import { useState } from 'react';
import { Chip, Sheet } from '@extension/ui';
import { t } from '@extension/i18n';
import { findModel, formatBytes, chooseModel, type RaCapabilities } from '@extension/runanywhere';

interface ModelStatusProps {
  /** The catalog id of the on-device model that is actually downloaded/active. */
  modelId: string;
  capabilities: RaCapabilities | null;
}

/**
 * A compact, always-visible statement of which model is running — reassurance
 * ("Running LFM2.5 2.6B, chosen for your Mac"), never a picker. Clicking opens
 * a Sheet with a bit more detail and a link to the options page for anyone who
 * wants to override the automatic choice.
 */
export function ModelStatus({ modelId, capabilities }: ModelStatusProps) {
  const [open, setOpen] = useState(false);
  const model = findModel(modelId);
  if (!model) return null;

  const choice = chooseModel(capabilities);
  const rationale = choice.model.id === model.id ? choice.rationale : t('status_model_fastStartRationale');
  const computeLabel = capabilities?.hasWebGPU ? t('status_sheet_compute_gpu') : t('status_sheet_compute_cpu');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('status_model_chip_a11y')}
        className="inline-flex rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <Chip tone="brand">{t('status_model_running', [model.label])}</Chip>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('status_sheet_title')}>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">{rationale}</p>
          <dl className="space-y-2">
            <StatusRow label={t('status_sheet_model')} value={model.label} />
            <StatusRow label={t('status_sheet_size')} value={formatBytes(model.totalBytes)} />
            <StatusRow label={t('status_sheet_context')} value={model.contextLength.toLocaleString()} />
            <StatusRow label={t('status_sheet_compute')} value={computeLabel} />
          </dl>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="text-sm font-medium text-brand hover:text-brand-hover">
            {t('status_sheet_advancedLink')}
          </button>
        </div>
      </Sheet>
    </>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
