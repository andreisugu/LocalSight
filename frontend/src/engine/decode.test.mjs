// Tests for the pure box math: `decodeYolo`, `decodeYuNet` and `nms`.
//
// These are the only guard between a decode regression and blurred-wrong-region output, so
// the cases come from the differential test in `docs/qa/engine-parity.md` §2.3/§3.1/§4:
// the tensor layout, the letterbox round-trip (detector box in source pixels), the frame-12
// duplicate that NMS 0.45 suppresses but ultralytics' 0.7 keeps, and the YuNet stride math.
// Synthetic Float32Arrays only: no model, no canvas, no DOM.
//
// `letterbox()` and `rgbaToNchw()` live in `detectors.js`, which imports the ORT wasm with
// Vite's `?url` suffix at module scope; plain Node cannot resolve that, so the padding and
// scale are pinned from this side: the exact numbers the worker feeds `decodeYolo` for a
// 1920x1080 frame (scale 1/3, padX 0, padY 140) and the round-trip back to source pixels.

import test from 'node:test';
import assert from 'node:assert/strict';

import { YUNET_STRIDES, decodeYolo, decodeYuNet, nms } from './decode.js';

const YOLO_CLASSES = 80;
const PERSON_CONF = 0.35;
const PERSON_NMS = 0.45;

/** Column-major `[1, 4 + classes, anchors]` tensor, as the graph emits it. */
function yoloTensor(boxes, numAnchors = boxes.length) {
  const data = new Float32Array((4 + YOLO_CLASSES) * numAnchors);
  boxes.forEach((box, anchor) => {
    data[anchor] = box.cx;
    data[numAnchors + anchor] = box.cy;
    data[2 * numAnchors + anchor] = box.w;
    data[3 * numAnchors + anchor] = box.h;
    data[4 * numAnchors + anchor] = box.score;
  });
  return data;
}

/** A source-pixel box -> the letterboxed cx/cy/w/h the tensor would carry. */
function toLetterbox(box, { scale, padX, padY }) {
  return {
    cx: ((box.x1 + box.x2) / 2) * scale + padX,
    cy: ((box.y1 + box.y2) / 2) * scale + padY,
    w: (box.x2 - box.x1) * scale,
    h: (box.y2 - box.y1) * scale,
    score: 0.9,
  };
}

function assertClose(actual, expected, tolerance = 1e-4) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );
}

function assertBoxClose(box, expected, tolerance = 1e-4) {
  assertClose(box.x1, expected.x1, tolerance);
  assertClose(box.y1, expected.y1, tolerance);
  assertClose(box.x2, expected.x2, tolerance);
  assertClose(box.y2, expected.y2, tolerance);
}

test('decodeYolo reads the column-major tensor, not interleaved rows', () => {
  const data = yoloTensor([
    { cx: 100, cy: 200, w: 40, h: 80, score: 0.9 },
    { cx: 300, cy: 320, w: 20, h: 60, score: 0.8 },
    { cx: 500, cy: 400, w: 10, h: 30, score: 0.7 },
  ]);

  // An infinite NMS threshold keeps every candidate, so the geometry is what is asserted.
  const boxes = decodeYolo(data, { conf: 0.1, iou: Infinity });

  assert.deepEqual(
    boxes.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]),
    [
      [80, 160, 120, 240],
      [290, 290, 310, 350],
      [495, 385, 505, 415],
    ]
  );
  // Highest score first, like the Python `_nms`.
  boxes.forEach((box, index) => assertClose(box.score, [0.9, 0.8, 0.7][index], 1e-6));
  assert.ok(boxes.every((box) => box.classId === 0));
});

test('the tensor shape is derived from the buffer length when not given', () => {
  // 4 anchors exactly: a decoder that assumed a different `numAnchors` would shift every
  // column and return a box that is not this one.
  const data = yoloTensor([
    { cx: 10, cy: 20, w: 4, h: 6, score: 0.9 },
    { cx: 0, cy: 0, w: 0, h: 0, score: 0 },
    { cx: 0, cy: 0, w: 0, h: 0, score: 0 },
    { cx: 0, cy: 0, w: 0, h: 0, score: 0 },
  ]);
  const [box] = decodeYolo(data, { conf: PERSON_CONF });

  assert.deepEqual([box.x1, box.y1, box.x2, box.y2], [8, 17, 12, 23]);
});

