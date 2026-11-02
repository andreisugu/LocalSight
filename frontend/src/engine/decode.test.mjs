// Tests for the pure box math: `decodeEfficientDet`, `decodeYuNet`, output matching and `nms`.
//
// These are the only guard between a decode regression and blurred-wrong-region output, so
// the cases come from the differential test in `docs/qa/engine-parity.md` §2.3/§3.1/§4:
// the tensor layout, the letterbox round-trip (detector box in source pixels), the frame-12
// duplicate that NMS 0.45 suppresses, and the YuNet stride math. Synthetic Float32Arrays
// only: no model, no canvas, no DOM.
//
// `letterbox()` and `rgbaToNchw()` live in `detectors.js`, which imports the ORT wasm with
// Vite's `?url` suffix at module scope; plain Node cannot resolve that, so the padding and
// scale are pinned from this side: the exact numbers the worker feeds the decoder for a
// 1280x720 frame (Lite0, size 320) and the round-trip back to source pixels.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  YUNET_STRIDES,
  decodeEfficientDet,
  decodeYuNet,
  isClassIdArray,
  matchEfficientDetOutputs,
  nms,
} from './decode.js';

const PERSON_CONF = 0.35;
const PERSON_NMS = 0.45;

/** Tolerance comparisons for float32 round-trips. */
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

// --- EfficientDet-Lite ---------------------------------------------------------------
// The graph emits 25 rows whatever the input size: boxes `[1, 25, 4]` normalized
// `[ymin, xmin, ymax, xmax]`, class ids `[1, 25]`, scores `[1, 25]`, count `[1]`.
// Person is class 0, so every test here pins that class 0 survives: a decoder that read
// class ids as scores (or vice versa) would return zero persons.

const EDET_ROWS = 25;

/** Synthetic graph shape: 25 rows, the same layout `runEfficientDet` returns. */
function efficientDetOutput(rows, { count = EDET_ROWS } = {}) {
  const boxes = new Float32Array(EDET_ROWS * 4);
  const classes = new Float32Array(EDET_ROWS);
  const scores = new Float32Array(EDET_ROWS);
  rows.forEach((row, index) => {
    boxes[index * 4] = row.ymin;
    boxes[index * 4 + 1] = row.xmin;
    boxes[index * 4 + 2] = row.ymax;
    boxes[index * 4 + 3] = row.xmax;
    classes[index] = row.classId ?? 0;
    scores[index] = row.score ?? 0;
  });
  return { boxes, classes, scores, count };
}

/** A source-pixel box -> the normalized [ymin, xmin, ymax, xmax] the model would emit. */
function toEfficientDetBox(box, { size, scale, padX, padY }) {
  return {
    ymin: (box.y1 * scale + padY) / size,
    xmin: (box.x1 * scale + padX) / size,
    ymax: (box.y2 * scale + padY) / size,
    xmax: (box.x2 * scale + padX) / size,
  };
}

test('decodeEfficientDet keeps a class-0 person and never reads class ids as scores', () => {
  const output = efficientDetOutput([
    { ymin: 0.1, xmin: 0.2, ymax: 0.6, xmax: 0.5, classId: 0, score: 0.709 },
  ]);

  const boxes = decodeEfficientDet(output, { size: 320 });

  assert.equal(boxes.length, 1, 'class 0 is the person class, not a thresholded score');
  assert.equal(boxes[0].classId, 0);
  assertClose(boxes[0].score, 0.709, 1e-6);
  // The two `[1, 25]` tensors are told apart by value character: ids are integers.
  assert.equal(isClassIdArray(output.classes), true);
  assert.equal(isClassIdArray(output.scores), false);
});

test('decodeEfficientDet drops every non-person class', () => {
  const output = efficientDetOutput([
    { ymin: 0, xmin: 0, ymax: 0.5, xmax: 0.5, classId: 4, score: 0.9 }, // car
    { ymin: 0, xmin: 0, ymax: 0.5, xmax: 0.5, classId: 7, score: 0.8 }, // truck
    { ymin: 0.1, xmin: 0.1, ymax: 0.9, xmax: 0.9, classId: 0, score: 0.6 },
  ]);

  const boxes = decodeEfficientDet(output, { size: 320 });
  assert.equal(boxes.length, 1);
  assertClose(boxes[0].score, 0.6, 1e-6);
});

