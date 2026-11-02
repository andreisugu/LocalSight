import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_EVENTS } from '../constants/mockData.js';
import {
  EVENT_SOURCE,
  eventSource,
  isDemoEvent,
  isVisibleEvent,
  sourceLabel,
  visibleEvents,
} from './eventVisibility.js';

const fixture = INITIAL_EVENTS[0];
const localEvent = { event_id: 'evt_stand12_1790000000000_17', local: true };
const simulatedEvent = { event_id: 'evt_stand12_1790000000001_18', simulated: true };
const backendEvent = { event_id: 'evt_stand12_1790000000002_19' };

test('the four sources are told apart by facts on the row', () => {
  assert.equal(eventSource(fixture), EVENT_SOURCE.demo);
  assert.equal(eventSource(localEvent), EVENT_SOURCE.local);
  assert.equal(eventSource(simulatedEvent), EVENT_SOURCE.simulated);
  assert.equal(eventSource(backendEvent), EVENT_SOURCE.backend);
});

test('a simulated row wins over the fixture id list', () => {
  // The simulator reuses the demo camera, so only the flag can separate the two.
  const simulatedFixtureShape = { ...fixture, simulated: true };
  assert.equal(eventSource(simulatedFixtureShape), EVENT_SOURCE.simulated);
});

test('fixtures are the only source hidden by default', () => {
  assert.equal(isVisibleEvent(fixture), false);
  assert.equal(isVisibleEvent(localEvent), true);
  assert.equal(isVisibleEvent(simulatedEvent), true);
  assert.equal(isVisibleEvent(backendEvent, { fixtureIds: new Set() }), true);
});

test('turning demo data on shows the fixtures, and nothing else changes', () => {
  const list = [fixture, localEvent, simulatedEvent, backendEvent];
  assert.deepEqual(visibleEvents(list).map((event) => event.event_id), [
    localEvent.event_id,
    simulatedEvent.event_id,
    backendEvent.event_id,
  ]);
  assert.equal(visibleEvents(list, { showDemoData: true }).length, 4);
});

test('every fixture is recognised, not just the newest', () => {
  assert.equal(INITIAL_EVENTS.length, 8);
  assert.equal(visibleEvents(INITIAL_EVENTS, { showDemoData: true }).length, 8);
  assert.equal(visibleEvents(INITIAL_EVENTS).length, 0);
  assert.equal(INITIAL_EVENTS.filter((event) => isDemoEvent(event)).length, 8);
});

test('a malformed list never hides a real row', () => {
  assert.deepEqual(visibleEvents(null), []);
  assert.equal(isVisibleEvent(null), true);
  assert.equal(isVisibleEvent(undefined), true);
  assert.equal(isVisibleEvent({}), true);
});

test('a custom fixture set keeps tests independent of the demo data file', () => {
  const ids = new Set(['evt_custom_1']);
  assert.equal(eventSource({ event_id: 'evt_custom_1' }, { fixtureIds: ids }), EVENT_SOURCE.demo);
  assert.equal(isVisibleEvent({ event_id: 'evt_custom_1' }, { fixtureIds: ids }), false);
});

test('each source has the visible tag it shows, and backend none', () => {
  assert.equal(sourceLabel(EVENT_SOURCE.local), 'local');
  assert.equal(sourceLabel(EVENT_SOURCE.simulated), 'simulat');
  assert.equal(sourceLabel(EVENT_SOURCE.demo), 'date demo');
  assert.equal(sourceLabel(EVENT_SOURCE.backend), null);
});
