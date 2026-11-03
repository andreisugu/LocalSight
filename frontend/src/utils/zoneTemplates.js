// Zone templates: export a camera's polygons, import them on another camera, and keep
// named templates in localStorage so an operator does not redraw every zone.
//
// Everything here is pure and Node-testable. localStorage is untrusted input: a key can
// be planted from DevTools, left by an older build or be larger than the quota, so every
// read is capped and validated, and a bad blob means "no templates" instead of an
// exception. Imported files are untrusted in the same way: `parseZoneTemplate` never
// throws and rejects the whole file instead of silently merging half of it.
//
// A zone keeps the contract fields (`docs/contract.md`): normalised 0..1 polygon points,
// `zone_id`, `name`, `rule_type`, `active_when`, `severity`, `debounce_s`,
// `notify_channel: 'slack'`, `escalate_after_s` and `required_ppe`. Nothing about the
// zone schema changes here; this module only moves that shape between cameras.

import { slugify, uniqueZoneId } from './zoneDraft.js';
import { readStoredJson } from './storage.js';

/** The single localStorage key that holds every named template. */
export const ZONE_TEMPLATE_STORAGE_KEY = 'localsight.zoneTemplates';

/** Marker in an exported file, so a foreign JSON is rejected with a readable message. */
export const ZONE_TEMPLATE_APP = 'LocalSight';

/** Bumped only if the exported envelope changes shape. */
export const ZONE_TEMPLATE_SCHEMA = 1;

/** Rule types the zone editor and the engine understand. */
export const ZONE_RULE_TYPES = Object.freeze([
  'RESTRICTED',
  'PPE_REQUIRED',
  'NO_SMOKING',
  'CROWD_WATCH',
]);

/** `RESOLVED` is an incident status, never a zone severity. */
export const ZONE_SEVERITIES = Object.freeze(['CRITICAL', 'WARNING']);

/** When a rule fires. Anything else would be guessed at, so it is rejected. */
export const ZONE_ACTIVE_WHEN = Object.freeze(['always', 'engine_on']);

/** Caps: 20 templates, 40 zones each, 64k characters per file and 256k for the key. */
export const MAX_ZONE_TEMPLATES = 20;
export const MAX_ZONES_PER_TEMPLATE = 40;
export const MAX_TEMPLATE_CHARS = 64 * 1024;
export const MAX_TEMPLATE_STORAGE_CHARS = 256 * 1024;
export const MAX_TEMPLATE_NAME_CHARS = 60;
export const MAX_ZONE_POINTS = 200;

/** Coordinates are compared with this tolerance, then rounded for storage. */
const FRAME_EPSILON = 1e-6;

/** Defaults for a rule field a file left out. A missing field is not a fatal error. */
const DEFAULT_DEBOUNCE_S = 1;
const MAX_DEBOUNCE_S = 600;
const MAX_ESCALATE_S = 86_400;
const MAX_REQUIRED_PPE = 10;

/**
 * The browser's localStorage, or null. Private mode, a hostile getter and Node (where
 * there is no `window`) all mean "no templates", never a crash while rendering.
 * @returns {Storage|null}
 */
export function templateStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isoStamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

function fail(code, message) {
  return { ok: false, zones: [], errors: [{ code, message }] };
}

function note(code, message, extra = {}) {
  return { code, message, ...extra };
}

/** One point, or the reason it is unusable. Order is never changed. */
function normalizePoint(raw, index, pointIndex) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  const where = `Zona ${index + 1}, punctul ${pointIndex + 1}`;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { point: null, error: note('invalid-point', `${where}: coordonatele trebuie să fie numere.`, { index }) };
  }
  if (x < -FRAME_EPSILON || x > 1 + FRAME_EPSILON || y < -FRAME_EPSILON || y > 1 + FRAME_EPSILON) {
    return { point: null, error: note('point-out-of-frame', `${where}: coordonatele trebuie să fie între 0 și 1.`, { index }) };
  }
  return { point: { x: round4(Math.max(0, Math.min(1, x))), y: round4(Math.max(0, Math.min(1, y))) }, error: null };
}

