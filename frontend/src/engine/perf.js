// Pure helpers for the engine's measured optimizations. No canvas, no model, no worker:
// every function here takes numbers and returns numbers, so `perf.test.mjs` can pin the
// geometry and the policy with `node --test`.
//
// The one optimization that lives here is the face-detector input cap. YuNet runs on a
// downscaled copy of the frame, the boxes are mapped back to frame pixels and the blur is
// drawn at full frame resolution. It is only allowed when the head-band safety blur is ON:
// a face YuNet misses inside a person box is still covered by `blurHeads`, so the cap can
// cost recall without costing privacy. With the safety blur OFF, the only blur is the face
// box, so the face detector keeps the full frame (`faceInputPlan` returns `capped: false`).

// Long side of the copy handed to YuNet. At 1280x720 this is 640x360; the detector input
// (padded to multiples of 32) drops from 1280x736 to 640x384, i.e. ~3.8x fewer pixels in
// both the inference and the RGBA->NCHW pass. 640 keeps the demo clip's faces (roughly
// 40-90 px wide on the 1280 frame) at 20-45 px, above YuNet's stride-8 grid.
export const FACE_INPUT_MAX_EDGE = 640;

// YuNet's graph fuses strides 8/16/32, so both input sides must be multiples of 32.
export const YUNET_INPUT_MULTIPLE = 32;

/**
 * Scale factor that fits the long side into `maxEdge` without ever upscaling.
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 * @returns {number} 0 < scale <= 1
 */
export function fitScale(width, height, maxEdge = FACE_INPUT_MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1, maxEdge / Math.max(width, height));
}

/**
 * Geometry a downscaled detector input needs: the copy's size and the factors that map a
 * box from copy pixels back to frame pixels. Each axis has its own factor because the
 * rounded copy size is not exactly `scale * frame`; using one factor would shift boxes by
 * up to a pixel on the axis that rounded the other way.
 *
 * @param {number} width frame width in pixels
 * @param {number} height frame height in pixels
 * @param {number} [maxEdge] longest side of the copy
 * @returns {{capped: boolean, width: number, height: number, scaleX: number, scaleY: number}}
 *   `capped` is false when the frame already fits (or the arguments are unusable), and the
 *   returned size is then the frame's own size with identity factors. `width`/`height` are
 *   the copy's size, not the padded detector input.
 */
export function cappedFaceInput(width, height, maxEdge = FACE_INPUT_MAX_EDGE) {
  const scale = fitScale(width, height, maxEdge);
  if (scale >= 1) {
    return { capped: false, width, height, scaleX: 1, scaleY: 1 };
  }
  const inputWidth = Math.max(1, Math.round(width * scale));
  const inputHeight = Math.max(1, Math.round(height * scale));
  return {
    capped: true,
    width: inputWidth,
    height: inputHeight,
    scaleX: width / inputWidth,
    scaleY: height / inputHeight,
  };
}

/**
 * The face detector's input plan for this frame.
 *
 * The cap is a trade (recall for speed) and is only taken when the head-band safety blur
 * covers what the cap can drop. `safetyBlur === false` therefore always means the full
 * frame: the only blur left is the face box, and weakening it is not an optimization.
 *
 * @param {{safetyBlur: boolean, width: number, height: number, maxEdge?: number}} options
 * @returns {{capped: boolean, width: number, height: number, scaleX: number, scaleY: number}}
 */
export function faceInputPlan({ safetyBlur, width, height, maxEdge = FACE_INPUT_MAX_EDGE }) {
  const full = cappedFaceInput(width, height, Infinity);
  if (!safetyBlur) return full;
  return cappedFaceInput(width, height, maxEdge);
}

/**
 * Round a detector input side up to YuNet's multiple. A 360-high copy becomes 384.
 * @param {number} size
 * @param {number} [multiple]
 * @returns {number}
 */
export function padToMultiple(size, multiple = YUNET_INPUT_MULTIPLE) {
  const step = Number.isFinite(multiple) && multiple > 0 ? Math.floor(multiple) : YUNET_INPUT_MULTIPLE;
  return Math.ceil(Math.max(1, size) / step) * step;
}

/**
 * Map detector boxes from capped-input pixels to frame pixels. `score` is carried through
 * untouched; the other numeric fields a decoder may add are scaled as coordinates, so the
 * helper stays a pure geometry pass and does not need to know the box shape.
 *
 * @param {Array<{x1:number,y1:number,x2:number,y2:number,score?:number}>} boxes
 * @param {number} scaleX
 * @param {number} scaleY
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score?:number}>}
 */
export function scaleFaceBoxes(boxes, scaleX, scaleY) {
  if (!Array.isArray(boxes)) return [];
  const sx = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const sy = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  return boxes.map((box) => ({
    ...box,
    x1: box.x1 * sx,
    y1: box.y1 * sy,
    x2: box.x2 * sx,
    y2: box.y2 * sy,
  }));
}
