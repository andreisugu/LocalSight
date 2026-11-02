// Tests for the per-camera ground calibration. Pure: no DOM, no canvas, no model.
//
// The cases are the ones that decide whether a speed number may be printed at all: a valid
// four-point calibration must build a real homography, while a truncated blob, an
// out-of-frame click, a zero side or four collinear points must all fail closed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUND_CALIBRATION_KEY_PREFIX,
  MAX_SAMPLE_GAP_S,
  TRUNCATED_BOTTOM,
  advanceTrackSpeeds,
  buildGroundHomography,
  calibrationStorageKey,
  clearStoredGroundCalibration,
  createTrackSpeedState,
  formatGroundRect,
  groundCalibrationStatus,
  normalizeGroundCalibration,
  readStoredGroundCalibration,
  storeGroundCalibration,
} from './groundCalibration.js';
import { projectPoint } from '../engine/groundPlane.js';

/** The full frame is a 10 x 10 m rectangle: one normalized unit is ten metres. */
const FULL_FRAME_10M = {
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  widthM: 10,
  heightM: 10,
};

/** One person walking 0.05 normalized units (0.5 m) in half a second. */
const STEP_1 = { time: 0, boxes: [{ id: 3, bbox: [0.45, 0.4, 0.55, 0.8] }] };
const STEP_2 = { time: 0.5, boxes: [{ id: 3, bbox: [0.5, 0.4, 0.6, 0.8] }] };

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    value: (key) => values.get(key),
    has: (key) => values.has(key),
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const statusOf = (calibration) => groundCalibrationStatus(calibration);

describe('storage key', () => {
  test('is one namespaced key per camera', () => {
    assert.equal(
      calibrationStorageKey('stand12'),
      `${GROUND_CALIBRATION_KEY_PREFIX}stand12`
    );
    assert.equal(calibrationStorageKey('  taxiway-b  '), `${GROUND_CALIBRATION_KEY_PREFIX}taxiway-b`);
  });

  test('refuses a missing or empty camera id', () => {
    assert.equal(calibrationStorageKey(''), null);
    assert.equal(calibrationStorageKey('   '), null);
    assert.equal(calibrationStorageKey(null), null);
    assert.equal(calibrationStorageKey(42), null);
  });
});

describe('normalizeGroundCalibration', () => {
  test('accepts a complete in-frame calibration and returns a copy', () => {
    const normalized = normalizeGroundCalibration(FULL_FRAME_10M);
    assert.deepEqual(normalized, FULL_FRAME_10M);
    assert.notEqual(normalized, FULL_FRAME_10M);
    assert.notEqual(normalized.points[0], FULL_FRAME_10M.points[0]);
  });

  test('rejects malformed or incomplete input', () => {
    assert.equal(normalizeGroundCalibration(null), null);
    assert.equal(normalizeGroundCalibration('calibration'), null);
    assert.equal(normalizeGroundCalibration([]), null);
    assert.equal(normalizeGroundCalibration({ ...FULL_FRAME_10M, points: [] }), null);
    assert.equal(
      normalizeGroundCalibration({ ...FULL_FRAME_10M, points: FULL_FRAME_10M.points.slice(0, 3) }),
      null
    );
    assert.equal(
      normalizeGroundCalibration({ ...FULL_FRAME_10M, points: [...FULL_FRAME_10M.points, { x: 0, y: 0 }] }),
      null
    );
  });

  test('rejects non-finite and out-of-frame points', () => {
    const withPoint = (point) => ({ ...FULL_FRAME_10M, points: [point, ...FULL_FRAME_10M.points.slice(1)] });
    assert.equal(normalizeGroundCalibration(withPoint({ x: NaN, y: 0.2 })), null);
    assert.equal(normalizeGroundCalibration(withPoint({ x: 0.2, y: Infinity })), null);
    assert.equal(normalizeGroundCalibration(withPoint({ x: '0.2', y: 0.2 })), null);
    assert.equal(normalizeGroundCalibration(withPoint({ x: -0.01, y: 0.2 })), null);
    assert.equal(normalizeGroundCalibration(withPoint({ x: 1.01, y: 0.2 })), null);
  });

  test('rejects missing, zero, negative or non-numeric sides', () => {
    for (const side of [0, -10, NaN, Infinity, '10', null, undefined]) {
      assert.equal(normalizeGroundCalibration({ ...FULL_FRAME_10M, widthM: side }), null);
      assert.equal(normalizeGroundCalibration({ ...FULL_FRAME_10M, heightM: side }), null);
    }
  });
});

