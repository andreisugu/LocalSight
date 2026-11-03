import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEMPLATE_CHARS,
  MAX_TEMPLATE_STORAGE_CHARS,
  MAX_ZONE_TEMPLATES,
  ZONE_TEMPLATE_STORAGE_KEY,
  assignZoneIds,
  deleteTemplate,
  exportZones,
  normalizeZones,
  parseZoneTemplate,
  readTemplates,
  saveTemplate,
  templateForCamera,
  toZonePayload,
  zoneExportFileName,
} from './zoneTemplates.js';

// A zone shaped exactly like `data/zones.js`, so the round-trip test exercises real data.
const P = (x, y) => ({ x, y });
const SQUARE = [P(0.04, 0.22), P(0.42, 0.22), P(0.42, 0.72), P(0.04, 0.72)];

function zone(overrides = {}) {
  return {
    zone_id: 'engine-left',
    name: 'Motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    severity: 'CRITICAL',
    debounce_s: 0.5,
    notify_channel: 'slack',
    escalate_after_s: 120,
    required_ppe: ['ear_defenders', 'hi_vis_vest'],
    polygon: [P(0.02, 0.48), P(0.4, 0.48), P(0.62, 0.6), P(0.64, 0.86), P(0.2, 0.86)],
    ...overrides,
  };
}

/** localStorage stand-in, plus the way a browser says "quota exceeded". */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function throwingStorage() {
  return {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
}

const codes = (result) => result.errors.map((error) => error.code);

test('export keeps ids, names, rule fields and polygon order and adds no functions', () => {
  const zones = [zone(), zone({ zone_id: 'apron', name: 'Platformă', severity: 'WARNING', escalate_after_s: null })];
  const payload = exportZones(zones, { cameraId: 'stand12', now: new Date('2026-01-02T03:04:05.000Z') });
  assert.equal(payload.app, 'LocalSight');
  assert.equal(payload.schema, 1);
  assert.equal(payload.exported_at, '2026-01-02T03:04:05.000Z');
  assert.equal(payload.camera_id, 'stand12');
  assert.equal(payload.zones.length, 2);
  assert.deepEqual(payload.zones[0].polygon, zones[0].polygon);
  assert.equal(payload.zones[0].zone_id, 'engine-left');
  assert.equal(payload.zones[0].name, 'Motor stâng');
  assert.equal(payload.zones[0].rule_type, 'RESTRICTED');
  assert.equal(payload.zones[0].active_when, 'engine_on');
  assert.equal(payload.zones[1].severity, 'WARNING');
  assert.equal(payload.zones[1].escalate_after_s, null);
  // Nothing executable and no per-tab URL travels in the file.
  assert.equal(payload.zones[0].reference_frame, undefined);
  assert.equal(payload.zones[0].reference_frame_url, undefined);
  assert.equal(payload.zones[0].notify_channel, 'slack');
  assert.doesNotThrow(() => JSON.stringify(payload));

  // Without a camera hint the key is absent, not null.
  const anonymous = exportZones([zone()]);
  assert.equal('camera_id' in anonymous, false);
  assert.equal(anonymous.zones.length, 1);
});

test('export → parse round-trips the zones unchanged', () => {
  const zones = [zone(), zone({ zone_id: 'apron', polygon: SQUARE })];
  const json = JSON.stringify(exportZones(zones, { cameraId: 'stand12', now: '2026-05-06T00:00:00.000Z' }));
  const result = parseZoneTemplate(json);
  assert.equal(result.ok, true);
  assert.equal(result.cameraId, 'stand12');
  assert.equal(result.exportedAt, '2026-05-06T00:00:00.000Z');
  assert.deepEqual(result.zones, normalizeZones(zones).zones);
  assert.deepEqual(result.zones.map((item) => item.zone_id), ['engine-left', 'apron']);
});

test('broken files are rejected with a readable reason and never throw', () => {
  const cases = [
    ['', 'empty-file'],
    ['   ', 'empty-file'],
    ['{not json', 'invalid-json'],
    ['42', 'not-zone-file'],
    ['null', 'not-zone-file'],
    ['"zones"', 'not-zone-file'],
    [JSON.stringify({ app: 'OtherApp', schema: 1, zones: [zone()] }), 'foreign-file'],
    [JSON.stringify({ app: 'LocalSight', schema: 2, zones: [zone()] }), 'unsupported-schema'],
    ['x'.repeat(MAX_TEMPLATE_CHARS + 1), 'file-too-large'],
    [JSON.stringify({ app: 'LocalSight', schema: 1, zones: [] }), 'no-zones'],
  ];
  for (const [text, code] of cases) {
    assert.doesNotThrow(() => parseZoneTemplate(text));
    const result = parseZoneTemplate(text);
    assert.equal(result.ok, false, `expected ${code}`);
    assert.deepEqual(result.zones, []);
    assert.ok(codes(result).includes(code), `expected ${code}, got ${codes(result).join(',')}`);
    assert.equal(typeof result.errors[0].message, 'string');
    assert.ok(result.errors[0].message.length > 0);
  }
});

test('a bare zone array is accepted, like an older hand-written file', () => {
  const result = parseZoneTemplate(JSON.stringify([zone()]));
  assert.equal(result.ok, true);
  assert.equal(result.cameraId, null);
  assert.equal(result.zones.length, 1);
});

test('polygons need three in-frame finite points, in the order given', () => {
  const twoPoints = normalizeZones([zone({ polygon: SQUARE.slice(0, 2) })]);
  assert.equal(twoPoints.ok, false);
  assert.ok(codes(twoPoints).includes('too-few-points'));

  const outOfFrame = normalizeZones([zone({ polygon: [P(0.1, 0.1), P(1.2, 0.1), P(0.1, 0.1)] })]);
  assert.equal(outOfFrame.ok, false);
  assert.ok(codes(outOfFrame).includes('point-out-of-frame'));

  const notNumbers = normalizeZones([zone({ polygon: [P(0.1, 0.1), { x: 'a', y: 0.2 }, P(0.1, 0.3)] })]);
  assert.equal(notNumbers.ok, false);
  assert.ok(codes(notNumbers).includes('invalid-point'));

  const missing = normalizeZones([zone({ polygon: undefined })]);
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes('missing-polygon'));

  const ok = normalizeZones([zone({ polygon: [P(0.9, 0.9), P(0.1, 0.9), P(0.1, 0.1), P(0.9, 0.1)] })]);
  assert.equal(ok.ok, true);
  assert.deepEqual(
    ok.zones[0].polygon,
    [P(0.9, 0.9), P(0.1, 0.9), P(0.1, 0.1), P(0.9, 0.1)],
    'polygon order is preserved'
  );
});

