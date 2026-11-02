// Pure decoding for the ONNX graphs. No DOM, no ONNX Runtime import: these can be
// unit-tested with plain Float32Arrays under Node.
//
// Every decoder returns boxes in *frame* pixels (letterbox padding and scale removed) as
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

/**
 * A class-id list is integer-valued; a score list is fractional. Used only as the
 * name-agnostic fallback in `matchEfficientDetOutputs`: the two `[1, 25]` outputs share a
 * shape, and a "score > 1.5" test would misread class 0 (person) as a score.
 *
 * @param {ArrayLike<number>} values
 * @returns {boolean}
 */
export function isClassIdArray(values) {
  if (!values || values.length === 0) return false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value < 0) return false;
    if (Math.abs(value - Math.round(value)) > 1e-3) return false;
  }
  return true;
}

/**
 * Resolve the four EfficientDet output tensors from an ORT result object.
 *
 * The export names them `StatefulPartitionedCall:3` (boxes), `:2` (classes), `:1` (scores),
 * `:0` (count), so the numeric suffix is the stable handle. A renamed graph falls back to
 * shape and graph order: the 3-D tensor is boxes, the 1-D one is the count, and of the two
 * 2-D tensors the first is classes - unless one is integer-valued and the other is not, in
 * which case the integer one is the class list.
 *
 * @param {Record<string, {data: Float32Array, dims: number[]}>} results
 * @returns {{boxes: Float32Array, classes: Float32Array, scores: Float32Array,
 *            count: number} | null} null for an unexpected graph
 */
export function matchEfficientDetOutputs(results) {
  if (!results || typeof results !== 'object') return null;
  const entries = Object.entries(results).filter(
    ([, value]) => value && value.data && Array.isArray(value.dims)
  );
  if (entries.length < 3) return null;

  const named = (suffix) => entries.find(([name]) => name.endsWith(suffix))?.[1] ?? null;
  let boxes = named(':3');
  let classes = named(':2');
  let scores = named(':1');
  let count = named(':0');

  if (!boxes) boxes = entries.find(([, value]) => value.dims.length === 3)?.[1] ?? null;
  if (!count) count = entries.find(([, value]) => value.dims.length === 1)?.[1] ?? null;

  const pairs = entries
    .filter(([, value]) => value.dims.length === 2)
    .map(([, value]) => value);
  if (!classes || !scores) {
    const pool = pairs.filter((value) => value !== classes && value !== scores);
    if (classes) {
      scores = pool[0] ?? scores;
    } else if (scores) {
      classes = pool[0] ?? classes;
    } else {
      const [first, second] = pool;
      if (first && second) {
        const classFirst = isClassIdArray(second.data) && !isClassIdArray(first.data);
        classes = classFirst ? second : first;
        scores = classFirst ? first : second;
      }
    }
  }

  if (!boxes || !classes || !scores) return null;
  const rows = Math.min(
    Math.floor(boxes.data.length / 4),
    classes.data.length,
    scores.data.length
  );
  if (rows <= 0) return null;
  const rawCount = count?.data?.[0];
  return {
    boxes: boxes.data,
    classes: classes.data,
    scores: scores.data,
    count: Number.isFinite(rawCount)
      ? Math.max(0, Math.min(rows, Math.floor(rawCount)))
      : rows,
  };
}

/**
 * EfficientDet decode: keep class 0 (person) above `conf`, undo the letterbox and run NMS.
 *
 * The boxes are normalized `[ymin, xmin, ymax, xmax]` - y before x, unlike YOLO's
 * `[cx, cy, w, h]` - so the mapping is `(value * size - pad) / scale` per axis.
 *
 * @param {{boxes: Float32Array, classes: Float32Array, scores: Float32Array,
 *          count: number}} output from `runEfficientDet`
 * @param {object} [options]
 * @param {number} options.size model input side (320 for Lite0, 448 for Lite2)
 * @param {number} [options.conf] score threshold
 * @param {number} [options.iou] NMS IoU
 * @param {number} [options.scale] letterbox scale
 * @param {number} [options.padX]
 * @param {number} [options.padY]
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score:number,classId:number}>}
 */
export function decodeEfficientDet(output, options = {}) {
  const {
    size,
    conf = 0.35,
    iou: iouThreshold = 0.45,
    scale = 1,
    padX = 0,
    padY = 0,
  } = options;
  if (!output || !output.boxes || !output.classes || !output.scores) return [];
  if (!(size > 0) || !(scale > 0)) return [];

  const rows = Math.min(
    Math.floor(output.boxes.length / 4),
    output.classes.length,
    output.scores.length,
    Number.isFinite(output.count) ? Math.max(0, Math.floor(output.count)) : Infinity
  );

  const candidates = [];
  for (let row = 0; row < rows; row += 1) {
    // Class 0 is person, and the only class this pipeline cares about.
    if (output.classes[row] !== 0) continue;
    const score = output.scores[row];
    if (!(score >= conf)) continue;

    const ymin = output.boxes[row * 4];
    const xmin = output.boxes[row * 4 + 1];
    const ymax = output.boxes[row * 4 + 2];
    const xmax = output.boxes[row * 4 + 3];
    if (!Number.isFinite(ymin) || !Number.isFinite(xmin)
      || !Number.isFinite(ymax) || !Number.isFinite(xmax)) continue;

    const x1 = (xmin * size - padX) / scale;
    const y1 = (ymin * size - padY) / scale;
    const x2 = (xmax * size - padX) / scale;
    const y2 = (ymax * size - padY) / scale;
    // A box outside the letterbox can hang over the padded border; only a degenerate one
    // is dropped here, the caller clamps to the frame.
    if (!(x2 > x1) || !(y2 > y1)) continue;
    candidates.push({ x1, y1, x2, y2, score, classId: 0 });
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
