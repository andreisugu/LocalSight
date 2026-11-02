import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COVERAGE_STATE,
  GAP_REASON,
  coverageFor,
  expectedFrameMs,
  mergeGaps,
} from './coverage.js';

// The sample clock is absolute epoch milliseconds, like the engine's frame timestamps.
const T0 = Date.UTC(2026, 0, 5, 19, 0, 0);
const CAMERA = 'CAM-01';
const at = (seconds) => T0 + seconds * 1000;
const windowTo = (seconds) => ({ from: T0, to: at(seconds) });

/** One sample per second from `start` to `end` inclusive, with a per-instant status. */
function stream(start, end, statusAt = () => COVERAGE_STATE.LIVE, cameraId = CAMERA) {
  const samples = [];
  for (let second = start; second <= end; second += 1) {
    samples.push({ cameraId, at: at(second), status: statusAt(second) });
  }
  return samples;
}

test('expectedFrameMs is the documented 1 s default', () => {
  assert.equal(expectedFrameMs, 1000);
});

test('an uninterrupted 60 s of live frames is 100% coverage and one segment', () => {
  const result = coverageFor(stream(0, 60), [], windowTo(60));
  const camera = result.cameras[0];

  assert.equal(camera.cameraId, CAMERA);
  assert.equal(camera.noData, false);
  assert.equal(camera.coveragePct, 100);
  assert.equal(camera.liveMs, 60000);
  assert.equal(camera.degradedMs, 0);
  assert.equal(camera.gapMs, 0);
  assert.equal(camera.watchedMs, 60000);
  assert.equal(camera.longestGapMs, 0);
  assert.deepEqual(camera.gaps, []);
  assert.deepEqual(camera.segments, [{ from: T0, to: at(60), state: COVERAGE_STATE.LIVE }]);
  assert.equal(result.totals.coveragePct, 100);
  assert.equal(result.totals.noData, false);
  assert.equal(result.noData, false);
  assert.equal(result.invalid, 0);
});

test('a missing 10 s of frames is a measured gap, not a thinner live run', () => {
  // Clean 1 s cadence, then the 11 samples between 11 s and 21 s never arrived.
  const samples = [...stream(0, 10), ...stream(21, 40)];
  const result = coverageFor(samples, [], windowTo(40));
  const camera = result.cameras[0];

  assert.equal(camera.liveMs, 30000);
  assert.equal(camera.noFramesMs, 10000);
  assert.equal(camera.gapMs, 10000);
  assert.equal(camera.longestGapMs, 10000);
  assert.equal(camera.watchedMs, 40000);
  assert.equal(camera.coveragePct, 75);
  assert.deepEqual(camera.gaps, [
    { from: at(11), to: at(21), reason: GAP_REASON.NO_FRAMES, durationMs: 10000 },
  ]);
  assert.deepEqual(camera.segments, [
    { from: T0, to: at(11), state: COVERAGE_STATE.LIVE },
    { from: at(11), to: at(21), state: GAP_REASON.NO_FRAMES },
    { from: at(21), to: at(40), state: COVERAGE_STATE.LIVE },
  ]);
});

test('a hidden tab is an explicit blind window with its own reason', () => {
  const samples = stream(0, 30, (second) =>
    second >= 11 && second <= 20 ? COVERAGE_STATE.HIDDEN : COVERAGE_STATE.LIVE
  );
  const camera = coverageFor(samples, [], windowTo(30)).cameras[0];

  assert.equal(camera.hiddenMs, 10000);
  assert.equal(camera.pausedMs, 0);
  assert.equal(camera.noFramesMs, 0);
  assert.equal(camera.gapMs, 10000);
  assert.equal(camera.liveMs, 20000);
  assert.equal(camera.coveragePct, 66.7);
  assert.deepEqual(camera.gaps, [
    { from: at(11), to: at(21), reason: GAP_REASON.HIDDEN, durationMs: 10000 },
  ]);
});

test('a paused engine is blind until frames resume', () => {
  const samples = stream(0, 20, (second) =>
    second >= 5 && second <= 19 ? COVERAGE_STATE.PAUSED : COVERAGE_STATE.LIVE
  );
  const camera = coverageFor(samples, [], windowTo(20)).cameras[0];

  assert.equal(camera.pausedMs, 15000);
  assert.equal(camera.hiddenMs, 0);
  assert.equal(camera.gapMs, 15000);
  assert.equal(camera.coveragePct, 25);
  assert.deepEqual(camera.gaps, [
    { from: at(5), to: at(20), reason: GAP_REASON.PAUSED, durationMs: 15000 },
  ]);
});

