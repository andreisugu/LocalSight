// Tests for the browser incident/event layer. Run with:
//   node --test frontend/src/engine/events.test.mjs
// Expectations come from the removed Python reference (git history):
// ml/safesight_ml/pipeline.py, ml/safesight_ml/events.py, backend/app/services/events.py
// and backend/app/services/escalation.py.

import test from 'node:test';
import assert from 'node:assert/strict';

import { eventId, IncidentCooldown, buildEvent, applyAction, escalateIfDue } from './events.js';

const T0 = 1793356933120; // 2026-10-30T10:42:13.120Z, the contract example
const ISO_T0 = '2026-10-30T10:42:13.120Z';

function sample(overrides = {}) {
  return buildEvent({
    cameraId: 'stand12',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    zoneId: 'engine-left',
    trackId: 17,
    confidence: { detector: 0.91, seen: 14, window: 15 },
    durationS: 1.4,
    engineOn: true,
    snapshotUrl: 'blob:http://localhost:5173/9f1c-4d2a',
    model: 'yolo26n',
    detectedAt: T0,
    ...overrides,
  });
}

test('eventId produces exactly the contract format', () => {
  assert.equal(eventId('stand12', T0, 17), 'evt_stand12_1793356933120_17');
  assert.match(eventId('baggage-area', Date.now(), 0), /^evt_[a-z0-9-]+_\d{13}_\d+$/);
  // The backend regex rejects anything outside this shape; the port fails early instead.
  assert.throws(() => eventId('Stand12', T0, 17), RangeError);
  assert.throws(() => eventId('stand12', 1793356933, 17), RangeError);
  assert.throws(() => eventId('stand12', T0, 1.5), RangeError);
  assert.throws(() => eventId('stand12', T0, -1), RangeError);
});

test('IncidentCooldown allows, denies inside the window and re-allows after it', () => {
  const cooldown = new IncidentCooldown();
  assert.equal(cooldown.windowS, 60);

  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0), true);
  cooldown.record('RESTRICTED_ZONE', 'engine-left', T0);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0 + 1), false);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0 + 59_999), false);
  // Boundary is inclusive, like `now_s - last < incident_cooldown_s` being False.
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0 + 60_000), true);
});

test('IncidentCooldown is per type and per zone, and per camera instance', () => {
  const cooldown = new IncidentCooldown();
  cooldown.record('RESTRICTED_ZONE', 'engine-left', T0);

  assert.equal(cooldown.allow('NO_PPE', 'engine-left', T0 + 1_000), true);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-right', T0 + 1_000), true);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0 + 1_000), false);

  // A second camera has its own map, so the same zone id never leaks across cameras.
  const otherCamera = new IncidentCooldown();
  assert.equal(otherCamera.allow('RESTRICTED_ZONE', 'engine-left', T0 + 1_000), true);
});

test('IncidentCooldown with 0 disables the cooldown entirely', () => {
  const cooldown = new IncidentCooldown(0);
  cooldown.record('RESTRICTED_ZONE', 'engine-left', T0);
  cooldown.record('RESTRICTED_ZONE', 'engine-left', T0);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0), true);
  assert.equal(cooldown.allow('RESTRICTED_ZONE', 'engine-left', T0 + 1), true);
  assert.throws(() => new IncidentCooldown(-1), RangeError);
});

