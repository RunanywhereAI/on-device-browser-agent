/**
 * The models this extension can run, and how big they really are.
 *
 * The catalog is app-owned by design: the SDK downloads and loads whatever it
 * has been told about, but it can only resolve ids it already knows, so we
 * register these at boot.
 *
 * THE BUDGET, AND WHY IT IS NOT JUST ABOUT WEIGHTS
 * ------------------------------------------------
 * Everything lives in one wasm32 linear memory capped at 4 GiB, and the SDK
 * pins `-sMAXIMUM_MEMORY=4294967296` identically for every WASM target — the
 * WebGPU build gets no more room than the CPU build. Memory64 is deliberately
 * disabled in the SDK (its main module is wasm32 and Emscripten cannot link
 * wasm32 against wasm64).
 *
 * Crucially, **weights and KV cache share that budget**. For agentic work the
 * KV cache is not a rounding error: it grows with every step of a task, and
 * running out of it is what ends a long task early. So a smaller model is not
 * merely "cheaper" — it buys context. Roughly, after ~0.4 GB of runtime, stack
 * and staging overhead:
 *
 *   LFM2.5-2.6B      1.56 GB weights  ->  ~2.0 GB left for KV
 *   Qwen3-4B         2.33 GB weights  ->  ~1.3 GB left for KV
 *   LFM2.5-VL-3B     2.10 GB weights  ->  ~1.5 GB left, minus image tokens
 *   Qwen3-VL-4B      3.11 GB weights  ->  ~0.5 GB left  (too tight to use)
 *
 * Three models that look like obvious picks and are not:
 *  - **Qwen3.6 has no small variant.** Qwen publishes 27B dense and 35B-A3B
 *    only; there is no 9B. Every smaller "Qwen3.6" on the hub is a community
 *    merge at 27B or above.
 *  - **LFM2.5-8B-A1B does not fit**, at 4.80 GB for Q4_K_M. Mixture-of-experts
 *    reduces *compute* to ~1B active parameters but every expert must still be
 *    resident, so it exceeds the entire 4 GiB address space.
 *  - **Fara1.5** is purpose-trained for browser use and would otherwise be
 *    ideal, but the smallest published GGUF is the 9B at ~5.9 GB. Worth
 *    re-checking whether a 4B GGUF has appeared.
 *
 * Every `sizeBytes` below was measured from the live download URL.
 */

/** Which agent role a model is fit for. */
export type RaModelRole = 'both' | 'test';

export interface RaModelFile {
  readonly url: string;
  /** 'primary' is the weights; 'projector' is a VLM's mmproj. */
  readonly role: 'primary' | 'projector';
  readonly sizeBytes: number;
}

export interface RaModelEntry {
  readonly id: string;
  /** Shown to the user. Consumer-facing, so no quantisation jargon. */
  readonly label: string;
  readonly files: readonly RaModelFile[];
  /** Sum of all files — what the user actually downloads. */
  readonly totalBytes: number;
  /**
   * Context window we actually configure, in tokens.
   *
   * Deliberately below what several of these models support. LFM2.5 is trained
   * to 131,072 tokens, but a KV cache that long would need far more than the
   * whole 4 GiB budget, so the real limit is memory rather than the model. This
   * is the value we ask for; treat it as a starting point to tune per device.
   */
  readonly contextLength: number;
  /** What the model itself is trained to handle, for reference. */
  readonly nativeContextLength: number;
  readonly vision: boolean;
  readonly role: RaModelRole;
  /**
   * Rough floor for comfortable operation. Advisory only — the real decision
   * goes through the SDK's own compatibility check, which knows about the WASM
   * heap; this only orders candidates.
   */
  readonly minDeviceMemoryGb: number;
  /** Not yet validated end to end on this platform. Never auto-selected. */
  readonly experimental?: boolean;
  readonly notes?: string;
}

const HF = 'https://huggingface.co';

export const LFM25_2_6B = 'lfm2.5-2.6b-q4_k_m';
export const LFM25_1_2B = 'lfm2.5-1.2b-q4_k_m';
export const LFM25_VL_3B = 'lfm2.5-vl-3b-q4_k_m';
export const QWEN3_4B = 'qwen3-4b-q4_k_m';
export const QWEN3_0_6B = 'qwen3-0.6b-q4_k_m';

