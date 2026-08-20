/**
 * The on-device model section: the primary, lead surface of the "Models" tab.
 *
 * Product framing (see the task brief this was built from): on-device inference
 * is the default and the whole point — no API key, no cloud, page content never
 * leaves the browser. The user is never asked to make a technical choice; we
 * pick the model for their hardware and say what we picked. The one deliberate
 * exception is the very first choice, which is a genuine tradeoff (a smaller,
 * faster-to-fetch model vs. a bigger, better one) and is framed in plain,
 * non-technical terms — never a quantisation string.
 *
 * WHERE "first run" comes from
 * -----------------------------
 * `chrome-extension/src/background/setupOnDevice.ts` already seeds both agent
 * roles with `chooseModel(null)` on install, so by the time this page loads
 * there is almost always already a recorded on-device choice — it just hasn't
 * been downloaded yet (seeding deliberately never touches the engine). So the
 * two-card "Start now / Best quality" chooser below is shown only when there is
 * truly no on-device choice on record at all (fresh profile before the install
 * hook ran, a user who switched away to a cloud provider, or the hook failing);
 * otherwise this renders the steady-state active-model card and, if needed, a
 * plain "resume the download" affordance — using `getCapabilities()` for a real
 * device read rather than the install hook's mainstream-laptop assumption.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Disclosure, ProgressBar, Sheet } from '@extension/ui';
import { t } from '@extension/i18n';
import {
  agentModelStore,
  llmProviderStore,
  AgentNameEnum,
  ProviderTypeEnum,
  getDefaultProviderConfig,
  type ModelConfig,
} from '@extension/storage';
import * as RaBridge from '@extension/runanywhere';
import {
  findModel,
  selectableModels,
  formatBytes,
  chooseModel,
  getCapabilities,
  getModelState,
  ensureModel,
  LFM25_1_2B,
} from '@extension/runanywhere';
import type { RaCapabilities, RaModelEntry, RaModelStateEntry, RaDownloadProgress } from '@extension/runanywhere';

/*
 * -----------------------------------------------------------------------------
 * LITERAL STRINGS — no i18n key exists for these yet.
 *
 * `options_ondevice_title`, `_activeModel`, `_advanced`, `_switchModel`,
 * `_downloaded`, `_notDownloaded` and `_delete` exist now (added by the
 * sibling agent who owns packages/i18n partway through this task) and are
 * used via `t()` below; `_cloudSection` is used the same way in Options.tsx.
 * Everything else this section needs — first-run copy, download-phase text,
 * the delete-confirm dialog, error copy — has no key yet. Per the brief's own
 * fallback rule this file must not touch packages/i18n/**, so these stay
 * literal English; the full list with suggested key names is in the handoff
 * report for i18n follow-up.
 * -----------------------------------------------------------------------------
 */
const STRINGS = {
  noConfigNeeded: 'Runs entirely on this device — no account, no API key, and page content never leaves your browser.',
  checkingDevice: 'Checking your device…',
  loadError: "Couldn't read the on-device model state.",
  firstRunHeading: "We'll download a model to get started",
  firstRunSingleBlurbPrefix: 'Chosen for your device: ',
  startNowHeading: 'Start now',
  startNowBlurb: 'Ready in about a minute.',
  bestQualityHeading: 'Best quality',
  bestQualityBlurbSuffix: ' — better at harder pages.',
  sizeLabel: 'Size',
  contextLabel: 'Context',
  runsOnLabel: 'Runs on',
  tokensSuffix: 'tokens',
  gpu: 'GPU',
  cpu: 'CPU',
  notDownloadedIdle: 'Paused — resume picks up where it stopped.',
  resumeDownload: 'Resume download',
  tryAgain: 'Try again',
  advancedSubtitle: 'We already picked the model above for your device. Choose a different one if you prefer.',
  selected: 'Selected',
  deleteConfirmTitle: 'Delete this model?',
  deleteConfirmBodyActive:
    'Since this is the model currently in use, the extension will automatically switch to the best model for ' +
    'your device.',
  deleteConfirmBodyInactive: 'You can download it again any time.',
  deleteConfirmFreesUpPrefix: 'This frees up ',
  cancel: 'Cancel',
  deleteNotAvailable:
    'Deleting downloaded models is not available in this build yet — the on-device bridge does not expose it.',
  phaseQueued: 'Starting…',
  phaseVerifying: 'Checking download',
  phaseExtracting: 'Unpacking',
  phaseCancelling: 'Cancelling…',
  phaseWorking: 'Working…',
  downloading: 'Downloading…',
  bytesOf: 'of',
  left: 'left',
} as const;

