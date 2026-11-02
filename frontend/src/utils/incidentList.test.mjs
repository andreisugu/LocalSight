import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_FILTERS,
  countByStatus,
  filterIncidents,
  summaryLine,
} from './incidentList.js';

const events = [
  { event_id: 'evt_a_1', type: 'RESTRICTED_ZONE', status: 'open', camera_id: 'cam1', zone_id: 'z1', detected_at: '2026-11-02T10:00:00Z', report: { what: 'Persoană în zona motorului' } },
  { event_id: 'evt_b_2', type: 'NO_PPE', status: 'acknowledged', camera_id: 'cam2', zone_id: 'z2', detected_at: '2026-11-02T11:00:00Z', acked_by: 'Dispecer' },
  { event_id: 'evt_c_3', type: 'RESTRICTED_ZONE', status: 'escalated', camera_id: 'cam1', zone_id: 'z3', detected_at: '2026-11-02T12:00:00Z' },
  { event_id: 'evt_d_4', type: 'SMOKING', status: 'false_positive', camera_id: 'cam3', zone_id: 'z4', detected_at: 'not-a-date' },
];

const labels = { RESTRICTED_ZONE: 'Zonă restricționată', NO_PPE: 'Echipament lipsă', SMOKING: 'Fumat' };

test('the four status tabs count what they claim', () => {
  const counts = countByStatus(events);
  assert.equal(counts.all, 4);
  assert.equal(counts.active, 2);
  assert.equal(counts.closed, 1);
  assert.equal(counts.false_positive, 1);
  assert.deepEqual(STATUS_FILTERS.map((f) => f.label), ['Toate', 'Active', 'Rezolvate', 'Fals pozitiv']);
});

test('the active tab keeps open and escalated only', () => {
  const rows = filterIncidents(events, { status: 'active' });
  assert.deepEqual(rows.map((e) => e.event_id), ['evt_c_3', 'evt_a_1']);
});

test('search covers id, type, label, camera, zone, report and operator', () => {
  assert.equal(filterIncidents(events, { query: 'evt_b_2' }).length, 1);
  assert.equal(filterIncidents(events, { query: 'echipament', typeLabels: labels }).length, 1);
  assert.equal(filterIncidents(events, { query: 'zona motorului' }).length, 1);
  assert.equal(filterIncidents(events, { query: 'dispecer' }).length, 1);
  assert.equal(filterIncidents(events, { query: 'CAM1' }).length, 2);
  assert.equal(filterIncidents(events, { query: '  ' }).length, 4);
});

test('status and search compose, and the result is newest first', () => {
  const rows = filterIncidents(events, { status: 'all', query: 'cam1', typeLabels: labels });
  assert.deepEqual(rows.map((e) => e.event_id), ['evt_c_3', 'evt_a_1']);
});

test('an unknown filter falls back to all', () => {
  assert.equal(filterIncidents(events, { status: 'nope' }).length, 4);
});

test('the input array is not mutated', () => {
  const copy = [...events];
  filterIncidents(events, { status: 'all' });
  assert.deepEqual(events, copy);
});

test('the summary line carries camera, zone and operator', () => {
  assert.equal(
    summaryLine(events[1], (id) => (id === 'cam2' ? 'CAM-02' : id)),
    'CAM-02 · z2 · confirmat de Dispecer'
  );
});
