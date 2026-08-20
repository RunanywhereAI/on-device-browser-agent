import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, ProgressBar } from '@extension/ui';
import { t } from '@extension/i18n';
import {
  ensureModel,
  findModel,
  formatBytes,
  chooseModel,
  describeBlockers,
  LFM25_1_2B,
  type RaCapabilities,
  type RaDownloadProgress,
} from '@extension/runanywhere';

interface OnboardingProps {
  /** Null while capabilities are still loading, or if the probe failed — treated as "assume a mainstream device". */
  capabilities: RaCapabilities | null;
  /** Called once the chosen model has finished downloading and is ready to use. */
  onModelReady: (modelId: string) => void;
}

type Phase =
  | { readonly kind: 'choice' }
  | { readonly kind: 'downloading'; readonly modelId: string; readonly progress: RaDownloadProgress | null }
  | { readonly kind: 'error'; readonly modelId: string; readonly message: string; readonly quota: boolean }
  | { readonly kind: 'done'; readonly modelId: string };

function isQuotaMessage(message: string): boolean {
  return /quota|storage|disk|space/i.test(message);
}

function phaseCopy(progress: RaDownloadProgress, paused: boolean): string {
  if (paused && progress.phase === 'transferring') return t('onboarding_phase_paused');
  switch (progress.phase) {
    case 'queued':
      return t('onboarding_phase_queued');
    case 'verifying':
      return t('onboarding_phase_verifying');
    case 'extracting':
      return t('onboarding_phase_extracting');
    case 'cancelling':
      return t('onboarding_phase_cancelling');
    default:
      return t('onboarding_phase_transferring');
  }
}

function formatRate(bytesPerSecond?: number): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;
  return t('onboarding_rate', [formatBytes(bytesPerSecond)]);
}

function formatEta(etaSeconds?: number): string | null {
  if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
  if (etaSeconds < 60) return t('onboarding_eta_seconds', [String(Math.max(1, Math.round(etaSeconds)))]);
  return t('onboarding_eta_minutes', [String(Math.max(1, Math.round(etaSeconds / 60)))]);
}

/**
 * First-run choice between a fast, small download and the best-quality one,
 * with live, honest download progress and a resumable retry on failure.
 *
 * On-device inference is the default and needs no configuration — this is
 * the one deliberate exception, because a multi-gigabyte download is a real
 * tradeoff the user should get to make once, in plain terms (a wait vs. a
 * size), never as a model-picker.
 */
export function Onboarding({ capabilities, onModelReady }: OnboardingProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'choice' });
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const activeRequestRef = useRef(0);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const fastModel = findModel(LFM25_1_2B);
  const bestChoice = useMemo(() => chooseModel(capabilities), [capabilities]);
  const blockers = capabilities ? describeBlockers(capabilities) : [];
  const cannotCacheModels = capabilities ? !capabilities.hasOPFS : false;
  // Once the hard OPFS stop below applies, describeBlockers() has nothing else to say — this note
  // is only ever the "no WebGPU, so it'll be slower" advisory.
  const softNote = cannotCacheModels ? undefined : blockers[0];

  const startDownload = useCallback(
    (modelId: string) => {
      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      setPhase({ kind: 'downloading', modelId, progress: null });

      ensureModel(modelId, progress => {
        if (activeRequestRef.current !== requestId) return;
        setPhase(prev => (prev.kind === 'downloading' && prev.modelId === modelId ? { ...prev, progress } : prev));
      })
        .then(() => {
          if (activeRequestRef.current !== requestId) return;
          setPhase({ kind: 'done', modelId });
          onModelReady(modelId);
        })
        .catch((error: unknown) => {
          if (activeRequestRef.current !== requestId) return;
          const message = error instanceof Error ? error.message : String(error);
          setPhase({ kind: 'error', modelId, message, quota: isQuotaMessage(message) });
        });
    },
    [onModelReady],
  );

  const retry = useCallback(() => {
    if (phase.kind !== 'error') return;
    startDownload(phase.modelId);
  }, [phase, startDownload]);

  if (cannotCacheModels) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="max-w-sm text-center">
          <h3 className="mb-2 text-lg font-semibold text-foreground">{t('onboarding_blocked_title')}</h3>
          <p className="text-sm text-muted-foreground">{blockers[0] ?? t('onboarding_blocked_generic')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6">
      <Card className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <img src="/icon-128.png" alt="" className="mx-auto mb-3 size-10" />
          <h3 className="text-lg font-semibold text-foreground">{t('onboarding_title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('onboarding_subtitle')}</p>
        </div>

        {softNote && <p className="text-center text-xs text-warning-text">{softNote}</p>}

        {phase.kind === 'choice' && (
          <div className="space-y-2">
            {fastModel && (
              <ChoiceButton
                title={t('onboarding_choice_start_title')}
                description={t('onboarding_choice_start_desc')}
                size={formatBytes(fastModel.totalBytes)}
                onClick={() => startDownload(fastModel.id)}
              />
            )}
            <ChoiceButton
              title={t('onboarding_choice_best_title')}
              description={t('onboarding_choice_best_desc')}
              size={formatBytes(bestChoice.model.totalBytes)}
              onClick={() => startDownload(bestChoice.model.id)}
            />
          </div>
        )}

        {phase.kind === 'downloading' && (
          <DownloadingView modelId={phase.modelId} progress={phase.progress} isOffline={isOffline} />
        )}

        {phase.kind === 'error' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-danger-text">
              {phase.quota ? t('onboarding_error_quota') : t('onboarding_error_generic', [phase.message])}
            </p>
            <Button type="button" onClick={retry} className="w-full">
              {t('onboarding_retry')}
            </Button>
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="text-center">
            <p className="text-sm font-semibold text-success-text">{t('onboarding_done_title')}</p>
            <p className="text-xs text-muted-foreground">{t('onboarding_done_subtitle')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChoiceButton({
  title,
  description,
  size,
  onClick,
}: {
  title: string;
  description: string;
  size: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-foreground">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{size}</span>
      </div>
      <div className="text-sm text-muted-foreground">{description}</div>
    </button>
  );
}

function DownloadingView({
  modelId,
  progress,
  isOffline,
}: {
  modelId: string;
  progress: RaDownloadProgress | null;
  isOffline: boolean;
}) {
  const model = findModel(modelId);
  const label = model?.label ?? modelId;
  const rate = progress?.phase === 'transferring' && !isOffline ? formatRate(progress.bytesPerSecond) : null;
  const eta = progress?.phase === 'transferring' && !isOffline ? formatEta(progress.etaSeconds) : null;
  const bytesLine =
    progress?.bytesDone !== undefined && progress?.bytesTotal !== undefined
      ? t('onboarding_progress_bytes', [formatBytes(progress.bytesDone), formatBytes(progress.bytesTotal)])
      : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{t('onboarding_downloading_title', [label])}</span>
      </div>
      <ProgressBar value={progress?.fraction} label={t('onboarding_downloading_title', [label])} />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{progress ? phaseCopy(progress, isOffline) : t('onboarding_phase_queued')}</span>
        {bytesLine && <span>{bytesLine}</span>}
      </div>
      {(rate || eta) && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{rate}</span>
          <span>{eta}</span>
        </div>
      )}
    </div>
  );
}