test('degraded frames count as watched but stay flagged', () => {
  const samples = stream(0, 20, (second) =>
    second >= 5 && second <= 9 ? COVERAGE_STATE.DEGRADED : COVERAGE_STATE.LIVE
  );
  const camera = coverageFor(samples, [], windowTo(20)).cameras[0];

  assert.equal(camera.degradedMs, 5000);
  assert.equal(camera.liveMs, 15000);
  assert.equal(camera.gapMs, 0);
  assert.equal(camera.coveragePct, 100);
  assert.deepEqual(camera.segments, [
    { from: T0, to: at(5), state: COVERAGE_STATE.LIVE },
    { from: at(5), to: at(10), state: COVERAGE_STATE.DEGRADED },
    { from: at(10), to: at(20), state: COVERAGE_STATE.LIVE },
  ]);
});

test('a camera switch closes the previous camera instead of marking it blind', () => {
  const samples = [...stream(0, 9, undefined, 'CAM-01'), ...stream(11, 29, undefined, 'CAM-02')];
  const result = coverageFor(samples, [], windowTo(30));
  const [first, second] = result.cameras;

  assert.deepEqual(result.cameras.map((camera) => camera.cameraId), ['CAM-01', 'CAM-02']);
  // CAM-01 stops at its last frame plus one cadence: no fabricated gap after the switch.
  assert.equal(first.watchedMs, 10000);
  assert.equal(first.gapMs, 0);
  assert.equal(first.coveragePct, 100);
  assert.equal(second.watchedMs, 19000);
  assert.equal(second.gapMs, 0);
  assert.equal(second.coveragePct, 100);
  assert.equal(result.totals.coveragePct, 100);
  assert.equal(result.totals.gapMs, 0);
});

test('the last active camera extends to the window end, so a dead engine shows as a gap', () => {
  const samples = stream(0, 10);
  const camera = coverageFor(samples, [], windowTo(30)).cameras[0];

  assert.equal(camera.liveMs, 11000);
  assert.equal(camera.noFramesMs, 19000);
  assert.equal(camera.coveragePct, 36.7);
  assert.deepEqual(camera.gaps, [
    { from: at(11), to: at(30), reason: GAP_REASON.NO_FRAMES, durationMs: 19000 },
  ]);
});

test('incident ticks are positioned relative to the session window', () => {
  const incidents = [
    { eventId: 'evt-60', at: at(60), cameraId: CAMERA },
    { eventId: 'evt-15', at: at(15), cameraId: CAMERA },
    { eventId: 'evt-0', at: at(0), cameraId: CAMERA },
    { eventId: 'evt-other', at: at(30), cameraId: 'CAM-02' },
    { eventId: 'evt-nocam', at: at(45) },
    { eventId: 'evt-outside', at: at(61), cameraId: CAMERA },
    { eventId: 'evt-broken', at: 'not-a-date', cameraId: CAMERA },
  ];
  const result = coverageFor(stream(0, 60), incidents, windowTo(60));
  const camera = result.cameras[0];

  assert.deepEqual(camera.ticks, [
    { eventId: 'evt-0', at: at(0), offsetPct: 0 },
    { eventId: 'evt-15', at: at(15), offsetPct: 25 },
    { eventId: 'evt-60', at: at(60), offsetPct: 100 },
  ]);
  // The session-wide list keeps incidents from every camera, still ordered by time.
  assert.deepEqual(
    result.totals.ticks.map((tick) => tick.eventId),
    ['evt-0', 'evt-15', 'evt-other', 'evt-nocam', 'evt-60']
  );
  assert.equal(result.ignoredIncidents, 2);
});

test('no samples at all is 0% with a clear noData flag', () => {
  const result = coverageFor([], [], windowTo(60));

  assert.equal(result.noData, true);
  assert.equal(result.totals.noData, true);
  assert.equal(result.totals.coveragePct, 0);
  assert.equal(result.totals.watchedMs, 0);
  assert.deepEqual(result.cameras, []);
});

