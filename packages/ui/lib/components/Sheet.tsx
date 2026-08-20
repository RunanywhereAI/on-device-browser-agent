import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<'div'>, 'title' | 'children'>;

const TITLE_ID = 'ra-sheet-title';

/**
 * A bottom sheet (this ships in a ~400px side panel, so there is no desktop
 * centered-dialog variant to fall back to at wider widths). Traps focus,
 * closes on Escape, restores focus to the trigger on close, and marks the
 * rest of the document inert/aria-hidden while open.
 *
 * Escape/Tab handling is a document-level listener (attached only while
 * `open`) rather than a JSX `onKeyDown` on the dialog element — the dialog's
 * `role="dialog"` is intentionally non-interactive, and a document listener
 * also keeps the trap working if focus is ever programmatically moved
 * outside the panel.
 */
export function Sheet({ open, onClose, title, children, className, ...props }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const root = panelRef.current?.closest('[data-ra-sheet-root]');
    const siblings = Array.from(document.body.children).filter(el => el !== root);
    const restoreFns: Array<() => void> = [];
    for (const el of siblings) {
      const target = el as HTMLElement;
      const hadAriaHidden = target.hasAttribute('aria-hidden');
      const hadInert = target.inert;
      target.setAttribute('aria-hidden', 'true');
      target.inert = true;
      restoreFns.push(() => {
        if (!hadAriaHidden) target.removeAttribute('aria-hidden');
        target.inert = hadInert;
      });
    }

    const focusables = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusables[0] ?? panelRef.current)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const current = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (current.length === 0) {
        event.preventDefault();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreFns.forEach(fn => fn());
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ra-sheet-root" data-ra-sheet-root="">
      <button type="button" className="ra-sheet__scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? TITLE_ID : undefined}
        className={cn('ra-sheet__panel', className)}
        tabIndex={-1}
        {...props}>
        {title ? (
          <div className="ra-sheet__header">
            <span id={TITLE_ID} className="ra-sheet__title">
              {title}
            </span>
            <button type="button" className="ra-sheet__close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
        <div className="ra-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
