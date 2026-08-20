/**
 * The inference host.
 *
 * This module owns the one live RunAnywhere SDK instance in the extension. It
 * runs inside an offscreen document because that is the only extension surface
 * that has what the engine needs — a DOM, `Worker`, WebGPU, and OPFS — while a
 * service worker has none of them and would in any case be killed after 30
 * seconds of idle, taking a multi-gigabyte resident model with it.
 *
 * It deliberately does NOT contain the agent loop. An offscreen document is
 * granted `chrome.runtime` and nothing else, so it cannot see tabs or drive a
 * page; that work stays in the service worker.
 */

import { ImageInput, InferenceFramework, ModelCategory, ModelFormat, RunAnywhere } from '@runanywhere/web';
import { LlamaCPP } from '@runanywhere/web-llamacpp';
import {
  RA_MODEL_CATALOG,
  findModel,
  type RaCapabilities,
  type RaChatMessage,
  type RaDownloadProgress,
  type RaGenerateOptions,
  type RaGenerationResult,
  type RaModelStateEntry,
} from '@extension/runanywhere';

type Emit = (response: import('@extension/runanywhere').RaResponse) => void;

let initialised: Promise<void> | null = null;

/** Requests currently generating, so `cancel` can reach them. */
const inFlight = new Map<string, AbortController>();

/**
 * Resolve a packaged asset to an absolute extension URL.
 *
 * The SDK resolves its WASM and worker URLs relative to `import.meta.url` by
 * default, which breaks as soon as a bundler rewrites module semantics. Passing
 * explicit `chrome.runtime.getURL` values sidesteps that entirely, and is also
 * what keeps us compliant with the Chrome Web Store's remotely-hosted-code
 * rule: every executable byte ships inside the package, and only model weights
 * (data) are fetched at runtime.
 */
function assetUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

export async function initEngine(): Promise<void> {
  if (initialised) return initialised;

  initialised = (async () => {
    // Keyless, local-only initialisation: no control-plane call, nothing to
    // configure, and no API key to leak.
    await RunAnywhere.initialize({ environment: 'production' });

    await LlamaCPP.register({
      // WebGPU when the adapter supports it, CPU WASM otherwise. The WebGPU
      // build is also the no-pthread one, so it does not require
      // SharedArrayBuffer / cross-origin isolation.
      acceleration: 'auto',
      wasmUrl: assetUrl('wasm/racommons-llamacpp.wasm'),
      webgpuWasmUrl: assetUrl('wasm/racommons-llamacpp-webgpu.wasm'),
      backendWorkerFactory: () => new Worker(assetUrl('wasm/backendWorker.js'), { type: 'module' }),
    });

    registerCatalog();
  })().catch(error => {
    // Let the next attempt retry rather than caching a permanent failure.
    initialised = null;
    throw error;
  });

  return initialised;
}

/**
 * Teach the SDK about our models. The catalog is app-owned: the SDK will
 * download and load on demand, but only for ids it already knows.
 */
function registerCatalog(): void {
  for (const entry of RA_MODEL_CATALOG) {
    const primary = entry.files.find(file => file.role === 'primary');
    if (!primary) continue;

    const projector = entry.files.find(file => file.role === 'projector');

    const registration: Record<string, unknown> = {
      id: entry.id,
      name: entry.label,
      category: entry.vision ? ModelCategory.MODEL_CATEGORY_MULTIMODAL : ModelCategory.MODEL_CATEGORY_LANGUAGE,
      framework: InferenceFramework.INFERENCE_FRAMEWORK_LLAMA_CPP,
      format: ModelFormat.MODEL_FORMAT_GGUF,
      contextLength: entry.contextLength,
      sizeBytes: entry.totalBytes,
      memoryRequiredBytes: entry.totalBytes,
    };

    if (projector) {
      // A vision model is two files: weights plus the mmproj projector, which
      // must be tagged so the engine knows which is which.
      registration.files = [
        { url: primary.url, role: 'primary', sizeBytes: primary.sizeBytes },
        { url: projector.url, role: 'projector', sizeBytes: projector.sizeBytes },
      ];
    } else {
      registration.url = primary.url;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      RunAnywhere.models.register(registration as any);
    } catch (error) {
      // Already registered is fine; anything else is worth surfacing in logs.
      console.debug('[offscreen] model registration skipped', entry.id, error);
    }
  }
}

