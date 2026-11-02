// Tests for the geometry of the privacy guard. They pin the browser port to
// `ml/safesight_ml/privacy.py` (`FaceBlurrer.blur_with_faces` and `_blur_box`), so the head
// band cannot silently shrink back to "faces YuNet happened to find".
//
// Numbers only: no canvas, no models, so every expectation is exact.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLUR_MARGIN_RATIO,
  HEAD_BAND_RATIO,
  clampRect,
  expandedRect,
  headBandRects,
} from './blur.js';

// The demo clip is 1920x1080; a person in the middle gives round numbers.
const WIDTH = 1920;
const HEIGHT = 1080;

describe('clampRect', () => {
  test('keeps a rectangle inside the frame', () => {
    assert.deepEqual(clampRect(10, 20, 30, 40, WIDTH, HEIGHT), {
      left: 10,
      top: 20,
      width: 20,
      height: 20,
    });
  });

  test('clamps negative and oversized edges together', () => {
    assert.deepEqual(clampRect(-50, -50, 2000, 1200, WIDTH, HEIGHT), {
      left: 0,
      top: 0,
      width: WIDTH,
      height: HEIGHT,
    });
  });
});

describe('expandedRect', () => {
  test('grows by 0.2 of the longest side, like _blur_box', () => {
    // Longest side 200 -> margin 40.
    assert.equal(BLUR_MARGIN_RATIO, 0.2);
    assert.deepEqual(expandedRect(100, 100, 200, 300, 1000, 1000), {
      left: 60,
      top: 60,
      width: 180,
      height: 280,
    });
  });

  test('keeps a one-pixel margin on a tiny box', () => {
    assert.deepEqual(expandedRect(100, 100, 101, 101, 1000, 1000), {
      left: 99,
      top: 99,
      width: 3,
      height: 3,
    });
  });

  test('is clamped at the top-left corner', () => {
    assert.deepEqual(expandedRect(-10, -10, 50, 50, 100, 100), {
      left: 0,
      top: 0,
      width: 62,
      height: 62,
    });
  });

  test('is clamped at the bottom-right corner', () => {
    assert.deepEqual(expandedRect(950, 950, 1010, 1010, 1000, 1000), {
      left: 938,
      top: 938,
      width: 62,
      height: 62,
    });
  });
});

describe('headBandRects', () => {
  test('covers the top 35% of a known person box, grown by the margin', () => {
    // 1920x1080, person 0.25..0.75 on both axes:
    //   pixels 480,270 -> 1440,810; head height trunc(540 * 0.35) = 189;
    //   band 480,270 -> 1440,459 (960x189); margin trunc(0.2 * 960) = 192.
    assert.equal(HEAD_BAND_RATIO, 0.35);
    assert.deepEqual(headBandRects([[0.25, 0.25, 0.75, 0.75]], WIDTH, HEIGHT), [
      { left: 288, top: 78, width: 1344, height: 573 },
    ]);
  });

  test('truncates the 35% instead of rounding up', () => {
    // 401 px tall -> 401 * 0.35 = 140.35 -> 140, the Python int() result.
    const [rect] = headBandRects([[0.1, 0.1, 0.5, 0.501]], 1000, 1000);
    // band 100,100 -> 500,240 (400x140); margin trunc(0.2 * 400) = 80.
    assert.deepEqual(rect, { left: 20, top: 20, width: 560, height: 300 });
  });

  test('uses the frame height, so a small person still gets a proportional band', () => {
    // 40 px tall person: 40 * 0.35 = 14 px of head, not "too small to blur".
    const [rect] = headBandRects([[0.5, 0.5, 0.52, 0.54]], 1000, 1000);
    // band 500,500 -> 520,514 (20x14); margin max(1, trunc(0.2 * 20)) = 4.
    assert.deepEqual(rect, { left: 496, top: 496, width: 28, height: 22 });
  });

  test('clamps the band at the bottom edge', () => {
    // Person running off the bottom: the band and its margin stop at the frame.
    assert.deepEqual(headBandRects([[0, 0.9, 1, 1.05]], 1000, 1000), [
      { left: 0, top: 700, width: 1000, height: 300 },
    ]);
  });

  test('clamps the band at the left and right edges', () => {
    assert.deepEqual(
      headBandRects(
        [
          [-0.05, 0.1, 0.05, 0.5],
          [0.95, 0.1, 1.05, 0.5],
        ],
        1000,
        1000,
      ),
      [
        { left: 0, top: 72, width: 78, height: 196 },
        { left: 922, top: 72, width: 78, height: 196 },
      ],
    );
  });

  test('collapses a zero-size box to at most one pixel of band plus the margin', () => {
    // `max(1, int(0 * 0.35))` is 1 in privacy.py: degenerate input cannot grow a big blur
    // box, and it cannot throw either.
    assert.deepEqual(headBandRects([[0.5, 0.5, 0.5, 0.5]], 1000, 1000), [
      { left: 499, top: 499, width: 2, height: 3 },
    ]);
  });

  test('returns nothing for an empty detection list', () => {
    assert.deepEqual(headBandRects([], WIDTH, HEIGHT), []);
  });

  test('returns one rect per person, in detection order', () => {
    const rects = headBandRects(
      [
        [0.1, 0.1, 0.2, 0.5],
        [0.6, 0.1, 0.7, 0.5],
      ],
      WIDTH,
      HEIGHT,
    );
    assert.equal(rects.length, 2);
    assert.ok(rects[0].left < rects[1].left);
  });

  test('does not throw on a zero-sized frame', () => {
    assert.deepEqual(headBandRects([[0, 0, 1, 1]], 0, 0), [
      { left: 0, top: 0, width: 0, height: 0 },
    ]);
  });
});
