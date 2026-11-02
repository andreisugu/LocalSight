// Pure decoding for the two ONNX graphs. No DOM, no ONNX Runtime import: these can be
// unit-tested with plain Float32Arrays under Node.
//
// Both decoders return boxes in *frame* pixels (letterbox padding and scale removed) as
// { x1, y1, x2, y2, score } so the caller can draw them directly.

/**
 * Greedy NMS, highest score first, same shape as the Python `_nms`.
 * @param {Array<{x1:number,y1:number,x2:number,y2:number,score:number}>} boxes
 * @param {number} threshold
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score:number}>}
 */
export function nms(boxes, threshold) {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.score - a.box.score)
    .map((entry) => entry.index);
  const keep = [];
  const suppressed = new Uint8Array(boxes.length);

  for (let i = 0; i < order.length; i += 1) {
    const best = order[i];
    if (suppressed[best]) continue;
    const a = boxes[best];
    keep.push(a);
    for (let j = i + 1; j < order.length; j += 1) {
      const other = order[j];
      if (suppressed[other]) continue;
      if (iou(a, boxes[other]) > threshold) suppressed[other] = 1;
    }
  }
  return keep;
}

function iou(a, b) {
  const overlapW = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const overlapH = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = overlapW * overlapH;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * YOLO anchor-free decode. Output tensor is [1, 4 + classes, anchors] with rows
 * cx, cy, w, h followed by the class scores.
 *
 * @param {Float32Array} data
 * @param {object} [options]
 * @param {number} [options.numClasses] 80 for COCO
 * @param {number} [options.numAnchors] 8400 for a 640 input
 * @param {number} [options.conf] score threshold
 * @param {number} [options.iou] NMS IoU
 * @param {number} [options.scale] letterbox scale
 * @param {number} [options.padX]
 * @param {number} [options.padY]
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score:number,classId:number}>}
 */
export function decodeYolo(data, options = {}) {
  const {
    numClasses = 80,
    conf = 0.25,
    iou: iouThreshold = 0.45,
    scale = 1,
    padX = 0,
    padY = 0,
  } = options;
  // 84 x 8400 for a 640 input; derived from the buffer when not given explicitly.
  const numAnchors = options.numAnchors || Math.floor(data.length / (4 + numClasses));

  const candidates = [];
  for (let anchor = 0; anchor < numAnchors; anchor += 1) {
    // Person is class 0 and the only class this spike cares about.
    const score = data[4 * numAnchors + anchor];
    if (!(score >= conf)) continue;
    const cx = data[anchor];
    const cy = data[numAnchors + anchor];
    const w = data[2 * numAnchors + anchor];
    const h = data[3 * numAnchors + anchor];
    if (!(w > 0) || !(h > 0)) continue;
    candidates.push({
      x1: (cx - w / 2 - padX) / scale,
      y1: (cy - h / 2 - padY) / scale,
      x2: (cx + w / 2 - padX) / scale,
      y2: (cy + h / 2 - padY) / scale,
      score,
      classId: 0,
    });
  }
  return nms(candidates, iouThreshold);
}

export const YUNET_STRIDES = [8, 16, 32];

/**
 * YuNet decode, the same maths as the removed ml/safesight_ml/privacy.py `_decode_yunet`:
 * score = sqrt(cls * obj), cx = (col + dx) * stride, w = exp(dw) * stride, NMS 0.3.
 *
 * `outputs` is the model output list in graph order: cls[3], obj[3], bbox[3], kps[3].
 *
 * @param {Float32Array[]} outputs
 * @param {object} [options]
 * @param {number} [options.inputW] model input width (padded frame or letterbox size)
 * @param {number} [options.inputH]
 * @param {number} [options.scoreThreshold] 0.6 in the Python edge
 * @param {number} [options.nmsThreshold] 0.3
 * @param {number} [options.scale] input -> frame scale
 * @param {number} [options.padX]
 * @param {number} [options.padY]
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score:number}>}
 */
export function decodeYuNet(outputs, options = {}) {
  const {
    inputW,
    inputH,
    scoreThreshold = 0.6,
    nmsThreshold = 0.3,
    scale = 1,
    padX = 0,
    padY = 0,
  } = options;

  const strides = YUNET_STRIDES.length;
  if (!Array.isArray(outputs) || outputs.length < strides * 3) return [];
  if (!inputW || !inputH) return [];

  const candidates = [];
  for (let index = 0; index < strides; index += 1) {
    const stride = YUNET_STRIDES[index];
    const cols = Math.floor(inputW / stride);
    const rows = Math.floor(inputH / stride);
    const cls = outputs[index];
    const obj = outputs[index + strides];
    const deltas = outputs[index + 2 * strides];
    const cells = Math.min(cols * rows, cls.length, obj.length);

    for (let cell = 0; cell < cells; cell += 1) {
      const clsScore = Math.min(1, Math.max(0, cls[cell]));
      const objScore = Math.min(1, Math.max(0, obj[cell]));
      const score = Math.sqrt(clsScore * objScore);
      if (!(score >= scoreThreshold)) continue;

      const col = cell % cols;
      const row = (cell - col) / cols;
      const cx = (col + deltas[cell * 4]) * stride;
      const cy = (row + deltas[cell * 4 + 1]) * stride;
      const w = Math.exp(deltas[cell * 4 + 2]) * stride;
      const h = Math.exp(deltas[cell * 4 + 3]) * stride;
      if (!(w > 0) || !(h > 0)) continue;

      candidates.push({
        x1: (cx - w / 2 - padX) / scale,
        y1: (cy - h / 2 - padY) / scale,
        x2: (cx + w / 2 - padX) / scale,
        y2: (cy + h / 2 - padY) / scale,
        score,
      });
    }
  }
  return nms(candidates, nmsThreshold);
}
