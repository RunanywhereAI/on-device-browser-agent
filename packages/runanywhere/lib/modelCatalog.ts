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
 *   LFM2.5-2.6B  Q5_K_M   1.94 GB weights  ->  ~1.6 GB left for KV
 *   LFM2.5-1.2B  Q5_K_M   0.79 GB weights  ->  ~2.8 GB left for KV
 *   Qwen3-4B     Q4_K_M   2.33 GB weights  ->  ~1.3 GB left for KV
 *   LFM2.5-VL-3B Q5+Q8    2.52 GB weights  ->  ~1.1 GB left, minus image tokens
 *
 * WHY Q5_K_M AND NOT Q4, OR A BIGGER MODEL AT Q2
 * ----------------------------------------------
 * Under a fixed budget the interesting question is not "how many parameters"
 * but "how much quality per byte". Q5_K_M costs ~0.27 GB more than Q4_K_M on
 * the 2.6B and is meaningfully closer to the unquantised model, while still
 * leaving more KV headroom than a 4B at Q4 would. Going the other way — a 9B
 * crushed to Q2 — spends the whole budget on weights, destroys quality, and
 * leaves nothing for context. So: a good quant of a right-sized model.
 * (Q6_K at 2.22 GB and Liquid's quantisation-aware `QAD-Q4_0` at 1.59 GB are
 * the quality and max-context ends of the same ladder if this needs tuning.)
 *
 * MODELS RULED OUT ON MEASURED EVIDENCE, not on vibes
 * ---------------------------------------------------
 *  - **Ornith-1.5-9B** (9.41B, MIT, vision-language). Every published quant is
 *    too big: the smallest, IQ2_M, is 3.51 GB, and being a VLM it also needs an
 *    0.86 GB projector — 4.37 GB together, more than the entire address space,
 *    with nothing left for KV. Q4_K_M is 5.50 GB. Its 35B-A3B sibling is far
 *    worse. Genuinely interesting model, physically impossible here.
 *  - **Qwen3.6 has no small variant.** Qwen publishes 27B dense and 35B-A3B
 *    only; there is no 9B. Every smaller "Qwen3.6" on the hub is a community
 *    merge at 27B or above.
 *  - **LFM2.5-8B-A1B does not fit**, at 4.80 GB for Q4_K_M. Mixture-of-experts
 *    cuts *compute* to ~1B active parameters but every expert stays resident.
 *  - **Fara1.5** is purpose-trained for browser use and would otherwise be
 *    ideal, but its smallest published GGUF is the 9B at ~5.9 GB.
 *  - **Qwen3-VL-4B** fits only on paper: 3.11 GB leaves ~0.5 GB for KV and
 *    image tokens, so LFM2.5-VL-3B is the vision choice instead.
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
  /**
   * Computer-use profile, for a model trained to drive a UI from a screenshot.
   *
   * Declaring this is the whole of what it takes to add a computer-use model:
   * the catalog seeder registers the profile with the SDK at boot, so nothing
   * else has to know the model is special. Omit it for an ordinary model.
   *
   * Both fields have to be right and neither fails loudly if it is not. The
   * prompt must be the envelope the model was actually trained to emit, or the
   * parser reads nothing; `modelSpace` must be the coordinate space it answers
   * in, because every coordinate is rescaled from it — a wrong number does not
   * error, it just puts every click in the same wrong place.
   */
  readonly cua?: {
    /** Profile id registered with the SDK. Conventionally the model id. */
    readonly profileId: string;
    /** The system prompt that gives the model its action vocabulary. */
    readonly systemPrompt: string;
    /** The coordinate space the model was trained to answer in. */
    readonly modelSpace: { readonly width: number; readonly height: number };
  };
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

export const LFM25_2_6B = 'lfm2.5-2.6b-q5_k_m';
export const LFM25_2_6B_Q6 = 'lfm2.5-2.6b-q6_k';
export const LFM25_1_2B = 'lfm2.5-1.2b-q5_k_m';
export const LFM25_VL_3B = 'lfm2.5-vl-3b-q5_k_m';
export const QWEN3_4B = 'qwen3-4b-q4_k_m';
export const QWEN3_0_6B = 'qwen3-0.6b-q4_k_m';

export const RA_MODEL_CATALOG: readonly RaModelEntry[] = [
  {
    id: LFM25_2_6B,
    label: 'LFM2.5 2.6B',
    files: [
      {
        url: `${HF}/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q5_K_M.gguf`,
        role: 'primary',
        sizeBytes: 1_939_744_768,
      },
    ],
    totalBytes: 1_939_744_768,
    contextLength: 32_768,
    nativeContextLength: 131_072,
    vision: false,
    role: 'both',
    minDeviceMemoryGb: 8,
    notes:
      'The default, and the best fit for this product by some distance. Liquid post-trained it ' +
      'specifically as an agent (their own card recommends it for "agentic workloads, tool use, ' +
      'data extraction, RAG, and long-context workflows"), it is a hybrid architecture built for ' +
      'on-device use, and at 1.94 GB (Q5_K_M) it leaves substantially more of the 4 GiB budget for KV ' +
      'cache than a 4B would — which is what actually determines how long a task can run. The SDK also ' +
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
        url: `${HF}/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf`,
        role: 'primary',
        sizeBytes: 843_354_944,
      },
    ],
    totalBytes: 843_354_944,
    contextLength: 32_768,
    nativeContextLength: 131_072,
    vision: false,
    role: 'both',
    minDeviceMemoryGb: 4,
    notes:
      'The fast-start option: 0.79 GB, so the first task can begin in well under a minute, and ' +
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
        url: `${HF}/LiquidAI/LFM2.5-VL-3B-GGUF/resolve/main/LFM2.5-VL-3B-Q5_K_M.gguf`,
        role: 'primary',
        sizeBytes: 1_939_743_968,
      },
      {
        url: `${HF}/LiquidAI/LFM2.5-VL-3B-GGUF/resolve/main/mmproj-LFM2.5-VL-3B-Q8_0.gguf`,
        role: 'projector',
        sizeBytes: 583_109_120,
      },
    ],
    totalBytes: 1_939_743_968 + 583_109_120,
    contextLength: 16_384,
    nativeContextLength: 131_072,
    vision: true,
    role: 'both',
    minDeviceMemoryGb: 16,
    experimental: true,
    notes:
      'Screenshot-driven control, for pages the DOM path cannot read (canvas apps, obfuscated ' +
      'widgets). At 2.52 GB including the projector it still leaves usable KV headroom, unlike ' +
      'Qwen3-VL-4B at 3.11 GB which does not. Still gated behind a measured comparison against ' +
      'the DOM path on real hardware before it is offered by default.',
  },
];

/** Models that declare a computer-use profile. */
export function cuaModels(): readonly RaModelEntry[] {
  return RA_MODEL_CATALOG.filter(entry => entry.cua !== undefined);
}

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
