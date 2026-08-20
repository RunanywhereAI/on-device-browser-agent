/**
 * Choosing a model for the user, so they never have to.
 *
 * This is a consumer product: the model is an implementation detail we own. The
 * UI reports the outcome ("Running Qwen3 4B, chosen for your Mac") rather than
 * presenting a menu.
 *
 * Deliberately NOT a RAM heuristic. The browser exposes only a coarse,
 * power-of-two-bucketed `navigator.deviceMemory`, no VRAM at all, and the real
 * constraint is the WASM heap rather than system memory — so a hand-rolled
 * "GB >= X" rule would be inventing precision that does not exist. The probe
 * below only ORDERS candidates; whether a model can actually run is the SDK's
 * call, via its own compatibility check inside the offscreen document.
 */

import { selectableModels, type RaModelEntry } from './modelCatalog';
import type { RaCapabilities } from './protocol';

export interface RaModelChoice {
  readonly model: RaModelEntry;
  /** One short sentence, shown to the user as reassurance. */
  readonly rationale: string;
  /** True when we fell back to something smaller than the best model. */
  readonly constrained: boolean;
}

/** No capability signal at all — assume a mainstream laptop rather than the floor. */
const ASSUMED_MEMORY_GB = 8;

function describeDevice(capabilities: RaCapabilities | null): string {
  if (!capabilities) return 'your device';
  if (capabilities.hasWebGPU && capabilities.hasShaderF16) return 'your GPU';
  if (capabilities.hasWebGPU) return 'your device';
  return "your device's processor";
}

/**
 * Pick the most capable model this device should run.
 *
 * Candidates come in capability order (best first), which is NOT size order:
 * the preferred default is smaller than its alternative, because leaving room
 * for KV cache matters more for long agentic tasks than raw parameter count.
 * The first candidate whose advisory memory floor the device clears wins.
 *
 * A device below every floor still gets the smallest selectable model — refusing
 * to run at all is a worse experience than running slowly, and the SDK raises a
 * real error if it genuinely cannot load.
 */
export function chooseModel(capabilities: RaCapabilities | null): RaModelChoice {
  // Catalog order is capability order, best first — deliberately not size
  // order, since the preferred default is smaller than its alternative.
  const candidates = selectableModels();
  if (candidates.length === 0) {
    throw new Error('No selectable models are registered.');
  }

  const memoryGb = capabilities?.deviceMemoryGb ?? ASSUMED_MEMORY_GB;
  const best = candidates[0];

  const fit = candidates.find(entry => memoryGb >= entry.minDeviceMemoryGb);
  const smallest = candidates[candidates.length - 1];
  const model = fit ?? smallest;

  const where = describeDevice(capabilities);
  if (model.id === best.id) {
    return {
      model,
      rationale: `Chosen for ${where}.`,
      constrained: false,
    };
  }

  return {
    model,
    rationale: `Chosen for ${where} — a smaller model so tasks stay responsive here.`,
    constrained: true,
  };
}

/**
 * Whether this browser can run on-device inference at all.
 *
 * WebGPU is not required: the SDK falls back to a CPU WASM build, just slower.
 * What is genuinely required is WebAssembly and somewhere to cache multi-gigabyte
 * weights, so OPFS is the real gate.
 */
export function describeBlockers(capabilities: RaCapabilities): readonly string[] {
  const blockers: string[] = [];
  if (!capabilities.hasOPFS) {
    blockers.push('This browser cannot store model files on disk, so a model cannot be cached.');
  }
  if (!capabilities.hasWebGPU) {
    blockers.push('Without GPU acceleration, responses will be noticeably slower.');
  }
  return blockers;
}
