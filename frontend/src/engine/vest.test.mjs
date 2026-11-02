// Tests for the hi-vis port of `ppe.py`. Synthetic RGBA buffers only: no video, no models,
// so every case is exact and a failure names the rule that broke.
//
// The frames are built the way the browser hands them over: RGBA bytes, `r, g, b, a`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDGE,
  HIVIS_MIN,
  MIN_SAMPLES,
  MIN_SAMPLES_NO_VEST,
  NO_VEST_MAX,
  RECENT,
  VestTracker,
  hivisRatio,
  vestSample,
} from './vest.js';

// A 200x200 frame makes the torso band of `[0, 0, 1, 1]` land on x 40..160, y 30..110,
// so the arithmetic in the assertions below stays readable.
const WIDTH = 200;
const HEIGHT = 200;

/** Hi-vis orange, RGB (255, 165, 0): BGR2HSV gives H~19, S=255, V=255. */
const ORANGE = [255, 165, 0];
/** Yellow-green, RGB (128, 255, 0): BGR2HSV gives H~45, S=255, V=255. */
const YELLOW_GREEN = [128, 255, 0];
/** Washed-out yellow-green, RGB (200, 230, 150): H~41, S~89, V=230 - only the pale range. */
const PALE_YELLOW_GREEN = [200, 230, 150];
const GREY = [128, 128, 128];
const WHITE = [240, 240, 240];
const BLUE = [30, 60, 200];

/**
 * @param {number} width
 * @param {number} height
 * @param {number[]} fill RGB.
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
function makeFrame(width, height, fill = GREY) {
  const frame = { data: new Uint8ClampedArray(width * height * 4), width, height };
  paint(frame, 0, 0, width, height, fill);
  return frame;
}

/**
 * Fill an axis-aligned rectangle, half-open on the right and bottom.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} frame
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number[]} rgb
 * @returns {void}
 */
function paint(frame, x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * frame.width + x) * 4;
      frame.data[i] = r;
      frame.data[i + 1] = g;
      frame.data[i + 2] = b;
      frame.data[i + 3] = 255;
    }
  }
}

/**
 * Feed `count` identical good frames, one per second, and return the final state.
 *
 * @param {VestTracker} tracker
 * @param {number} trackId
 * @param {number} count
 * @param {number} ratio
 * @param {{ confidence?: number, personPx?: number, start?: number }} [options]
 * @returns {string}
 */
function feed(
  tracker,
  trackId,
  count,
  ratio,
  { confidence = 0.9, personPx = 200, start = 0 } = {},
) {
  let state = 'unknown';
  for (let frame = 0; frame < count; frame += 1) {
    state = tracker.update(trackId, ratio, confidence, start + frame, personPx);
  }
  return state;
}