// Parity §4 discrepancy 1: on frame 12 ultralytics (NMS 0.7) keeps a duplicate whose IoU
// with its neighbour is 0.70; the port (NMS 0.45) suppresses it. Both halves are pinned so
// a change to the threshold is visible instead of silent.
test('NMS 0.45 suppresses the frame-12 duplicate that IoU 0.7 keeps', () => {
  const boxes = [
    { cx: 50, cy: 50, w: 100, h: 100, score: 0.9 },
    { cx: 50, cy: 35, w: 100, h: 70, score: 0.85 },
  ];
  const data = yoloTensor(boxes);

  const port = decodeYolo(data, { conf: PERSON_CONF, iou: PERSON_NMS });
  assert.equal(port.length, 1, '0.45 suppresses the 0.70 duplicate');
  assert.deepEqual([port[0].x1, port[0].y1, port[0].x2, port[0].y2], [0, 0, 100, 100]);

  const ultralytics = decodeYolo(data, { conf: PERSON_CONF, iou: 0.7 });
  assert.equal(ultralytics.length, 2, '0.70 keeps both, which is the documented difference');
  assert.deepEqual(
    ultralytics.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]),
    [
      [0, 0, 100, 100],
      [0, 0, 100, 70],
    ]
  );
});

test('nms keeps the first of two equal scores and drops overlapping boxes', () => {
  const box = (x1, score) => ({ x1, y1: 0, x2: x1 + 100, y2: 100, score });
  assert.deepEqual(nms([], 0.45), []);
  // Equal scores, no overlap: stable order, both kept.
  assert.deepEqual(nms([box(0, 0.5), box(200, 0.5)], 0.45).map((item) => item.x1), [0, 200]);
  // Equal scores, full overlap: the first stays, the second is suppressed.
  assert.deepEqual(nms([box(0, 0.5), box(0, 0.5)], 0.45).map((item) => item.x1), [0]);
  // The comparison is strict (`iou > threshold`), so exactly-at-threshold survives.
  assert.equal(nms([box(0, 0.9), { ...box(0, 0.8), y2: 85 }], 0.85).length, 2);
});

test('decodeYolo drops scores below the threshold and non-positive boxes', () => {
  const data = yoloTensor([
    { cx: 100, cy: 100, w: 40, h: 80, score: 0.35 },
    { cx: 100, cy: 100, w: 40, h: 80, score: 0.2 },
    { cx: 100, cy: 100, w: 0, h: 80, score: 0.99 },
  ]);
  // The graph hands over float32: 0.35 is stored as 0.3499999940…, so "exactly at the
  // decimal threshold" is not a real case. The boundary is `score >= conf` on the stored
  // value, which is what this pins.
  const stored = data[4 * 3];
  assert.ok(stored < 0.35);

  const atThreshold = decodeYolo(data, { conf: stored });
  assert.equal(atThreshold.length, 1, 'the stored score passes its own threshold');
  assertClose(atThreshold[0].score, stored, 1e-7);

  assert.equal(decodeYolo(data, { conf: stored + 1e-6 }).length, 0, 'below `conf` is dropped');
  assert.equal(
    decodeYolo(data, { conf: 0.1, iou: Infinity }).length,
    2,
    'a low threshold keeps both scores, the w=0 candidate stays out'
  );
});

// The worker feeds `decodeYolo` a 640x640 letterbox of the frame: 1920x1080 -> drawW 640,
// drawH 360, scale 1/3, padX 0, padY 140 (`letterbox()` in detectors.js). A box in source
// pixels must come back to the same source pixels, because those coordinates become the
// blur rectangle.
test('a person box survives the 1920x1080 -> 640 letterbox round-trip', () => {
  const letterbox = { scale: 640 / 1920, padX: 0, padY: 140 };
  const source = { x1: 960, y1: 313.2, x2: 1056, y2: 637.2 };
  const data = yoloTensor([toLetterbox(source, letterbox)]);

  const [box] = decodeYolo(data, {
    conf: PERSON_CONF,
    iou: PERSON_NMS,
    scale: letterbox.scale,
    padX: letterbox.padX,
    padY: letterbox.padY,
  });

  assertBoxClose(box, source);
});

// Parity §4 (risk): at 1920x1080 both implementations round to exactly 640x360, so the
// 1-px letterbox-rounding difference is invisible. The padding/scale removal must still be
// exact for a scale that is not representable in binary.
test('the padding and a non-integer scale are removed exactly', () => {
  // 1921x1081: scale = 640/1921, drawH = round(1081 * scale) = 360, padY = floor(280/2).
  const letterbox = { scale: 640 / 1921, padX: 0, padY: 140 };
  const source = { x1: 500.5, y1: 400.25, x2: 620.75, y2: 900.5 };
  const data = yoloTensor([toLetterbox(source, letterbox)]);

  const [box] = decodeYolo(data, {
    conf: PERSON_CONF,
    iou: PERSON_NMS,
    scale: letterbox.scale,
    padX: letterbox.padX,
    padY: letterbox.padY,
  });

  assertBoxClose(box, source, 1e-3);
});

