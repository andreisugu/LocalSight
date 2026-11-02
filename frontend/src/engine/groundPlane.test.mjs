// Tests for the metric ground plane. Exact numbers only: the module is pure arithmetic, so
// there is no clock, no canvas and no model in here.
//
// The cases are the ones the prototype can actually get wrong: the four-point fit must be
// exact on a synthetic rectangle (top-down and perspective), must refuse degenerate input,
// and the derived speed must not print a number when the input is a guess.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  footPointFromBox,
  groundMetrics,
  homographyFromPoints,
  projectPoint,
  smoothSpeed,
} from './groundPlane.js';

/** Ground rectangle used by the /lab UI: 10 m by 10 m, origin at the first click. */
const RECT_10M = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** A camera looking down, with the apron filling the frame: 1 px = 1 cm. */
const TOP_DOWN_PX = [
  { x: 100, y: 100 },
  { x: 1100, y: 100 },
  { x: 1100, y: 1100 },
  { x: 100, y: 1100 },
];

/** One normalized frame unit is `METRES_PER_UNIT` metres, both axes. */
const METRES_PER_UNIT = 10;
const SCALE_H = [METRES_PER_UNIT, 0, 0, 0, METRES_PER_UNIT, 0, 0, 0, 1];

/** Asserts two points agree to `digits` decimals. */
function assertPoint(actual, expected, epsilon = 1e-9) {
  assert.ok(actual, `expected a projected point, got ${JSON.stringify(actual)}`);
  assert.ok(
    Math.abs(actual.x - expected.x) <= epsilon,
    `x: expected ${expected.x}, got ${actual.x}`,
  );
  assert.ok(
    Math.abs(actual.y - expected.y) <= epsilon,
    `y: expected ${expected.y}, got ${actual.y}`,
  );
}

describe('homographyFromPoints', () => {
  test('maps a top-down 10 x 10 m rectangle exactly', () => {
    const H = homographyFromPoints(TOP_DOWN_PX, RECT_10M);
    assert.ok(H, 'a full rectangle must produce a matrix');
    assert.equal(H.length, 9);

    for (let index = 0; index < 4; index += 1) {
      assertPoint(projectPoint(H, TOP_DOWN_PX[index]), RECT_10M[index]);
    }
    // Interior points are not part of the fit: this is the real check.
    assertPoint(projectPoint(H, { x: 600, y: 600 }), { x: 5, y: 5 });
    assertPoint(projectPoint(H, { x: 100, y: 1100 }), { x: 0, y: 10 });
  });

  test('keeps the projective term for an oblique camera (trapezoid)', () => {
    // A synthetic ground -> image map with h31/h32 non-zero: the apron seen at an angle.
    const imageFromGround = [180, 40, 320, 20, 210, 120, 0.06, 0.11, 1];
    const imagePoints = RECT_10M.map((ground) => {
      const projected = projectPoint(imageFromGround, ground);
      assert.ok(projected);
      return projected;
    });

    const H = homographyFromPoints(imagePoints, RECT_10M);
    assert.ok(H);
    // The recovered camera->ground map must be the inverse, not just an interpolation of
    // the four corners.
    assertPoint(projectPoint(H, imagePoints[0]), { x: 0, y: 0 });
    assertPoint(projectPoint(H, imagePoints[2]), { x: 10, y: 10 });

    const interiorImage = projectPoint(imageFromGround, { x: 7.3, y: 2.6 });
    assert.ok(interiorImage);
    assertPoint(projectPoint(H, interiorImage), { x: 7.3, y: 2.6 }, 1e-8);
  });

  test('returns the identity when source and destination are the same points', () => {
    const H = homographyFromPoints(RECT_10M, RECT_10M);
    assert.ok(H);
    const points = [
      { x: 0, y: 0 },
      { x: 3.25, y: 8.5 },
      { x: 10, y: 10 },
    ];
    for (const point of points) assertPoint(projectPoint(H, point), point);
  });

  test('rejects collinear image points (three on one line)', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 100 },
    ];
    assert.equal(homographyFromPoints(collinear, RECT_10M), null);
  });

  test('rejects collinear ground points', () => {
    const collinearGround = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ];
    assert.equal(homographyFromPoints(TOP_DOWN_PX, collinearGround), null);
  });

  test('rejects duplicated points', () => {
    const duplicated = [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 1100, y: 100 },
      { x: 100, y: 1100 },
    ];
    assert.equal(homographyFromPoints(duplicated, RECT_10M), null);
    assert.equal(
      homographyFromPoints(TOP_DOWN_PX, [RECT_10M[0], RECT_10M[0], RECT_10M[2], RECT_10M[3]]),
      null,
    );
  });

  test('rejects non-finite and malformed input', () => {
    const withNaN = [{ x: 100, y: 100 }, { x: Number.NaN, y: 100 }, { x: 1, y: 1 }, { x: 0, y: 0 }];
    assert.equal(homographyFromPoints(withNaN, RECT_10M), null);
    assert.equal(homographyFromPoints(TOP_DOWN_PX, [{ x: 0, y: Infinity }, ...RECT_10M.slice(1)]), null);
    assert.equal(homographyFromPoints(null, RECT_10M), null);
    assert.equal(homographyFromPoints(TOP_DOWN_PX, undefined), null);
    assert.equal(homographyFromPoints(TOP_DOWN_PX.slice(0, 3), RECT_10M), null);
    assert.equal(homographyFromPoints([...TOP_DOWN_PX, { x: 0, y: 0 }], RECT_10M), null);
    assert.equal(homographyFromPoints([{ x: '1', y: 0 }, ...TOP_DOWN_PX.slice(1)], RECT_10M), null);
  });

  test('all four identical points have no spread and are rejected', () => {
    const same = Array.from({ length: 4 }, () => ({ x: 5, y: 5 }));
    assert.equal(homographyFromPoints(same, RECT_10M), null);
  });
});