describe('hivisRatio', () => {
  test('a solid hi-vis torso fills the ratio', () => {
    assert.equal(hivisRatio(makeFrame(WIDTH, HEIGHT, ORANGE), [0, 0, 1, 1]), 1);
  });

  test('a grey frame has no fluorescent pixels', () => {
    assert.equal(hivisRatio(makeFrame(WIDTH, HEIGHT, GREY), [0, 0, 1, 1]), 0);
  });

  test('half of the torso band orange gives 0.5', () => {
    const frame = makeFrame(WIDTH, HEIGHT, GREY);
    // x 40..100 of the band x 40..160: exactly half of it.
    paint(frame, 40, 0, 100, HEIGHT, ORANGE);
    assert.equal(hivisRatio(frame, [0, 0, 1, 1]), 0.5);
  });

  test('only the torso band counts', () => {
    const frame = makeFrame(WIDTH, HEIGHT, GREY);
    // Above the band (y 0..30) and below it (y 110..200): a vest on the head or the legs
    // is not a torso, and the band stays grey.
    paint(frame, 0, 0, WIDTH, 25, ORANGE);
    paint(frame, 0, 120, WIDTH, HEIGHT, ORANGE);
    assert.equal(hivisRatio(frame, [0, 0, 1, 1]), 0);
  });

  test('the three HSV ranges are wired, and the alpha channel is ignored', () => {
    const cases = [
      [ORANGE, 1],
      [YELLOW_GREEN, 1],
      [PALE_YELLOW_GREEN, 1],
      // Snow and white surfaces sit at saturation ~10.
      [WHITE, 0],
      // Not orange, not yellow-green: blue is a barrier or a jacket, not a vest.
      [BLUE, 0],
    ];
    for (const [fill, expected] of cases) {
      const frame = makeFrame(WIDTH, HEIGHT, fill);
      // Alpha 0 everywhere must not change the answer: only R, G and B are read.
      for (let i = 3; i < frame.data.length; i += 4) frame.data[i] = 0;
      assert.equal(
        hivisRatio(frame, [0, 0, 1, 1]),
        expected,
        `RGB ${fill.join(',')} should give ${expected}`,
      );
    }
  });

  test('a hue on a rounding tie goes up, as it does in the cv2 reference', () => {
    // RGB (252, 234, 180) is exactly H = 45.0 degrees, so the 8-bit hue is the tie 22.5.
    // cv2 stores 23 for this colour, which is the yellow-green range; 22 would be orange
    // and S = 73 is below orange's 140, so a tie that rounded down would read 0 here.
    const frame = makeFrame(WIDTH, HEIGHT, [252, 234, 180]);
    assert.equal(hivisRatio(frame, [0, 0, 1, 1]), 1);
  });

  test('an inverted or empty band returns null', () => {
    const frame = makeFrame(WIDTH, HEIGHT, ORANGE);
    // x2 < x1: the crop is empty. Python returns None on `crop.size == 0`.
    assert.equal(hivisRatio(frame, [0.5, 0.2, 0.4, 0.8]), null);
    // Zero height: the band collapses.
    assert.equal(hivisRatio(frame, [0, 0.2, 1, 0.2]), null);
    // Zero width as well.
    assert.equal(hivisRatio(frame, [0.4, 0, 0.4, 1]), null);
  });

  test('malformed frames and boxes fail loudly', () => {
    const frame = makeFrame(WIDTH, HEIGHT, ORANGE);
    const badWidth = { data: frame.data, width: 0, height: HEIGHT };
    const badLength = { data: new Uint8ClampedArray(8), width: WIDTH, height: HEIGHT };
    assert.throws(() => hivisRatio(null, [0, 0, 1, 1]), TypeError);
    assert.throws(() => hivisRatio(badWidth, [0, 0, 1, 1]), TypeError);
    assert.throws(() => hivisRatio(badLength, [0, 0, 1, 1]), TypeError);
    // A bbox, not a frame: four numbers are required, and they must be finite.
    assert.throws(() => hivisRatio(frame, [0, 0, 1]), TypeError);
    assert.throws(() => hivisRatio(frame, [0, 0, 1, Number.NaN]), TypeError);
  });
});