test('decodeEfficientDet gates on the score threshold', () => {
  const output = efficientDetOutput([
    { ymin: 0, xmin: 0, ymax: 0.5, xmax: 0.5, classId: 0, score: 0.34 },
    { ymin: 0.2, xmin: 0.2, ymax: 0.9, xmax: 0.9, classId: 0, score: 0.35 },
  ]);

  // The graph hands over float32: 0.35 is stored as 0.3499999940…, so "exactly at the
  // decimal threshold" is not a real case. The boundary is `score >= conf` on the stored
  // value, which is what this pins.
  const stored = output.scores[1];
  assert.ok(stored < 0.35);
  assert.equal(decodeEfficientDet(output, { size: 320, conf: 0.35 }).length, 0);
  assert.equal(decodeEfficientDet(output, { size: 320, conf: stored }).length, 1);
  assert.equal(decodeEfficientDet(output, { size: 320, conf: 0.3 }).length, 2);

  // A NaN score is not a detection.
  const malformed = efficientDetOutput([
    { ymin: 0, xmin: 0, ymax: 0.5, xmax: 0.5, classId: 0, score: NaN },
  ]);
  assert.deepEqual(decodeEfficientDet(malformed, { size: 320 }), []);
});

// The export is y-first: [ymin, xmin, ymax, xmax]. Swapping those two axes would put a
// person's box on a person-shaped rectangle somewhere else, which the blur would then use.
test('decodeEfficientDet maps ymin/xmin to y1/x1, not the other way round', () => {
  const output = efficientDetOutput([
    { ymin: 0.2, xmin: 0.4, ymax: 0.6, xmax: 0.8, classId: 0, score: 0.9 },
  ]);

  const [box] = decodeEfficientDet(output, { size: 100 });
  assertBoxClose(box, { x1: 40, y1: 20, x2: 80, y2: 60 });
});

test('a person box survives the 1280x720 -> 320 Lite0 letterbox round-trip', () => {
  // letterbox(1280, 720, 320): scale 0.25, drawH 180, padY 70, padX 0.
  const letterbox = { size: 320, scale: 0.25, padX: 0, padY: 70 };
  const source = { x1: 320, y1: 200, x2: 480, y2: 560 };
  const output = efficientDetOutput([
    { ...toEfficientDetBox(source, letterbox), classId: 0, score: 0.71 },
  ]);

  const [box] = decodeEfficientDet(output, {
    size: letterbox.size,
    conf: PERSON_CONF,
    iou: PERSON_NMS,
    scale: letterbox.scale,
    padX: letterbox.padX,
    padY: letterbox.padY,
  });

  assertBoxClose(box, source, 1e-3);
});

test('the same decode works for the 448 Lite2 letterbox: size comes from the graph', () => {
  // letterbox(1280, 720, 448): scale 0.35, drawH 252, padY 98, padX 0.
  const letterbox = { size: 448, scale: 0.35, padX: 0, padY: 98 };
  const source = { x1: 500, y1: 300, x2: 700, y2: 640 };
  const output = efficientDetOutput([
    { ...toEfficientDetBox(source, letterbox), classId: 0, score: 0.83 },
  ]);

  const [box] = decodeEfficientDet(output, {
    size: letterbox.size,
    conf: PERSON_CONF,
    iou: PERSON_NMS,
    scale: letterbox.scale,
    padX: letterbox.padX,
    padY: letterbox.padY,
  });

  assertBoxClose(box, source, 1e-3);
});

test('decodeEfficientDet keeps only the first `count` rows', () => {
  const output = efficientDetOutput(
    [
      { ymin: 0.1, xmin: 0.1, ymax: 0.4, xmax: 0.4, classId: 0, score: 0.4 },
      { ymin: 0.5, xmin: 0.5, ymax: 0.9, xmax: 0.9, classId: 0, score: 0.9 },
    ],
    { count: 1 }
  );

  const boxes = decodeEfficientDet(output, { size: 320 });
  assert.equal(boxes.length, 1);
  assertClose(boxes[0].score, 0.4, 1e-6);
});