test('rule type, severity and active_when accept only the contract values', () => {
  const badRule = normalizeZones([zone({ rule_type: 'FOD' })]);
  assert.equal(badRule.ok, false);
  assert.ok(codes(badRule).includes('unknown-rule'));

  const badSeverity = normalizeZones([zone({ severity: 'RESOLVED' })]);
  assert.equal(badSeverity.ok, false);
  assert.ok(codes(badSeverity).includes('unknown-severity'));

  const badActive = normalizeZones([zone({ active_when: 'verifying' })]);
  assert.equal(badActive.ok, false);
  assert.ok(codes(badActive).includes('unknown-active-when'));

  for (const rule_type of ['RESTRICTED', 'PPE_REQUIRED', 'NO_SMOKING', 'CROWD_WATCH']) {
    assert.equal(normalizeZones([zone({ rule_type, severity: 'WARNING', active_when: 'always' })]).ok, true);
  }
});

test('duplicate ids are refused; a zone without an id is allowed and gets its name', () => {
  const duplicate = normalizeZones([zone(), zone({ name: 'A doua' })]);
  assert.equal(duplicate.ok, false);
  assert.ok(codes(duplicate).includes('duplicate-id'));

  const missingId = normalizeZones([zone({ zone_id: undefined, name: 'Zona fără id' })]);
  assert.equal(missingId.ok, true);
  assert.equal(missingId.zones[0].zone_id, '');
  assert.equal(missingId.zones[0].name, 'Zona fără id');

  const invalidId = normalizeZones([zone({ zone_id: '!!!' })]);
  assert.equal(invalidId.ok, false);
  assert.ok(codes(invalidId).includes('invalid-id'));
});

