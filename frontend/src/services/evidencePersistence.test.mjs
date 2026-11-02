import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETENTION,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_STORES,
  applyAckOverrides,
  createEvidenceStore,
  mergeHydratedEvents,
} from './evidencePersistence.js';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const clock = () => NOW;

/** An IndexedDB-shaped adapter over Maps; the seam the store is designed around. */
function memoryAdapter() {
  const data = {
    events: new Map(),
    evidence: new Map(),
    acks: new Map(),
    meta: new Map(),
  };
  const keyOf = (name, value) => (name === EVIDENCE_STORES.meta ? value.key : value.event_id);
  const adapter = {
    data,
    failWrite: null,
    readyCalls: 0,
    async ready() {
      adapter.readyCalls += 1;
      return true;
    },
    async getAll(name) {
      return [...data[name].values()];
    },
    async get(name, key) {
      return data[name].get(key);
    },
    async put(name, value) {
      if (adapter.failWrite?.(name, value)) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data[name].set(keyOf(name, value), value);
      return true;
    },
    async delete(name, key) {
      data[name].delete(key);
      return true;
    },
    async clear(name) {
      data[name].clear();
      return true;
    },
  };
  return adapter;
}

function fakeUrlApi() {
  const created = [];
  const revoked = [];
  let counter = 0;
  return {
    created,
    revoked,
    createObjectURL(blob) {
      counter += 1;
      const url = `blob:fake/${counter}`;
      created.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
}

function blobOf(size = 12) {
  return { size, type: 'image/jpeg' };
}

function sampleEvent(overrides = {}) {
  return {
    event_id: 'evt_stand12_1793610000000_17',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    track_id: 17,
    confidence: { detector: 0.91, temporal: { seen: 4, window: 5 } },
    duration_s: 1.5,
    context: { engine_on: true },
    snapshot_url: 'blob:http://localhost:4173/dead-beef',
    model: 'yolo26n',
    detected_at: '2026-11-02T09:00:00.000Z',
    received_at: '2026-11-02T09:00:01.000Z',
    notified_at: null,
    escalated_at: null,
    acked_at: null,
    acked_by: null,
    report: null,
    local: true,
    ...overrides,
  };
}

function makeStore(overrides = {}) {
  const adapter = overrides.adapter || memoryAdapter();
  const urls = overrides.urls || fakeUrlApi();
  const store = createEvidenceStore({
    adapter,
    urlApi: urls,
    now: clock,
    ...overrides,
  });
  return { store, adapter, urls };
}

test('events round-trip with a schema version and newest-first order', async () => {
  const { store, adapter } = makeStore();
  const older = sampleEvent({ event_id: 'evt_stand12_1_1', detected_at: '2026-11-02T08:00:00.000Z' });
  const newer = sampleEvent({ event_id: 'evt_stand12_2_2', detected_at: '2026-11-02T10:00:00.000Z' });

  assert.equal(await store.putEvent(older), true);
  assert.equal(await store.putEvent(newer), true);

  const records = [...adapter.data.events.values()];
  assert.equal(records.length, 2);
  assert.equal(records[0].schema, EVIDENCE_SCHEMA_VERSION);

  const listed = await store.listEvents();
  assert.deepEqual(listed.map((event) => event.event_id), [newer.event_id, older.event_id]);
  assert.equal(listed[0].snapshot_url, newer.snapshot_url);
  assert.equal(store.supported, true);
});

test('corrupt and foreign-schema records are skipped, not thrown', async () => {
  const { store, adapter } = makeStore();
  await store.putEvent(sampleEvent({ event_id: 'evt_ok_1_1' }));
  // Hand-written garbage, exactly what a half-upgraded or foreign writer would leave.
  adapter.data.events.set('broken', { event_id: 'broken', schema: EVIDENCE_SCHEMA_VERSION, event: null });
  adapter.data.events.set('future', {
    event_id: 'future',
    schema: EVIDENCE_SCHEMA_VERSION + 1,
    event: sampleEvent({ event_id: 'future' }),
  });
  adapter.data.events.set('nokey', 'not even an object');

  const listed = await store.listEvents();
  assert.deepEqual(listed.map((event) => event.event_id), ['evt_ok_1_1']);
  const stats = await store.stats();
  assert.equal(stats.count, 1);
});

test('evidence blobs are stored and read back by event id', async () => {
  const { store } = makeStore();
  const blob = blobOf(2048);
  assert.equal(await store.putEvidence('evt_stand12_1793610000000_17', blob), true);
  assert.equal(await store.getEvidence('evt_stand12_1793610000000_17'), blob);
  assert.equal(await store.getEvidence('missing'), null);
  assert.equal(await store.putEvidence('', blob), false);
  assert.equal(await store.putEvidence('evt', null), false);
});

test('acks are stored as overrides and re-applied to the same incidents only', async () => {
  const event = sampleEvent();
  const { store } = makeStore();
  await store.putEvent(event);
  await store.putAck({
    ...event,
    status: 'acknowledged',
    acked_at: '2026-11-02T09:10:00.000Z',
    acked_by: 'Ana',
  });

  const acks = await store.listAcks();
  assert.deepEqual(acks, [{
    event_id: event.event_id,
    status: 'acknowledged',
    acked_at: '2026-11-02T09:10:00.000Z',
    acked_by: 'Ana',
    escalated_at: null,
  }]);

  const { events, acks: hydratedAcks } = await store.hydrate();
  const [restored] = applyAckOverrides(events, hydratedAcks);
  assert.equal(restored.status, 'acknowledged');
  assert.equal(restored.acked_by, 'Ana');
  // Detection fields are untouched by an override.
  assert.equal(restored.severity, 'CRITICAL');
  assert.equal(restored.confidence.detector, 0.91);
});

test('hydrate recreates snapshot URLs and revokes the previous document URLs', async () => {
  const event = sampleEvent();
  const { store, urls } = makeStore();
  await store.putEvent(event);
  await store.putEvidence(event.event_id, blobOf(100));

  const first = await store.hydrate();
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].snapshot_url, 'blob:fake/1');
  assert.equal(urls.created[0].blob.size, 100);

  // A second hydrate (StrictMode mounts the provider twice) must not leak the first URL.
  const second = await store.hydrate();
  assert.equal(second.events[0].snapshot_url, 'blob:fake/2');
  assert.deepEqual(urls.revoked, ['blob:fake/1']);

  await store.clear();
  assert.deepEqual(urls.revoked, ['blob:fake/1', 'blob:fake/2']);
});

