import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterEvents,
  matchesEventFilters,
  selectCamera,
  selectCameraZones,
  selectEvent,
  selectZone,
  selectZoneName,
} from './selectors.js';

const cameras = [
  { id: 'stand12', name: 'CAM-01' },
  { id: 'taxiway-b', name: 'CAM-02' },
];

const zones = [
  { zone_id: 'engine-left', camera_id: 'stand12', name: 'Stand 12 — motor stâng' },
  { zone_id: 'apron-stand12', camera_id: 'stand12', name: 'Platformă Stand 12' },
  { zone_id: 'taxiway-b', camera_id: 'taxiway-b', name: 'Taxiway B' },
];

const events = [
  { event_id: 'evt_a', status: 'open', severity: 'CRITICAL', camera_id: 'stand12' },
  { event_id: 'evt_b', status: 'escalated', severity: 'CRITICAL', camera_id: 'taxiway-b' },
  { event_id: 'evt_c', status: 'acknowledged', severity: 'WARNING', camera_id: 'stand12' },
];

test('camera and zone selectors return the fixture or null', () => {
  assert.equal(selectCamera(cameras, 'taxiway-b').name, 'CAM-02');
  assert.equal(selectCamera(cameras, 'nope'), null);
  assert.equal(selectCamera(cameras, undefined), null);
  assert.equal(selectCamera(undefined, 'stand12'), null);

  assert.equal(selectZone(zones, 'engine-left').camera_id, 'stand12');
  assert.equal(selectZone(zones, 'nope'), null);
});

test('a zone name falls back to the id the event already carries', () => {
  assert.equal(selectZoneName(zones, 'apron-stand12'), 'Platformă Stand 12');
  assert.equal(selectZoneName(zones, 'deleted-zone'), 'deleted-zone');
});

test('zones of a camera, or every zone when none is selected', () => {
  assert.deepEqual(
    selectCameraZones(zones, 'stand12').map((zone) => zone.zone_id),
    ['engine-left', 'apron-stand12']
  );
  assert.equal(selectCameraZones(zones, 'taxiway-b').length, 1);
  assert.deepEqual(selectCameraZones(zones, ''), zones);
  assert.deepEqual(selectCameraZones(undefined, 'stand12'), []);
});

test('an event is selected by its stable id', () => {
  assert.equal(selectEvent(events, 'evt_b').status, 'escalated');
  assert.equal(selectEvent(events, 'missing'), null);
  assert.equal(selectEvent(undefined, 'evt_a'), null);
});

test('list filters ignore empty values but honour `all`', () => {
  assert.deepEqual(
    filterEvents(events, { status: 'open' }).map((event) => event.event_id),
    ['evt_a']
  );
  assert.equal(filterEvents(events, { status: 'all' }).length, 3);
  assert.equal(filterEvents(events, { severity: 'CRITICAL' }).length, 2);
  assert.deepEqual(
    filterEvents(events, { camera_id: 'stand12' }).map((event) => event.event_id),
    ['evt_a', 'evt_c']
  );
  assert.deepEqual(
    filterEvents(events, { status: 'escalated', severity: 'CRITICAL', camera_id: 'taxiway-b' })
      .map((event) => event.event_id),
    ['evt_b']
  );
  assert.deepEqual(filterEvents(events), events);
});

test('the filter predicate rejects anything that is not an event', () => {
  assert.equal(matchesEventFilters(events[0]), true);
  assert.equal(matchesEventFilters(null), false);
  assert.equal(matchesEventFilters(events[0], { status: 'resolved' }), false);
});