describe('buildGroundHomography', () => {
  test('maps the frame corners onto the measured rectangle', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    assert.ok(H, 'a complete rectangle must build a matrix');
    assert.deepEqual(projectPoint(H, { x: 0.5, y: 0.5 }), { x: 5, y: 5 });
    assert.deepEqual(projectPoint(H, { x: 0.25, y: 0.75 }), { x: 2.5, y: 7.5 });
  });

  test('honours the measured width and height independently', () => {
    const H = buildGroundHomography({ ...FULL_FRAME_10M, widthM: 20, heightM: 5 });
    assert.deepEqual(projectPoint(H, { x: 0.5, y: 0.5 }), { x: 10, y: 2.5 });
  });

  test('rejects four collinear points instead of inventing metres', () => {
    const collinear = {
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.3, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      widthM: 10,
      heightM: 10,
    };
    assert.equal(buildGroundHomography(collinear), null);
    assert.equal(normalizeGroundCalibration(collinear) === null, false);
    assert.equal(statusOf(collinear).calibrated, false);
    assert.equal(statusOf(collinear).degenerate, true);
  });

  test('rejects four identical points', () => {
    const duplicated = {
      points: Array.from({ length: 4 }, () => ({ x: 0.5, y: 0.5 })),
      widthM: 10,
      heightM: 10,
    };
    assert.equal(buildGroundHomography(duplicated), null);
  });
});

describe('groundCalibrationStatus', () => {
  test('no calibration is „necalibrat”, not a zero rectangle', () => {
    const status = statusOf(null);
    assert.equal(status.calibrated, false);
    assert.equal(status.degenerate, false);
    assert.equal(status.homography, null);
    assert.equal(status.label, 'necalibrat');
  });

  test('a valid calibration says what was measured', () => {
    const status = statusOf({ ...FULL_FRAME_10M, widthM: 12.5, heightM: 8 });
    assert.equal(status.calibrated, true);
    assert.equal(status.degenerate, false);
    assert.ok(status.homography);
    assert.equal(status.label, `calibrat — ${formatGroundRect({ widthM: 12.5, heightM: 8 })}`);
  });

  test('three points are incomplete, four degenerate points are called out', () => {
    assert.equal(statusOf({ ...FULL_FRAME_10M, points: FULL_FRAME_10M.points.slice(0, 3) }).label, 'necalibrat');
    assert.equal(statusOf({
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.3, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      widthM: 10,
      heightM: 10,
    }).label, 'necalibrat — puncte degenere');
  });
});

describe('localStorage round trip', () => {
  test('writes one key per camera and reads it back', () => {
    const storage = memoryStorage();
    assert.equal(storeGroundCalibration(storage, 'stand12', FULL_FRAME_10M), true);
    assert.ok(storage.has(`${GROUND_CALIBRATION_KEY_PREFIX}stand12`));
    assert.equal(storage.has(`${GROUND_CALIBRATION_KEY_PREFIX}taxiway-b`), false);
    assert.deepEqual(readStoredGroundCalibration(storage, 'stand12'), FULL_FRAME_10M);
    assert.equal(readStoredGroundCalibration(storage, 'taxiway-b'), null);
  });

  test('a corrupt, oversized or out-of-bounds blob means „never calibrated”', () => {
    const key = `${GROUND_CALIBRATION_KEY_PREFIX}stand12`;
    assert.equal(readStoredGroundCalibration(memoryStorage({ [key]: '{not json' }), 'stand12'), null);
    assert.equal(readStoredGroundCalibration(memoryStorage({ [key]: '[]' }), 'stand12'), null);
    assert.equal(
      readStoredGroundCalibration(memoryStorage({ [key]: JSON.stringify({ ...FULL_FRAME_10M, widthM: 0 }) }), 'stand12'),
      null
    );
    assert.equal(
      readStoredGroundCalibration(
        memoryStorage({ [key]: JSON.stringify({ ...FULL_FRAME_10M, points: [{ x: 4, y: 0 }, ...FULL_FRAME_10M.points.slice(1)] }) }),
        'stand12'
      ),
      null
    );
    assert.equal(
      readStoredGroundCalibration(memoryStorage({ [key]: 'x'.repeat(5000) }), 'stand12'),
      null
    );
  });

  test('a blocked storage getter or setter never throws', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    assert.equal(readStoredGroundCalibration(blocked, 'stand12'), null);
    assert.equal(storeGroundCalibration(blocked, 'stand12', FULL_FRAME_10M), false);
    assert.equal(clearStoredGroundCalibration(blocked, 'stand12'), false);
  });

  test('reset removes exactly one camera key', () => {
    const storage = memoryStorage();
    storeGroundCalibration(storage, 'stand12', FULL_FRAME_10M);
    storeGroundCalibration(storage, 'taxiway-b', FULL_FRAME_10M);
    assert.equal(clearStoredGroundCalibration(storage, 'stand12'), true);
    assert.equal(readStoredGroundCalibration(storage, 'stand12'), null);
    assert.deepEqual(readStoredGroundCalibration(storage, 'taxiway-b'), FULL_FRAME_10M);
    // Clearing an absent key is not an error.
    assert.equal(clearStoredGroundCalibration(storage, 'stand12'), true);
  });

  test('a legacy blob without the version field still reads', () => {
    const key = `${GROUND_CALIBRATION_KEY_PREFIX}stand12`;
    const storage = memoryStorage({ [key]: JSON.stringify(clone(FULL_FRAME_10M)) });
    assert.deepEqual(readStoredGroundCalibration(storage, 'stand12'), FULL_FRAME_10M);
  });
});

