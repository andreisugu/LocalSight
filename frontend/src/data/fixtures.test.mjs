import test from 'node:test';
import assert from 'node:assert/strict';
import * as barrel from '../constants/mockData.js';
import { INITIAL_CAMERAS } from './cameras.js';
import { EVENT_ID_PATTERN } from './eventIds.js';
import { INITIAL_EVENTS } from './incidents.js';
import { DEMO_REFERENCE_FRAMES, DEMO_STILLS } from './media.js';
import { AVAILABLE_OPERATORS, migrateOperator, resolveOperatorName } from './operators.js';
import { OPERATIONAL_DATE, OPERATIONAL_SHIFT_ID } from './shift.js';
import { INITIAL_ZONES } from './zones.js';

const countBy = (list, predicate) => list.filter(predicate).length;

test('the barrel still exports every fixture a screen imports', () => {
  assert.deepEqual(Object.keys(barrel).sort(), [
    'AVAILABLE_OPERATORS',
    'DEMO_REFERENCE_FRAMES',
    'DEMO_STILLS',
    'INITIAL_CAMERAS',
    'INITIAL_EVENTS',
    'INITIAL_KPIS',
    'INITIAL_SHIFT_REPORT',
    'INITIAL_ZONES',
    'OPERATIONAL_DATE',
    'OPERATIONAL_SHIFT_ID',
  ]);
});

test('four cameras, three of them airport feeds', () => {
  assert.deepEqual(
    INITIAL_CAMERAS.map((camera) => camera.id),
    ['stand12', 'taxiway-b', 'baggage-area', 'webcam-live']
  );
  assert.deepEqual(
    INITIAL_CAMERAS.map((camera) => camera.code),
    ['CAM-01', 'CAM-02', 'CAM-03', 'CAM-LOCAL']
  );
  assert.equal(INITIAL_CAMERAS[0].engine_on, true);
  assert.equal(INITIAL_CAMERAS[3].rtsp_url, null);
  assert.ok(INITIAL_CAMERAS[0].boxes.length > 0);
  assert.ok(INITIAL_CAMERAS.every((camera) => camera.status === 'online'));
});

test('the dataset is a shift, not a snapshot: 8 incidents with the same mix', () => {
  assert.equal(INITIAL_EVENTS.length, 8);
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.status === 'open'), 2);
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.status === 'escalated'), 2);
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.status === 'acknowledged'), 3);
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.status === 'resolved'), 1);
  // What the "open incidents" tile and filter count: open + escalated.
  assert.equal(
    countBy(INITIAL_EVENTS, (event) => event.status === 'open' || event.status === 'escalated'),
    4
  );
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.severity === 'CRITICAL'), 4);
  assert.equal(countBy(INITIAL_EVENTS, (event) => event.severity === 'WARNING'), 4);
});

test('the ids the deep links use are pinned', () => {
  assert.deepEqual(
    INITIAL_EVENTS.map((event) => event.event_id),
    [
      'evt_stand12_1700000000000_17',
      'evt_taxiway-b_1700000060000_23',
      'evt_baggage-area_1700000120000_41',
      'evt_stand12_1700000180000_12',
      'evt_taxiway-b_1700000240000_28',
      'evt_stand12_1700000300000_9',
      'evt_baggage-area_1700000360000_55',
      'evt_stand12_1700000420000_14',
    ]
  );
  for (const event of INITIAL_EVENTS) assert.match(event.event_id, EVENT_ID_PATTERN);
});

test('incident timestamps are relative to the page load, ids are not', () => {
  const now = Date.now();
  const oldest = Date.parse(INITIAL_EVENTS[INITIAL_EVENTS.length - 1].detected_at);
  const newest = Date.parse(INITIAL_EVENTS[0].detected_at);

  assert.ok(newest <= now, 'the newest incident is in the past');
  assert.ok(now - newest <= 60_000, 'the newest incident is less than a minute old');
  assert.ok(now - oldest <= 169 * 60_000, 'the oldest stays inside the capped shift window');

  for (const event of INITIAL_EVENTS) {
    assert.ok(Date.parse(event.detected_at) <= Date.parse(event.received_at ?? event.detected_at));
    assert.ok(Date.parse(event.received_at) < Date.parse(event.notified_at));
    assert.equal(typeof event.context.engine_on, 'boolean');
    assert.equal(typeof event.confidence.detector, 'number');
    assert.equal(event.confidence.temporal.window, 15);
    assert.match(event.report.when, /^\d{2}:\d{2}:\d{2}, timp în zonă [\d,]+ s\.$/);
    assert.equal(event.report.source, 'llm');
  }
});

test('statuses carry exactly the timestamps the contract defines', () => {
  for (const event of INITIAL_EVENTS) {
    if (event.status === 'escalated') assert.ok(event.escalated_at, event.event_id);
    if (event.acked_at) {
      assert.ok(event.acked_by, event.event_id);
      assert.ok(Date.parse(event.acked_at) > Date.parse(event.detected_at));
    } else {
      assert.equal(event.acked_by, null);
    }
  }
});

test('snapshots come from the app, never a third-party host', () => {
  for (const event of INITIAL_EVENTS) {
    assert.equal(event.snapshot_url, DEMO_STILLS[event.camera_id]);
    assert.ok(!/^https?:/.test(event.snapshot_url));
  }
  assert.equal(Object.keys(DEMO_STILLS).length, 3);
  assert.equal(Object.keys(DEMO_REFERENCE_FRAMES).length, 3);
});

test('five zones, each drawable on its own camera', () => {
  assert.deepEqual(
    INITIAL_ZONES.map((zone) => zone.zone_id),
    ['engine-left', 'apron-stand12', 'taxiway-b', 'baggage-area', 'webcam-view']
  );
  for (const zone of INITIAL_ZONES) {
    assert.ok(zone.polygon.length >= 4, zone.zone_id);
    assert.ok(zone.polygon.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
    assert.equal(zone.notify_channel, 'slack');
    assert.ok(Array.isArray(zone.required_ppe));
  }
  assert.equal(INITIAL_ZONES.find((zone) => zone.zone_id === 'engine-left').active_when, 'engine_on');
  assert.equal(INITIAL_ZONES.find((zone) => zone.zone_id === 'baggage-area').escalate_after_s, null);
});

test('operators are roles and legacy ids migrate onto them', () => {
  assert.deepEqual(
    AVAILABLE_OPERATORS.map((operator) => operator.id),
    ['dispatcher', 'shift-lead', 'inspector']
  );
  assert.equal(migrateOperator('ariana').id, 'dispatcher');
  assert.equal(migrateOperator('Mihai D.').id, 'shift-lead');
  assert.equal(migrateOperator('Inspector').id, 'inspector');
  assert.equal(migrateOperator('cineva'), null);
  assert.equal(migrateOperator(''), null);
  assert.equal(resolveOperatorName(''), 'Operator');
  assert.equal(resolveOperatorName('  Ana  '), 'Ana');
  assert.equal(resolveOperatorName('radu'), 'Inspector');
});

test('the operational date and shift come from the same clock reading', () => {
  assert.match(OPERATIONAL_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(['shift_1', 'shift_2', 'shift_3'].includes(OPERATIONAL_SHIFT_ID));
});
