import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_ID_ANCHOR_MS,
  EVENT_ID_PATTERN,
  EVENT_ID_STEP_MS,
  fixtureEventId,
} from './eventIds.js';

test('the first fixture id is the one the demo links already use', () => {
  assert.equal(fixtureEventId('stand12', 0, 17), 'evt_stand12_1700000000000_17');
});

test('each position steps one minute from the anchor', () => {
  assert.equal(fixtureEventId('taxiway-b', 1, 23), 'evt_taxiway-b_1700000060000_23');
  assert.equal(fixtureEventId('stand12', 7, 14), 'evt_stand12_1700000420000_14');
  assert.equal(EVENT_ID_ANCHOR_MS + 7 * EVENT_ID_STEP_MS, 1_700_000_420_000);
});

test('ids match the contract and stay unique across the shift', () => {
  const ids = Array.from({ length: 8 }, (_, index) => fixtureEventId('baggage-area', index, 41));
  assert.equal(new Set(ids).size, 8);
  for (const id of ids) {
    assert.match(id, EVENT_ID_PATTERN);
    assert.match(id, /^evt_baggage-area_\d{13}_41$/);
  }
});

test('an id does not depend on the clock', () => {
  const id = fixtureEventId('stand12', 3, 12);
  const later = fixtureEventId('stand12', 3, 12);
  assert.equal(id, later);
  assert.equal(id, 'evt_stand12_1700000180000_12');
});