test('an incident without stored evidence loses its dead document URL', async () => {
  const { store } = makeStore();
  await store.putEvent(sampleEvent());
  const { events } = await store.hydrate();
  assert.equal(events[0].snapshot_url, '');
});

test('prune keeps the newest N, deleting evidence and acks of the rest', async () => {
  const { store, adapter, urls } = makeStore();
  const events = Array.from({ length: 3 }, (_, index) => sampleEvent({
    event_id: `evt_stand12_${index}_${index}`,
    detected_at: new Date(NOW - index * 60_000).toISOString(),
  }));
  for (const event of events) {
    await store.putEvent(event);
    await store.putEvidence(event.event_id, blobOf(10 + event.track_id));
  }
  await store.putAck({ ...events[2], status: 'acknowledged' });
  await store.hydrate();
  assert.deepEqual(urls.created.map((entry) => entry.url), ['blob:fake/1', 'blob:fake/2', 'blob:fake/3']);
  urls.revoked.length = 0;

  const result = await store.prune({ maxEvents: 2, maxAgeDays: 7 });
  assert.deepEqual(result, { removed: 1, remaining: 2 });

  const ids = (await store.listEvents()).map((event) => event.event_id);
  assert.deepEqual(ids, [events[0].event_id, events[1].event_id]);
  assert.equal(adapter.data.evidence.has(events[2].event_id), false);
  assert.equal(adapter.data.acks.has(events[2].event_id), false);
  // The pruned incident's restored URL is revoked, so the tab cannot leak it.
  assert.deepEqual(urls.revoked, ['blob:fake/3']);
});

test('prune drops incidents older than maxAgeDays even below the count limit', async () => {  const { store } = makeStore();
  const old = sampleEvent({
    event_id: 'evt_old_1_1',
    detected_at: new Date(NOW - 8 * DAY_MS).toISOString(),
  });
  const fresh = sampleEvent({
    event_id: 'evt_fresh_2_2',
    detected_at: new Date(NOW - 1 * DAY_MS).toISOString(),
  });
  await store.putEvent(old);
  await store.putEvent(fresh);

  const result = await store.prune({ maxEvents: 200, maxAgeDays: 7 });
  assert.equal(result.removed, 1);
  assert.deepEqual((await store.listEvents()).map((event) => event.event_id), [fresh.event_id]);
});