describe('projectPoint', () => {
  test('refuses a point that maps to infinity', () => {
    // denominator = x, so x = 0 is the vanishing line of this map.
    const H = [1, 0, 0, 0, 1, 0, 1, 0, 0];
    assert.equal(projectPoint(H, { x: 0, y: 5 }), null);
    assertPoint(projectPoint(H, { x: 2, y: 1 }), { x: 1, y: 0.5 });
  });

  test('refuses malformed matrices and points', () => {
    assert.equal(projectPoint(null, { x: 1, y: 1 }), null);
    assert.equal(projectPoint([1, 0, 0], { x: 1, y: 1 }), null);
    assert.equal(projectPoint([1, 0, 0, 0, 1, 0, 0, 0, Number.NaN], { x: 1, y: 1 }), null);
    assert.equal(projectPoint(SCALE_H, null), null);
    assert.equal(projectPoint(SCALE_H, { x: Number.NaN, y: 1 }), null);
  });
});

describe('groundMetrics', () => {
  test('reports a known 2 m/s from two foot points 0.5 s apart', () => {
    const metrics = groundMetrics({
      foot: { x: 0.6, y: 0.5 },
      previousFoot: { x: 0.5, y: 0.5 },
      dt: 0.5,
      H: SCALE_H,
    });
    assert.equal(metrics.valid, true);
    assert.ok(Math.abs(metrics.distanceM - 1) < 1e-6, `distance ${metrics.distanceM}`);
    assert.ok(Math.abs(metrics.speedMps - 2) < 1e-6, `speed ${metrics.speedMps}`);
  });

  test('measures distance on both axes (3-4-5 triangle)', () => {
    const metrics = groundMetrics({
      foot: { x: 0.7, y: 0.9 },
      previousFoot: { x: 0.4, y: 0.5 },
      dt: 1,
      H: SCALE_H,
    });
    assert.equal(metrics.valid, true);
    assert.ok(Math.abs(metrics.distanceM - 5) < 1e-9);
    assert.ok(Math.abs(metrics.speedMps - 5) < 1e-9);
  });

  test('uses the perspective map, not a constant scale', () => {
    // Same 0.1 image-unit step at the near and far edge of a trapezoid: the far step must
    // cover fewer metres, because a metre near the horizon is fewer pixels.
    const imageFromGround = [180, 40, 320, 20, 210, 120, 0.06, 0.11, 1];
    const H = homographyFromPoints(
      RECT_10M.map((ground) => {
        const projected = projectPoint(imageFromGround, ground);
        assert.ok(projected);
        return projected;
      }),
      RECT_10M,
    );
    assert.ok(H);
    const near = groundMetrics({
      foot: { x: 0.45, y: 0.8 },
      previousFoot: { x: 0.35, y: 0.8 },
      dt: 1,
      H,
    });
    const far = groundMetrics({
      foot: { x: 0.45, y: 0.2 },
      previousFoot: { x: 0.35, y: 0.2 },
      dt: 1,
      H,
    });
    assert.equal(near.valid, true);
    assert.equal(far.valid, true);
    assert.ok(near.distanceM > far.distanceM, `${near.distanceM} should exceed ${far.distanceM}`);
  });

  test('refuses a non-positive or non-finite dt', () => {
    const base = { foot: { x: 0.6, y: 0.5 }, previousFoot: { x: 0.5, y: 0.5 }, H: SCALE_H };
    for (const dt of [0, -0.1, Number.NaN, Infinity, '0.5', undefined]) {
      const metrics = groundMetrics({ ...base, dt });
      assert.deepEqual(metrics, { speedMps: null, distanceM: null, valid: false }, `dt=${dt}`);
    }
  });

  test('refuses a missing or invalid calibration', () => {
    const base = { foot: { x: 0.6, y: 0.5 }, previousFoot: { x: 0.5, y: 0.5 }, dt: 0.5 };
    for (const H of [null, undefined, [], [0, 0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0, 1, 0, 0]]) {
      assert.deepEqual(
        groundMetrics({ ...base, H }),
        { speedMps: null, distanceM: null, valid: false },
        `H=${JSON.stringify(H)}`,
      );
    }
  });

  test('refuses a singular calibration that would collapse the ground', () => {
    // Valid numbers, invertible-looking, but the frame collapses onto the line y = 0: every
    // foot point would report 0 m/s with no warning.
    const collapsed = [1, 0, 0, 0, 0, 0, 0, 0, 1];
    assert.deepEqual(
      groundMetrics({
        foot: { x: 0.6, y: 0.9 },
        previousFoot: { x: 0.5, y: 0.2 },
        dt: 0.5,
        H: collapsed,
      }),
      { speedMps: null, distanceM: null, valid: false },
    );
  });

  test('refuses a missing foot point', () => {
    assert.equal(
      groundMetrics({ foot: null, previousFoot: { x: 0.5, y: 0.5 }, dt: 0.5, H: SCALE_H }).valid,
      false,
    );
    assert.equal(groundMetrics().valid, false);
  });
});

