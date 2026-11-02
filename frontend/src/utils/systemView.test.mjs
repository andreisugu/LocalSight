import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_LIMIT,
  buildAuditRows,
  buildCameraRows,
  buildSystemTiles,
  countCameraSources,
  formatAuditTime,
  latestDetectionModel,
  sourceSummary,
} from './systemView.js';
import { ENGINE_SETTINGS_KEY, readEngineSettings, storeDetector } from '../utils/engineSettings.js';

const cameras = [
  { id: 'stand12', code: 'CAM-01', name: 'CAM-01 • Stand 12', rtsp_url: 'rtsp://edge/stand12', status: 'online', engine_on: true },
  { id: 'taxiway-b', code: 'CAM-02', name: 'CAM-02 • Taxiway B', rtsp_url: 'rtsp://edge/taxiway-b', status: 'online', engine_on: false },
  { id: 'baggage-area', code: 'CAM-03', name: 'CAM-03 • Bagaje', rtsp_url: 'rtsp://edge/baggage', status: 'offline', engine_on: false },
  { id: 'webcam-live', code: 'CAM-LOCAL', name: 'CAM-LOCAL • Cameră browser', rtsp_url: null, status: 'online', engine_on: false },
];

const zones = [
  { zone_id: 'engine-left', camera_id: 'stand12' },
  { zone_id: 'apron', camera_id: 'stand12' },
  { zone_id: 'view', camera_id: 'webcam-live' },
];

const labels = {
  RESTRICTED_ZONE: 'Zonă restricționată',
  NO_PPE: 'Echipament lipsă',
  SMOKING: 'Fumat',
};

const events = [
  {
    event_id: 'evt_old',
    type: 'RESTRICTED_ZONE',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    track_id: 17,
    model: 'person-ppe-v1',
    detected_at: '2026-11-02T08:00:00Z',
    notified_at: '2026-11-02T08:00:30Z',
    escalated_at: '2026-11-02T08:03:00Z',
    acked_at: '2026-11-02T08:04:00Z',
    acked_by: 'Dispecer',
    status: 'acknowledged',
  },
  {
    event_id: 'evt_new',
    type: 'NO_PPE',
    camera_id: 'baggage-area',
    zone_id: 'baggage-area',
    track_id: 41,
    model: 'person-ppe-v2',
    detected_at: '2026-11-02T09:00:00Z',
    notified_at: '2026-11-02T09:00:10Z',
    acked_at: '2026-11-02T09:02:00Z',
    acked_by: 'Șef tură',
    status: 'false_positive',
  },
  {
    event_id: 'evt_resolved',
    type: 'SMOKING',
    camera_id: 'taxiway-b',
    zone_id: 'taxiway-b',
    detected_at: '2026-11-02T07:00:00Z',
    acked_at: '2026-11-02T07:01:00Z',
    status: 'resolved',
  },
];

test('camera sources are separated by the RTSP URL they do or do not carry', () => {
  const counts = countCameraSources(cameras);
  assert.deepEqual(counts, { total: 4, clips: 3, local: 1 });
  assert.deepEqual(countCameraSources([]), { total: 0, clips: 0, local: 0 });
});

test('the source sentence is demo-specific only in the static build', () => {
  assert.deepEqual(sourceSummary(cameras, { isMock: true }), {
    total: 4,
    clips: 3,
    local: 1,
    value: '4 surse',
    detail: '3 clipuri demo + 1 cameră locală; date demo',
  });
  assert.equal(sourceSummary(cameras, { isMock: false }).detail, '3 fluxuri de rețea + 1 cameră locală');
  assert.equal(sourceSummary(cameras.slice(0, 1), { isMock: true }).detail, '1 clip demo; date demo');
  assert.equal(sourceSummary([], { isMock: true }).value, '0 surse');
  assert.equal(sourceSummary([], { isMock: true }).detail, 'nicio sursă configurată; date demo');
});

