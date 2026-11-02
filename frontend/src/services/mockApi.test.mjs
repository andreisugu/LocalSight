import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_EVENTS } from '../data/incidents.js';
import { INITIAL_KPIS } from '../data/kpis.js';
import { INITIAL_SHIFT_REPORT } from '../data/report.js';
import { mockApi } from './mockApi.js';

const STAND12 = 'evt_stand12_1700000000000_17';
const ACKNOWLEDGED = 'evt_stand12_1700000180000_12';
const ESCALATED = 'evt_taxiway-b_1700000060000_23';

test('health and cameras answer from the fixtures', async () => {
  assert.deepEqual(await mockApi.getHealth(), {
    status: 'ok',
    db: true,
    edge_last_seen_s: 0,
    mock: true,
  });

  const cameras = await mockApi.getCameras();
  assert.equal(cameras.length, 4);
  assert.equal(cameras[0].id, 'stand12');
});

test('the engine switch echoes the requested state', async () => {
  assert.deepEqual(await mockApi.setEngineState('stand12', false), {
    id: 'stand12',
    camera_id: 'stand12',
    engine_on: false,
    status: 'online',
  });
  assert.equal((await mockApi.setEngineState('stand12', true)).engine_on, true);
});

test('the incident list filters like the backend query', async () => {
  assert.equal((await mockApi.getEvents()).length, 8);
  assert.equal((await mockApi.getEvents({ status: 'open' })).length, 2);
  assert.equal((await mockApi.getEvents({ status: 'escalated' })).length, 2);
  assert.equal((await mockApi.getEvents({ severity: 'CRITICAL' })).length, 4);
  assert.equal((await mockApi.getEvents({ camera_id: 'stand12' })).length, 4);
  assert.equal((await mockApi.getEvents({ status: 'all', severity: 'all' })).length, 8);
});

test('an incident is found by its stable id', async () => {
  assert.equal((await mockApi.getEventById(STAND12)).status, 'open');
  assert.equal(await mockApi.getEventById('evt_missing_1700000000000_1'), null);
});

test('acknowledging returns the incident after the transition', async () => {
  const updated = await mockApi.acknowledgeEvent(STAND12, 'ariana');

  assert.equal(updated.event_id, STAND12);
  assert.equal(updated.status, 'acknowledged');
  // A legacy operator id migrates to today's role before it reaches the audit log.
  assert.equal(updated.acked_by, 'Dispecer');
  assert.ok(Date.parse(updated.acked_at) > 0);
  // The mock is stateless: the fixture list is the seed, not a mutable store.
  assert.equal((await mockApi.getEventById(STAND12)).status, 'open');
  assert.equal(INITIAL_EVENTS.find((event) => event.event_id === STAND12).status, 'open');
});

test('acknowledging an unknown id still answers the minimal shape', async () => {
  assert.deepEqual(await mockApi.acknowledgeEvent('evt_missing', ''), {
    event_id: 'evt_missing',
    status: 'acknowledged',
    acked_by: 'Operator',
  });
});

test('false positive carries the note back to the caller', async () => {
  const updated = await mockApi.markFalsePositive(STAND12, 'Dispecer', 'Umbră pe asfalt');
  assert.equal(updated.status, 'false_positive');
  assert.equal(updated.note, 'Umbră pe asfalt');

  assert.deepEqual(await mockApi.markFalsePositive('evt_missing', 'Dispecer', 'x'), {
    event_id: 'evt_missing',
    status: 'false_positive',
    note: 'x',
  });
});

test('reopening clears the confirmation fields', async () => {
  const updated = await mockApi.reopenEvent(ACKNOWLEDGED);
  assert.equal(updated.status, 'open');
  assert.equal(updated.acked_at, null);
  assert.equal(updated.acked_by, null);
  assert.equal(updated.escalated_at, null);
  assert.equal((await mockApi.reopenEvent('evt_missing')).status, 'open');
});

test('regenerating a report keeps the written content', async () => {
  const result = await mockApi.regenerateReport(STAND12);
  assert.equal(result.event_id, STAND12);
  assert.equal(result.report.source, 'llm');
  assert.equal(result.report.what, INITIAL_EVENTS[0].report.what);

  const fallback = await mockApi.regenerateReport('evt_missing');
  assert.equal(fallback.event_id, 'evt_missing');
  assert.equal(fallback.report.source, 'llm');
  assert.ok(fallback.report.what.length > 0);
});

test('zones are listed per camera and saved without a backend', async () => {
  assert.equal((await mockApi.getZones()).length, 5);
  assert.deepEqual(
    (await mockApi.getZones('stand12')).map((zone) => zone.zone_id),
    ['engine-left', 'apron-stand12']
  );

  const draft = { name: 'Nouă', camera_id: 'stand12', polygon: [{ x: 0.1, y: 0.2 }] };
  assert.deepEqual(await mockApi.saveZone('zona-noua', draft), {
    ...draft,
    zone_id: 'zona-noua',
    saved: true,
  });
  assert.equal(await mockApi.deleteZone('zona-noua'), true);
});

test('reference-frame calls keep their mock shapes', async () => {
  assert.equal((await mockApi.captureReferenceFrame('engine-left')).zone_id, 'engine-left');
  assert.deepEqual(await mockApi.captureReferenceFromLive('engine-left'), {
    zone_id: 'engine-left',
    reference_frame: null,
  });
  assert.deepEqual(await mockApi.deleteReferenceFrame('engine-left'), {
    zone_id: 'engine-left',
    reference_frame: null,
  });
});

test('KPI and report snapshots are copies of the fixtures', async () => {
  const kpis = await mockApi.getKPIs();
  assert.deepEqual(kpis, INITIAL_KPIS);
  assert.notEqual(kpis, INITIAL_KPIS);

  const report = await mockApi.getShiftReport();
  assert.deepEqual(report, INITIAL_SHIFT_REPORT);

  // Escalated incidents are the ones the second KPI tile counts.
  assert.equal((await mockApi.getEventById(ESCALATED)).status, 'escalated');
});

test('the mock socket is a no-op unsubscribe', () => {
  const unsubscribe = mockApi.connectEventsSocket(() => {});
  assert.equal(typeof unsubscribe, 'function');
  assert.equal(unsubscribe(), undefined);
});