test('buildEvent returns every field the UI consumes', () => {
  const event = sample();

  assert.deepEqual(Object.keys(event).sort(), [
    'acked_at',
    'acked_by',
    'camera_id',
    'confidence',
    'context',
    'detected_at',
    'duration_s',
    'escalated_at',
    'event_id',
    'model',
    'notified_at',
    'received_at',
    'report',
    'severity',
    'snapshot_url',
    'status',
    'track_id',
    'type',
    'zone_id',
  ]);

  assert.equal(event.event_id, 'evt_stand12_1793356933120_17');
  assert.equal(event.type, 'RESTRICTED_ZONE');
  assert.equal(event.severity, 'CRITICAL');
  assert.equal(event.status, 'open');
  assert.equal(event.camera_id, 'stand12');
  assert.equal(event.zone_id, 'engine-left');
  assert.equal(event.track_id, 17);
  assert.deepEqual(event.confidence, { detector: 0.91, temporal: { seen: 14, window: 15 } });
  assert.equal(event.duration_s, 1.4);
  assert.deepEqual(event.context, { engine_on: true });
  assert.equal(event.snapshot_url, 'blob:http://localhost:5173/9f1c-4d2a');
  assert.equal(event.model, 'yolo26n');
  assert.equal(event.detected_at, ISO_T0);
  assert.equal(event.detected_at, new Date(T0).toISOString());
  assert.equal(event.received_at, ISO_T0);
  assert.equal(event.notified_at, null);
  assert.equal(event.escalated_at, null);
  assert.equal(event.acked_at, null);
  assert.equal(event.acked_by, null);
  assert.equal(event.report, null);
});

test('buildEvent rounds duration_s to 3 decimals like the pipeline', () => {
  assert.equal(sample({ durationS: 1.23456 }).duration_s, 1.235);
  assert.equal(sample({ durationS: 1.4000000000000001 }).duration_s, 1.4);
  assert.equal(sample({ durationS: 0 }).duration_s, 0);
});

test('buildEvent rejects fields the backend would reject', () => {
  assert.throws(() => sample({ severity: 'RESOLVED' }), RangeError);
  assert.throws(() => sample({ type: 'CROWD' }), RangeError);
  assert.throws(() => sample({ trackId: -1 }), RangeError);
  assert.throws(() => sample({ confidence: { detector: 1.2, seen: 14, window: 15 } }), RangeError);
  assert.throws(() => sample({ confidence: { detector: 0.9, seen: 14, window: 0 } }), RangeError);
  assert.throws(() => sample({ snapshotUrl: 'minio://bucket/evt.jpg' }), RangeError);
  assert.throws(() => sample({ engineOn: 'true' }), TypeError);
});

// P0: the id's middle number is an identifier, not the detection time. Two zones that
// confirm the same track in one frame pass distinct `idMs` values and keep one real time.
test('idMs feeds event_id only, never detected_at or received_at', () => {
  const event = sample({ detectedAt: T0, receivedAt: T0 + 7, idMs: T0 + 1 });

  assert.equal(event.event_id, 'evt_stand12_1793356933121_17');
  assert.equal(event.detected_at, ISO_T0, 'the detection time is unchanged');
  assert.equal(event.received_at, new Date(T0 + 7).toISOString());
  assert.match(event.event_id, /^evt_[a-z0-9-]+_\d{13}_\d+$/);
});

test('two events for one track and frame get distinct ids through idMs', () => {
  const first = sample();
  const second = sample({ zoneId: 'engine-right', idMs: T0 + 1 });

  assert.notEqual(first.event_id, second.event_id);
  assert.equal(first.detected_at, second.detected_at);
  assert.equal(first.event_id, 'evt_stand12_1793356933120_17');
  assert.equal(second.event_id, 'evt_stand12_1793356933121_17');
});

test('without idMs the id keeps the contract formula from detectedAt', () => {
  assert.equal(sample().event_id, `evt_stand12_${T0}_17`);
  // An id millisecond still has to be a 13-digit epoch, like `eventId` demands.
  assert.throws(() => sample({ idMs: 0 }), RangeError);
  assert.throws(() => sample({ idMs: 'now' }), TypeError);
});

test('ack moves an open event to acknowledged and stops escalation', () => {
  const event = sample();
  const acked = applyAction(event, 'ack', { operator: 'Ana', now: T0 + 5_000 });

  assert.notEqual(acked, event);
  assert.equal(event.status, 'open');
  assert.equal(acked.status, 'acknowledged');
  assert.equal(acked.acked_at, '2026-10-30T10:42:18.120Z');
  assert.equal(acked.acked_by, 'Ana');
  assert.equal(acked.escalated_at, null);

  // The timer would have fired at received_at + 30 s; nothing escalates after the ack.
  assert.equal(escalateIfDue(acked, T0 + 31_000, 30), null);
});