test('the mock summary has four honest cells and never a backend claim', () => {
  const tiles = buildSystemTiles({ isMock: true, cameras, zones, health: { mock: true } });
  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map((tile) => tile.id), ['build', 'engine', 'model', 'cameras']);
  assert.equal(tiles[0].value, 'STATIC');
  assert.match(tiles[1].detail, /WASM pe Firefox, WebGPU pe Chrome compatibil/);
  assert.equal(tiles[2].value, 'EfficientDet-Lite0 + YuNet');
  assert.equal(tiles[3].value, '4 surse');
  assert.match(tiles[3].detail, /3 clipuri demo \+ 1 cameră locală; date demo/);

  const text = JSON.stringify(tiles);
  for (const forbidden of ['Backend online', 'Baza de date răspunde', 'Edge AI', 'Ultimul semnal', 'YOLO', 'ByteTrack', 'ACTIV', 'ONLINE']) {
    assert.equal(text.includes(forbidden), false, `mock tiles must not say "${forbidden}"`);
  }
});

test('the model tile follows the stored detector without a reload', () => {
  const lite2 = buildSystemTiles({ isMock: true, cameras, zones, detector: 'efficientdet-lite2' });
  assert.equal(lite2[2].value, 'EfficientDet-Lite2 + YuNet');
  assert.match(lite2[2].detail, /Apache-2\.0 \+ MIT/);

  const unknown = buildSystemTiles({ isMock: true, cameras, zones, detector: 'yolo' });
  assert.equal(unknown[2].value, 'EfficientDet-Lite0 + YuNet');

  // The stored Settings value is what the caller passes; a change is visible immediately.
  const storage = {
    data: { [ENGINE_SETTINGS_KEY]: JSON.stringify({ detector: 'efficientdet-lite2' }) },
    getItem(key) { return key in this.data ? this.data[key] : null; },
    setItem(key, value) { this.data[key] = String(value); },
  };
  const stored = readEngineSettings(storage).detector;
  assert.equal(buildSystemTiles({ isMock: true, cameras, zones, detector: stored })[2].value, 'EfficientDet-Lite2 + YuNet');
  storeDetector('efficientdet', storage);
  assert.equal(
    buildSystemTiles({ isMock: true, cameras, zones, detector: readEngineSettings(storage).detector })[2].value,
    'EfficientDet-Lite0 + YuNet',
  );
});

test('the backend branch keeps the backend and edge cells', () => {
  const tiles = buildSystemTiles({
    isMock: false,
    health: { db: true, edge_last_seen_s: 5 },
    cameras,
    zones,
    latestModel: 'person-ppe-v1',
  });
  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map((tile) => tile.id), ['backend', 'edge', 'model', 'cameras']);
  assert.equal(tiles[0].value, 'ONLINE');
  assert.equal(tiles[0].detail, 'Baza de date răspunde');
  assert.equal(tiles[1].value, 'ACTIV');
  assert.equal(tiles[1].detail, 'Ultimul semnal acum 5 s');
  assert.equal(tiles[2].value, 'person-ppe-v1');
  // Two of the four fixture cameras are online: the cell must not round that up.
  assert.equal(tiles[3].value, '3 / 4 online');
  assert.equal(tiles[3].detail, '3 zone configurate');
});

test('a missing edge signal and a late edge are reported, never assumed healthy', () => {
  const missing = buildSystemTiles({ isMock: false, health: { db: false, edge_last_seen_s: null }, cameras, zones });
  assert.equal(missing[0].value, 'OFFLINE');
  assert.equal(missing[1].value, 'FĂRĂ DATE');
  assert.equal(missing[1].detail, 'Niciun semnal de la edge');

  const late = buildSystemTiles({ isMock: false, health: { db: true, edge_last_seen_s: 90 }, cameras, zones });
  assert.equal(late[1].value, 'ÎNTÂRZAT');
  assert.equal(late[1].detail, 'Ultimul semnal acum 90 s');
});

test('camera rows say DEMO in the static build, never ONLINE', () => {
  const rows = buildCameraRows(cameras, { isMock: true, zones });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.statusLabel), ['DEMO', 'DEMO', 'DEMO', 'DEMO']);
  assert.deepEqual(rows.map((row) => row.sourceLabel), ['Clip demo', 'Clip demo', 'Clip demo', 'Cameră locală']);
  assert.deepEqual(rows.map((row) => row.zoneCount), [2, 0, 0, 1]);
  assert.equal(rows[0].engineLabel, 'pornit');
  assert.equal(rows[1].engineLabel, 'oprit');
  assert.equal(JSON.stringify(rows).includes('ONLINE'), false);
});

