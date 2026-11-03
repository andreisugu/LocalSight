import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_APP,
  ARCHIVE_LIMITS,
  ARCHIVE_SCHEMA,
  ArchiveError,
  archiveCounts,
  archiveFilename,
  base64ToBlob,
  blobToBase64,
  encodeBase64,
  isValidEventId,
  parseArchive,
  serializeArchive,
  summarizeImport,
} from './evidenceArchive.js';

const FIXED_NOW = new Date('2026-11-02T12:34:56.000Z');
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUg==';

function eventOf(id, overrides = {}) {
  return {
    event_id: id,
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    detected_at: '2026-11-02T09:00:00.000Z',
    snapshot_url: `blob:http://localhost/${id}`,
    confidence: { detector: 0.91, temporal: { seen: 4, window: 5 } },
    ...overrides,
  };
}

function eventRecord(event, storedAt = 1_700_000_000_000) {
  return { event_id: event.event_id, schema: 1, stored_at: storedAt, event };
}

function evidenceRecord(eventId, bytes = PNG_BYTES, type = 'image/png') {
  return {
    event_id: eventId,
    schema: 1,
    stored_at: 1_700_000_000_000,
    size: bytes.length,
    type,
    blob: new Blob([bytes], { type }),
  };
}

function ackRecord(eventId, override = { status: 'acknowledged', acked_by: 'Ana' }) {
  return { event_id: eventId, schema: 1, updated_at: 1_700_000_000_000, override };
}

/** A full archive object, already parsed, for summary tests. */
function parsedEvent(id, overrides = {}) {
  return eventOf(id, overrides);
}

test('serializeArchive writes the documented file shape and round-trips through parseArchive', async () => {
  const event = eventOf('evt_stand12_1793610000000_17');
  const archive = await serializeArchive({
    events: [eventRecord(event)],
    evidence: [evidenceRecord(event.event_id)],
    acks: [ackRecord(event.event_id)],
    meta: [{ key: 'schema_version', value: 1 }],
    now: FIXED_NOW,
  });

  assert.deepEqual(Object.keys(archive), [
    'app', 'schema', 'exported_at', 'counts', 'events', 'evidence', 'acks', 'meta',
  ]);
  assert.equal(archive.app, ARCHIVE_APP);
  assert.equal(archive.schema, ARCHIVE_SCHEMA);
  assert.equal(archive.exported_at, FIXED_NOW.toISOString());
  assert.deepEqual(archive.counts, { events: 1, evidence: 1, acks: 1 });
  assert.deepEqual(archive.events, [event]);
  assert.equal(archive.evidence[0].mime, 'image/png');
  assert.equal(archive.evidence[0].size, PNG_BYTES.length);
  assert.equal(archive.evidence[0].base64, PNG_BASE64);
  assert.deepEqual(archive.acks, [{
    event_id: event.event_id,
    override: { status: 'acknowledged', acked_by: 'Ana' },
  }]);

  // The archive survives JSON (what a downloaded file is) and parses back into the same data.
  const parsed = parseArchive(JSON.stringify(archive));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.archive, archive);
  // Nothing in the result is shared with the source object.
  parsed.archive.events[0].status = 'resolved';
  assert.equal(event.status, 'open');
});

test('an empty store exports an empty archive that parses cleanly', async () => {
  const archive = await serializeArchive({ events: [], evidence: [], acks: [], meta: [], now: FIXED_NOW });
  assert.deepEqual(archive.counts, { events: 0, evidence: 0, acks: 0 });
  assert.deepEqual(archive.events, []);

  const parsed = parseArchive(JSON.stringify(archive));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.archive.counts, { events: 0, evidence: 0, acks: 0 });
});

test('an empty or whitespace-only file is rejected before any parsing', () => {
  assert.equal(parseArchive('').code, 'empty-file');
  assert.equal(parseArchive('   \n\t ').code, 'empty-file');
  assert.equal(parseArchive(null).code, 'empty-file');
});