describe('advanceTrackSpeeds', () => {
  test('turns a foot-point step into m/s with the calibration', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const first = advanceTrackSpeeds(createTrackSpeedState(H), STEP_1, H);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].id, 3);
    assert.equal(first.rows[0].speedMps, null, 'the first frame has nothing to compare');
    assert.equal(first.rows[0].distanceM, null);

    const second = advanceTrackSpeeds(first.state, STEP_2, H);
    assert.ok(Math.abs(second.rows[0].speedMps - 1) < 1e-9, '0.5 m in 0.5 s is 1 m/s');
    assert.equal(second.rows[0].distanceM, 0.5);
  });

  test('no calibration means no numbers, never zero', () => {
    const first = advanceTrackSpeeds(createTrackSpeedState(null), STEP_1, null);
    const second = advanceTrackSpeeds(first.state, STEP_2, null);
    assert.equal(second.rows[0].speedMps, null);
    assert.equal(second.rows[0].distanceM, null);
  });

  test('a box whose bottom sits on the frame edge is truncated, not measured', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const first = advanceTrackSpeeds(createTrackSpeedState(H), {
      time: 0,
      boxes: [{ id: 7, bbox: [0.4, 0.1, 0.5, TRUNCATED_BOTTOM] }],
    }, H);
    const second = advanceTrackSpeeds(first.state, {
      time: 0.5,
      boxes: [{ id: 7, bbox: [0.45, 0.1, 0.55, TRUNCATED_BOTTOM] }],
    }, H);
    assert.equal(second.rows[0].truncated, true);
    assert.equal(second.rows[0].speedMps, null);
  });

  test('a gap longer than a reading may bridge is not averaged over', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const first = advanceTrackSpeeds(createTrackSpeedState(H), STEP_1, H);
    const late = advanceTrackSpeeds(first.state, { ...STEP_2, time: MAX_SAMPLE_GAP_S + 0.1 }, H);
    assert.equal(late.rows[0].speedMps, null);

    const after = advanceTrackSpeeds(
      late.state,
      { time: MAX_SAMPLE_GAP_S + 0.6, boxes: [{ id: 3, bbox: [0.55, 0.4, 0.65, 0.8] }] },
      H
    );
    assert.ok(Math.abs(after.rows[0].speedMps - 1) < 1e-9);
  });

  test('a recalibration throws the old metres away', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const other = buildGroundHomography({ ...FULL_FRAME_10M, widthM: 20, heightM: 20 });
    const first = advanceTrackSpeeds(createTrackSpeedState(H), STEP_1, H);
    const withOther = advanceTrackSpeeds(first.state, STEP_2, other);
    assert.equal(withOther.rows[0].speedMps, null, 'no previous foot point under the new map');
    assert.equal(withOther.state.entries.size, 1);
  });

  test('a malformed feed is ignored without throwing', () => {
    const state = createTrackSpeedState(null);
    for (const feed of [null, {}, { time: 1 }, { time: NaN, boxes: [] }, { time: 1, boxes: 'x' }]) {
      const result = advanceTrackSpeeds(state, feed, null);
      assert.deepEqual(result.rows, []);
    }
  });

  test('tracks that disappear are forgotten after the bridge window', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const first = advanceTrackSpeeds(createTrackSpeedState(H), STEP_1, H);
    const empty = advanceTrackSpeeds(first.state, { time: 1, boxes: [] }, H);
    assert.equal(empty.state.entries.size, 1, 'a missed frame keeps the foot point briefly');
    const stale = advanceTrackSpeeds(empty.state, { time: 1 + MAX_SAMPLE_GAP_S * 2 + 1, boxes: [] }, H);
    assert.equal(stale.state.entries.size, 0);
  });

  test('rows are ordered by tracker id, independent of the box order', () => {
    const H = buildGroundHomography(FULL_FRAME_10M);
    const result = advanceTrackSpeeds(createTrackSpeedState(H), {
      time: 0,
      boxes: [
        { id: 9, bbox: [0.1, 0.1, 0.2, 0.5] },
        { id: 2, bbox: [0.5, 0.1, 0.6, 0.5] },
      ],
    }, H);
    assert.deepEqual(result.rows.map((row) => row.id), [2, 9]);
  });
});