/** Bridge export this file expects once packages/runanywhere wires model deletion through. See the report. */
type DeleteCapableBridge = {
  deleteModel?: (modelId: string) => Promise<void>;
};

/**
 * Delete a downloaded model's bytes.
 *
 * The underlying `@runanywhere/web` SDK already exposes `RunAnywhere.models.delete(id)`
 * (confirmed in its shipped type declarations), but nothing between here and
 * there wires it up yet: `packages/runanywhere/lib/protocol.ts` has no
 * `deleteModel` request/response pair, `bridgeClient.ts` has no matching
 * export, and `pages/offscreen/src/host.ts` has no handler that would call the
 * SDK. None of those three files are owned by this task (pages/options/**
 * only), so this cannot be wired end-to-end here.
 *
 * This is written as a forward-compatible feature probe rather than a static
 * import of a name that does not exist yet (which would fail type-check
 * today): the moment `@extension/runanywhere` grows an export literally named
 * `deleteModel(modelId: string): Promise<void>`, this starts working with no
 * further change in this file. Until then it fails clearly and immediately —
 * never a silently-hung "Deleting…" spinner.
 */
async function deleteDownloadedModel(modelId: string): Promise<void> {
  const bridge = RaBridge as unknown as DeleteCapableBridge;
  if (typeof bridge.deleteModel !== 'function') {
    throw new Error(STRINGS.deleteNotAvailable);
  }
  await bridge.deleteModel(modelId);
}