test('validation never mutates its input and rounds points to four decimals', () => {
  const input = [zone({ polygon: [P(0.123456, 0.1), P(0.9, 0.1), P(0.5, 0.987654321)] })];
  const snapshot = JSON.parse(JSON.stringify(input));
  const result = normalizeZones(input);
  assert.equal(result.ok, true);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.zones[0].polygon, [P(0.1235, 0.1), P(0.9, 0.1), P(0.5, 0.9877)]);
  assert.equal(result.zones[0].notify_channel, 'slack');
  assert.equal(result.zones[0].debounce_s, 0.5);
});

test('assignZoneIds preserves ids, fills missing ones and never steals another camera id', () => {
  const zones = [
    zone({ zone_id: 'engine-left' }),
    zone({ zone_id: 'apron' }),
    zone({ zone_id: '', name: 'Zona nouă' }),
    zone({ zone_id: 'baggage-area', name: 'Bagaje' }),
  ];
  const assigned = assignZoneIds(zones, ['baggage-area']);
  assert.deepEqual(
    assigned.map((item) => item.zone_id),
    ['engine-left', 'apron', 'zona-noua', 'baggage-area-2']
  );
  const again = assignZoneIds(zones, []);
  assert.deepEqual(again.map((item) => item.zone_id), ['engine-left', 'apron', 'zona-noua', 'baggage-area']);
});

test('templates round-trip through storage and can be deleted', () => {
  const storage = memoryStorage();
  const saved = saveTemplate(storage, {
    name: 'Stand 12',
    cameraId: 'stand12',
    zones: [zone()],
    now: new Date('2026-02-03T04:05:06.000Z'),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.template.name, 'Stand 12');
  assert.equal(saved.template.camera_id, 'stand12');
  assert.equal(saved.template.saved_at, '2026-02-03T04:05:06.000Z');
  assert.equal(saved.template.zones.length, 1);
  assert.equal(typeof saved.template.id, 'string');
  assert.equal(storage.values.has(ZONE_TEMPLATE_STORAGE_KEY), true);

  const read = readTemplates(storage);
  assert.equal(read.length, 1);
  assert.deepEqual(read[0], saved.template);

  const removed = deleteTemplate(storage, saved.template.id);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.templates, []);
  assert.deepEqual(readTemplates(storage), []);

  const missing = deleteTemplate(storage, saved.template.id);
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes('missing'));
});

test('a template name is never silently overwritten', () => {
  const storage = memoryStorage();
  const first = saveTemplate(storage, { name: 'Apron', cameraId: 'stand12', zones: [zone()] });
  assert.equal(first.ok, true);
  const duplicate = saveTemplate(storage, { name: '  apron ', cameraId: 'stand12', zones: [zone({ name: 'Alt nume' })] });
  assert.equal(duplicate.ok, false);
  assert.ok(codes(duplicate).includes('duplicate-name'));
  assert.equal(readTemplates(storage).length, 1);
  assert.equal(readTemplates(storage)[0].id, first.template.id);

  // The same name is fine in another scope: camera-specific and global are separate lists.
  assert.equal(saveTemplate(storage, { name: 'Apron', cameraId: null, zones: [zone()] }).ok, true);
  assert.equal(saveTemplate(storage, { name: 'Apron', cameraId: 'taxiway-b', zones: [zone()] }).ok, true);
  assert.equal(readTemplates(storage).length, 3);

  assert.equal(saveTemplate(storage, { name: '   ', zones: [zone()] }).ok, false);
  assert.ok(codes(saveTemplate(storage, { name: 'X', zones: [] })).includes('invalid-zones'));
});

