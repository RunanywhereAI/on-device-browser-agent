import { describe, expect, it } from 'vitest';
import {
  CoordinateError,
  chooseModel,
  devicePixelsToCss,
  fitWithin,
  findModel,
  formatBytes,
  imageToViewport,
  LFM25_1_2B,
  LFM25_2_6B,
  normalizedToViewport,
  RA_MODEL_CATALOG,
  selectableModels,
  type RaCapabilities,
} from '@extension/runanywhere';

/**
 * These cover the pure logic behind on-device inference: the coordinate maths a
 * vision model's clicks depend on, and the model-selection rules. Both are the
 * kind of code that looks obviously right and is quietly off by a factor of two,
 * which is exactly why they are unit-tested rather than eyeballed.
 */

const caps = (over: Partial<RaCapabilities> = {}): RaCapabilities => ({
  hasWebGPU: true,
  hasShaderF16: true,
  hasSharedArrayBuffer: true,
  crossOriginIsolated: true,
  hasOPFS: true,
  ...over,
});

describe('coordinate mapping', () => {
  const viewport = { widthCss: 1200, heightCss: 800, devicePixelRatio: 2 };

  it('scales a model-space point into the live viewport', () => {
    // The model saw a 600x400 image of a 1200x800 viewport, so everything doubles.
    const point = imageToViewport({ x: 300, y: 200 }, { width: 600, height: 400 }, viewport);
    expect(point).toEqual({ x: 600, y: 400 });
  });

  it('maps the origin and the far corner exactly', () => {
    const image = { width: 600, height: 400 };
    expect(imageToViewport({ x: 0, y: 0 }, image, viewport)).toEqual({ x: 0, y: 0 });
    expect(imageToViewport({ x: 600, y: 400 }, image, viewport)).toEqual({ x: 1200, y: 800 });
  });

  it('handles a non-uniform aspect ratio on each axis independently', () => {
    // 1000x1000 canonical space (the shape a normalising CUA profile uses) onto
    // a wide viewport: x and y must scale differently.
    const point = imageToViewport({ x: 500, y: 500 }, { width: 1000, height: 1000 }, viewport);
    expect(point).toEqual({ x: 600, y: 400 });
  });

  it('clamps a slight overshoot to the viewport edge rather than failing the step', () => {
    const point = imageToViewport({ x: 605, y: 405 }, { width: 600, height: 400 }, viewport);
    expect(point).toEqual({ x: 1200, y: 800 });
  });

  it('rejects a coordinate that was never plausible instead of silently clamping', () => {
    expect(() => imageToViewport({ x: 5000, y: 10 }, { width: 600, height: 400 }, viewport)).toThrow(CoordinateError);
  });

  it('rejects a zero-sized image rather than dividing by zero', () => {
    expect(() => imageToViewport({ x: 1, y: 1 }, { width: 0, height: 400 }, viewport)).toThrow(CoordinateError);
  });

  it('treats normalised coordinates as fractions, not pixels', () => {
    expect(normalizedToViewport({ x: 0.5, y: 0.25 }, viewport)).toEqual({ x: 600, y: 200 });
  });

  it('refuses a pixel value passed to the normalised path', () => {
    // 300 is a plausible pixel coordinate and a nonsensical fraction. Catching
    // this is the difference between clicking a button and clicking the corner.
    expect(() => normalizedToViewport({ x: 300, y: 0.5 }, viewport)).toThrow(CoordinateError);
  });

  it('converts device pixels to the CSS size they represent', () => {
    // A retina screenshot is devicePixelRatio times larger than the CSS
    // viewport; CDP input events are in CSS pixels.
    expect(devicePixelsToCss({ width: 2400, height: 1600 }, 2)).toEqual({ width: 1200, height: 800 });
  });
});

