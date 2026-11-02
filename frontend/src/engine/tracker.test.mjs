// Tests for the IoU tracker that replaces ByteTrack. Synthetic boxes only: no video and
// no models, so the cases are exact and the failure messages point at the rule that broke.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTracker, iou } from './tracker.js';

/** A detection object in the shape the pipeline receives. */
function detection(bbox, confidence = 0.9) {
  return { bbox, confidence };
}

/** Shorthand for a person-sized box whose top-left corner moves. */
function box(x, y, width = 0.15, height = 0.35) {
  return [x, y, x + width, y + height];
}

describe('createTracker', () => {
  test('two people crossing keep their ids', () => {
    const tracker = createTracker();
    // Different vertical lanes, so crossing in x never makes the boxes ambiguous.
    let left = box(0.1, 0.2);
    let right = box(0.75, 0.6);

    const first = tracker.update([detection(left), detection(right)], 0);
    assert.deepEqual(
      first.map((track) => track.trackId),
      [1, 2],
    );

    for (let frame = 1; frame <= 8; frame += 1) {
      left = [left[0] + 0.04, left[1], left[2] + 0.04, left[3]];
      right = [right[0] - 0.04, right[1], right[2] - 0.04, right[3]];
      const tracked = tracker.update([detection(left), detection(right)], frame * 33);
      assert.deepEqual(
        tracked.map((track) => track.trackId),
        [1, 2],
        `ids changed on frame ${frame}`,
      );
    }
  });

  test('a missing frame keeps the id', () => {
    const tracker = createTracker();
    const person = detection([0.4, 0.2, 0.5, 0.6]);

    assert.equal(tracker.update([person], 0)[0].trackId, 1);
    assert.deepEqual(tracker.update([], 33), []);
    assert.equal(tracker.update([person], 66)[0].trackId, 1);
  });

  test('a track is dropped after maxAgeFrames missed frames', () => {
    const tracker = createTracker({ maxAgeFrames: 2 });
    const person = detection([0.4, 0.2, 0.5, 0.6]);

    assert.equal(tracker.update([person], 0)[0].trackId, 1);

    // Exactly maxAgeFrames misses survive.
    tracker.update([], 1);
    tracker.update([], 2);
    assert.equal(tracker.update([person], 3)[0].trackId, 1);

    // One miss more and the track is gone; the id is not reused.
    tracker.update([], 4);
    tracker.update([], 5);
    tracker.update([], 6);
    assert.equal(tracker.update([person], 7)[0].trackId, 2);
  });

  test('a new person gets a new id and ids never go back', () => {
    const tracker = createTracker();
    const first = detection([0.1, 0.1, 0.2, 0.5]);
    const second = detection([0.7, 0.1, 0.8, 0.5]);

    assert.equal(tracker.update([first], 0)[0].trackId, 1);
    const both = tracker.update([first, second], 1);
    assert.deepEqual(
      both.map((track) => track.trackId),
      [1, 2],
    );

    // The first person is gone for good (more than maxAgeFrames).
    tracker.update([second], 2);
    for (let frame = 3; frame <= 40; frame += 1) tracker.update([second], frame);
    assert.equal(tracker.update([first, second], 41).map((track) => track.trackId)[0], 3);
  });

  test('the IoU threshold decides whether a box is the same track', () => {
    const before = [0.0, 0.0, 0.2, 0.2];
    const after = [0.1, 0.0, 0.3, 0.2];
    assert.ok(Math.abs(iou(before, after) - 1 / 3) < 1e-12, `IoU was ${iou(before, after)}`);

    // The IoU stage in isolation: the second pass would otherwise cover this gap.
    const loose = createTracker({ iouThreshold: 0.3, centerMatch: false });
    loose.update([detection(before)], 0);
    assert.equal(loose.update([detection(after)], 1)[0].trackId, 1);

    const strict = createTracker({ iouThreshold: 0.4, centerMatch: false });
    strict.update([detection(before)], 0);
    assert.equal(strict.update([detection(after)], 1)[0].trackId, 2);

    // With the default second pass, the same pair is recovered by centre distance.
    const viaCenter = createTracker({ iouThreshold: 0.4 });
    viaCenter.update([detection(before)], 0);
    assert.equal(viaCenter.update([detection(after)], 1)[0].trackId, 1);
  });

  test('a fast mover keeps its id when IoU falls below the threshold', () => {
    // A diagonal step of 0.4 box heights per frame: the overlap is tiny, the centre is
    // still well inside the tracker's budget.
    const before = box(0.4, 0.2);
    const after = box(0.54, 0.34);
    assert.ok(iou(before, after) < 0.3, `IoU was ${iou(before, after)}`);

    // The pre-fix behaviour, kept as the reproduction of the bug.
    const iouOnly = createTracker({ centerMatch: false });
    iouOnly.update([detection(before)], 0);
    assert.equal(iouOnly.update([detection(after)], 1)[0].trackId, 2);

    const tracker = createTracker();
    assert.equal(tracker.update([detection(before)], 0)[0].trackId, 1);
    assert.equal(tracker.update([detection(after)], 1)[0].trackId, 1);

    // The budget is a knob: half a box height is not enough for this step.
    const tight = createTracker({ centerDistanceFactor: 0.5 });
    tight.update([detection(before)], 0);
    assert.equal(tight.update([detection(after)], 1)[0].trackId, 2);
  });

  test('two people crossing keep their ids when IoU cannot match them', () => {
    const tracker = createTracker();
    // Separate lanes, so "nearest centre" stays unambiguous while they pass each other.
    let left = box(0.1, 0.1);
    let right = box(0.7, 0.55);

    assert.deepEqual(
      tracker.update([detection(left), detection(right)], 0).map((track) => track.trackId),
      [1, 2],
    );

    // Steps larger than the box width: the IoU pass sees no overlap on every frame.
    for (let frame = 1; frame <= 3; frame += 1) {
      left = [left[0] + 0.2, left[1], left[2] + 0.2, left[3]];
      right = [right[0] - 0.2, right[1], right[2] - 0.2, right[3]];
      assert.equal(iou(left, box(left[0] - 0.2, left[1])), 0, `left still overlapped on frame ${frame}`);
      assert.deepEqual(
        tracker.update([detection(left), detection(right)], frame * 600).map((track) => track.trackId),
        [1, 2],
        `ids swapped on frame ${frame}`,
      );
    }
  });

  test('a stationary person and a nearby second person do not merge', () => {
    const tracker = createTracker();
    const stationary = box(0.3, 0.3);
    const nearby = box(0.5, 0.3); // centres 0.2 apart, inside the 0.28 budget

    assert.equal(tracker.update([detection(stationary)], 0)[0].trackId, 1);
    const both = tracker.update([detection(stationary), detection(nearby)], 1);
    assert.equal(both.length, 2);
    assert.deepEqual(
      both.map((track) => track.trackId),
      [1, 2],
      'the nearby person must start a track instead of taking the stationary one',
    );
  });

  test('a fast mover beyond the distance factor still gets a new id', () => {
    const tracker = createTracker();
    const before = box(0.4, 0.2);
    const after = box(0.4, 0.55); // exactly one box height down: outside 0.8 heights

    assert.equal(iou(before, after), 0);
    assert.equal(tracker.update([detection(before)], 0)[0].trackId, 1);
    assert.equal(tracker.update([detection(after)], 1)[0].trackId, 2);
  });

  test('a new person where the old one left gets a new id once the track aged out', () => {
    // Centre matching must not reach into a dead track: after maxAgeFrames misses the id
    // is gone, even if the next person appears exactly where the old one was.
    const tracker = createTracker({ maxAgeFrames: 2 });
    const spot = box(0.4, 0.2);

    assert.equal(tracker.update([detection(spot)], 0)[0].trackId, 1);
    tracker.update([], 1);
    tracker.update([], 2);
    tracker.update([], 3); // the third miss drops the track
    assert.equal(tracker.update([detection(spot)], 4)[0].trackId, 2);
  });

  test('the result keeps detection order and the detector confidence', () => {
    const tracker = createTracker();
    const high = detection([0.7, 0.1, 0.8, 0.5], 0.42);
    const low = detection([0.1, 0.1, 0.2, 0.5], 0.91);

    const tracked = tracker.update([high, low], 0);
    assert.equal(tracked.length, 2);
    assert.deepEqual(tracked[0].bbox, high.bbox);
    assert.equal(tracked[0].confidence, 0.42);
    assert.deepEqual(tracked[1].bbox, low.bbox);
    assert.equal(tracked[1].confidence, 0.91);
    assert.deepEqual(
      tracked.map((track) => track.trackId),
      [1, 2],
    );
  });

  test('invalid options and detections fail loudly', () => {
    assert.throws(() => createTracker({ iouThreshold: 0 }), RangeError);
    assert.throws(() => createTracker({ maxAgeFrames: -1 }), RangeError);
    assert.throws(() => createTracker({ centerMatch: 'yes' }), TypeError);
    assert.throws(() => createTracker({ centerDistanceFactor: 0 }), RangeError);
    assert.throws(() => createTracker({ centerDistanceFactor: Number.NaN }), RangeError);
    const tracker = createTracker();
    assert.throws(() => tracker.update([{ bbox: [0, 0, 1] }], 0), TypeError);
    assert.throws(() => tracker.update([{ bbox: [0, 0, 1, Number.NaN] }], 0), TypeError);
  });
});
