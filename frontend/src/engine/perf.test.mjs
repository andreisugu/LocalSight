// Tests for the engine's measured optimization: the face-detector input cap.
//
// Numbers only: no canvas, no model, no worker. `perf.js` is the pure part of
// `detectFaces` in worker.js, so the scaling that maps a capped box back to the frame is
// pinned here instead of being checked by eye on a demo clip.
//
// The policy test is the privacy one: the cap may only run when the head-band safety blur
// is on, because only then a face YuNet misses is still covered.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FACE_INPUT_MAX_EDGE,
  YUNET_INPUT_MULTIPLE,
  cappedFaceInput,
  faceInputPlan,
  fitScale,
  padToMultiple,
  scaleFaceBoxes,
} from './perf.js';

// The demo frame the cap was measured on.
const WIDTH = 1280;
const HEIGHT = 720;

describe('fitScale', () => {
  test('fits the long side into the limit', () => {
    assert.equal(fitScale(WIDTH, HEIGHT), 0.5);
    assert.equal(fitScale(1920, 1080), 640 / 1920);
  });

  test('never upscales', () => {
    assert.equal(fitScale(640, 360), 1);
    assert.equal(fitScale(320, 240), 1);
  });

  test('unusable sizes fall back to no scaling', () => {
    assert.equal(fitScale(0, 720), 1);
    assert.equal(fitScale(1280, -1), 1);
    assert.equal(fitScale(Number.NaN, 720), 1);
  });
});

describe('cappedFaceInput', () => {
  test('1280x720 becomes a 640x360 copy', () => {
    assert.deepEqual(cappedFaceInput(WIDTH, HEIGHT), {
      capped: true,
      width: 640,
      height: 360,
      scaleX: 2,
      scaleY: 2,
    });
  });

  test('1920x1080 becomes 640x360 with a 3x factor on each axis', () => {
    const plan = cappedFaceInput(1920, 1080);
    assert.equal(plan.capped, true);
    assert.equal(plan.width, 640);
    assert.equal(plan.height, 360);
    assert.equal(plan.scaleX, 3);
    assert.equal(plan.scaleY, 3);
  });

  test('the factor is per axis, because each side rounds on its own', () => {
    // 1279*0.5 = 639.5 -> 640, 719*0.5 = 359.5 -> 360: the copy is not exactly half.
    const plan = cappedFaceInput(1279, 719);
    assert.equal(plan.width, 640);
    assert.equal(plan.height, 360);
    assert.equal(plan.scaleX, 1279 / 640);
    assert.equal(plan.scaleY, 719 / 360);
    assert.notEqual(plan.scaleX, plan.scaleY);
  });

  test('a frame that already fits is not capped and keeps identity factors', () => {
    assert.deepEqual(cappedFaceInput(640, 360), {
      capped: false,
      width: 640,
      height: 360,
      scaleX: 1,
      scaleY: 1,
    });
  });

  test('the default limit is the documented long side', () => {
    assert.equal(FACE_INPUT_MAX_EDGE, 640);
    const plan = cappedFaceInput(4000, 3000);
    assert.equal(Math.max(plan.width, plan.height), FACE_INPUT_MAX_EDGE);
  });
});

describe('faceInputPlan', () => {
  test('caps the detector only while the head-band safety blur is on', () => {
    const capped = faceInputPlan({ safetyBlur: true, width: WIDTH, height: HEIGHT });
    assert.equal(capped.capped, true);
    assert.equal(capped.width, 640);

    const full = faceInputPlan({ safetyBlur: false, width: WIDTH, height: HEIGHT });
    assert.equal(full.capped, false);
    assert.equal(full.width, WIDTH);
    assert.equal(full.height, HEIGHT);
    assert.equal(full.scaleX, 1);
    assert.equal(full.scaleY, 1);
  });

  test('a small frame is left alone even with the safety blur on', () => {
    const plan = faceInputPlan({ safetyBlur: true, width: 640, height: 360 });
    assert.equal(plan.capped, false);
    assert.equal(plan.width, 640);
  });

  test('an explicit limit is honoured', () => {
    const plan = faceInputPlan({ safetyBlur: true, width: WIDTH, height: HEIGHT, maxEdge: 720 });
    assert.equal(plan.capped, true);
    assert.equal(plan.width, 720);
    assert.equal(plan.height, 405);
  });
});