describe('screenshot downscaling', () => {
  it('preserves aspect ratio when shrinking', () => {
    expect(fitWithin({ width: 2000, height: 1000 }, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it('never upscales a small screenshot', () => {
    const small = { width: 400, height: 300 };
    expect(fitWithin(small, 1600)).toEqual(small);
  });

  it('constrains by the longest edge, whichever axis that is', () => {
    expect(fitWithin({ width: 500, height: 2000 }, 1000)).toEqual({ width: 250, height: 1000 });
  });

  it('never collapses an extreme aspect ratio to zero', () => {
    const fitted = fitWithin({ width: 10_000, height: 5 }, 100);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});

describe('model catalog', () => {
  it('states a total that matches the sum of its files', () => {
    for (const entry of RA_MODEL_CATALOG) {
      const summed = entry.files.reduce((total, file) => total + file.sizeBytes, 0);
      expect(summed, `${entry.id} totalBytes`).toBe(entry.totalBytes);
    }
  });

  it('gives every vision model a projector, and no text model one', () => {
    for (const entry of RA_MODEL_CATALOG) {
      const hasProjector = entry.files.some(file => file.role === 'projector');
      expect(hasProjector, `${entry.id}`).toBe(entry.vision);
    }
  });

  it('gives every entry exactly one primary weights file', () => {
    for (const entry of RA_MODEL_CATALOG) {
      expect(entry.files.filter(file => file.role === 'primary')).toHaveLength(1);
    }
  });

  it('keeps every model inside the ~3.5 GB usable WASM weight budget', () => {
    // Weights and KV cache share one 4 GiB wasm32 heap. Anything at or above
    // this leaves no room to actually run a task.
    const budget = 3.5 * 1024 ** 3;
    for (const entry of RA_MODEL_CATALOG) {
      expect(entry.totalBytes, `${entry.id} is too large for the WASM heap`).toBeLessThan(budget);
    }
  });

  it('never offers an experimental or test model for automatic selection', () => {
    for (const entry of selectableModels()) {
      expect(entry.experimental).not.toBe(true);
      expect(entry.role).toBe('both');
    }
  });

  it('does not claim a configured context larger than the model supports', () => {
    for (const entry of RA_MODEL_CATALOG) {
      expect(entry.contextLength, `${entry.id}`).toBeLessThanOrEqual(entry.nativeContextLength);
    }
  });

  it('resolves ids that exist and rejects ones that do not', () => {
    expect(findModel(LFM25_2_6B)?.label).toBe('LFM2.5 2.6B');
    expect(findModel('definitely-not-a-model')).toBeUndefined();
  });
});

describe('automatic model selection', () => {
  it('prefers the agentic default on a mainstream machine', () => {
    const choice = chooseModel(caps({ deviceMemoryGb: 8 }));
    expect(choice.model.id).toBe(LFM25_2_6B);
    expect(choice.constrained).toBe(false);
  });

  it('does not upgrade to a bigger model just because there is more RAM', () => {
    // More weights would come straight out of the KV budget, which is what
    // limits how long an agentic task can run.
    expect(chooseModel(caps({ deviceMemoryGb: 64 })).model.id).toBe(LFM25_2_6B);
  });

  it('drops to a smaller model on a constrained machine and says so', () => {
    const choice = chooseModel(caps({ deviceMemoryGb: 4 }));
    expect(choice.model.id).toBe(LFM25_1_2B);
    expect(choice.model.totalBytes).toBeLessThan(1024 ** 3);
    expect(choice.constrained).toBe(true);
  });

  it('still returns something runnable below every advisory floor', () => {
    // Running slowly beats refusing to run.
    const choice = chooseModel(caps({ deviceMemoryGb: 1 }));
    expect(choice.model).toBeDefined();
    expect(choice.constrained).toBe(true);
  });

  it('assumes a mainstream laptop when the browser reports nothing', () => {
    // navigator.deviceMemory is absent in several browsers; that must not be
    // read as "this device is tiny".
    expect(chooseModel(null).model.id).toBe(LFM25_2_6B);
    expect(chooseModel(caps({ deviceMemoryGb: undefined })).model.id).toBe(LFM25_2_6B);
  });

  it('mentions the GPU only when there is one', () => {
    expect(chooseModel(caps({ deviceMemoryGb: 8 })).rationale).toContain('GPU');
    expect(chooseModel(caps({ deviceMemoryGb: 8, hasWebGPU: false, hasShaderF16: false })).rationale).not.toContain(
      'GPU',
    );
  });
});

describe('size formatting', () => {
  it('reads the way a download dialog should', () => {
    expect(formatBytes(1_939_744_768)).toBe('1.8 GB');
    expect(formatBytes(843_354_944)).toBe('804 MB');
    expect(formatBytes(4096)).toBe('4 KB');
  });
});
