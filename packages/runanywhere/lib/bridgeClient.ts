/**
 * Service-worker side of the offscreen inference bridge.
 *
 * Owns the offscreen document's lifecycle and turns the port protocol in
 * `protocol.ts` into promises and async iterables.
 */

import {
  RA_OFFSCREEN_PATH,
  RA_PORT_NAME,
  isTerminal,
  type RaCapabilities,
  type RaChatMessage,
  type RaDownloadProgress,
  type RaGenerateOptions,
  type RaGenerationResult,
  type RaModelStateEntry,
  type RaRequest,
  type RaResponse,
} from './protocol';

/** Events surfaced to callers of `generateStream`. */
export type RaStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'done'; readonly result: RaGenerationResult };

type Waiter = {
  readonly onResponse: (response: RaResponse) => void;
  readonly onClose: (reason: Error) => void;
};

let port: chrome.runtime.Port | null = null;
/** In-flight `createDocument` call, so concurrent callers await one creation. */
let creating: Promise<void> | null = null;
/** Resolves when the offscreen document has announced itself. */
let readyPromise: Promise<void> | null = null;
let markReady: (() => void) | null = null;

const waiters = new Map<string, Waiter>();
let requestSeq = 0;

function nextRequestId(): string {
  requestSeq += 1;
  return `ra-${Date.now().toString(36)}-${requestSeq}`;
}

/**
 * True when an offscreen document already exists.
 *
 * Uses `chrome.runtime.getContexts` rather than `chrome.offscreen.hasDocument`:
 * the latter works but is deliberately undocumented ("nodoc") because the
 * Chrome team was unhappy with its shape and steered developers to
 * `getContexts` in Chrome 116+.
 */
async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  return contexts.length > 0;
}

/**
 * Create the offscreen document if absent, and wait until it is listening.
 *
 * Chrome permits exactly one offscreen document per extension; a second
 * `createDocument` throws "Only a single offscreen document may be created."
 * Concurrent callers are funnelled through a single creation promise, and an
 * existing document is adopted rather than recreated — its lifetime is
 * independent of the service worker, so it routinely outlives us.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (port && readyPromise) {
    await readyPromise;
    return;
  }

  if (!readyPromise) {
    readyPromise = new Promise<void>(resolve => {
      markReady = resolve;
    });
  }

  if (!creating) {
    creating = (async () => {
      if (await hasOffscreenDocument()) {
        // Already there (worker restarted under a live document). It will not
        // re-announce itself, so prod it into reconnecting.
        return;
      }
      await chrome.offscreen.createDocument({
        url: RA_OFFSCREEN_PATH,
        // WORKERS is the right justification: the engine runs a threaded WASM
        // worker pool. Of the available reasons only AUDIO_PLAYBACK has a
        // documented auto-teardown rule.
        reasons: ['WORKERS' as chrome.offscreen.Reason],
        justification:
          'Runs the on-device language model (WebAssembly/WebGPU) and its OPFS model cache. ' +
          'Neither can run in a service worker.',
      });
    })().finally(() => {
      creating = null;
    });
  }

  await creating;
  await readyPromise;
}

/**
 * Register the port listener. Call once from the service worker's top level so
 * it is re-registered on every worker wake-up.
 */
export function registerOffscreenPortListener(): void {
  chrome.runtime.onConnect.addListener(incoming => {
    if (incoming.name !== RA_PORT_NAME) return;
    // Only our own extension may claim this port.
    if (incoming.sender?.id !== chrome.runtime.id) return;

    port = incoming;

    incoming.onMessage.addListener(raw => {
      const response = raw as RaResponse;
      if (response.kind === 'ready') {
        markReady?.();
        return;
      }
      const waiter = waiters.get(response.requestId);
      if (!waiter) return;
      waiter.onResponse(response);
      if (isTerminal(response)) waiters.delete(response.requestId);
    });

    incoming.onDisconnect.addListener(() => {
      port = null;
      readyPromise = null;
      markReady = null;
      const reason = new Error('The on-device inference host disconnected.');
      for (const waiter of waiters.values()) waiter.onClose(reason);
      waiters.clear();
    });
  });
}

function post(request: RaRequest): void {
  if (!port) throw new Error('The on-device inference host is not connected.');
  port.postMessage(request);
}