export async function capabilities(): Promise<RaCapabilities> {
  await initEngine();

  let hasWebGPU = false;
  let hasShaderF16 = false;
  let gpuMaxBufferSizeBytes: number | undefined;

  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu) {
      const adapter = (await gpu.requestAdapter()) as {
        features?: { has(name: string): boolean };
        limits?: { maxBufferSize?: number };
      } | null;
      if (adapter) {
        hasWebGPU = true;
        hasShaderF16 = adapter.features?.has('shader-f16') ?? false;
        gpuMaxBufferSizeBytes = adapter.limits?.maxBufferSize;
      }
    }
  } catch {
    // Probing must never be fatal — the CPU path still works.
  }

  let storageQuotaBytes: number | undefined;
  let hasOPFS = false;
  try {
    hasOPFS = typeof navigator.storage?.getDirectory === 'function';
    const estimate = await navigator.storage?.estimate?.();
    storageQuotaBytes = estimate?.quota;
  } catch {
    // Ignore; reported as unavailable.
  }

  const nav = navigator as unknown as { deviceMemory?: number; hardwareConcurrency?: number };

  return {
    hasWebGPU,
    hasShaderF16,
    gpuMaxBufferSizeBytes,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    hasOPFS,
    storageQuotaBytes,
  };
}

export async function modelState(): Promise<RaModelStateEntry[]> {
  await initEngine();
  const state = await RunAnywhere.models.state();
  const loaded = new Set((state.loaded ?? []).map((model: { id: string }) => model.id));

  return RA_MODEL_CATALOG.map(entry => {
    const info = RunAnywhere.models.get(entry.id);
    return {
      id: entry.id,
      downloaded: Boolean(info?.localPath),
      loaded: loaded.has(entry.id),
      sizeBytes: entry.totalBytes,
    };
  });
}

/**
 * Download (resuming if partial) and load a model.
 *
 * Downloads are issued here rather than from the service worker on purpose: a
 * worker `fetch` is bounded by the worker's own 30-second-no-progress and
 * five-minute limits, so a multi-gigabyte transfer would be killed mid-stream.
 * Breaking out of the SDK's download iterator keeps the bytes already on disk,
 * so a later call resumes with a Range request rather than starting over.
 */
export async function ensureModel(
  modelId: string,
  requestId: string,
  emit: Emit,
  onProgress: (progress: RaDownloadProgress) => void,
): Promise<void> {
  await initEngine();

  const entry = findModel(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);

  const info = RunAnywhere.models.get(modelId);
  if (!info?.localPath) {
    onProgress({ phase: 'queued' });
    for await (const event of RunAnywhere.models.download(modelId)) {
      switch (event.type) {
        case 'progress': {
          const total = event.bytesTotal ?? entry.totalBytes;
          onProgress({
            phase: 'transferring',
            bytesDone: event.bytesDone,
            bytesTotal: total,
            bytesPerSecond: event.bytesPerSecond,
            etaSeconds: event.etaSeconds,
            // Absent when not measurable — never fabricate a percentage.
            fraction: total > 0 && event.bytesDone != null ? event.bytesDone / total : undefined,
          });
          break;
        }
        case 'extracting':
          onProgress({ phase: 'extracting' });
          break;
        case 'failed':
          throw new Error(event.error?.message ?? 'The model download failed.');
        case 'cancelled':
          throw new Error('The model download was cancelled.');
        default:
          break;
      }
    }
  }

  onProgress({ phase: 'verifying' });
  await RunAnywhere.models.load(modelId);
  emit({ kind: 'modelReady', requestId, modelId });
}

