import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../utils';

export type DisclosureProps = {
  summary: ReactNode;
  defaultOpen?: boolean;
} & Omit<ComponentPropsWithoutRef<'details'>, 'open' | 'children'> & { children?: ReactNode };

/**
 * A `<details>`-based collapsible with a rotating chevron. `defaultOpen` only
 * seeds the initial state — like a real `<details open>`, the element stays
 * uncontrolled after mount, so a user's manual toggle is never fought by a
 * re-render.
 */
export function Disclosure({ summary, children, defaultOpen = false, className, ...props }: DisclosureProps) {
  return (
    <details className={cn('ra-disclosure', className)} open={defaultOpen} {...props}>
      <summary className="ra-disclosure__summary">
        <svg
          className="ra-disclosure__chevron"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="ra-disclosure__summary-content">{summary}</span>
      </summary>
      <div className="ra-disclosure__content">{children}</div>
    </details>
  );
}
