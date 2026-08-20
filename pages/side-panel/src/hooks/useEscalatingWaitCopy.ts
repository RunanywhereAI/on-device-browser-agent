import { useEffect, useState } from 'react';
import { t } from '@extension/i18n';

const READING_DELAY_MS = 600;
const WARMING_DELAY_MS = 2500;

type WaitPhase = 'starting' | 'reading' | 'warming';

/**
 * The "please wait" copy shown before the first result of an in-flight step:
 * "Starting…" immediately, "Reading the page…" after ~600ms, then "Warming up
 * the model — the first reply takes longest" after ~2.5s.
 *
 * `resetKey` identifies the current step; changing it (a new step started)
 * restarts the ladder from the top rather than continuing a previous step's
 * clock.
 */
export function useEscalatingWaitCopy(active: boolean, resetKey: string): string {
  const [phase, setPhase] = useState<WaitPhase>('starting');

  useEffect(() => {
    if (!active) return undefined;
    setPhase('starting');
    const readingTimer = window.setTimeout(() => setPhase('reading'), READING_DELAY_MS);
    const warmingTimer = window.setTimeout(() => setPhase('warming'), WARMING_DELAY_MS);
    return () => {
      window.clearTimeout(readingTimer);
      window.clearTimeout(warmingTimer);
    };
    // resetKey deliberately restarts the ladder for a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, resetKey]);

  if (!active) return '';

  switch (phase) {
    case 'reading':
      return t('chat_wait_readingPage');
    case 'warming':
      return t('chat_wait_warmingUp');
    default:
      return t('chat_wait_starting');
  }
}