test('a declared camera with no samples renders as no data, never as full coverage', () => {
  const result = coverageFor([], [], windowTo(60), { cameras: ['CAM-01', 'CAM-02'] });

  assert.equal(result.cameras.length, 2);
  for (const camera of result.cameras) {
    assert.equal(camera.noData, true);
    assert.equal(camera.coveragePct, 0);
    assert.equal(camera.watchedMs, 0);
    assert.deepEqual(camera.segments, []);
  }
  assert.equal(result.noData, true);
});

test('one sample covers one cadence, and the rest of the window is honest gap', () => {
  const result = coverageFor([{ cameraId: CAMERA, at: T0, status: COVERAGE_STATE.LIVE }], [], windowTo(10));
  const camera = result.cameras[0];

  assert.equal(camera.noData, false);
  assert.equal(camera.sampleCount, 1);
  assert.equal(camera.watchedMs, 10000);
  assert.equal(camera.liveMs, 1000);
  assert.equal(camera.noFramesMs, 9000);
  assert.equal(camera.coveragePct, 10);
  assert.equal(camera.longestGapMs, 9000);
});

test('out-of-order and duplicated samples are idempotent', () => {
  const clean = stream(0, 10);
  const shuffled = [...clean].reverse();
  const duplicated = [...clean, ...clean, ...clean.slice(3, 7)];

  const expected = coverageFor(clean, [], windowTo(10));
  const reordered = coverageFor(shuffled, [], windowTo(10));
  const repeated = coverageFor(duplicated, [], windowTo(10));

  assert.deepEqual(reordered.cameras, expected.cameras);
  assert.deepEqual(repeated.cameras, expected.cameras);
  assert.deepEqual(repeated.totals, expected.totals);
});

test('a conflicting duplicate folds toward the least flattering status', () => {
  const samples = [
    { cameraId: CAMERA, at: at(0), status: COVERAGE_STATE.LIVE },
    { cameraId: CAMERA, at: at(0), status: COVERAGE_STATE.HIDDEN },
    { cameraId: CAMERA, at: at(1), status: COVERAGE_STATE.LIVE },
  ];
  const camera = coverageFor(samples, [], windowTo(1)).cameras[0];

  assert.equal(camera.sampleCount, 2);
  assert.equal(camera.hiddenMs, 1000);
  assert.equal(camera.liveMs, 0);
});

test('invalid samples are dropped and counted instead of guessed', () => {
  const samples = [
    { cameraId: CAMERA, at: at(0), status: COVERAGE_STATE.LIVE },
    { cameraId: CAMERA, at: at(1), status: COVERAGE_STATE.LIVE },
    null,
    42,
    { at: at(1), status: 'live' },
    { cameraId: '   ', at: at(1), status: 'live' },
    { cameraId: CAMERA, at: 'not-a-date', status: 'live' },
    { cameraId: CAMERA, at: Number.NaN, status: 'live' },
    { cameraId: CAMERA, at: at(1), status: 'verifying' },
    { cameraId: CAMERA, at: at(1), status: 'live', width: 0 },
    { cameraId: CAMERA, at: at(1), status: 'live', height: -3 },
  ];
  const result = coverageFor(samples, [], windowTo(1));

  assert.equal(result.invalid, 9);
  assert.equal(result.cameras.length, 1);
  assert.equal(result.cameras[0].sampleCount, 2);
  assert.equal(result.cameras[0].coveragePct, 100);
});

test('ISO timestamps and epoch milliseconds describe the same instant', () => {
  const iso = new Date(at(0)).toISOString();
  const isoCamera = coverageFor(
    [{ cameraId: CAMERA, at: iso, status: COVERAGE_STATE.LIVE }],
    [{ eventId: 'evt', at: new Date(at(5)).toISOString(), cameraId: CAMERA }],
    { from: iso, to: new Date(at(10)).toISOString() }
  ).cameras[0];

  assert.equal(isoCamera.sampleCount, 1);
  assert.equal(isoCamera.coveragePct, 10);
  assert.deepEqual(isoCamera.ticks, [{ eventId: 'evt', at: at(5), offsetPct: 50 }]);
});

