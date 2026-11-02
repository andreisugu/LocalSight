import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatDuration, formatTime } from './time.js';

// The API sends UTC and the operators read Romania's clock. Fixed instants are used so the
// expectations never depend on the machine's time zone; the DST cases are the two days the
// offset changes, because a hardcoded +02:00 passes every other test in the suite.

test('an instant is shown on the Bucharest clock, winter and summer', () => {
  // November is EET (UTC+2); July is EEST (UTC+3).
  assert.equal(formatTime('2026-11-02T10:00:00Z'), '12:00:00');
  assert.equal(formatTime('2026-07-01T10:00:00Z'), '13:00:00');
});

test('midnight is the next day, not 24:00', () => {
  assert.equal(formatTime('2026-11-02T22:00:00Z'), '00:00:00');
  assert.equal(formatDateTime('2026-11-02T22:00:00Z'), '03.11, 00:00:00');
  assert.equal(formatTime('2026-11-02T23:30:00Z'), '01:30:00');
  assert.equal(formatTime('2026-11-02T21:59:59Z'), '23:59:59');
});

test('the DST switches are followed, both of them', () => {
  // 29 March: 03:00 local does not exist, the clock jumps to 04:00 EEST.
  assert.equal(formatTime('2026-03-29T00:30:00Z'), '02:30:00');
  assert.equal(formatTime('2026-03-29T01:30:00Z'), '04:30:00');
  // 25 October: 03:30 happens twice; both instants read the same on the wall clock.
  assert.equal(formatTime('2026-10-25T00:30:00Z'), '03:30:00');
  assert.equal(formatTime('2026-10-25T01:30:00Z'), '03:30:00');
});

test('a Date is accepted like an ISO string', () => {
  assert.equal(formatTime(new Date('2026-11-02T10:00:00Z')), '12:00:00');
  assert.equal(formatDateTime(new Date('2026-11-02T10:00:00Z')), '02.11, 12:00:00');
});

test('a missing time says it is pending; a broken one is an em dash', () => {
  assert.equal(formatTime(null), 'În așteptare');
  assert.equal(formatTime(undefined), 'În așteptare');
  assert.equal(formatTime(''), 'În așteptare');
  assert.equal(formatTime(null, { placeholder: '—' }), '—');
  assert.equal(formatTime('not-a-date'), '—');
});

test('the day-and-time shape is the one the list and the audit trail use', () => {
  assert.equal(formatDateTime('2026-11-02T10:00:00Z'), '02.11, 12:00:00');
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime(''), '—');
  assert.equal(formatDateTime('not-a-date'), '—');
});

test('a contract date renders as one Romanian format', () => {
  assert.equal(formatDate('2026-11-02'), '02.11.2026');
});

test('a missing or malformed date renders as a dash, never a guess', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(undefined), '—');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('2026-11'), '—');
  assert.equal(formatDate('02.11.2026'), '—');
  assert.equal(formatDate('2026-11-02T10:00:00Z'), '—');
});

test('a duration is whole seconds with its unit, and a dash when unmeasured', () => {
  assert.equal(formatDuration(43), '43 sec');
  assert.equal(formatDuration(42.6), '43 sec');
  assert.equal(formatDuration(0), '0 sec');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(Number.NaN), '—');
});