/** A polygon of at least three points, or the reasons it was rejected. */
function normalizePolygon(raw, index) {
  if (!Array.isArray(raw)) {
    return { points: null, errors: [note('missing-polygon', `Zona ${index + 1}: poligonul lipsește.`, { index })] };
  }
  if (raw.length < 3) {
    return {
      points: null,
      errors: [note('too-few-points', `Zona ${index + 1}: poligonul are nevoie de minimum 3 puncte.`, { index })],
    };
  }
  if (raw.length > MAX_ZONE_POINTS) {
    return {
      points: null,
      errors: [note('too-many-points', `Zona ${index + 1}: maximum ${MAX_ZONE_POINTS} puncte.`, { index })],
    };
  }
  const points = [];
  const errors = [];
  raw.forEach((rawPoint, pointIndex) => {
    const { point, error } = normalizePoint(rawPoint, index, pointIndex);
    if (error) errors.push(error);
    else points.push(point);
  });
  return { points: errors.length === 0 ? points : null, errors };
}

function normalizeDebounce(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_DEBOUNCE_S;
  return Math.min(MAX_DEBOUNCE_S, round4(value));
}

function normalizeEscalation(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(MAX_ESCALATE_S, round4(value));
}

function normalizePpe(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim().slice(0, 40);
    if (value) seen.add(value);
    if (seen.size >= MAX_REQUIRED_PPE) break;
  }
  return [...seen];
}

/**
 * One zone from untrusted input. The polygon is fatal (no polygon, no zone); the other
 * fields fall back to the defaults of the editor so an older export still imports.
 * Returns the converted zone even when a field was reported, so export stays best-effort
 * while import can still refuse the file when `errors` is not empty.
 */
function convertZone(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      zone: null,
      errors: [note('not-object', `Zona ${index + 1} nu este un obiect.`, { index })],
    };
  }
  const errors = [];
  const rawId = raw.zone_id ?? raw.id ?? '';
  let zoneId = '';
  if (typeof rawId === 'string' && rawId.trim() !== '') {
    zoneId = slugify(rawId);
    if (!zoneId) {
      errors.push(note('invalid-id', `Zona ${index + 1}: ID invalid „${rawId.slice(0, 40)}”.`, { index, field: 'zone_id' }));
    }
  } else if (rawId !== '' && rawId !== null && rawId !== undefined) {
    errors.push(note('invalid-id', `Zona ${index + 1}: ID-ul trebuie să fie text.`, { index, field: 'zone_id' }));
  }

  const ruleType = raw.rule_type;
  if (!ZONE_RULE_TYPES.includes(ruleType)) {
    errors.push(
      note('unknown-rule', `Zona ${index + 1}: tip de regulă necunoscut („${String(ruleType)}”).`, {
        index,
        field: 'rule_type',
      })
    );
  }
  const severity = raw.severity;
  if (!ZONE_SEVERITIES.includes(severity)) {
    errors.push(
      note('unknown-severity', `Zona ${index + 1}: severitatea poate fi doar CRITICAL sau WARNING.`, {
        index,
        field: 'severity',
      })
    );
  }
  const activeWhen = raw.active_when ?? 'always';
  if (!ZONE_ACTIVE_WHEN.includes(activeWhen)) {
    errors.push(
      note('unknown-active-when', `Zona ${index + 1}: active_when poate fi doar always sau engine_on.`, {
        index,
        field: 'active_when',
      })
    );
  }

  const polygon = normalizePolygon(raw.polygon, index);
  errors.push(...polygon.errors);
  if (!polygon.points) return { zone: null, errors };

  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, MAX_TEMPLATE_NAME_CHARS)
      : '';
  return {
    zone: {
      zone_id: zoneId,
      name: name || zoneId,
      rule_type: ZONE_RULE_TYPES.includes(ruleType) ? ruleType : 'RESTRICTED',
      active_when: ZONE_ACTIVE_WHEN.includes(activeWhen) ? activeWhen : 'always',
      severity: ZONE_SEVERITIES.includes(severity) ? severity : 'WARNING',
      debounce_s: normalizeDebounce(raw.debounce_s),
      notify_channel: 'slack',
      escalate_after_s: normalizeEscalation(raw.escalate_after_s),
      required_ppe: normalizePpe(raw.required_ppe),
      polygon: polygon.points,
    },
    errors,
  };
}