describe('vestSample', () => {
  test('a big enough, fully visible box returns the ratio', () => {
    const frame = makeFrame(WIDTH, HEIGHT, ORANGE);
    assert.equal(vestSample(frame, [0.2, 0.2, 0.7, 0.7]), 1);
  });

  test('a person below MIN_PERSON_PX (80 px) returns null', () => {
    const frame = makeFrame(WIDTH, HEIGHT, ORANGE);
    // 0.39 * 200 = 78 px: too few torso pixels to judge.
    assert.equal(vestSample(frame, [0.2, 0.2, 0.6, 0.59]), null);
    // 0.4 * 200 = 80 px: exactly at the limit, so it counts.
    assert.equal(vestSample(frame, [0.2, 0.2, 0.6, 0.6]), 1);
  });

  test('a box touching the frame edge returns null', () => {
    const frame = makeFrame(WIDTH, HEIGHT, ORANGE);
    // EDGE is inclusive on both sides: `x <= EDGE` or `x >= 1 - EDGE` means cut.
    assert.equal(vestSample(frame, [EDGE, 0.2, 0.6, 0.6]), null);
    assert.equal(vestSample(frame, [0.2, EDGE, 0.6, 0.6]), null);
    assert.equal(vestSample(frame, [0.2, 0.2, 1 - EDGE, 0.6]), null);
    assert.equal(vestSample(frame, [0.2, 0.2, 0.6, 1 - EDGE]), null);
    // A millimetre inside the border is judged normally.
    assert.equal(vestSample(frame, [EDGE + 0.001, 0.2, 0.6, 0.6]), 1);
    assert.equal(vestSample(frame, [0.2, 0.2, 1 - EDGE - 0.001, 0.6]), 1);
  });
});

