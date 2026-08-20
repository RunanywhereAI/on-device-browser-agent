/**
 * Wire protocol between the background service worker and the offscreen
 * document that hosts on-device inference.
 *
 * WHY A PORT AND NOT `chrome.runtime.sendMessage`
 * -----------------------------------------------
 * Token streaming is many-messages-per-request, and `sendMessage` is
 * single-response. The offscreen document therefore opens one long-lived
 * `chrome.runtime.Port` to the service worker on boot and every request/response
 * is multiplexed over it by `requestId`.
 *
 * This has a second, load-bearing benefit: since Chrome 114 traffic on a
 * long-lived port resets the service worker's idle timer. An agent task is a
 * continuous stream of inference calls, so the very act of running a task keeps
 * the worker alive. Without that, the worker's 30s idle death would kill a
 * multi-minute task.
 *
 * WHERE THE WORK LIVES
 * --------------------
 * An offscreen document is granted `chrome.runtime` and nothing else — no
 * `chrome.tabs`, `chrome.debugger`, or `chrome.scripting`. So the agent loop
 * CANNOT live here; it needs those APIs to drive the page and stays in the
 * service worker. The offscreen document is a pure inference service: it owns
 * the WASM/WebGPU engine, the OPFS model cache, and model downloads (a `fetch`
 * started in the worker would be killed by the worker's own 30s/5-minute
 * limits; one started here is not).
 *
 * SIZE DISCIPLINE
 * ---------------
 * Only JSON-serialisable values cross this boundary, and nothing large. A
 * `SharedArrayBuffer` cannot cross it at all (the worker is never
 * cross-origin-isolated), and multi-megabyte payloads such as screenshots must
 * be passed by handle rather than inlined.
 */

/** Name of the port the offscreen document opens to the service worker. */
export const RA_PORT_NAME = 'ra-offscreen';

/** Path of the offscreen document, relative to the extension root. */
export const RA_OFFSCREEN_PATH = 'offscreen/index.html';

/** One chat turn, reduced to what the SDK needs. */
export interface RaChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  /**
   * Images on this turn, if any. Present only on the latest user turn in
   * practice: re-sending every historical screenshot would exhaust the context
   * within a few steps, which is the same reason the SDK's own long-session
   * handling strips older images first.
   */
  readonly images?: readonly RaImage[];
}

/**
 * An image attached to a turn.
 *
 * Carried as base64 because that is what `chrome.tabs.captureVisibleTab`
 * returns and what the SDK's `ImageInput.base64()` accepts, so no re-encoding
 * happens on the way through. Screenshots are downscaled BEFORE they get here —
 * a full-resolution retina capture would blow a small model's image-token
 * budget, and it must be the same size the coordinate maths is told about.
 */
export interface RaImage {
  /** Base64 payload, with or without a `data:` prefix. */
  readonly base64: string;
  readonly mediaType: 'image/png' | 'image/jpeg';
  /** Pixel dimensions of what the model is actually shown. */
  readonly width: number;
  readonly height: number;
}

/** Generation knobs we actually forward. */
export interface RaGenerateOptions {
  readonly model: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  /**
   * JSON Schema, as a string. When present the SDK is asked for
   * grammar-constrained decoding, which makes schema-invalid output
   * structurally impossible rather than something we detect and retry.
   */
  readonly jsonSchema?: string;
}

/** Progress of a single model download. Mirrors the SDK's phase vocabulary. */
export type RaDownloadPhase = 'queued' | 'transferring' | 'verifying' | 'extracting' | 'cancelling';

export interface RaDownloadProgress {
  readonly phase: RaDownloadPhase;
  readonly bytesDone?: number;
  readonly bytesTotal?: number;
  readonly bytesPerSecond?: number;
  readonly etaSeconds?: number;
  /** 0..1 when measurable; absent means indeterminate — never fake a percentage. */
  readonly fraction?: number;
}

/** What the device can actually run, as reported by the SDK plus browser probes. */
export interface RaCapabilities {
  readonly hasWebGPU: boolean;
  readonly hasShaderF16: boolean;
  readonly gpuMaxBufferSizeBytes?: number;
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
  readonly hasSharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly hasOPFS: boolean;
  readonly storageQuotaBytes?: number;
}

/* -------------------------------------------------------------------------- */
/* Service worker -> offscreen                                                */
/* -------------------------------------------------------------------------- */

export type RaRequest =
  | { readonly kind: 'init'; readonly requestId: string }
  | { readonly kind: 'capabilities'; readonly requestId: string }
  | {
      readonly kind: 'generate';
      readonly requestId: string;
      readonly messages: readonly RaChatMessage[];
      readonly options: RaGenerateOptions;
    }
  | { readonly kind: 'cancel'; readonly requestId: string; readonly targetRequestId: string }
  | { readonly kind: 'ensureModel'; readonly requestId: string; readonly modelId: string }
  | { readonly kind: 'modelState'; readonly requestId: string };

/* -------------------------------------------------------------------------- */
/* Offscreen -> service worker                                                */
/* -------------------------------------------------------------------------- */

export interface RaGenerationResult {
  readonly text: string;
  readonly outputTokens?: number;
  readonly tokensPerSecond?: number;
  readonly timeToFirstTokenMs?: number;
}

export interface RaModelStateEntry {
  readonly id: string;
  readonly downloaded: boolean;
  readonly loaded: boolean;
  readonly sizeBytes?: number;
}

export type RaResponse =
  /** Sent once, unprompted, when the offscreen document is listening. */
  | { readonly kind: 'ready' }
  | { readonly kind: 'initDone'; readonly requestId: string }
  | { readonly kind: 'capabilities'; readonly requestId: string; readonly capabilities: RaCapabilities }
  /** Streaming text. `text` is a delta, not the accumulated string. */
  | { readonly kind: 'delta'; readonly requestId: string; readonly text: string }
  /** Reasoning/thinking delta, kept separate so the UI can disclose it apart from the answer. */
  | { readonly kind: 'reasoningDelta'; readonly requestId: string; readonly text: string }
  | { readonly kind: 'done'; readonly requestId: string; readonly result: RaGenerationResult }
  | { readonly kind: 'cancelled'; readonly requestId: string }
  | { readonly kind: 'downloadProgress'; readonly requestId: string; readonly progress: RaDownloadProgress }
  | { readonly kind: 'modelReady'; readonly requestId: string; readonly modelId: string }
  | { readonly kind: 'modelState'; readonly requestId: string; readonly models: readonly RaModelStateEntry[] }
  | {
      readonly kind: 'error';
      readonly requestId: string;
      readonly message: string;
      /** False for programmer/config errors the user cannot fix by retrying. */
      readonly retryable: boolean;
    };

/** Narrowing helper: responses that terminate a request. */
export function isTerminal(response: RaResponse): boolean {
  return (
    response.kind === 'done' ||
    response.kind === 'cancelled' ||
    response.kind === 'error' ||
    response.kind === 'initDone' ||
    response.kind === 'capabilities' ||
    response.kind === 'modelReady' ||
    response.kind === 'modelState'
  );
}