/**
 * Validate a zone list for import or for a named template. Any error rejects the whole
 * list, so a half-valid file can never replace a camera's zones by accident.
 *
 * @param {unknown} rawZones
 * @param {{maxZones?: number}} [options]
 * @returns {{ok: boolean, zones: Array<object>, errors: Array<{code: string, message: string, index?: number}>}}
 */
export function normalizeZones(rawZones, { maxZones = MAX_ZONES_PER_TEMPLATE } = {}) {
  if (!Array.isArray(rawZones)) {
    return fail('not-array', 'Fișierul nu conține o listă de zone.');
  }
  if (rawZones.length === 0) {
    return fail('no-zones', 'Nu există nicio zonă în fișier.');
  }
  if (rawZones.length > maxZones) {
    return fail('too-many-zones', `Maximum ${maxZones} zone într-un șablon.`);
  }
  const errors = [];
  const zones = [];
  const seen = new Set();
  rawZones.forEach((raw, index) => {
    const { zone, errors: zoneErrors } = convertZone(raw, index);
    if (zoneErrors.length > 0) {
      errors.push(...zoneErrors);
      return;
    }
    if (zone.zone_id) {
      if (seen.has(zone.zone_id)) {
        errors.push(note('duplicate-id', `ID duplicat în fișier: „${zone.zone_id}”.`, { index, field: 'zone_id' }));
      } else {
        seen.add(zone.zone_id);
      }
    }
    zones.push(zone);
  });
  const ok = errors.length === 0;
  return { ok, zones: ok ? zones : [], errors };
}

/**
 * The exported envelope. Stable key order, plain data only (no functions, no reference
 * frame URL — that URL belongs to one camera and one tab), rounded points, polygon order
 * preserved. `camera_id` is only a hint for the operator: importing into another camera
 * is the point of the file.
 *
 * @param {Array<object>} zones
 * @param {{cameraId?: string|null, now?: Date|string|number}} [options]
 */
export function exportZones(zones = [], { cameraId = null, now = new Date() } = {}) {
  const list = (Array.isArray(zones) ? zones : [])
    .map((zone, index) => convertZone(zone, index).zone)
    .filter(Boolean);
  const payload = {
    app: ZONE_TEMPLATE_APP,
    schema: ZONE_TEMPLATE_SCHEMA,
    exported_at: isoStamp(now),
  };
  if (typeof cameraId === 'string' && cameraId.trim()) payload.camera_id = cameraId.trim();
  payload.zones = list;
  return payload;
}

/**
 * Parse an exported file or a bare zone array, the two shapes an operator may have.
 * Never throws: a broken file comes back as `{ok: false, errors}` with a readable reason.
 *
 * @param {string} text
 * @returns {{ok: boolean, zones: Array<object>, errors: Array<object>, cameraId: string|null, exportedAt: string|null}}
 */
