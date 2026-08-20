import { Disclosure, Chip, type ChipTone } from '@extension/ui';
import { t } from '@extension/i18n';
import type { ToolCallUiMessage, StepStatus } from '../types/uiMessage';
import { GeneratingCaret } from './GeneratingCaret';

const STATUS_TONE: Record<StepStatus, ChipTone> = {
  running: 'brand',
  ok: 'success',
  fail: 'danger',
};

function statusLabel(status: StepStatus): string {
  switch (status) {
    case 'running':
      return t('chat_toolCall_status_running');
    case 'fail':
      return t('chat_toolCall_status_failed');
    default:
      return t('chat_toolCall_status_done');
  }
}

/**
 * One Navigator action as a collapsible "tool call" row, driven by
 * ACT_START/ACT_OK/ACT_FAIL: a summary line (the action, truncated, plus a
 * status chip and a caret while it is still running) that expands to the
 * full arguments and — once settled — the result.
 */
export function ToolCallRow({ message }: { message: ToolCallUiMessage }) {
  const running = message.status === 'running';

  return (
    <Disclosure
      defaultOpen={false}
      summary={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-foreground">{message.action}</span>
          {running && <GeneratingCaret />}
          <Chip tone={STATUS_TONE[message.status]} className="shrink-0">
            {statusLabel(message.status)}
          </Chip>
        </span>
      }>
      <div className="space-y-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('chat_toolCall_arguments')}
          </div>
          <div className="whitespace-pre-wrap break-words">{message.action}</div>
        </div>
        {message.result ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('chat_toolCall_result')}
            </div>
            <div className="whitespace-pre-wrap break-words">{message.result}</div>
          </div>
        ) : null}
      </div>
    </Disclosure>
  );
}