test('escalateIfDue escalates at the threshold, never before it', () => {
  const event = sample();

  assert.equal(escalateIfDue(event, T0 + 29_999, 30), null);
  const escalated = escalateIfDue(event, T0 + 30_000, 30);

  assert.equal(event.status, 'open');
  assert.equal(escalated.status, 'escalated');
  assert.equal(escalated.escalated_at, '2026-10-30T10:42:43.120Z');
  assert.equal(escalated.acked_at, null);
  assert.equal(escalated.event_id, event.event_id);
});

test('escalateIfDue respects status, type and a missing threshold', () => {
  const event = sample();
  assert.equal(escalateIfDue({ ...event, status: 'acknowledged' }, T0 + 60_000, 30), null);
  assert.equal(escalateIfDue({ ...event, status: 'escalated' }, T0 + 60_000, 30), null);
  assert.equal(escalateIfDue({ ...event, status: 'resolved' }, T0 + 60_000, 30), null);
  // A dead camera cannot be confirmed by an operator, so it never escalates.
  assert.equal(escalateIfDue({ ...event, type: 'CAMERA_OFFLINE' }, T0 + 60_000, 30), null);
  // null is the zone's "no escalation" (escalate_after_s), 0 is not a valid threshold.
  assert.equal(escalateIfDue(event, T0 + 60_000, null), null);
  assert.equal(escalateIfDue(event, T0 + 60_000, undefined), null);
  assert.equal(escalateIfDue(event, T0 + 60_000, 0), null);
});

test('reopen resets to open and clears the ack and escalation stamps', () => {
  const escalated = escalateIfDue(sample(), T0 + 40_000, 30);
  const acked = applyAction(escalated, 'ack', { operator: 'Ana', now: T0 + 41_000 });
  const reopened = applyAction(acked, 'reopen', { operator: 'Ana', now: T0 + 50_000 });

  assert.equal(acked.status, 'acknowledged');
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.acked_at, null);
  assert.equal(reopened.acked_by, null);
  assert.equal(reopened.escalated_at, null);
  assert.equal(reopened.event_id, escalated.event_id);

  // Reopening restarts the timer from received_at, so an overdue event escalates at once.
  assert.equal(escalateIfDue(reopened, T0 + 50_000, 30).status, 'escalated');
  assert.equal(escalateIfDue(reopened, T0 + 29_000, 30), null);
});

test('markFalsePositive is a status, not a severity, and stops escalation', () => {
  const event = sample({ type: 'NO_PPE', severity: 'WARNING' });
  assert.equal(applyAction(event, 'markFalsePositive', { operator: 'Ana', now: T0 }).status, 'false_positive');
  assert.equal(applyAction(event, 'false_positive', { operator: 'Ana', now: T0 }).status, 'false_positive');

  const acked = applyAction(event, 'ack', { operator: 'Ana', now: T0 + 1_000 });
  assert.equal(applyAction(acked, 'markFalsePositive', { operator: 'Ana', now: T0 + 2_000 }).status, 'false_positive');
  assert.equal(escalateIfDue(acked, T0 + 60_000, 30), null);
});

test('actions the backend rejects with 409 throw and do not mutate the event', () => {
  const frozen = Object.freeze({
    ...sample(),
    status: 'resolved',
    confidence: Object.freeze({ detector: 0.9, temporal: Object.freeze({ seen: 14, window: 15 }) }),
  });

  assert.throws(() => applyAction(frozen, 'ack', { operator: 'Ana' }), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'conflict');
    assert.match(error.message, /cannot ack an event with status resolved/);
    return true;
  });
  assert.throws(() => applyAction(frozen, 'nope', { operator: 'Ana' }), RangeError);
  assert.throws(() => applyAction(sample(), 'ack', { operator: '' }), TypeError);

  // No state change: a frozen event would throw on write.
  assert.equal(frozen.status, 'resolved');
  assert.equal(frozen.escalated_at, null);
});