test('camera rows keep real statuses outside the static build', () => {
  const rows = buildCameraRows(cameras, { isMock: false, zones });
  assert.deepEqual(rows.map((row) => row.statusLabel), ['ONLINE', 'ONLINE', 'OFFLINE', 'ONLINE']);
  assert.deepEqual(rows.map((row) => row.statusTone), ['ok', 'ok', 'bad', 'ok']);
  assert.equal(rows[0].sourceLabel, 'Flux de rețea');
  assert.equal(rows[3].sourceLabel, 'Cameră locală');
});

test('the audit trail flattens every step, newest first', () => {
  const rows = buildAuditRows(events, { typeLabels: labels });
  assert.deepEqual(
    rows.map((row) => [row.eventId, row.actor]),
    [
      ['evt_new', 'Operator'],
      ['evt_new', 'Notificare'],
      ['evt_new', 'Edge'],
      ['evt_old', 'Operator'],
      ['evt_old', 'Escaladare'],
      ['evt_old', 'Notificare'],
      ['evt_old', 'Edge'],
      ['evt_resolved', 'Operator'],
      ['evt_resolved', 'Edge'],
    ]
  );
  assert.equal(rows[0].action, 'Marcat fals pozitiv de Șef tură: Echipament lipsă · baggage-area/baggage-area');
  assert.equal(rows[7].action, 'Rezolvat: Fumat · taxiway-b/taxiway-b');
});

test('the mock audit is worded as demo, the live audit as something that happened', () => {
  const mockRows = buildAuditRows(events, { typeLabels: labels, isMock: true });
  const mockText = JSON.stringify(mockRows);
  assert.match(mockRows.find((row) => row.actor === 'Notificare').action, /^Alertă Slack demo:/);
  assert.match(mockRows.find((row) => row.actor === 'Escaladare').action, /^Escaladare demo:/);
  assert.equal(mockText.includes('trimisă'), false);
  const mockDetection = mockRows.find((row) => row.eventId === 'evt_old' && row.actor === 'Detecție');
  assert.equal(mockDetection.actor, 'Detecție');
  assert.equal(mockDetection.action, 'Zonă restricționată · stand12/engine-left (track #17)');

  const liveRows = buildAuditRows(events, { typeLabels: labels, isMock: false });
  assert.match(liveRows.find((row) => row.actor === 'Notificare').action, /^Alertă Slack trimisă:/);
  assert.match(liveRows.find((row) => row.actor === 'Escaladare').action, /^Neconfirmat la timp:/);
  assert.equal(liveRows.find((row) => row.actor === 'Edge').actor, 'Edge');
  assert.match(liveRows.find((row) => row.actor === 'Edge').action, /^Detecție /);
});

test('a row without a timestamp is skipped, not rendered as an empty step', () => {
  const rows = buildAuditRows([{ event_id: 'evt_x', type: 'RESTRICTED_ZONE', camera_id: 'cam', zone_id: 'z', detected_at: null }]);
  assert.deepEqual(rows, []);
});

test('the audit is capped at the documented limit, keeping the newest rows', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    event_id: `evt_${index}`,
    type: 'RESTRICTED_ZONE',
    camera_id: 'cam',
    zone_id: 'z',
    track_id: index,
    detected_at: `2026-11-02T08:${String(index).padStart(2, '0')}:00Z`,
    notified_at: `2026-11-02T08:${String(index).padStart(2, '0')}:30Z`,
  }));
  const rows = buildAuditRows(many, { typeLabels: labels });
  assert.equal(rows.length, AUDIT_LIMIT);
  assert.equal(rows[0].eventId, 'evt_39');
  assert.equal(buildAuditRows(many, { typeLabels: labels, limit: 3 }).length, 3);
});

test('audit timestamps are formatted once, and bad input is a dash', () => {
  assert.match(formatAuditTime('2026-11-02T08:00:00Z'), /^\d{2}\.\d{2}, \d{2}:\d{2}:\d{2}$/);
  assert.equal(formatAuditTime(null), '—');
  assert.equal(formatAuditTime('not-a-date'), '—');
});

test('the latest model comes from the newest event and is null when there is none', () => {
  assert.equal(latestDetectionModel(events), 'person-ppe-v2');
  assert.equal(latestDetectionModel([]), null);
  assert.equal(latestDetectionModel([{ detected_at: '2026-11-02T08:00:00Z' }]), null);
  assert.equal(latestDetectionModel([{ detected_at: '2026-11-02T08:00:00Z', model: 'only-one' }]), 'only-one');
});