describe('padToMultiple', () => {
  test('rounds the detector input up to YuNet multiples of 32', () => {
    assert.equal(YUNET_INPUT_MULTIPLE, 32);
    assert.equal(padToMultiple(640), 640);
    assert.equal(padToMultiple(360), 384);
    assert.equal(padToMultiple(720), 736);
    assert.equal(padToMultiple(1), 32);
  });

  test('an unusable multiple falls back to 32 instead of dividing by zero', () => {
    assert.equal(padToMultiple(360, 0), 384);
    assert.equal(padToMultiple(360, Number.NaN), 384);
    assert.equal(padToMultiple(360, -8), 384);
  });

  test('the padded side is always a whole multiple and never shorter than the input', () => {
    for (const size of [1, 31, 32, 33, 360, 361, 640, 719, 1080]) {
      const padded = padToMultiple(size);
      assert.equal(padded % YUNET_INPUT_MULTIPLE, 0);
      assert.ok(padded >= size);
      assert.ok(padded - size < YUNET_INPUT_MULTIPLE);
    }
  });
});

describe('scaleFaceBoxes', () => {
  const faces = [
    { x1: 100, y1: 50, x2: 140, y2: 90, score: 0.92 },
    { x1: 10, y1: 20, x2: 30, y2: 40, score: 0.61 },
  ];

  test('maps copy pixels back to frame pixels', () => {
    assert.deepEqual(scaleFaceBoxes(faces, 2, 2), [
      { x1: 200, y1: 100, x2: 280, y2: 180, score: 0.92 },
      { x1: 20, y1: 40, x2: 60, y2: 80, score: 0.61 },
    ]);
  });

  test('keeps per-axis factors independent', () => {
    const [box] = scaleFaceBoxes([faces[0]], 1279 / 640, 719 / 360);
    assert.equal(box.x2, 140 * (1279 / 640));
    assert.equal(box.y2, 90 * (719 / 360));
  });

  test('identity factors return equal coordinates', () => {
    assert.deepEqual(scaleFaceBoxes(faces, 1, 1), faces);
  });

  test('invalid factors are treated as no scaling, never as zero', () => {
    for (const factor of [0, -2, Number.NaN, undefined]) {
      const [box] = scaleFaceBoxes([faces[0]], factor, factor);
      assert.deepEqual(box, faces[0]);
    }
  });

  test('does not mutate the decoded boxes', () => {
    const input = faces.map((face) => ({ ...face }));
    scaleFaceBoxes(input, 2, 2);
    assert.deepEqual(input, faces);
  });

  test('a non-array is an empty list, not a throw', () => {
    assert.deepEqual(scaleFaceBoxes(null, 2, 2), []);
    assert.deepEqual(scaleFaceBoxes(undefined, 2, 2), []);
  });

  test('a round trip through copy pixels lands on the original box', () => {
    const plan = cappedFaceInput(WIDTH, HEIGHT);
    const frameBox = { x1: 92.5, y1: 214.25, x2: 131.75, y2: 260.5, score: 0.88 };
    const copyBox = {
      ...frameBox,
      x1: frameBox.x1 / plan.scaleX,
      y1: frameBox.y1 / plan.scaleY,
      x2: frameBox.x2 / plan.scaleX,
      y2: frameBox.y2 / plan.scaleY,
    };
    const [back] = scaleFaceBoxes([copyBox], plan.scaleX, plan.scaleY);
    for (const key of ['x1', 'y1', 'x2', 'y2']) {
      assert.ok(Math.abs(back[key] - frameBox[key]) < 1e-9, `${key} drifted`);
    }
    assert.equal(back.score, frameBox.score);
  });
});
