import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFeedEvents, matchesFeedFilter } from './eventFeed.js';

const events = [
  {
    event_id: 'evt_stand12_1700000000000_17',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    report: { what: 'Persoană în zona motorului.', where: 'Stand 12, engine-left.' },
  },
  {
    event_id: 'evt_taxiway_b_1700000000060_18',
    type: 'NO_PPE',
    severity: 'WARNING',
    status: 'escalated',
    camera_id: 'taxiway-b',
    report: { what: 'Persoană fără vestă.', where: 'Taxiway B.' },
  },
  {
    event_id: 'evt_baggage_area_1700000000120_19',
    type: 'SMOKING',
    severity: 'WARNING',
    status: 'acknowledged',
    camera_id: 'baggage-area',
    report: { what: 'Fumat detectat.', where: 'Triere bagaje.' },
  },
  { event_id: 'evt_no_report_1700000000180_20', severity: 'CRITICAL', status: 'false_positive' },
];

test('the open tab keeps open and escalated incidents only', () => {
  assert.deepEqual(
    filterFeedEvents(events, { filterMode: 'open' }).map((event) => event.event_id),
    ['evt_stand12_1700000000000_17', 'evt_taxiway_b_1700000000060_18']
  );
});

test('the critical tab matches severity, whatever the status', () => {
  assert.deepEqual(
    filterFeedEvents(events, { filterMode: 'critical' }).map((event) => event.event_id),
    ['evt_stand12_1700000000000_17', 'evt_no_report_1700000000180_20']
  );
});

test('the all tab returns the whole list, in order', () => {
  assert.deepEqual(
    filterFeedEvents(events, { filterMode: 'all' }).map((event) => event.event_id),
    events.map((event) => event.event_id)
  );
});

test('an unknown filter mode hides nothing', () => {
  for (const event of events) assert.equal(matchesFeedFilter(event, 'nonsense'), true);
});

test('search is case-insensitive and looks at id, type, camera, what and where', () => {
  const ids = (query, filterMode = 'all') => filterFeedEvents(events, { filterMode, searchQuery: query })
    .map((event) => event.event_id);
  assert.deepEqual(ids('STAND12'), ['evt_stand12_1700000000000_17']);
  assert.deepEqual(ids('no_ppe'), ['evt_taxiway_b_1700000000060_18']);
  assert.deepEqual(ids('  taxiway b.  '), ['evt_taxiway_b_1700000000060_18']);
  assert.deepEqual(ids('fumat'), ['evt_baggage_area_1700000000120_19']);
  assert.deepEqual(ids('1700000000180'), ['evt_no_report_1700000000180_20']);
});

test('a whitespace-only query is no query', () => {
  assert.equal(filterFeedEvents(events, { filterMode: 'all', searchQuery: '   ' }).length, events.length);
});

test('search and filter combine', () => {
  assert.deepEqual(
    filterFeedEvents(events, { filterMode: 'open', searchQuery: 'vestă' }).map((event) => event.event_id),
    ['evt_taxiway_b_1700000000060_18']
  );
  assert.deepEqual(filterFeedEvents(events, { filterMode: 'open', searchQuery: 'fumat' }), []);
});

test('missing fields never throw during a search', () => {
  assert.deepEqual(filterFeedEvents(events, { filterMode: 'all', searchQuery: 'zzz' }), []);
  assert.equal(filterFeedEvents([], { searchQuery: 'x' }).length, 0);
});