export const RA_MODEL_CATALOG: readonly RaModelEntry[] = [
  {
    id: LFM25_2_6B,
    label: 'LFM2.5 2.6B',
    files: [
      {
        url: `${HF}/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf`,
        role: 'primary',
        sizeBytes: 1_674_455_040,
      },
    ],
    totalBytes: 1_674_455_040,
    contextLength: 32_768,
    nativeContextLength: 131_072,
    vision: false,
    role: 'both',
    minDeviceMemoryGb: 8,
    notes:
      'The default, and the best fit for this product by some distance. Liquid post-trained it ' +
      'specifically as an agent (their own card recommends it for "agentic workloads, tool use, ' +
      'data extraction, RAG, and long-context workflows"), it is a hybrid architecture built for ' +
      'on-device use, and at 1.56 GB it leaves substantially more of the 4 GiB budget for KV cache ' +
      'than a 4B would — which is what actually determines how long a task can run. The SDK also ' +
      'ships a dedicated LFM2 tool-call parser, so its tool output is understood natively rather ' +
      'than by a generic fallback. Its card notes it is weaker at coding and knowledge-heavy ' +
      'tasks; neither is what browser automation asks of it.',
  },
  {
    id: QWEN3_4B,
    label: 'Qwen3 4B',
    files: [
      {
        url: `${HF}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`,
        role: 'primary',
        sizeBytes: 2_497_281_312,
      },
    ],
    totalBytes: 2_497_281_312,
    contextLength: 16_384,
    nativeContextLength: 32_768,
    vision: false,
    role: 'both',
    minDeviceMemoryGb: 16,
    notes:
      'The alternative when broader general knowledge matters more than context length. Larger ' +
      'and more capable per token than LFM2.5-2.6B, but its extra 0.8 GB of weights comes ' +
      'straight out of the KV budget, so long tasks hit the ceiling sooner.',
  },
  {
    id: LFM25_1_2B,
    label: 'LFM2.5 1.2B',
    files: [
      {
        url: `${HF}/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf`,
        role: 'primary',
        sizeBytes: 730_895_168,
      },
    ],
    totalBytes: 730_895_168,
    contextLength: 32_768,
    nativeContextLength: 131_072,
    vision: false,
    role: 'both',
    minDeviceMemoryGb: 4,
    notes:
      'The fast-start option: 0.68 GB, so the first task can begin in well under a minute, and ' +
      'the same agentic post-training and tool-call format as its larger sibling.',
  },
  {
    id: QWEN3_0_6B,
    label: 'Qwen3 0.6B',
    files: [
      {
        url: `${HF}/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf`,
        role: 'primary',
        sizeBytes: 396_705_472,
      },
    ],
    totalBytes: 396_705_472,
    contextLength: 4_096,
    nativeContextLength: 32_768,
    vision: false,
    role: 'test',
    minDeviceMemoryGb: 2,
    notes:
      'Integration testing only, never auto-selected. Too weak to navigate reliably, but it is ' +
      'the model the SDK Web release gate itself exercises, so it is the quickest way to prove ' +
      'the pipeline end to end.',
  },
  {
    id: LFM25_VL_3B,
    label: 'LFM2.5-VL 3B (vision)',
    files: [
      {
        url: `${HF}/LiquidAI/LFM2.5-VL-3B-GGUF/resolve/main/LFM2.5-VL-3B-Q4_K_M.gguf`,
        role: 'primary',
        sizeBytes: 1_674_454_240,
      },
      {
        url: `${HF}/LiquidAI/LFM2.5-VL-3B-GGUF/resolve/main/mmproj-LFM2.5-VL-3B-Q8_0.gguf`,
        role: 'projector',
        sizeBytes: 583_109_120,
      },
    ],
    totalBytes: 1_674_454_240 + 583_109_120,
    contextLength: 16_384,
    nativeContextLength: 131_072,
    vision: true,
    role: 'both',
    minDeviceMemoryGb: 16,
    experimental: true,
    notes:
      'Screenshot-driven control, for pages the DOM path cannot read (canvas apps, obfuscated ' +
      'widgets). At 2.10 GB including the projector it actually leaves usable KV headroom, unlike ' +
      'Qwen3-VL-4B at 3.11 GB which does not. Still gated behind a measured comparison against ' +
      'the DOM path on real hardware before it is offered by default.',
  },
];

export function findModel(id: string): RaModelEntry | undefined {
  return RA_MODEL_CATALOG.find(entry => entry.id === id);
}

/**
 * Models eligible for automatic selection.
 *
 * Ordered by capability rather than raw size, because size is not the ranking
 * we want: LFM2.5-2.6B is the preferred default despite Qwen3-4B being bigger.
 */
export function selectableModels(): readonly RaModelEntry[] {
  return RA_MODEL_CATALOG.filter(entry => entry.role === 'both' && !entry.experimental);
}

/** Human-readable size, matching the SDK apps' formatting. */
export function formatBytes(bytes: number): string {
  const GIB = 1024 ** 3;
  const MIB = 1024 ** 2;
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  if (bytes >= MIB) return `${Math.round(bytes / MIB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