describe('smoothSpeed', () => {
  test('takes the first sample as is and then blends towards the next', () => {
    const first = smoothSpeed(null, 2);
    assert.equal(first, 2);
    const second = smoothSpeed(first, 4, 0.5);
    assert.ok(Math.abs(second - 3) < 1e-12);
    const third = smoothSpeed(second, 4, 0.5);
    assert.ok(Math.abs(third - 3.5) < 1e-12);
  });

  test('holds the previous value when the frame had no sample', () => {
    assert.equal(smoothSpeed(1.8, null), 1.8);
    assert.equal(smoothSpeed(1.8, Number.NaN), 1.8);
    assert.equal(smoothSpeed(null, null), null);
    assert.equal(smoothSpeed(undefined, 1.2), 1.2);
  });

  test('rejects an alpha outside (0, 1]', () => {
    for (const alpha of [0, -0.2, 1.5, Number.NaN, '0.5']) {
      assert.throws(() => smoothSpeed(1, 2, alpha), RangeError, `alpha=${alpha}`);
    }
  });
});

describe('footPointFromBox', () => {
  test('is the bottom-centre of the box, as the zone membership uses it', () => {
    assert.deepEqual(footPointFromBox([0.2, 0.3, 0.6, 0.9]), { x: 0.4, y: 0.9 });
  });

  test('refuses a malformed box', () => {
    assert.equal(footPointFromBox(null), null);
    assert.equal(footPointFromBox([0, 0, 1]), null);
    assert.equal(footPointFromBox([0, 0, 1, Number.NaN]), null);
    assert.equal(footPointFromBox(['0', 0, 1, 1]), null);
  });
});
