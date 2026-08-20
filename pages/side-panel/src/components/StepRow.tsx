import { Disclosure, Chip, type ChipTone } from '@extension/ui';
import { t } from '@extension/i18n';
import { ACTOR_PROFILES } from '../types/message';
import type { StepUiMessage, StepStatus } from '../types/uiMessage';
import { useEscalatingWaitCopy } from '../hooks/useEscalatingWaitCopy';
import { GeneratingCaret } from './GeneratingCaret';

const STATUS_TONE: Record<StepStatus, ChipTone> = {
  running: 'brand',
  ok: 'success',
  fail: 'danger',
};

function statusLabel(status: StepStatus): string {
  switch (status) {
    case 'running':
      return t('chat_step_status_running');
    case 'fail':
      return t('chat_step_status_failed');
    default:
      return t('chat_step_status_done');
  }
}

/**
 * A Planner/Navigator/Validator "thinking" step: an auto-expanding Disclosure
 * that shows escalating wait copy (plus a generating caret) while running,
 * then collapses to the real reasoning once the step settles — the reader
 * can still click it back open.
 */
export function StepRow({ message }: { message: StepUiMessage }) {
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const running = message.status === 'running';
  const waitCopy = useEscalatingWaitCopy(running, message.id);
  const bodyText = running ? waitCopy : message.text;

  return (
    <Disclosure
      defaultOpen={running}
      summary={
        <span className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{actor?.name ?? message.actor}</span>
          <Chip tone={STATUS_TONE[message.status]}>{statusLabel(message.status)}</Chip>
        </span>
      }>
      <span className="whitespace-pre-wrap break-words">
        {bodyText}
        {running && <GeneratingCaret />}
      </span>
    </Disclosure>
  );
}