test('a fixture-only ack override survives prune and comes back on hydrate', async () => {
  const { store } = makeStore();
  // A demo fixture is never written as an incident, but its confirmation is still an
  // operator decision that must outlive the tab.
  await store.putAck({
    event_id: 'evt_fixture_stand12_1_1',
    status: 'acknowledged',
    acked_at: '2026-11-02T09:10:00.000Z',
    acked_by: 'Ana',
  });

  assert.deepEqual(await store.prune({ maxEvents: 1, maxAgeDays: 7 }), { removed: 0, remaining: 0 });
  const { acks } = await store.hydrate();
  assert.equal(acks.length, 1);
  assert.equal(acks[0].event_id, 'evt_fixture_stand12_1_1');
  assert.equal(acks[0].status, 'acknowledged');
});

test('hydrate enforces retention before restoring', async () => {
  const { store } = makeStore({ retention: { maxEvents: 1, maxAgeDays: 7 } });
  await store.putEvent(sampleEvent({
    event_id: 'evt_old_1_1',
    detected_at: new Date(NOW - 60_000).toISOString(),
  }));
  await store.putEvent(sampleEvent({
    event_id: 'evt_new_2_2',
    detected_at: new Date(NOW - 30_000).toISOString(),
  }));

  const { events } = await store.hydrate();
  assert.deepEqual(events.map((event) => event.event_id), ['evt_new_2_2']);
  assert.equal((await store.stats()).count, 1);
});

test('clear empties every store, revokes URLs and resets stats', async () => {
  const { store, adapter, urls } = makeStore();
  await store.recordEvent(sampleEvent());
  await store.putEvidence(sampleEvent().event_id, blobOf(32));
  await store.putAck({ ...sampleEvent(), status: 'acknowledged' });
  await store.hydrate();
  assert.ok(urls.created.length > 0);

  assert.equal(await store.clear(), true);
  for (const name of Object.values(EVIDENCE_STORES)) {
    assert.equal(adapter.data[name].size, 0, `${name} must be empty`);
  }
  assert.deepEqual(urls.revoked, urls.created.map((entry) => entry.url));
  const stats = await store.stats();
  assert.equal(stats.count, 0);
  assert.equal(stats.bytes, 0);
});

test('stats reports counts and an approximate size', async () => {
  const { store } = makeStore();
  await store.putEvent(sampleEvent({ event_id: 'evt_a_1_1' }));
  await store.putEvidence('evt_a_1_1', blobOf(4096));
  await store.putAck({ ...sampleEvent({ event_id: 'evt_a_1_1' }), status: 'acknowledged' });

  const stats = await store.stats();
  assert.equal(stats.supported, true);
  assert.equal(stats.count, 1);
  assert.equal(stats.evidenceCount, 1);
  assert.equal(stats.ackCount, 1);
  assert.ok(stats.bytes >= 4096, `expected at least the blob size, got ${stats.bytes}`);
  assert.deepEqual(
    { maxEvents: stats.maxEvents, maxAgeDays: stats.maxAgeDays },
    DEFAULT_RETENTION
  );
});

test('a quota error prunes and retries once instead of failing the incident', async () => {
  const adapter = memoryAdapter();
  const { store } = makeStore({ adapter });
  let failed = false;
  adapter.failWrite = (name, value) => {
    if (!failed && name === EVIDENCE_STORES.evidence && value.event_id === 'evt_q_1_1') {
      failed = true;
      return true;
    }
    return false;
  };

  assert.equal(await store.putEvent(sampleEvent({ event_id: 'evt_q_1_1' })), true);
  assert.equal(await store.putEvidence('evt_q_1_1', blobOf(64)), true);
  assert.equal(failed, true);
  assert.equal(await store.getEvidence('evt_q_1_1') !== null, true);
});

test('a permanently full quota resolves false and never throws', async () => {
  const adapter = memoryAdapter();
  const { store } = makeStore({ adapter });
  adapter.failWrite = () => true;
  assert.equal(await store.putEvent(sampleEvent()), false);
  assert.equal(await store.putEvidence(sampleEvent().event_id, blobOf(64)), false);
  assert.equal(await store.putAck({ ...sampleEvent(), status: 'acknowledged' }), false);
  // Reads still answer, so the UI can boot.
  assert.deepEqual(await store.listEvents(), []);
});

