import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ENGINE_MODEL, mergeEngineEvents } from './engineEventFeed.js';
import { applyEscalations } from './incidentState.js';

const cameras = [{ id: 'stand12', name: 'CAM-01 • Stand 12' }];
const zones = [{ zone_id: 'engine-left', id: 'engine-left', name: 'Zona motor stâng' }];
const buildReport = (event, names) => ({
  what: `Eveniment în ${names.zoneName}`,
  where: names.cameraName,
  source: 'template',
});

function engineEvent(overrides = {}) {
  return {
    event_id: 'evt_engine_1700000000000_1',
    type: 'RESTRICTED_ZONE',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    detected_at: '2026-11-02T09:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

test('a new engine event is prepended, marked local and given a template report', () => {
  const existing = { event_id: 'evt_backend' };
  const next = mergeEngineEvents([existing], [engineEvent()], { cameras, zones, buildReport });
  assert.equal(next.length, 2);
  assert.equal(next[0].event_id, 'evt_engine_1700000000000_1');
  assert.equal(next[0].local, true);
  assert.equal(next[0].status, 'open');
  assert.equal(next[0].model, DEFAULT_ENGINE_MODEL);
  assert.deepEqual(next[0].report, {
    what: 'Eveniment în Zona motor stâng',
    where: 'CAM-01 • Stand 12',
    source: 'template',
  });
  assert.equal(next[1], existing);
});

test('a known event id is not added twice', () => {
  const events = [engineEvent()];
  assert.equal(mergeEngineEvents(events, [engineEvent()], { buildReport }), events);
});

test('a re-render with the same batch is idempotent', () => {
  const batch = [engineEvent()];
  const once = mergeEngineEvents([], batch, { cameras, zones, buildReport });
  const twice = mergeEngineEvents(once, batch, { cameras, zones, buildReport });
  assert.equal(twice.length, 1);
  assert.equal(twice[0].event_id, 'evt_engine_1700000000000_1');
});

test('a report the event already carries is kept', () => {
  const report = { what: 'deja scris', source: 'llm' };
  const [merged] = mergeEngineEvents([], [engineEvent({ report })], { buildReport });
  assert.equal(merged.report, report);
});

test('the engine model is kept when set, defaulted otherwise', () => {
  const [merged] = mergeEngineEvents([], [engineEvent({ model: 'efficientdet-lite2' })], { buildReport });
  assert.equal(merged.model, 'efficientdet-lite2');
});

test('a zone can be matched by id or zone_id', () => {
  const byId = mergeEngineEvents([], [engineEvent()], {
    zones: [{ id: 'engine-left', name: 'după id' }],
    buildReport,
  });
  const byZoneId = mergeEngineEvents([], [engineEvent()], {
    zones: [{ zone_id: 'engine-left', name: 'după zone_id' }],
    buildReport,
  });
  assert.equal(byId[0].report.what, 'Eveniment în după id');
  assert.equal(byZoneId[0].report.what, 'Eveniment în după zone_id');
});

test('an unknown camera or zone falls back to the ids in the report', () => {
  const [merged] = mergeEngineEvents([], [engineEvent()], {
    buildReport: (event) => ({ what: event.camera_id, where: event.zone_id }),
  });
  assert.deepEqual(merged.report, { what: 'stand12', where: 'engine-left' });
});

test('without a report builder the field stays empty instead of invented', () => {
  const [merged] = mergeEngineEvents([], [engineEvent()]);
  assert.equal(merged.report, null);
});

test('invalid batches keep the list reference', () => {
  const events = [{ event_id: 'evt_backend' }];
  assert.equal(mergeEngineEvents(events, []), events);
  assert.equal(mergeEngineEvents(events, null), events);
  assert.equal(mergeEngineEvents(events, undefined), events);
  assert.equal(mergeEngineEvents(events, [null, { event_id: 42 }]), events);
});

test('the list keeps the feed limit', () => {
  const events = Array.from({ length: 200 }, (_, index) => ({ event_id: `evt_${index}` }));
  const next = mergeEngineEvents(events, [engineEvent()], { buildReport });
  assert.equal(next.length, 200);
  assert.equal(next[0].event_id, 'evt_engine_1700000000000_1');
  assert.equal(next[199].event_id, 'evt_198');
});

// P1: the engine writes detection fields only, but `applyEscalations` needs the zone's
// timer; without it an engine incident never escalates while a fixture one does.
test('an engine event takes escalate_after_s from its zone', () => {
  const zonesWithTimer = [
    { zone_id: 'engine-left', name: 'Zona motor stâng', escalate_after_s: 30 },
  ];
  const [merged] = mergeEngineEvents([], [engineEvent()], { zones: zonesWithTimer, buildReport });

  assert.equal(merged.escalate_after_s, 30);
});

test('an escalate_after_s the event already carries wins over the zone', () => {
  const zonesWithTimer = [{ zone_id: 'engine-left', escalate_after_s: 30 }];
  const [merged] = mergeEngineEvents([], [engineEvent({ escalate_after_s: 120 })], {
    zones: zonesWithTimer,
    buildReport,
  });

  assert.equal(merged.escalate_after_s, 120);
});

test('a zone without a timer or an unknown zone leaves null, not undefined', () => {
  const [noTimer] = mergeEngineEvents([], [engineEvent()], {
    zones: [{ zone_id: 'engine-left', escalate_after_s: null }],
    buildReport,
  });
  const [unknownZone] = mergeEngineEvents([], [engineEvent()], { buildReport });

  assert.equal(noTimer.escalate_after_s, null);
  assert.equal(unknownZone.escalate_after_s, null);
});

test('an engine incident escalates once the zone timer elapses', () => {
  const zonesWithTimer = [{ zone_id: 'engine-left', escalate_after_s: 30 }];
  const [merged] = mergeEngineEvents([], [engineEvent()], { zones: zonesWithTimer, buildReport });
  const detected = Date.parse(merged.detected_at);

  // The same function the mock tick runs on the shared list.
  assert.equal(applyEscalations([merged], detected + 29_999)[0].status, 'open');
  const escalated = applyEscalations([merged], detected + 30_000)[0];
  assert.equal(escalated.status, 'escalated');
  assert.equal(escalated.escalated_at, new Date(detected + 30_000).toISOString());
});

// The store keeps both rows: two overlapping zones on one track are two incidents, and each
// is acknowledged by its own id (review P0-1, the reason ids had to be unique per frame).
test('two zones for one track stay two incidents with distinct ids', () => {
  const batch = [
    engineEvent({
      event_id: 'evt_stand12_1793356933120_1',
      zone_id: 'engine-left',
    }),
    engineEvent({
      event_id: 'evt_stand12_1793356933121_1',
      zone_id: 'engine-right',
    }),
  ];
  const merged = mergeEngineEvents([], batch, {
    zones: [
      { zone_id: 'engine-left', name: 'Motor stâng', escalate_after_s: 30 },
      { zone_id: 'engine-right', name: 'Motor dreapta', escalate_after_s: 30 },
    ],
    buildReport,
  });

  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((event) => event.event_id)).size, 2);
  assert.deepEqual(merged.map((event) => event.zone_id), ['engine-left', 'engine-right']);
  assert.deepEqual(merged.map((event) => event.escalate_after_s), [30, 30]);
});
