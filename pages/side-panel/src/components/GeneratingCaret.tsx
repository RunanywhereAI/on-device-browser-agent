import { t } from '@extension/i18n';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * A pulsing 9x9px caret shown at the tail of in-flight assistant text.
 *
 * Suppressed entirely (not merely stilled) under `prefers-reduced-motion`,
 * per the design system's rule that a Reduce Motion user should not be shown
 * a "breathing" indicator with the breathing removed — either it conveys
 * "still working" through motion, or it does not appear at all.
 */
export function GeneratingCaret() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <span
      role="img"
      aria-label={t('chat_generating_a11y')}
      className="ml-1 inline-block size-[9px] shrink-0 animate-ra-breathe rounded-full bg-brand align-middle"
    />
  );
}
