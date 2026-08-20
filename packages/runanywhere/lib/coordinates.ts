/**
 * Translating a vision model's coordinates into real page pixels.
 *
 * A screenshot-driven model does not see the page; it sees an image. Those are
 * rarely the same size, and they are never the same size once the screenshot is
 * downscaled to fit an image-token budget. So a raw `click(x, y)` from the model
 * is in *image* space and must be mapped back into *viewport* space before it
 * can be dispatched, or every click lands in the wrong place — subtly, and worse
 * the further from the origin you go.
 *
 * Two distinct scale factors are in play and conflating them is the classic bug:
 *
 *  - Model space -> CSS space. The model was trained against a fixed canonical
 *    resolution (RunAnywhere's Fara profile normalises to 1000x1000), or we
 *    downscaled the screenshot ourselves. Either way the ratio is
 *    `cssSize / imageSize`.
 *
 *  - CSS space -> device pixels. `devicePixelRatio` is 2 or 3 on retina
 *    displays, so a screenshot captured at device resolution is physically
 *    larger than the CSS viewport. Chrome DevTools Protocol input events take
 *    CSS pixels, so this factor must be divided out and NOT applied again.
 *
 * Everything here is pure so it can be tested without a browser, which matters:
 * this is exactly the kind of arithmetic that looks right and is off by a
 * factor of two.
 */

/** A rendered image's pixel dimensions. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** The live viewport, in CSS pixels, plus its device-pixel ratio. */
export interface ViewportInfo {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly devicePixelRatio: number;
}

/** A point in some coordinate space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export class CoordinateError extends Error {}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CoordinateError(`${label} must be a positive finite number, got ${value}.`);
  }
}

/**
 * Map a point the model produced (in the coordinate space of the image it was
 * shown) into CSS pixels in the live viewport.
 *
 * Clamps to the viewport rather than throwing: a model that overshoots the edge
 * by a pixel should still click the edge, not fail the step. A wildly
 * out-of-range point is a different matter and is reported, because silently
 * clamping a coordinate that was never plausible hides a real modelling
 * failure.
 */
export function imageToViewport(point: Point, image: ImageSize, viewport: ViewportInfo): Point {
  assertPositive('image.width', image.width);
  assertPositive('image.height', image.height);
  assertPositive('viewport.widthCss', viewport.widthCss);
  assertPositive('viewport.heightCss', viewport.heightCss);

  const scaleX = viewport.widthCss / image.width;
  const scaleY = viewport.heightCss / image.height;

  const rawX = point.x * scaleX;
  const rawY = point.y * scaleY;

  // Anything more than a viewport outside the frame is not a rounding artefact.
  const tolerance = 1;
  if (
    point.x < -image.width * tolerance ||
    point.x > image.width * (1 + tolerance) ||
    point.y < -image.height * tolerance ||
    point.y > image.height * (1 + tolerance)
  ) {
    throw new CoordinateError(
      `Model produced a coordinate far outside the image: (${point.x}, ${point.y}) ` +
        `for a ${image.width}x${image.height} image.`,
    );
  }

  return {
    x: clamp(rawX, 0, viewport.widthCss),
    y: clamp(rawY, 0, viewport.heightCss),
  };
}

/**
 * Map a normalised coordinate (0..1 on both axes) into CSS pixels.
 *
 * Some models emit fractions rather than pixels; treating one as the other is
 * the difference between clicking a button and clicking the top-left corner.
 */
export function normalizedToViewport(point: Point, viewport: ViewportInfo): Point {
  assertPositive('viewport.widthCss', viewport.widthCss);
  assertPositive('viewport.heightCss', viewport.heightCss);
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new CoordinateError(
      `Expected a normalised coordinate in 0..1, got (${point.x}, ${point.y}). ` +
        'If the model emits pixels, use imageToViewport instead.',
    );
  }
  return {
    x: clamp(point.x * viewport.widthCss, 0, viewport.widthCss),
    y: clamp(point.y * viewport.heightCss, 0, viewport.heightCss),
  };
}

/**
 * The size to downscale a screenshot to before showing it to the model.
 *
 * Preserves aspect ratio and never upscales — enlarging a screenshot costs
 * image tokens and adds no detail. `maxEdge` is the longest permitted side.
 */
export function fitWithin(size: ImageSize, maxEdge: number): ImageSize {
  assertPositive('size.width', size.width);
  assertPositive('size.height', size.height);
  assertPositive('maxEdge', maxEdge);

  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return size;

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Convert device-pixel image dimensions to the CSS-pixel size they represent.
 *
 * A screenshot captured on a retina display is `devicePixelRatio` times larger
 * than the CSS viewport it depicts. CDP input events are in CSS pixels, so this
 * is what stops a 2x display halving every click position.
 */
export function devicePixelsToCss(size: ImageSize, devicePixelRatio: number): ImageSize {
  assertPositive('devicePixelRatio', devicePixelRatio);
  return {
    width: size.width / devicePixelRatio,
    height: size.height / devicePixelRatio,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