test('a foreign app marker or an unknown schema is rejected', () => {
  const foreign = parseArchive(JSON.stringify({ app: 'OtherSight', schema: 1 }));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'not-an-archive');

  const future = parseArchive(JSON.stringify({ app: ARCHIVE_APP, schema: ARCHIVE_SCHEMA + 1 }));
  assert.equal(future.ok, false);
  assert.equal(future.code, 'unsupported-schema');
  assert.match(future.error, /schema/);
});

test('invalid JSON and a non-object payload are rejected with their own codes', () => {
  assert.equal(parseArchive('{not json').code, 'invalid-json');
  assert.equal(parseArchive('[1,2,3]').code, 'not-an-archive');
  assert.equal(parseArchive('"LocalSight"').code, 'not-an-archive');
});

test('the file size cap is enforced before JSON.parse', () => {
  const tiny = { ...ARCHIVE_LIMITS, maxBytes: 32 };
  const text = JSON.stringify({ app: ARCHIVE_APP, schema: 1, events: [] });
  const result = parseArchive(text, { limits: tiny });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'too-large');
  assert.match(result.error, /limita/);
});

test('counts are recomputed from the arrays, never trusted from the file', () => {
  const text = JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    counts: { events: 999, evidence: 999, acks: 999 },
    events: [parsedEvent('evt_a_1_1')],
    evidence: [],
    acks: [],
  });
  const parsed = parseArchive(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.archive.counts, { events: 1, evidence: 0, acks: 0 });
});

test('bad base64 is rejected instead of being decoded leniently', () => {
  const base = {
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [parsedEvent('evt_a_1_1')],
    acks: [],
  };
  for (const base64 of ['AAA', 'A$AA', 'AA=A', '====', 42]) {
    const result = parseArchive(JSON.stringify({
      ...base,
      evidence: [{ event_id: 'evt_a_1_1', mime: 'image/png', base64 }],
    }));
    assert.equal(result.ok, false, `base64 ${String(base64)} must be rejected`);
    assert.equal(result.code, 'bad-base64');
  }
});

test('evidence must have a known image type and a size that matches its bytes', () => {
  const base = { app: ARCHIVE_APP, schema: ARCHIVE_SCHEMA, events: [], acks: [] };
  const wrongMime = parseArchive(JSON.stringify({
    ...base,
    evidence: [{ event_id: 'evt_a_1_1', mime: 'text/html', base64: PNG_BASE64 }],
  }));
  assert.equal(wrongMime.code, 'bad-evidence');

  const wrongSize = parseArchive(JSON.stringify({
    ...base,
    evidence: [{ event_id: 'evt_a_1_1', mime: 'image/png', size: 999, base64: PNG_BASE64 }],
  }));
  assert.equal(wrongSize.code, 'bad-evidence');

  const unknownId = parseArchive(JSON.stringify({
    ...base,
    evidence: [{ event_id: '', mime: 'image/png', base64: PNG_BASE64 }],
  }));
  assert.equal(unknownId.code, 'bad-evidence');
});

test('a snapshot over the per-image cap is rejected', () => {
  const bytes = new Uint8Array(64);
  const base64 = Buffer.from(bytes).toString('base64');
  const result = parseArchive(JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [],
    acks: [],
    evidence: [{ event_id: 'evt_big_1_1', mime: 'image/png', base64 }],
  }), { limits: { ...ARCHIVE_LIMITS, maxEvidenceBytes: 16 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'bad-evidence');
});

test('duplicate ids inside the file are rejected per store', () => {
  const event = parsedEvent('evt_a_1_1');
  const duplicateEvent = parseArchive(JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [event, event],
  }));
  assert.equal(duplicateEvent.code, 'duplicate-event');

  const duplicateEvidence = parseArchive(JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [],
    evidence: [
      { event_id: 'evt_a_1_1', mime: 'image/png', base64: PNG_BASE64 },
      { event_id: 'evt_a_1_1', mime: 'image/png', base64: PNG_BASE64 },
    ],
  }));
  assert.equal(duplicateEvidence.code, 'duplicate-evidence');

  const duplicateAck = parseArchive(JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [],
    acks: [
      { event_id: 'evt_a_1_1', override: { status: 'acknowledged' } },
      { event_id: 'evt_a_1_1', override: { status: 'acknowledged' } },
    ],
  }));
  assert.equal(duplicateAck.code, 'duplicate-ack');
});

