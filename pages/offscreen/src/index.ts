/**
 * Offscreen document entry point: a message router in front of the inference
 * host.
 *
 * Opens one long-lived port to the service worker and serves requests over it.
 * The port is what makes a multi-minute agent task survivable: since Chrome 114
 * traffic on a long-lived port resets the worker's idle timer, so the inference
 * calls the task is already making keep the worker that drives it alive.
 */

import { RA_PORT_NAME, type RaRequest, type RaResponse } from '@extension/runanywhere';
import { cancel, capabilities, ensureModel, generate, initEngine, modelState } from './host';

let port: chrome.runtime.Port | null = null;

function emit(response: RaResponse): void {
  try {
    port?.postMessage(response);
  } catch {
    // The worker went away mid-response. Reconnection will re-establish state;
    // there is nothing useful to do here.
  }
}

function fail(requestId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // Configuration and programmer errors will not be fixed by retrying; a
  // transport or transient engine error might be.
  const retryable = !/unknown model|unsupported|not registered/i.test(message);
  emit({ kind: 'error', requestId, message, retryable });
}

async function handle(request: RaRequest): Promise<void> {
  switch (request.kind) {
    case 'init':
      await initEngine();
      emit({ kind: 'initDone', requestId: request.requestId });
      return;

    case 'capabilities':
      emit({ kind: 'capabilities', requestId: request.requestId, capabilities: await capabilities() });
      return;

    case 'modelState':
      emit({ kind: 'modelState', requestId: request.requestId, models: await modelState() });
      return;

    case 'ensureModel':
      await ensureModel(request.modelId, request.requestId, emit, progress =>
        emit({ kind: 'downloadProgress', requestId: request.requestId, progress }),
      );
      return;

    case 'generate':
      await generate(request.requestId, request.messages, request.options, emit);
      return;

    case 'cancel':
      cancel(request.targetRequestId);
      return;

    default: {
      // Exhaustiveness: a new request kind must be handled here.
      const unreachable: never = request;
      throw new Error(`Unhandled request: ${JSON.stringify(unreachable)}`);
    }
  }
}

function connect(): void {
  port = chrome.runtime.connect({ name: RA_PORT_NAME });

  port.onMessage.addListener(raw => {
    const request = raw as RaRequest;
    void handle(request).catch(error => fail(request.requestId, error));
  });

  port.onDisconnect.addListener(() => {
    port = null;
    // The worker was torn down (idle death, reload, or update). It will
    // reconnect by messaging us, but we re-announce so a freshly woken worker
    // that is waiting on `ready` is not left hanging.
    setTimeout(connect, 250);
  });

  emit({ kind: 'ready' });
}

connect();
