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

    const loose = createTracker({ iouThreshold: 0.3 });
    loose.update([detection(before)], 0);
    assert.equal(loose.update([detection(after)], 1)[0].trackId, 1);

    const strict = createTracker({ iouThreshold: 0.4 });
    strict.update([detection(before)], 0);
    assert.equal(strict.update([detection(after)], 1)[0].trackId, 2);
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
    const tracker = createTracker();
    assert.throws(() => tracker.update([{ bbox: [0, 0, 1] }], 0), TypeError);
    assert.throws(() => tracker.update([{ bbox: [0, 0, 1, Number.NaN] }], 0), TypeError);
  });
});