test('decodeEfficientDet drops degenerate boxes and malformed output', () => {
  const output = efficientDetOutput([
    { ymin: 0.5, xmin: 0.5, ymax: 0.5, xmax: 0.8, classId: 0, score: 0.9 },
    { ymin: 0.2, xmin: 0.2, ymax: 0.6, xmax: 0.2, classId: 0, score: 0.9 },
    { ymin: 0.1, xmin: 0.1, ymax: 0.7, xmax: 0.7, classId: 0, score: 0.8 },
  ]);
  assert.equal(decodeEfficientDet(output, { size: 320 }).length, 1);

  assert.deepEqual(decodeEfficientDet(null, { size: 320 }), []);
  assert.deepEqual(decodeEfficientDet({}, { size: 320 }), []);
  assert.deepEqual(
    decodeEfficientDet(
      { boxes: new Float32Array(2), classes: new Float32Array(1), scores: new Float32Array(1) },
      { size: 320 }
    ),
    [],
    'a short boxes buffer has no complete row'
  );
  assert.deepEqual(
    decodeEfficientDet(output, {}),
    [],
    'the letterbox size is required; without it there is no mapping'
  );
  assert.deepEqual(decodeEfficientDet(output, { size: 0 }), []);
});

test('decodeEfficientDet suppresses duplicates with NMS 0.45', () => {
  // Two 100x100 person boxes with IoU 0.7: the engine threshold keeps one, 0.7 keeps both.
  const output = efficientDetOutput([
    { ymin: 0, xmin: 0, ymax: 1, xmax: 1, classId: 0, score: 0.9 },
    { ymin: 0, xmin: 0, ymax: 0.7, xmax: 1, classId: 0, score: 0.85 },
  ]);

  assert.equal(decodeEfficientDet(output, { size: 100, iou: PERSON_NMS }).length, 1);
  assert.equal(decodeEfficientDet(output, { size: 100, iou: 0.7 }).length, 2);
});

// ORT names this export StatefulPartitionedCall:3/2/1/0. The name is the only reliable
// handle: both 2-D tensors are `[1, 25]`, and class 0 looks like a tiny score.
test('matchEfficientDetOutputs resolves the tensors by graph output name', () => {
  const output = efficientDetOutput([
    { ymin: 0.1, xmin: 0.2, ymax: 0.6, xmax: 0.5, classId: 0, score: 0.709 },
  ]);
  const results = {
    'StatefulPartitionedCall:3': { data: output.boxes, dims: [1, EDET_ROWS, 4] },
    'StatefulPartitionedCall:2': { data: output.classes, dims: [1, EDET_ROWS] },
    'StatefulPartitionedCall:1': { data: output.scores, dims: [1, EDET_ROWS] },
    'StatefulPartitionedCall:0': { data: new Float32Array([EDET_ROWS]), dims: [1] },
  };

  const matched = matchEfficientDetOutputs(results);
  assert.equal(matched.classes, output.classes, 'the class-0 column is the class list');
  assert.equal(matched.scores, output.scores);
  assert.equal(matched.count, EDET_ROWS);
  assert.equal(decodeEfficientDet(matched, { size: 320 }).length, 1);
  assert.equal(matchEfficientDetOutputs({}), null);
});

test('a renamed graph still finds the class list by integer-like values', () => {
  const output = efficientDetOutput([
    { ymin: 0.1, xmin: 0.2, ymax: 0.6, xmax: 0.5, classId: 0, score: 0.709 },
    { ymin: 0.3, xmin: 0.1, ymax: 0.9, xmax: 0.8, classId: 4, score: 0.5 },
  ]);
  const results = {
    raw_boxes: { data: output.boxes, dims: [1, EDET_ROWS, 4] },
    // Deliberately ordered scores-first: graph order alone would swap them.
    raw_scores: { data: output.scores, dims: [1, EDET_ROWS] },
    raw_classes: { data: output.classes, dims: [1, EDET_ROWS] },
    raw_num: { data: new Float32Array([EDET_ROWS]), dims: [1] },
  };

  const matched = matchEfficientDetOutputs(results);
  assert.equal(matched.classes, output.classes);
  assert.equal(matched.scores, output.scores);
  assert.equal(decodeEfficientDet(matched, { size: 320 }).length, 1);

  assert.equal(isClassIdArray(new Float32Array([0, 4, 7])), true);
  assert.equal(isClassIdArray(new Float32Array([0, 0.5, 1])), false);
  assert.equal(isClassIdArray(new Float32Array([0, -1, 2])), false);
  assert.equal(isClassIdArray(new Float32Array([0, NaN, 2])), false);
  assert.equal(isClassIdArray(new Float32Array(0)), false);
});