test('an ack needs a known status and typed operator fields', () => {
  const base = { app: ARCHIVE_APP, schema: ARCHIVE_SCHEMA, events: [], evidence: [] };
  const unknown = parseArchive(JSON.stringify({
    ...base,
    acks: [{ event_id: 'evt_a_1_1', override: { status: 'maybe' } }],
  }));
  assert.equal(unknown.code, 'bad-acks');

  const badField = parseArchive(JSON.stringify({
    ...base,
    acks: [{ event_id: 'evt_a_1_1', override: { status: 'acknowledged', acked_by: 7 } }],
  }));
  assert.equal(badField.code, 'bad-acks');

  // Unknown fields are dropped; the known ones survive.
  const extra = parseArchive(JSON.stringify({
    ...base,
    acks: [{ event_id: 'evt_a_1_1', override: { status: 'acknowledged', acked_by: 'Ana', injected: 'x' } }],
  }));
  assert.equal(extra.ok, true);
  assert.deepEqual(extra.archive.acks[0].override, { status: 'acknowledged', acked_by: 'Ana' });
});

test('event ids must be machine-shaped: no control characters, no empty ids', () => {
  assert.equal(isValidEventId('evt_stand12_1793610000000_17'), true);
  assert.equal(isValidEventId('evt_fixture_stand12_1_1'), true);
  assert.equal(isValidEventId(''), false);
  assert.equal(isValidEventId('evt with space'), false);
  assert.equal(isValidEventId('evt\n1'), false);
  assert.equal(isValidEventId('x'.repeat(ARCHIVE_LIMITS.maxIdLength + 1)), false);
  assert.equal(isValidEventId(42), false);

  const result = parseArchive(JSON.stringify({
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    events: [{ event_id: 'evt\x001' }],
  }));
  assert.equal(result.code, 'bad-events');
});

test('an incident type must be a contract-shaped identifier', () => {
  const base = { app: ARCHIVE_APP, schema: ARCHIVE_SCHEMA };
  for (const type of ['__proto__', 'restricted zone', '<img src=x>', 'constructor']) {
    const result = parseArchive(JSON.stringify({
      ...base,
      events: [{ event_id: 'evt_a_1_1', type }],
    }));
    assert.equal(result.ok, false, `type ${type} must be rejected`);
    assert.equal(result.code, 'bad-events');
  }
  const accepted = parseArchive(JSON.stringify({
    ...base,
    events: [{ event_id: 'evt_a_1_1', type: 'RESTRICTED_ZONE' }],
  }));
  assert.equal(accepted.ok, true);
});

test('too many incidents are refused instead of being silently truncated', () => {
  const events = Array.from({ length: 3 }, (_, index) => parsedEvent(`evt_${index}_1_1`));
  const result = parseArchive(JSON.stringify({ app: ARCHIVE_APP, schema: ARCHIVE_SCHEMA, events }), {
    limits: { ...ARCHIVE_LIMITS, maxEvents: 2 },
  });
  assert.equal(result.code, 'too-many-events');
});