describe('VestTracker', () => {
  test('a track stays unknown until MIN_SAMPLES good frames, then reports the vest', () => {
    const tracker = new VestTracker();
    for (let frame = 1; frame < MIN_SAMPLES; frame += 1) {
      assert.equal(
        tracker.update(1, 0.5, 0.9, frame, 200),
        'unknown',
        `after ${frame} samples`,
      );
    }
    assert.equal(tracker.update(1, 0.5, 0.9, MIN_SAMPLES, 200), 'vest');
  });

  test('the vest threshold is HIVIS_MIN on the smoothed ratio', () => {
    assert.equal(feed(new VestTracker(), 1, MIN_SAMPLES, HIVIS_MIN), 'vest');
    // Just under the threshold: not a vest, and not "no vest" either (0.099 > p90 max).
    assert.equal(feed(new VestTracker(), 1, 10, HIVIS_MIN - 0.001), 'unknown');
  });

  test('a null ratio keeps the state but adds no sample', () => {
    const tracker = new VestTracker();
    assert.equal(feed(tracker, 7, MIN_SAMPLES, 0.5), 'vest');
    const score = tracker.score(7);

    // An occlusion moves lastSeen only: score and sample count do not change.
    assert.equal(tracker.update(7, null, 0.9, 5, 200), 'vest');
    assert.equal(tracker.score(7), score);

    // Nine real frames plus five skipped ones are still below MIN_SAMPLES_NO_VEST.
    const waiting = new VestTracker();
    assert.equal(feed(waiting, 8, MIN_SAMPLES_NO_VEST - 1, 0), 'unknown');
    for (let frame = 0; frame < 5; frame += 1) {
      waiting.update(8, null, 0.9, 20 + frame, 200);
    }
    assert.equal(waiting.state(8), 'unknown');
    // The tenth counted frame is what flips it.
    assert.equal(waiting.update(8, 0, 0.9, 30, 200), 'no_vest');
  });

  test('no_vest needs all four conditions', () => {
    const feedAll = (count, ratio, options) => feed(new VestTracker(), 1, count, ratio, options);

    // All four: 10 samples, p90 < 0.03, median height >= 150 px, confidence >= 0.5.
    assert.equal(feedAll(10, 0), 'no_vest');
    // One condition at a time, each one just short of its threshold.
    assert.equal(feedAll(9, 0), 'unknown');
    assert.equal(feedAll(10, 0, { personPx: 149 }), 'unknown');
    assert.equal(feedAll(10, 0, { confidence: 0.49 }), 'unknown');
    // Exactly on a threshold still passes: `>=` for height and confidence.
    assert.equal(feedAll(10, 0, { personPx: 150 }), 'no_vest');
    assert.equal(feedAll(10, 0, { confidence: 0.5 }), 'no_vest');
  });

  test('p90 of the recent window decides, not the mean', () => {
    // 4 orange frames then 26 grey: the mean is 0.027 (below NO_VEST_MAX) but p90 is 0.2,
    // so a person who wore a vest at some point is not called "no vest".
    const dips = new VestTracker();
    for (let frame = 0; frame < 4; frame += 1) dips.update(2, 0.2, 0.9, frame, 200);
    for (let frame = 4; frame < RECENT; frame += 1) dips.update(2, 0, 0.9, frame, 200);
    assert.equal(dips.state(2), 'unknown');

    // Same history without the orange frames: p90 is 0, so "no vest".
    assert.equal(feed(new VestTracker(), 2, RECENT, 0), 'no_vest');

    // Two orange frames fall below the p90 index, so they do not block the claim.
    const noise = new VestTracker();
    noise.update(3, 1, 0.9, 0, 200);
    noise.update(3, 1, 0.9, 1, 200);
    for (let frame = 2; frame < RECENT; frame += 1) noise.update(3, 0, 0.9, frame, 200);
    assert.equal(noise.state(3), 'no_vest');
  });

  test('prune keeps a track for ttlS and then forgets it', () => {
    const tracker = new VestTracker({ ttlS: 10 });
    // Five frames at t = 0..4, so the track has a state and lastSeen = 4.
    assert.equal(feed(tracker, 3, MIN_SAMPLES, 0.5), 'vest');

    tracker.prune(13.9);
    assert.equal(tracker.state(3), 'vest');

    // A skipped frame still marks the track as seen: pruning is about visibility, not
    // about good samples. Half seconds keep the boundary arithmetic exact.
    tracker.update(3, null, 0.9, 13.5, 200);
    tracker.prune(23.4);
    assert.equal(tracker.state(3), 'vest');

    tracker.prune(23.5);
    assert.equal(tracker.state(3), 'unknown');
    assert.equal(tracker.score(3), null);
  });

  test('score is the EMA of the ratios, null before the first good frame', () => {
    const tracker = new VestTracker();
    assert.equal(tracker.score(4), null);

    tracker.update(4, 0.4, 0.9, 0, 200);
    assert.equal(tracker.score(4), 0.4);

    // alpha 0.2: 0.4 + 0.2 * (0.9 - 0.4) = 0.5
    tracker.update(4, 0.9, 0.9, 1, 200);
    assert.ok(Math.abs(tracker.score(4) - 0.5) < 1e-12, `score was ${tracker.score(4)}`);

    // 0.5 + 0.2 * (0 - 0.5) = 0.4
    tracker.update(4, 0, 0.9, 2, 200);
    assert.ok(Math.abs(tracker.score(4) - 0.4) < 1e-12, `score was ${tracker.score(4)}`);
  });

  test('a track can go from no_vest back to vest', () => {
    const tracker = new VestTracker();
    assert.equal(feed(tracker, 5, RECENT, 0), 'no_vest');
    // The vest branch is checked first, so one strong frame clears the violation.
    assert.equal(tracker.update(5, 1, 0.9, RECENT, 200), 'vest');
  });

  test('invalid options and arguments fail loudly', () => {
    assert.throws(() => new VestTracker({ alpha: 0 }), RangeError);
    assert.throws(() => new VestTracker({ alpha: 1.5 }), RangeError);
    assert.throws(() => new VestTracker({ ttlS: 0 }), RangeError);

    const tracker = new VestTracker();
    assert.throws(() => tracker.update(Number.NaN, 0.5), TypeError);
    assert.throws(() => tracker.update(1, 'vest'), TypeError);
    assert.throws(() => tracker.update(1, 0.5, Number.NaN), TypeError);
    assert.throws(() => tracker.update(1, 0.5, 0.9, Number.NaN), TypeError);
    assert.throws(() => tracker.update(1, 0.5, 0.9, 0, Number.NaN), TypeError);
    // Infinity is a valid personPx: the default means "unknown height".
    assert.doesNotThrow(() => tracker.update(2, 0.5, 0.9, 0, Number.POSITIVE_INFINITY));
  });
});