export async function generate(
  requestId: string,
  messages: readonly RaChatMessage[],
  options: RaGenerateOptions,
  emit: Emit,
): Promise<void> {
  await initEngine();

  const controller = new AbortController();
  inFlight.set(requestId, controller);

  try {
    // Loading is implicit for a known id, but doing it explicitly means a first
    // run reports download progress instead of appearing to hang.
    const info = RunAnywhere.models.get(options.model);
    if (!info?.localPath) {
      await ensureModel(
        options.model,
        requestId,
        () => undefined,
        progress => emit({ kind: 'downloadProgress', requestId, progress }),
      );
    }

    const prompt = messages.map(message => ({ role: message.role, content: message.content }));

    // Vision: if any turn carries a screenshot, this has to go through the VLM
    // entry point rather than the text one — a base64 image inlined into a text
    // prompt is just a very expensive string. Only the newest image is used;
    // the adapter has already dropped the older ones.
    const image = messages.flatMap(message => message.images ?? []).at(-1);

    const generationOptions: Record<string, unknown> = {
      model: options.model,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
    };

    let result: RaGenerationResult = { text: '' };
    let accumulated = '';

    if (options.jsonSchema) {
      // Grammar-constrained decoding: the schema is compiled to GBNF inside the
      // engine and constrains sampling, so the output cannot be schema-invalid.
      // This path is not streamed, because the value of the guarantee is the
      // complete document.
      const structured = await RunAnywhere.llm.generateStructured(
        // The transcript is passed through intact rather than flattened to a
        // single string: these agents build a deliberate multi-turn history
        // (system rules, the task, a worked example, then live page state) and
        // collapsing it to "role: content" lines measurably degrades a small
        // model's adherence.
        prompt,
        { json: options.jsonSchema },
        'constrained',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationOptions as any,
      );
      accumulated = structured.raw ?? JSON.stringify(structured.value ?? {});
      emit({ kind: 'delta', requestId, text: accumulated });
      result = { text: accumulated };
    } else if (image) {
      const visionPrompt = prompt.map(turn => `${turn.role}: ${turn.content}`).join('\n\n');
      const events = RunAnywhere.vlm.generateStream(
        ImageInput.base64(image.base64, image.mediaType),
        visionPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationOptions as any,
      );
      for await (const event of events) {
        if (controller.signal.aborted) break;
        if (event.type === 'textDelta') {
          accumulated += event.text;
          emit({ kind: 'delta', requestId, text: event.text });
        } else if (event.type === 'completed') {
          result = {
            text: event.result?.text ?? accumulated,
            outputTokens: event.result?.outputTokens,
            tokensPerSecond: event.result?.tokensPerSecond,
            timeToFirstTokenMs: event.result?.timeToFirstTokenMs,
          };
        } else if (event.type === 'failed') {
          throw new Error(event.error?.message ?? 'Vision generation failed.');
        }
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = RunAnywhere.llm.generateStream(prompt as any, generationOptions as any);
      for await (const event of events) {
        if (controller.signal.aborted) break;
        switch (event.type) {
          case 'textDelta':
            accumulated += event.text;
            emit({ kind: 'delta', requestId, text: event.text });
            break;
          case 'reasoningDelta':
            emit({ kind: 'reasoningDelta', requestId, text: event.text });
            break;
          case 'completed':
            result = {
              text: event.result?.text ?? accumulated,
              outputTokens: event.result?.outputTokens,
              tokensPerSecond: event.result?.tokensPerSecond,
              timeToFirstTokenMs: event.result?.timeToFirstTokenMs,
            };
            break;
          case 'failed':
            throw new Error(event.error?.message ?? 'Generation failed.');
          default:
            break;
        }
      }
    }

    if (controller.signal.aborted) {
      emit({ kind: 'cancelled', requestId });
      return;
    }

    emit({ kind: 'done', requestId, result: result.text ? result : { ...result, text: accumulated } });
  } finally {
    inFlight.delete(requestId);
  }
}

/**
 * Cancel a generation.
 *
 * Aborting breaks our `for await`, and the SDK treats an abandoned iterator as
 * the cancel signal — it calls the native cancel from its own `finally`. There
 * is no separate cancel method to call.
 */
export function cancel(targetRequestId: string): void {
  inFlight.get(targetRequestId)?.abort();
}