/** Send a request and resolve on its single terminal response. */
async function call<T>(build: (requestId: string) => RaRequest, extract: (response: RaResponse) => T): Promise<T> {
  await ensureOffscreenDocument();
  const requestId = nextRequestId();
  return new Promise<T>((resolve, reject) => {
    waiters.set(requestId, {
      onResponse: response => {
        if (response.kind === 'error') {
          reject(new Error(response.message));
          return;
        }
        try {
          resolve(extract(response));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      onClose: reject,
    });
    try {
      post(build(requestId));
    } catch (error) {
      waiters.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Boot the SDK inside the offscreen document. Idempotent. */
export async function initEngine(): Promise<void> {
  await call<void>(
    requestId => ({ kind: 'init', requestId }),
    response => {
      if (response.kind !== 'initDone') throw new Error(`Unexpected response: ${response.kind}`);
    },
  );
}

/** What this device can run. Drives automatic model selection. */
export async function getCapabilities(): Promise<RaCapabilities> {
  return call<RaCapabilities>(
    requestId => ({ kind: 'capabilities', requestId }),
    response => {
      if (response.kind !== 'capabilities') throw new Error(`Unexpected response: ${response.kind}`);
      return response.capabilities;
    },
  );
}

/** Resident/downloaded model inventory. */
export async function getModelState(): Promise<readonly RaModelStateEntry[]> {
  return call<readonly RaModelStateEntry[]>(
    requestId => ({ kind: 'modelState', requestId }),
    response => {
      if (response.kind !== 'modelState') throw new Error(`Unexpected response: ${response.kind}`);
      return response.models;
    },
  );
}

/**
 * Download (if needed) and load a model, reporting progress.
 *
 * Progress is delivered by callback rather than as an async iterable so a
 * caller that ignores it cannot accidentally stall the stream.
 */
export async function ensureModel(modelId: string, onProgress?: (progress: RaDownloadProgress) => void): Promise<void> {
  await ensureOffscreenDocument();
  const requestId = nextRequestId();
  return new Promise<void>((resolve, reject) => {
    waiters.set(requestId, {
      onResponse: response => {
        switch (response.kind) {
          case 'downloadProgress':
            onProgress?.(response.progress);
            break;
          case 'modelReady':
            resolve();
            break;
          case 'error':
            reject(new Error(response.message));
            break;
          default:
            break;
        }
      },
      onClose: reject,
    });
    try {
      post({ kind: 'ensureModel', requestId, modelId });
    } catch (error) {
      waiters.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Stream a generation.
 *
 * Abandoning the iterator (`break`, or an AbortSignal firing) sends a cancel to
 * the offscreen document, which stops iterating the SDK's own generator — that
 * is how the SDK expects cancellation to be expressed.
 */
export async function* generateStream(
  messages: readonly RaChatMessage[],
  options: RaGenerateOptions,
  signal?: AbortSignal,
): AsyncGenerator<RaStreamEvent, void, undefined> {
  await ensureOffscreenDocument();
  const requestId = nextRequestId();

  const queue: RaStreamEvent[] = [];
  let finished = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;

  const nudge = () => {
    wake?.();
    wake = null;
  };

  waiters.set(requestId, {
    onResponse: response => {
      switch (response.kind) {
        case 'delta':
          queue.push({ type: 'delta', text: response.text });
          break;
        case 'reasoningDelta':
          queue.push({ type: 'reasoning', text: response.text });
          break;
        case 'done':
          queue.push({ type: 'done', result: response.result });
          finished = true;
          break;
        case 'cancelled':
          finished = true;
          break;
        case 'error':
          failure = new Error(response.message);
          finished = true;
          break;
        default:
          break;
      }
      nudge();
    },
    onClose: reason => {
      failure = reason;
      finished = true;
      nudge();
    },
  });

  const onAbort = () => {
    try {
      post({ kind: 'cancel', requestId: nextRequestId(), targetRequestId: requestId });
    } catch {
      // The host is already gone; the stream is ending regardless.
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    post({ kind: 'generate', requestId, messages, options });

    for (;;) {
      while (queue.length > 0) {
        const event = queue.shift() as RaStreamEvent;
        yield event;
      }
      if (failure) throw failure;
      if (finished) return;
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // If we are unwinding before a terminal event, the consumer abandoned the
    // stream. Tell the host so it stops generating.
    if (!finished) onAbort();
    waiters.delete(requestId);
  }
}