test('the summary counts new, identical and conflicting rows per store', () => {
  const same = eventOf('evt_same_1_1');
  const changed = eventOf('evt_changed_1_1');
  const current = {
    events: [
      eventRecord(same),
      eventRecord(changed),
      eventRecord(eventOf('evt_gone_1_1')),
    ],
    evidence: [
      evidenceRecord('evt_same_1_1'),
      evidenceRecord('evt_changed_1_1', PNG_BYTES, 'image/png'),
    ],
    acks: [
      ackRecord('evt_same_1_1'),
      ackRecord('evt_changed_1_1'),
    ],
  };
  const incoming = {
    events: [
      eventOf('evt_same_1_1'),
      eventOf('evt_changed_1_1', { status: 'acknowledged' }),
      eventOf('evt_new_1_1'),
    ],
    evidence: [
      { event_id: 'evt_same_1_1', mime: 'image/png', size: PNG_BYTES.length, base64: PNG_BASE64 },
      { event_id: 'evt_changed_1_1', mime: 'image/jpeg', size: PNG_BYTES.length, base64: PNG_BASE64 },
      { event_id: 'evt_new_1_1', mime: 'image/png', size: PNG_BYTES.length, base64: PNG_BASE64 },
    ],
    acks: [
      { event_id: 'evt_same_1_1', override: { status: 'acknowledged', acked_by: 'Ana' } },
      { event_id: 'evt_changed_1_1', override: { status: 'resolved' } },
      { event_id: 'evt_new_1_1', override: { status: 'acknowledged' } },
    ],
  };

  const summary = summarizeImport(current, incoming);
  assert.deepEqual(summary.events, { total: 3, new: 1, duplicate: 1, conflicting: 1 });
  assert.deepEqual(summary.evidence, { total: 3, new: 1, duplicate: 1, conflicting: 1 });
  assert.deepEqual(summary.acks, { total: 3, new: 1, duplicate: 1, conflicting: 1 });
  // What the replacement would remove, so the warning can name it.
  assert.deepEqual(summary.current, { events: 3, evidence: 2, acks: 2 });
});

test('the summary ignores corrupt current rows and a partial current store', () => {
  const summary = summarizeImport(
    { events: [null, { nope: true }], evidence: [], acks: [] },
    { events: [eventOf('evt_a_1_1')], evidence: [], acks: [] }
  );
  assert.deepEqual(summary.events, { total: 1, new: 1, duplicate: 0, conflicting: 0 });
  assert.deepEqual(summarizeImport().current, { events: 0, evidence: 0, acks: 0 });
});

test('blobToBase64 and base64ToBlob round-trip the bytes and the MIME type', async () => {
  const blob = new Blob([PNG_BYTES], { type: 'image/png' });
  const base64 = await blobToBase64(blob);
  assert.equal(base64, PNG_BASE64);

  const restored = base64ToBlob(base64, 'image/png');
  assert.equal(restored.type, 'image/png');
  assert.equal(restored.size, PNG_BYTES.length);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), PNG_BYTES);

  // The encoder matches the platform's own implementation for every tail length.
  for (let length = 0; length < 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) % 256);
    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
});

test('base64ToBlob refuses an unknown type and unreadable input', () => {
  assert.throws(() => base64ToBlob(PNG_BASE64, 'text/html'), ArchiveError);
  assert.throws(() => base64ToBlob('%%%'), ArchiveError);
  assert.throws(() => base64ToBlob('A===', 'image/png'), ArchiveError);
});

test('a stored record whose blob cannot be read aborts the export instead of hiding it', async () => {
  await assert.rejects(
    serializeArchive({ events: [], evidence: [{ event_id: 'evt_a_1_1', type: 'image/png' }] }),
    (error) => error instanceof ArchiveError && error.code === 'bad-blob'
  );
  await assert.rejects(
    serializeArchive({ evidence: [{ event_id: 'bad id', blob: new Blob([]) }] }),
    (error) => error instanceof ArchiveError && error.code === 'bad-evidence'
  );
});

test('the download filename is a UTC stamp', () => {
  assert.equal(archiveFilename(FIXED_NOW), 'localsight-archive-20261102-123456.json');
  // A bad date falls back to the epoch instead of throwing in the click handler.
  assert.equal(archiveFilename(new Date('nope')), 'localsight-archive-19700101-000000.json');
});

test('archiveCounts is total over a partial object', () => {
  assert.deepEqual(archiveCounts({ events: [1, 2] }), { events: 2, evidence: 0, acks: 0 });
  assert.deepEqual(archiveCounts(null), { events: 0, evidence: 0, acks: 0 });
});