function truncateNotes(notes: string | undefined, max = 160): string {
  if (!notes) return '';
  if (notes.length <= max) return notes;
  const cut = notes.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

/** Phase vocabulary shared with every RunAnywhere app. Never fabricates a percentage. */
function phaseText(progress: RaDownloadProgress): string {
  switch (progress.phase) {
    case 'queued':
      return STRINGS.phaseQueued;
    case 'transferring': {
      const done = progress.bytesDone != null ? formatBytes(progress.bytesDone) : undefined;
      const total = progress.bytesTotal != null ? formatBytes(progress.bytesTotal) : undefined;
      const rate = progress.bytesPerSecond != null ? `${formatBytes(progress.bytesPerSecond)}/s` : undefined;
      const eta = progress.etaSeconds != null ? `${formatEta(progress.etaSeconds)} ${STRINGS.left}` : undefined;
      const size = done && total ? `${done} ${STRINGS.bytesOf} ${total}` : done;
      const parts = [size, rate, eta].filter((part): part is string => Boolean(part));
      return parts.length > 0 ? parts.join(' · ') : STRINGS.downloading;
    }
    case 'verifying':
      return STRINGS.phaseVerifying;
    case 'extracting':
      return STRINGS.phaseExtracting;
    case 'cancelling':
      return STRINGS.phaseCancelling;
    default:
      return STRINGS.phaseWorking;
  }
}

/** Only 'transferring' has a real fraction; every other phase renders as indeterminate. */
function progressValue(progress: RaDownloadProgress): number | undefined {
  if (progress.phase !== 'transferring') return undefined;
  return progress.fraction;
}

function accelerationLabel(capabilities: RaCapabilities | null): string | null {
  if (!capabilities) return null;
  return capabilities.hasWebGPU ? STRINGS.gpu : STRINGS.cpu;
}

export const OnDeviceSettings = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<RaCapabilities | null>(null);
  const [modelStates, setModelStates] = useState<readonly RaModelStateEntry[]>([]);
  const [navConfig, setNavConfig] = useState<ModelConfig | undefined>(undefined);

  // Selecting a model (first run or the Advanced override) and downloading it.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RaDownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [selectBusy, setSelectBusy] = useState(false);

  // Delete confirm.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [caps, states, nav] = await Promise.all([
        getCapabilities().catch(() => null),
        getModelState().catch(() => [] as readonly RaModelStateEntry[]),
        agentModelStore.getAgentModel(AgentNameEnum.Navigator).catch(() => undefined),
      ]);
      setCapabilities(caps);
      setModelStates(states);
      setNavConfig(nav);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : STRINGS.loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const candidateModel: RaModelEntry | undefined =
    navConfig?.provider === ProviderTypeEnum.RunAnywhere ? findModel(navConfig.modelName) : undefined;
  const candidateState = candidateModel ? modelStates.find(entry => entry.id === candidateModel.id) : undefined;
  const isDownloaded = candidateState?.downloaded ?? false;
  const showChooser = candidateModel === undefined;
  const acceleration = accelerationLabel(capabilities);

  const fastModel = useMemo(() => findModel(LFM25_1_2B), []);
  const bestChoice = useMemo(() => chooseModel(capabilities), [capabilities]);
  const onlyOneOption = fastModel !== undefined && bestChoice.model.id === fastModel.id;

  /** Ensure the RunAnywhere provider row exists so `setupExecutor` never sees an unconfigured provider. */
  const ensureProviderSeeded = useCallback(async () => {
    const hasProvider = await llmProviderStore.hasProvider(ProviderTypeEnum.RunAnywhere);
    if (!hasProvider) {
      await llmProviderStore.setProvider(
        ProviderTypeEnum.RunAnywhere,
        getDefaultProviderConfig(ProviderTypeEnum.RunAnywhere),
      );
    }
  }, []);

  const persistChoice = useCallback(
    async (modelId: string) => {
      await ensureProviderSeeded();
      await agentModelStore.setAgentModel(AgentNameEnum.Navigator, {
        provider: ProviderTypeEnum.RunAnywhere,
        modelName: modelId,
      });
      await agentModelStore.setAgentModel(AgentNameEnum.Planner, {
        provider: ProviderTypeEnum.RunAnywhere,
        modelName: modelId,
      });
    },
    [ensureProviderSeeded],
  );

  const startDownload = useCallback(
    async (modelId: string) => {
      setDownloadingId(modelId);
      setDownloadError(null);
      setProgress({ phase: 'queued' });
      try {
        await ensureModel(modelId, p => setProgress(p));
        await refresh();
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : String(error));
      } finally {
        setDownloadingId(null);
        setProgress(null);
      }
    },
    [refresh],
  );

  const chooseAndDownload = useCallback(
    async (modelId: string) => {
      setSelectBusy(true);
      try {
        await persistChoice(modelId);
        await refresh();
        await startDownload(modelId);
      } finally {
        setSelectBusy(false);
      }
    },
    [persistChoice, refresh, startDownload],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    const deletingId = confirmDeleteId;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDownloadedModel(deletingId);
      if (candidateModel?.id === deletingId) {
        const fallback = chooseModel(capabilities);
        await persistChoice(fallback.model.id);
      }
      setConfirmDeleteId(null);
      await refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusy(false);
    }
  }, [confirmDeleteId, candidateModel, capabilities, persistChoice, refresh]);

  const deletingEntry = confirmDeleteId ? findModel(confirmDeleteId) : undefined;
  const deletingIsActive = confirmDeleteId !== null && candidateModel?.id === confirmDeleteId;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('options_ondevice_title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{STRINGS.noConfigNeeded}</p>
      </div>

      {loadError && (
        <Card>
          <p className="text-sm text-danger-text">{loadError}</p>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-sm text-muted-foreground">{STRINGS.checkingDevice}</p>
        </Card>
      ) : showChooser ? (
        <Card>
          <h3 className="mb-3 text-base font-semibold text-foreground">{STRINGS.firstRunHeading}</h3>
          {onlyOneOption ? (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-1 text-sm font-medium text-foreground">{bestChoice.model.label}</p>
              <p className="mb-3 text-xs text-muted-foreground">
                {STRINGS.firstRunSingleBlurbPrefix}
                {formatBytes(bestChoice.model.totalBytes)}. {bestChoice.rationale}
              </p>
              <Button disabled={selectBusy} onClick={() => chooseAndDownload(bestChoice.model.id)}>
                {STRINGS.startNowHeading}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <p className="mb-1 text-sm font-semibold text-foreground">{STRINGS.startNowHeading}</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {fastModel ? formatBytes(fastModel.totalBytes) : ''} · {STRINGS.startNowBlurb}
                </p>
                <Button
                  variant="secondary"
                  disabled={selectBusy || !fastModel}
                  onClick={() => fastModel && chooseAndDownload(fastModel.id)}>
                  {STRINGS.startNowHeading}
                </Button>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="mb-1 text-sm font-semibold text-foreground">{STRINGS.bestQualityHeading}</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {formatBytes(bestChoice.model.totalBytes)}
                  {STRINGS.bestQualityBlurbSuffix}
                </p>
                <Button disabled={selectBusy} onClick={() => chooseAndDownload(bestChoice.model.id)}>
                  {STRINGS.bestQualityHeading}
                </Button>
              </div>
            </div>
          )}

          {downloadingId && progress && (
            <div className="mt-4">
              <ProgressBar value={progressValue(progress)} label={phaseText(progress)} />
              <p className="mt-1 text-xs text-muted-foreground">{phaseText(progress)}</p>
            </div>
          )}
          {downloadError && (
            <div className="mt-4">
              <p className="text-sm text-danger-text">{downloadError}</p>
              <Button
                variant="secondary"
                className="mt-2"
                onClick={() => {
                  if (downloadingId === null) void chooseAndDownload(bestChoice.model.id);
                }}>
                {STRINGS.tryAgain}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        candidateModel && (
          <Card>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('options_ondevice_activeModel')}
                </p>
                <h3 className="text-lg font-semibold text-foreground">{candidateModel.label}</h3>
              </div>
              <Chip tone={isDownloaded ? 'success' : 'warning'}>
                {isDownloaded ? t('options_ondevice_downloaded') : t('options_ondevice_notDownloaded')}
              </Chip>
            </div>

            <dl className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="inline text-muted-foreground">{STRINGS.sizeLabel}: </dt>
                <dd className="inline text-foreground">{formatBytes(candidateModel.totalBytes)}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{STRINGS.contextLabel}: </dt>
                <dd className="inline text-foreground">
                  {candidateModel.contextLength.toLocaleString()} {STRINGS.tokensSuffix}
                </dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{STRINGS.runsOnLabel}: </dt>
                <dd className="inline text-foreground">{acceleration ?? '—'}</dd>
              </div>
            </dl>

            {!isDownloaded && (
              <div>
                {downloadingId === candidateModel.id && progress ? (
                  <div>
                    <ProgressBar value={progressValue(progress)} label={phaseText(progress)} />
                    <p className="mt-1 text-xs text-muted-foreground">{phaseText(progress)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">{STRINGS.notDownloadedIdle}</p>
                    <Button disabled={selectBusy} onClick={() => startDownload(candidateModel.id)}>
                      {STRINGS.resumeDownload}
                    </Button>
                  </div>
                )}
                {downloadError && <p className="mt-2 text-sm text-danger-text">{downloadError}</p>}
              </div>
            )}
          </Card>
        )
      )}

      {!loading && (
        <Disclosure summary={t('options_ondevice_advanced')}>
          <p className="mb-3 text-sm text-muted-foreground">{STRINGS.advancedSubtitle}</p>
          <ul className="space-y-2">
            {selectableModels().map(entry => {
              const state = modelStates.find(model => model.id === entry.id);
              const isActive = candidateModel?.id === entry.id;
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{entry.label}</span>
                      {state?.downloaded && (
                        <Chip tone="success" className="text-[10px]">
                          {t('options_ondevice_downloaded')}
                        </Chip>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(entry.totalBytes)} · {truncateNotes(entry.notes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button
                      variant={isActive ? 'secondary' : 'primary'}
                      disabled={isActive || selectBusy}
                      onClick={() => chooseAndDownload(entry.id)}>
                      {isActive ? STRINGS.selected : t('options_ondevice_switchModel')}
                    </Button>
                    {state?.downloaded && (
                      <Button variant="danger" disabled={deleteBusy} onClick={() => setConfirmDeleteId(entry.id)}>
                        {t('options_ondevice_delete')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      <Sheet
        open={confirmDeleteId !== null}
        onClose={() => (deleteBusy ? undefined : setConfirmDeleteId(null))}
        title={STRINGS.deleteConfirmTitle}>
        <p className="mb-4 text-sm text-muted-foreground">
          {STRINGS.deleteConfirmFreesUpPrefix}
          {deletingEntry ? formatBytes(deletingEntry.totalBytes) : ''}
          {'. '}
          {deletingIsActive ? STRINGS.deleteConfirmBodyActive : STRINGS.deleteConfirmBodyInactive}
        </p>
        {deleteError && <p className="mb-3 text-sm text-danger-text">{deleteError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={deleteBusy} onClick={() => setConfirmDeleteId(null)}>
            {STRINGS.cancel}
          </Button>
          <Button variant="danger" disabled={deleteBusy} onClick={() => handleConfirmDelete()}>
            {t('options_ondevice_delete')}
          </Button>
        </div>
      </Sheet>
    </section>
  );
};
