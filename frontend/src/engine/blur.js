// Pure geometry for the privacy guard. No canvas, no DOM, no models: every function here
// takes numbers and returns numbers, so `blur.test.mjs` can pin the rectangles exactly.
//
// The reference is `ml/safesight_ml/privacy.py` (removed from this fork): `FaceBlurrer._blur_box` (margin) and
// `FaceBlurrer.blur_with_faces` (the head band on every person box). The browser port had
// dropped the head band, which left a profile face sharp on a frame YuNet only partly
// covered. Keeping the arithmetic here and the drawing in `worker.js` means the safety net
// is testable without an OffscreenCanvas.

// Top fraction of a person box that can contain a face. `privacy.py`:
// `head_height = max(1, int((py2 - py1) * 0.35))`.
export const HEAD_BAND_RATIO = 0.35;

// `privacy.py` `_blur_box`: `margin = max(1, int(0.2 * max(x2 - x1, y2 - y1)))`.
export const BLUR_MARGIN_RATIO = 0.2;

/**
 * Pixel rectangle clamped to the frame. Whole pixels: `left`/`top` are floored and
 * `right`/`bottom` ceiled, so a fractional box never loses a column to rounding.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} width frame width in pixels
 * @param {number} height frame height in pixels
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function clampRect(x1, y1, x2, y2, width, height) {
  const left = Math.max(0, Math.min(width, Math.floor(x1)));
  const top = Math.max(0, Math.min(height, Math.floor(y1)));
  const right = Math.max(0, Math.min(width, Math.ceil(x2)));
  const bottom = Math.max(0, Math.min(height, Math.ceil(y2)));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Grow a box by the reference's margin and clamp it. `_blur_box` grows every box it blurs,
 * faces and head bands alike, by 20% of its longest side (minimum one pixel).
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function expandedRect(x1, y1, x2, y2, width, height) {
  const margin = Math.max(1, Math.trunc(BLUR_MARGIN_RATIO * Math.max(x2 - x1, y2 - y1)));
  return clampRect(x1 - margin, y1 - margin, x2 + margin, y2 + margin, width, height);
}

/**
 * The safety net from `FaceBlurrer.blur_with_faces`: for every person box (frame-normalized
 * `[x1, y1, x2, y2]`), blur the top 35% of it, grown by the usual margin. This runs after
 * the face boxes, so an overlap is blurred twice, exactly like the reference.
 *
 * The ratio is on the source frame, not on the box: a distant person still gets a head band
 * proportional to their own height, never a skipped one.
 * @param {ReadonlyArray<readonly [number, number, number, number]>} boxes normalized persons
 * @param {number} width frame width in pixels
 * @param {number} height frame height in pixels
 * @returns {Array<{left: number, top: number, width: number, height: number}>} one rect per box
 */
export function headBandRects(boxes, width, height) {
  const rects = [];
  for (const box of boxes) {
    const [x1, y1, x2, y2] = box;
    // `_blur_box(output, px1, py1, px2, py1 + head_height, width, height)`: int() truncates.
    const px1 = Math.trunc(x1 * width);
    const py1 = Math.trunc(y1 * height);
    const px2 = Math.trunc(x2 * width);
    const py2 = Math.trunc(y2 * height);
    const headHeight = Math.max(1, Math.trunc((py2 - py1) * HEAD_BAND_RATIO));
    rects.push(expandedRect(px1, py1, px2, py1 + headHeight, width, height));
  }
  return rects;
}