test('a missing or blocked IndexedDB is unsupported, not fatal', async () => {
  const store = createEvidenceStore({ adapter: null, indexedDB: null, now: clock });
  assert.equal(store.supported, false);
  assert.equal(await store.putEvent(sampleEvent()), false);
  assert.deepEqual(await store.listEvents(), []);
  assert.deepEqual(await store.hydrate(), { events: [], acks: [] });
  assert.equal(await store.putEvidence('evt', blobOf(1)), false);
  assert.equal(await store.getEvidence('evt'), null);
  assert.deepEqual(await store.prune(), { removed: 0, remaining: 0 });
  assert.equal(await store.clear(), false);
  const stats = await store.stats();
  assert.equal(stats.supported, false);
  assert.equal(stats.count, 0);
});

test('an adapter that cannot open flips supported to false', async () => {
  const adapter = memoryAdapter();
  adapter.ready = async () => false;
  const { store } = makeStore({ adapter });
  assert.equal(await store.putEvent(sampleEvent()), false);
  assert.equal(store.supported, false);
  assert.equal((await store.stats()).supported, false);
});

test('recordEvent captures the live blob URL before it dies', async () => {
  const blob = blobOf(512);
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return { ok: true, blob: async () => blob };
  };
  const { store } = makeStore({ fetchImpl });

  assert.equal(await store.recordEvent(sampleEvent()), true);
  assert.deepEqual(fetchCalls, ['blob:http://localhost:4173/dead-beef']);
  assert.equal(await store.getEvidence('evt_stand12_1793610000000_17'), blob);
});

test('recordEvent skips non-blob sources, the pending marker and dead URLs', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    throw new Error('revoked');
  };
  const { store } = makeStore({ fetchImpl });

  await store.recordEvent(sampleEvent({ event_id: 'evt_http_1_1', snapshot_url: 'https://cdn/x.jpg' }));
  await store.recordEvent(sampleEvent({ event_id: 'evt_pending_2_2', snapshot_url: 'blob:pending' }));
  await store.recordEvent(sampleEvent({ event_id: 'evt_dead_3_3' }));

  assert.deepEqual(calls, ['blob:http://localhost:4173/dead-beef']);
  assert.equal(await store.getEvidence('evt_http_1_1'), null);
  assert.equal(await store.getEvidence('evt_dead_3_3'), null);
  // The incident itself is still saved even when its snapshot cannot be fetched.
  assert.equal((await store.listEvents()).length, 3);
});

test('mergeHydratedEvents dedupes by id, keeps existing rows and honours the limit', () => {
  const fixture = sampleEvent({ event_id: 'evt_fixture', detected_at: '2026-11-02T11:00:00.000Z' });
  const persisted = [
    sampleEvent({ event_id: 'evt_new', detected_at: '2026-11-02T11:30:00.000Z' }),
    sampleEvent({ event_id: 'evt_fixture', detected_at: '2026-11-02T11:00:00.000Z', status: 'open' }),
    sampleEvent({ event_id: 'evt_old', detected_at: '2026-11-02T07:00:00.000Z' }),
    { nope: true },
  ];

  const merged = mergeHydratedEvents([fixture], persisted, { limit: 2 });
  assert.deepEqual(merged.map((event) => event.event_id), ['evt_new', 'evt_fixture']);
  // Existing fixture values are untouched by hydration.
  assert.equal(merged[1], fixture);
  // Nothing new means the same array, so React does not re-render.
  const unchanged = [fixture];
  assert.equal(mergeHydratedEvents(unchanged, []), unchanged);
});

test('applyAckOverrides writes operator fields only and ignores unknown ids', () => {
  const event = sampleEvent();
  const overrides = [{
    event_id: event.event_id,
    status: 'false_positive',
    false_positive_by: 'Ana',
    false_positive_note: 'con',
    escalated_at: null,
  }, { event_id: 'evt_unknown', status: 'acknowledged' }];

  const [applied] = applyAckOverrides([event], overrides);
  assert.equal(applied.status, 'false_positive');
  assert.equal(applied.false_positive_by, 'Ana');
  assert.equal(applied.snapshot_url, event.snapshot_url);
  assert.equal(applied.event_id, event.event_id);
  const untouched = [event];
  assert.equal(applyAckOverrides(untouched, []), untouched);
});