/** YuNet outputs in graph order: cls[3], obj[3], bbox[3], kps[3]. */
function yunetOutputs(inputW, inputH) {
  const cells = YUNET_STRIDES.map((stride) => (
    Math.floor(inputW / stride) * Math.floor(inputH / stride)
  ));
  const empty = () => YUNET_STRIDES.map((_, index) => new Float32Array(cells[index]));
  const inputs = {
    cls: empty(),
    obj: empty(),
    deltas: YUNET_STRIDES.map((_, index) => new Float32Array(cells[index] * 4)),
    cells,
  };
  return [...inputs.cls, ...inputs.obj, ...inputs.deltas];
}

test('decodeYuNet uses stride*cell offsets, not flat output order', () => {
  const outputs = yunetOutputs(32, 32);
  // 32x32 at stride 8: 4 columns, 4 rows. Cell 9 is row 2, column 1.
  const cell = 2 * 4 + 1;
  outputs[0][cell] = 0.9;
  outputs[3][cell] = 0.8;
  const deltas = outputs[6];
  deltas[cell * 4] = 0.5;
  deltas[cell * 4 + 1] = 0.25;

  const [face] = decodeYuNet(outputs, { inputW: 32, inputH: 32 });
  // cx = (col + dx) * stride, w = exp(0) * stride = 8.
  assert.deepEqual([face.x1, face.y1, face.x2, face.y2], [8, 14, 16, 22]);
  assertClose(face.score, Math.sqrt(0.9 * 0.8), 1e-6);
});

test('decodeYuNet removes the letterbox padding and scale like the Python edge', () => {
  const outputs = yunetOutputs(32, 32);
  const cell = 2 * 4 + 1;
  outputs[0][cell] = 0.9;
  outputs[3][cell] = 0.8;
  const deltas = outputs[6];
  deltas[cell * 4] = 0.5;
  deltas[cell * 4 + 1] = 0.25;

  const [face] = decodeYuNet(outputs, {
    inputW: 32,
    inputH: 32,
    scale: 0.5,
    padX: 10,
    padY: 20,
  });

  // In the input: cx 12, cy 18, 8x8 -> (8, 14, 16, 22). Undoing pad (10, 20) and
  // scale 0.5 gives ((8 - 10) / 0.5, (14 - 20) / 0.5, ...). A face near the padded
  // border may go negative; the worker clamps when it draws the blur.
  assert.deepEqual([face.x1, face.y1, face.x2, face.y2], [-4, -12, 12, 4]);
});

test('decodeYuNet gates on the score threshold and on its inputs', () => {
  const outputs = yunetOutputs(32, 32);
  const cell = 0;
  outputs[0][cell] = 0.5;
  outputs[3][cell] = 0.5; // sqrt(0.25) = 0.5 < 0.6
  assert.deepEqual(decodeYuNet(outputs, { inputW: 32, inputH: 32 }), []);

  // The Python edge clamps both scores into 0..1 before the geometric mean.
  outputs[0][cell] = 2;
  outputs[3][cell] = 1;
  const [face] = decodeYuNet(outputs, { inputW: 32, inputH: 32 });
  assert.equal(face.score, 1);

  assert.deepEqual(decodeYuNet(outputs, {}), [], 'no input size, no boxes');
  assert.deepEqual(decodeYuNet([new Float32Array(1)], { inputW: 32, inputH: 32 }), []);
});

test('decodeYuNet keeps faces across all three strides', () => {
  const outputs = yunetOutputs(64, 64);
  // One high score per stride: cells 0, then the first cell of each output.
  outputs[0][0] = 0.9;
  outputs[3][0] = 0.9;
  outputs[1][0] = 0.9;
  outputs[4][0] = 0.9;
  outputs[2][0] = 0.9;
  outputs[5][0] = 0.9;

  const faces = decodeYuNet(outputs, { inputW: 64, inputH: 64 });
  assert.equal(faces.length, 3, 'one face per stride, five strides-worth of zeros ignored');
  // Cell 0 is (col 0, row 0) with no offset: the box is centred on the anchor, so it hangs
  // half a stride out of the frame on each side (8x8, 16x16, 32x32 boxes at the origin).
  assert.deepEqual(
    faces.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]),
    [
      [-4, -4, 4, 4],
      [-8, -8, 8, 8],
      [-16, -16, 16, 16],
    ]
  );
});
