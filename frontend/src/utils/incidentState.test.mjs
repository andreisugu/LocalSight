import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_LIMIT,
  acknowledgeLocally,
  applyEscalations,
  findEvent,
  hasEvent,
  isConflictError,
  markFalsePositiveLocally,
  mergeEvent,
  patchEvent,
  reopenLocally,
  revertEvent,
  upsertEvent,
} from './incidentState.js';

const AT = new Date('2026-11-02T09:00:00.000Z');

function event(overrides = {}) {
  return {
    event_id: 'evt_stand12_1700000000000_17',
    status: 'open',
    severity: 'CRITICAL',
    detected_at: '2026-11-02T08:59:00.000Z',
    escalate_after_s: 30,
    acked_at: null,
    acked_by: null,
    escalated_at: null,
    ...overrides,
  };
}

test('acknowledge writes status, time and operator without touching other rows', () => {
  const other = event({ event_id: 'evt_other' });
  const events = [event(), other];
  const next = acknowledgeLocally(events, 'evt_stand12_1700000000000_17', 'Ana', AT);
  assert.equal(next[0].status, 'acknowledged');
  assert.equal(next[0].acked_at, AT.toISOString());
  assert.equal(next[0].acked_by, 'Ana');
  assert.equal(next[1], other);
  // Pure: the input list is untouched.
  assert.equal(events[0].status, 'open');
});

test('false positive records the note and the operator', () => {
  const next = markFalsePositiveLocally([event()], 'evt_stand12_1700000000000_17', 'Ana', 'umbră');
  assert.equal(next[0].status, 'false_positive');
  assert.equal(next[0].false_positive_note, 'umbră');
  assert.equal(next[0].false_positive_by, 'Ana');
});

test('false positive without a note stores an empty note, not undefined', () => {
  const next = markFalsePositiveLocally([event()], 'evt_stand12_1700000000000_17', 'Ana');
  assert.equal(next[0].false_positive_note, '');
});

test('reopen clears every ack/escalation stamp', () => {
  const row = event({
    status: 'escalated',
    escalated_at: '2026-11-02T08:59:40.000Z',
    acked_at: AT.toISOString(),
    acked_by: 'Ana',
  });
  const next = reopenLocally([row], 'evt_stand12_1700000000000_17');
  assert.deepEqual(
    { status: next[0].status, escalated_at: next[0].escalated_at, acked_at: next[0].acked_at, acked_by: next[0].acked_by },
    { status: 'open', escalated_at: null, acked_at: null, acked_by: null }
  );
});

test('an unknown id is a no-op for every transition', () => {
  const events = [event()];
  assert.equal(acknowledgeLocally(events, 'missing', 'Ana', AT)[0].status, 'open');
  assert.deepEqual(markFalsePositiveLocally(events, 'missing', 'Ana'), events);
  assert.deepEqual(reopenLocally(events, 'missing'), events);
});

test('merge takes the API version over the optimistic row', () => {
  const events = [event({ status: 'acknowledged' })];
  const next = mergeEvent(events, 'evt_stand12_1700000000000_17', { status: 'resolved', acked_by: 'API' });
  assert.equal(next[0].status, 'resolved');
  assert.equal(next[0].acked_by, 'API');
  assert.equal(next[0].event_id, 'evt_stand12_1700000000000_17');
});

test('merge with no payload keeps the list reference', () => {
  const events = [event()];
  assert.equal(mergeEvent(events, 'evt_stand12_1700000000000_17', null), events);
});

test('rollback restores the exact previous row', () => {
  const previous = event({ status: 'open' });
  const optimistic = acknowledgeLocally([previous], previous.event_id, 'Ana', AT);
  assert.equal(optimistic[0].status, 'acknowledged');
  const reverted = revertEvent(optimistic, previous);
  assert.equal(reverted[0], previous);
});

test('rollback without a previous row leaves the list untouched', () => {
  const events = [event()];
  assert.equal(revertEvent(events, undefined), events);
  assert.equal(revertEvent(events, null), events);
});

test('patchEvent only rewrites the matching row', () => {
  const events = [event(), event({ event_id: 'evt_other', status: 'escalated' })];
  const next = patchEvent(events, 'evt_other', { status: 'open' });
  assert.equal(next[0], events[0]);
  assert.equal(next[1].status, 'open');
});

test('upsert replaces a known incident in place', () => {
  const events = [event({ status: 'open' }), event({ event_id: 'evt_old' })];
  const next = upsertEvent(events, event({ status: 'acknowledged' }));
  assert.equal(next.length, 2);
  assert.equal(next[0].status, 'acknowledged');
  assert.equal(next[1].event_id, 'evt_old');
});

test('upsert prepends an unknown incident and caps the list', () => {
  const events = Array.from({ length: EVENT_LIMIT }, (_, index) => event({ event_id: `evt_${index}` }));
  const next = upsertEvent(events, event({ event_id: 'evt_new' }));
  assert.equal(next.length, EVENT_LIMIT);
  assert.equal(next[0].event_id, 'evt_new');
  assert.equal(next[EVENT_LIMIT - 1].event_id, `evt_${EVENT_LIMIT - 2}`);
});

test('upsert ignores a missing payload', () => {
  const events = [event()];
  assert.equal(upsertEvent(events, null), events);
  assert.equal(upsertEvent(events, undefined), events);
});

test('escalation flips an open incident once its timer elapsed', () => {
  const events = [event({ detected_at: '2026-11-02T08:58:00.000Z' })];
  const now = Date.parse('2026-11-02T08:59:00.000Z'); // 60 s later, timer is 30 s
  const next = applyEscalations(events, now);
  assert.equal(next[0].status, 'escalated');
  assert.equal(next[0].escalated_at, new Date(now).toISOString());
});

test('escalation keeps the same list while the timer is still running', () => {
  const events = [event({ detected_at: '2026-11-02T08:58:50.000Z' })];
  assert.equal(applyEscalations(events, Date.parse('2026-11-02T08:59:00.000Z')), events);
});

test('escalation ignores acknowledged, escalated and timer-less incidents', () => {
  const events = [
    event({ event_id: 'ack', status: 'acknowledged' }),
    event({ event_id: 'already', status: 'escalated' }),
    event({ event_id: 'no-timer', escalate_after_s: null }),
  ];
  assert.equal(applyEscalations(events, Date.parse('2026-11-03T00:00:00.000Z')), events);
});

test('escalation ignores an unreadable detection time', () => {
  const events = [event({ detected_at: 'not-a-date' })];
  assert.equal(applyEscalations(events, Date.parse('2026-11-03T00:00:00.000Z')), events);
});

test('conflict detection reads the API error format only', () => {
  assert.equal(isConflictError(new Error('409 Evenimentul a fost deja confirmat')), true);
  assert.equal(isConflictError(new Error('500 boom')), false);
  assert.equal(isConflictError(new Error('NetworkError when attempting to fetch resource.')), false);
  assert.equal(isConflictError(null), false);
  assert.equal(isConflictError(undefined), false);
});

test('find and has agree on ids', () => {
  const events = [event()];
  assert.equal(findEvent(events, 'evt_stand12_1700000000000_17'), events[0]);
  assert.equal(findEvent(events, 'evt_missing'), undefined);
  assert.equal(hasEvent(events, 'evt_stand12_1700000000000_17'), true);
  assert.equal(hasEvent(events, 'evt_missing'), false);
});