test('storage is capped: quota failures and the template limit are reported, not thrown', () => {
  assert.doesNotThrow(() => saveTemplate(throwingStorage(), { name: 'X', zones: [zone()] }));
  const quota = saveTemplate(throwingStorage(), { name: 'X', zones: [zone()] });
  assert.equal(quota.ok, false);
  assert.ok(codes(quota).includes('storage-failed'));

  const unavailable = saveTemplate(null, { name: 'X', zones: [zone()] });
  assert.equal(unavailable.ok, false);
  assert.ok(codes(unavailable).includes('storage-unavailable'));

  const full = Array.from({ length: MAX_ZONE_TEMPLATES }, (_, index) => ({
    id: `sablon-${index}`,
    name: `Șablon ${index}`,
    camera_id: null,
    zones: [zone({ zone_id: `zona-${index}`, name: `Zona ${index}` })],
    saved_at: '2026-01-01T00:00:00.000Z',
  }));
  const storage = memoryStorage({ [ZONE_TEMPLATE_STORAGE_KEY]: JSON.stringify(full) });
  assert.equal(readTemplates(storage).length, MAX_ZONE_TEMPLATES);
  const tooMany = saveTemplate(storage, { name: 'Încă unul', zones: [zone()] });
  assert.equal(tooMany.ok, false);
  assert.ok(codes(tooMany).includes('too-many'));
  assert.equal(readTemplates(storage).length, MAX_ZONE_TEMPLATES);
});

test('readTemplates tolerates corrupt, oversized and partly invalid storage', () => {
  assert.deepEqual(readTemplates(memoryStorage({ [ZONE_TEMPLATE_STORAGE_KEY]: '{oops' })), []);
  assert.deepEqual(readTemplates(memoryStorage({ [ZONE_TEMPLATE_STORAGE_KEY]: '{"not":"a list"}' })), []);
  assert.deepEqual(
    readTemplates(memoryStorage({ [ZONE_TEMPLATE_STORAGE_KEY]: 'x'.repeat(MAX_TEMPLATE_STORAGE_CHARS + 1) })),
    []
  );
  assert.deepEqual(readTemplates(null), []);
  assert.doesNotThrow(() => readTemplates(undefined));

  const mixed = [
    { id: 'sablon-bun', name: 'Bun', camera_id: null, zones: [zone()], saved_at: '2026-01-01T00:00:00.000Z' },
    { id: 'sablon-bun', name: 'Duplicat', camera_id: null, zones: [zone()] },
    { id: 'sablon-fara-zone', name: 'Fără zone', camera_id: null, zones: [] },
    { id: 'sablon-polygon', name: 'Poligon rupt', camera_id: null, zones: [zone({ polygon: SQUARE.slice(0, 2) })] },
    { id: '!!!', name: 'ID invalid', camera_id: null, zones: [zone()] },
    'not a template',
  ];
  const read = readTemplates(memoryStorage({ [ZONE_TEMPLATE_STORAGE_KEY]: JSON.stringify(mixed) }));
  assert.deepEqual(read.map((template) => template.name), ['Bun']);
});

test('a camera sees its own templates first, then the global ones', () => {
  const templates = [
    { id: 'g1', name: 'Global 1', camera_id: null, zones: [zone()] },
    { id: 'c1', name: 'Camera 1', camera_id: 'stand12', zones: [zone()] },
    { id: 'other', name: 'Alta cameră', camera_id: 'taxiway-b', zones: [zone()] },
    { id: 'c2', name: 'Camera 2', camera_id: 'stand12', zones: [zone()] },
    { id: 'g2', name: 'Global 2', camera_id: null, zones: [zone()] },
  ];
  assert.deepEqual(
    templateForCamera(templates, 'stand12').map((template) => template.id),
    ['c1', 'c2', 'g1', 'g2']
  );
  assert.deepEqual(
    templateForCamera(templates, 'unknown').map((template) => template.id),
    ['g1', 'g2']
  );
  assert.deepEqual(templateForCamera(null, 'stand12'), []);
});

test('the apply payload is the contract zone shape for one camera', () => {
  const source = { ...zone(), reference_frame_url: 'http://localhost/zone.png' };
  const payload = toZonePayload(source, 'taxiway-b');
  assert.deepEqual(payload, {
    zone_id: 'engine-left',
    camera_id: 'taxiway-b',
    name: 'Motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    required_ppe: ['ear_defenders', 'hi_vis_vest'],
    severity: 'CRITICAL',
    debounce_s: 0.5,
    notify_channel: 'slack',
    escalate_after_s: 120,
    polygon: source.polygon,
  });
  assert.equal('reference_frame' in payload, false);
  assert.equal('reference_frame_url' in payload, false);
  assert.notEqual(payload.polygon, source.polygon, 'polygon is copied, not shared');
  assert.equal(zoneExportFileName('stand12', new Date('2026-07-08T09:10:11.000Z')), 'LocalSight_zone_stand12_2026-07-08.json');
});
