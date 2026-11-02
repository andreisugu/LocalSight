import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTE_MS,
  SECOND_MS,
  createShiftWindow,
  minutesIntoShiftAt,
  operationalDateAt,
  roDecimal,
  shiftIdAt,
  zonedDateString,
} from './clock.js';

// Dates are written with an explicit +02:00 offset (Romania in November), so the tests do
// not depend on the time zone of the machine running them.
const at = (iso) => new Date(iso);

test('shift boundaries are 06:00, 14:00 and 22:00 on the Romanian clock', () => {
  assert.equal(shiftIdAt(at('2026-11-02T05:59:00+02:00')), 'shift_3');
  assert.equal(shiftIdAt(at('2026-11-02T06:00:00+02:00')), 'shift_1');
  assert.equal(shiftIdAt(at('2026-11-02T13:59:00+02:00')), 'shift_1');
  assert.equal(shiftIdAt(at('2026-11-02T14:00:00+02:00')), 'shift_2');
  assert.equal(shiftIdAt(at('2026-11-02T21:59:00+02:00')), 'shift_2');
  assert.equal(shiftIdAt(at('2026-11-02T22:00:00+02:00')), 'shift_3');
});

test('the operational day only flips at 06:00', () => {
  assert.equal(operationalDateAt(at('2026-11-02T05:59:00+02:00')), '2026-11-01');
  assert.equal(operationalDateAt(at('2026-11-02T06:00:00+02:00')), '2026-11-02');
  assert.equal(operationalDateAt(at('2026-11-02T23:30:00+02:00')), '2026-11-02');
});

test('minutes into the shift wrap across midnight', () => {
  assert.equal(minutesIntoShiftAt(at('2026-11-02T06:00:00+02:00')), 0);
  assert.equal(minutesIntoShiftAt(at('2026-11-02T07:30:00+02:00')), 90);
  assert.equal(minutesIntoShiftAt(at('2026-11-02T23:15:00+02:00')), 75);
  assert.equal(minutesIntoShiftAt(at('2026-11-03T01:00:00+02:00')), 180);
});

test('the fixture window follows the current shift, capped at 168 minutes', () => {
  const morning = createShiftWindow(at('2026-11-02T07:00:00+02:00'));
  assert.equal(morning.shiftId, 'shift_1');
  assert.equal(morning.minutesIntoShift, 60);
  assert.equal(morning.spreadMinutes, 60);
  assert.equal(morning.operationalDate, '2026-11-02');
  // The newest incident is 45 s old; the oldest sits at the start of the window.
  assert.equal(morning.newestDetectedAt.getTime(), at('2026-11-02T07:00:00+02:00').getTime() - 45 * SECOND_MS);
  assert.equal(
    morning.ageAt(1).getTime(),
    at('2026-11-02T07:00:00+02:00').getTime() - 60 * MINUTE_MS
  );

  const late = createShiftWindow(at('2026-11-02T21:00:00+02:00'));
  assert.equal(late.minutesIntoShift, 420);
  assert.equal(late.spreadMinutes, 168);
});

test('a shift that just started still leaves room for escalation', () => {
  const justStarted = createShiftWindow(at('2026-11-02T06:00:00+02:00'));
  assert.equal(justStarted.minutesIntoShift, 0);
  assert.equal(justStarted.spreadMinutes, 4);
  // 10% of the window, so the newest incident stays inside it: 24 s.
  assert.equal(justStarted.newestDetectedAt.getTime(), at('2026-11-02T06:00:00+02:00').getTime() - 24 * SECOND_MS);
});

test('time and decimal formatting match the copy already on screen', () => {
  assert.equal(roDecimal(2.6), '2,6');
  assert.equal(roDecimal(93.8), '93,8');
  assert.equal(zonedDateString(at('2026-11-02T23:30:00+02:00')), '2026-11-02');
});