test('a sample before the window anchors the state but earns no time before it', () => {
  const samples = [
    { cameraId: CAMERA, at: at(-5), status: COVERAGE_STATE.LIVE },
    { cameraId: CAMERA, at: at(10), status: COVERAGE_STATE.LIVE },
  ];
  const camera = coverageFor(samples, [], windowTo(20)).cameras[0];

  // Nothing was processed between -5 s and 10 s, so 0–10 s is a measured gap.
  assert.equal(camera.spanFrom, T0);
  assert.equal(camera.liveMs, 1000);
  assert.equal(camera.noFramesMs, 19000);
  assert.deepEqual(camera.gaps, [
    { from: T0, to: at(10), reason: GAP_REASON.NO_FRAMES, durationMs: 10000 },
    { from: at(11), to: at(20), reason: GAP_REASON.NO_FRAMES, durationMs: 9000 },
  ]);
});

test('samples after the window are ignored and cannot stretch it', () => {
  const samples = [...stream(0, 20), { cameraId: CAMERA, at: at(25), status: COVERAGE_STATE.LIVE }];
  const result = coverageFor(samples, [], windowTo(20));

  assert.equal(result.ignored, 1);
  assert.equal(result.cameras[0].liveMs, 20000);
  assert.equal(result.cameras[0].coveragePct, 100);
});

test('the cadence is configurable for 10 s buckets', () => {
  const samples = [];
  for (let second = 0; second <= 60; second += 10) {
    samples.push({ cameraId: CAMERA, at: at(second), status: COVERAGE_STATE.LIVE });
  }
  const strict = coverageFor(samples, [], windowTo(60));
  const bucketed = coverageFor(samples, [], windowTo(60), { expectedFrameMs: 10000 });

  // With a 1 s expectation the same stream is mostly gap; at the real cadence it is full.
  assert.equal(strict.cameras[0].coveragePct, 10);
  assert.equal(bucketed.cameras[0].coveragePct, 100);
  assert.equal(bucketed.expectedFrameMs, 10000);
});

test('an inverted window falls back to the sample extremes instead of throwing', () => {
  const camera = coverageFor(stream(0, 10), [], { from: at(10), to: T0 }).cameras[0];

  assert.equal(camera.coveragePct, 100);
  assert.equal(camera.liveMs, 10000);
});

test('mergeGaps joins touching same-reason windows and keeps the rest apart', () => {
  const merged = mergeGaps([
    { from: 2000, to: 3000, reason: GAP_REASON.NO_FRAMES },
    { from: 0, to: 1000, reason: GAP_REASON.NO_FRAMES },
    { from: 1000, to: 2000, reason: GAP_REASON.NO_FRAMES },
    { from: 3000, to: 4000, reason: GAP_REASON.HIDDEN },
    { from: 3500, to: 5000, reason: GAP_REASON.HIDDEN },
    { from: 6000, to: 6000, reason: GAP_REASON.PAUSED },
    { from: 7000, to: 8000 },
    null,
  ]);

  assert.deepEqual(merged, [
    { from: 0, to: 3000, reason: GAP_REASON.NO_FRAMES, durationMs: 3000 },
    { from: 3000, to: 5000, reason: GAP_REASON.HIDDEN, durationMs: 2000 },
  ]);
});

test('mergeGaps never mutates its input', () => {
  const input = [
    { from: 0, to: 1000, reason: GAP_REASON.HIDDEN },
    { from: 1000, to: 2000, reason: GAP_REASON.HIDDEN },
  ];
  const merged = mergeGaps(input);

  assert.deepEqual(input, [
    { from: 0, to: 1000, reason: GAP_REASON.HIDDEN },
    { from: 1000, to: 2000, reason: GAP_REASON.HIDDEN },
  ]);
  assert.equal(merged.length, 1);
});

test('totals reconcile: watched time is live + degraded + every blind bucket', () => {
  const samples = [
    ...stream(0, 10),
    ...stream(21, 30),
    ...stream(40, 44, () => COVERAGE_STATE.DEGRADED),
  ];
  const result = coverageFor(samples, [], windowTo(50));

  assert.equal(
    result.totals.watchedMs,
    result.totals.liveMs + result.totals.degradedMs + result.totals.gapMs
  );
  assert.equal(
    result.totals.gapMs,
    result.totals.noFramesMs + result.totals.pausedMs + result.totals.hiddenMs
  );
  assert.equal(result.totals.coveragePct, 52);
});