export function parseZoneTemplate(text) {
  const rejected = (code, message) => ({
    ok: false,
    zones: [],
    errors: [note(code, message)],
    cameraId: null,
    exportedAt: null,
  });
  if (typeof text !== 'string' || text.trim() === '') {
    return rejected('empty-file', 'Fișierul este gol.');
  }
  if (text.length > MAX_TEMPLATE_CHARS) {
    return rejected('file-too-large', `Fișierul depășește ${Math.round(MAX_TEMPLATE_CHARS / 1024)} KB.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rejected('invalid-json', 'JSON invalid: fișierul nu poate fi citit.');
  }
  if (Array.isArray(parsed)) {
    const result = normalizeZones(parsed);
    return { ...result, cameraId: null, exportedAt: null };
  }
  if (!parsed || typeof parsed !== 'object') {
    return rejected('not-zone-file', 'Fișierul nu conține zone.');
  }
  if (parsed.schema !== undefined && Number(parsed.schema) !== ZONE_TEMPLATE_SCHEMA) {
    return rejected('unsupported-schema', `Versiune de fișier necunoscută (schema ${String(parsed.schema)}).`);
  }
  if (parsed.app !== undefined && parsed.app !== ZONE_TEMPLATE_APP) {
    return rejected('foreign-file', `Fișierul nu a fost exportat din ${ZONE_TEMPLATE_APP}.`);
  }
  const result = normalizeZones(parsed.zones);
  return {
    ...result,
    cameraId: typeof parsed.camera_id === 'string' && parsed.camera_id.trim() ? parsed.camera_id.trim() : null,
    exportedAt: typeof parsed.exported_at === 'string' ? parsed.exported_at : null,
  };
}

/**
 * Give every zone a usable id. An id from the file is preserved unless another camera
 * already owns it (zone ids are global in the store, so a collision would overwrite that
 * other camera). A zone without an id gets a fresh one from its name.
 *
 * @param {Array<object>} zones
 * @param {Array<string>} takenIds ids that are already used and must not be reused
 */
export function assignZoneIds(zones = [], takenIds = []) {
  const taken = new Set((Array.isArray(takenIds) ? takenIds : []).map((id) => String(id)));
  return (Array.isArray(zones) ? zones : []).map((zone) => {
    const given = typeof zone?.zone_id === 'string' ? slugify(zone.zone_id) : '';
    if (given && !taken.has(given)) {
      taken.add(given);
      return { ...zone, zone_id: given };
    }
    const next = uniqueZoneId(given || zone?.name || 'zona', [...taken].map((id) => ({ zone_id: id })));
    taken.add(next);
    return { ...zone, zone_id: next };
  });
}

/** The PUT payload for applying a template zone to a camera. */
export function toZonePayload(zone, cameraId) {
  return {
    zone_id: zone.zone_id,
    camera_id: cameraId,
    name: zone.name || zone.zone_id,
    rule_type: zone.rule_type,
    active_when: zone.active_when,
    required_ppe: [...(zone.required_ppe || [])],
    severity: zone.severity,
    debounce_s: Number(zone.debounce_s) || 0,
    notify_channel: 'slack',
    escalate_after_s: zone.escalate_after_s ?? null,
    polygon: (zone.polygon || []).map(({ x, y }) => ({ x, y })),
  };
}

/** Download name for the current camera's zones; stable, no spaces. */
export function zoneExportFileName(cameraId, now = new Date()) {
  const camera = slugify(cameraId) || 'camera';
  const stamp = isoStamp(now).slice(0, 10);
  return `LocalSight_zone_${camera}_${stamp}.json`;
}

/** One stored template from untrusted JSON; null when it cannot be applied safely. */
function templateFromRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? slugify(raw.id) : '';
  if (!id) return null;
  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, MAX_TEMPLATE_NAME_CHARS) : '';
  if (!name) return null;
  const result = normalizeZones(raw.zones);
  if (!result.ok) return null;
  const cameraId =
    typeof raw.camera_id === 'string' && raw.camera_id.trim() ? raw.camera_id.trim().slice(0, 80) : null;
  const savedAt = typeof raw.saved_at === 'string' && raw.saved_at ? raw.saved_at : null;
  return { id, name, camera_id: cameraId, zones: result.zones, saved_at: savedAt };
}

/**
 * Every valid template, newest first as stored. Missing, oversized, corrupt or partially
 * invalid content is dropped, never guessed at.
 * @param {Storage|null} [storage]
 */
export function readTemplates(storage = templateStorage()) {
  const parsed = readStoredJson(storage, ZONE_TEMPLATE_STORAGE_KEY, {
    maxChars: MAX_TEMPLATE_STORAGE_CHARS,
  });
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const templates = [];
  for (const raw of parsed) {
    const template = templateFromRaw(raw);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id);
    templates.push(template);
    if (templates.length >= MAX_ZONE_TEMPLATES) break;
  }
  return templates;
}

function writeTemplates(storage, templates) {
  const blob = JSON.stringify(templates);
  if (blob.length > MAX_TEMPLATE_STORAGE_CHARS) {
    return {
      ok: false,
      blob,
      error: note('too-large', `Șabloanele depășesc ${Math.round(MAX_TEMPLATE_STORAGE_CHARS / 1024)} KB. Șterge unul vechi.`),
    };
  }
  if (!storage || typeof storage.setItem !== 'function') {
    return { ok: false, blob, error: note('storage-unavailable', 'Stocarea locală nu este disponibilă în acest browser.') };
  }
  try {
    storage.setItem(ZONE_TEMPLATE_STORAGE_KEY, blob);
  } catch {
    return {
      ok: false,
      blob,
      error: note('storage-failed', 'Stocarea locală este plină sau blocată. Șterge un șablon și încearcă din nou.'),
    };
  }
  return { ok: true, blob, error: null };
}

function templateIdFor(name, templates, now) {
  const slug = slugify(name) || 'sablon';
  const stamp = Number(new Date(isoStamp(now)).getTime() || 0)
    .toString(36)
    .slice(-5);
  const base = `sablon-${slug}-${stamp}`;
  const taken = new Set(templates.map((template) => template.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Save the current camera as a named template. A name is never silently overwritten: the
 * same name in the same scope (this camera or global) is refused, and the caller decides
 * whether to delete the old one first.
 *
 * @param {Storage|null} storage
 * @param {{name: string, cameraId?: string|null, zones: Array<object>, now?: Date}} input
 */
export function saveTemplate(storage, { name, cameraId = null, zones, now = new Date() } = {}) {
  const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_TEMPLATE_NAME_CHARS) : '';
  if (!cleanName) {
    return { ok: false, templates: [], template: null, errors: [note('missing-name', 'Dă un nume șablonului.')] };
  }
  const result = normalizeZones(zones);
  if (!result.ok) {
    return {
      ok: false,
      templates: [],
      template: null,
      errors: [note('invalid-zones', 'Zonele camerei nu pot fi salvate ca șablon.'), ...result.errors],
    };
  }
  const scope = typeof cameraId === 'string' && cameraId.trim() ? cameraId.trim() : null;
  const templates = readTemplates(storage);
  const duplicate = templates.find(
    (template) => template.camera_id === scope && template.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicate) {
    return {
      ok: false,
      templates,
      template: null,
      errors: [
        note(
          'duplicate-name',
          `Există deja șablonul „${duplicate.name}” pentru ${scope ? `camera ${scope}` : 'toate camerele'}. Alege alt nume.`
        ),
      ],
    };
  }
  if (templates.length >= MAX_ZONE_TEMPLATES) {
    return {
      ok: false,
      templates,
      template: null,
      errors: [note('too-many', `Ai atins limita de ${MAX_ZONE_TEMPLATES} șabloane. Șterge unul înainte de a salva.`)],
    };
  }
  const template = {
    id: templateIdFor(cleanName, templates, now),
    name: cleanName,
    camera_id: scope,
    zones: assignZoneIds(result.zones),
    saved_at: isoStamp(now),
  };
  const next = [template, ...templates];
  const written = writeTemplates(storage, next);
  if (!written.ok) {
    return { ok: false, templates, template: null, errors: [written.error] };
  }
  return { ok: true, templates: next, template, errors: [] };
}

/** Remove one template by id. The cameras themselves are untouched. */
export function deleteTemplate(storage, templateId) {
  const templates = readTemplates(storage);
  const next = templates.filter((template) => template.id !== templateId);
  if (next.length === templates.length) {
    return { ok: false, templates, errors: [note('missing', 'Șablonul nu mai există.')] };
  }
  const written = writeTemplates(storage, next);
  if (!written.ok) return { ok: false, templates, errors: [written.error] };
  return { ok: true, templates: next, errors: [] };
}

/**
 * The templates offered for one camera: the ones saved for it first (newest first), then
 * the global ones. Another camera's templates are not offered, so applying one cannot
 * silently move somebody else's polygons.
 */
export function templateForCamera(templates, cameraId) {
  const list = (Array.isArray(templates) ? templates : []).filter(
    (template) => template && typeof template === 'object' && Array.isArray(template.zones)
  );
  const specific = cameraId ? list.filter((template) => template.camera_id === cameraId) : [];
  const global = list.filter((template) => template.camera_id === null || template.camera_id === undefined);
  return [...specific, ...global];
}
