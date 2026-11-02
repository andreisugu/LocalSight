import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentShiftId,
  localDateString,
  shiftDate,
  shiftToApi,
} from './shift.js';

const at = (iso) => new Date(iso);

test('the API shift names are the ones the backend documents', () => {
  assert.equal(shiftToApi('shift_1'), 'morning');
  assert.equal(shiftToApi('shift_2'), 'afternoon');
  assert.equal(shiftToApi('shift_3'), 'night');
  assert.equal(shiftToApi('unknown'), 'morning');
});

test('the current shift follows the same boundaries as the fixtures', () => {
  assert.equal(currentShiftId(at('2026-11-02T05:59:00+02:00')), 'shift_3');
  assert.equal(currentShiftId(at('2026-11-02T06:00:00+02:00')), 'shift_1');
  assert.equal(currentShiftId(at('2026-11-02T14:00:00+02:00')), 'shift_2');
  assert.equal(currentShiftId(at('2026-11-02T22:00:00+02:00')), 'shift_3');
});

test('before 06:00 the shift belongs to the previous operational day', () => {
  assert.equal(shiftDate('shift_3', at('2026-11-02T02:00:00+02:00')), '2026-11-01');
  assert.equal(shiftDate('shift_1', at('2026-11-02T06:00:00+02:00')), '2026-11-02');
});

test('a calendar date is the Romanian date, not the machine date', () => {
  assert.equal(localDateString(at('2026-11-02T23:30:00+02:00')), '2026-11-02');
  assert.equal(localDateString(at('2026-11-03T00:30:00+02:00')), '2026-11-03');
});
