// The local evidence archive: one JSON file with the incidents, snapshots and acks that
// otherwise live only in this browser's IndexedDB.
//
// The static build has no backend, so `evidencePersistence.js` is the only durable copy of
// an incident. A tab can be cleared, a private window closed, a demo laptop wiped. This
// module turns that store into a file the operator can keep and nothing else: no upload,
// no server, no third-party host.
//
// What is written (schema 1):
//
// {
//   "app": "LocalSight",
//   "schema": 1,
//   "exported_at": "2026-11-03T10:33:00.000Z",
//   "counts": { "events": 1, "evidence": 1, "acks": 1 },
//   "events":   [ <the incident envelope, exactly as the list shows it> ],
//   "evidence": [ { "event_id", "mime", "size", "base64" } ],
//   "acks":     [ { "event_id", "override": { "status", ... } } ],
//   "meta":     [ { "key": "schema_version", "value": 1 } ]
// }
//
// The archive is not the database schema and does not pretend to be: the stores wrap the
// same data (`{event_id, schema, stored_at, event}`) while the file is readable. The
// IndexedDB writer (`evidenceArchiveDb.js`) rebuilds those wrappers on import, in one
// transaction, and never writes a record the persistence store would later skip.
//
// This file is pure: no DOM, no IndexedDB, no network. `Blob` and `TextEncoder` are used
// only when the caller passes a blob or a string; Node ships both, so the unit tests run
// without a browser. Base64 is implemented here instead of `btoa`/`Buffer` so a decode is
// strict and identical in both runtimes, and so a corrupt string cannot slip through.
//
// Import is replace-only by design. A merge would let a stale file overwrite a confirmed
// incident without anyone deciding that; the summary says what is new, identical or
// different and the operator confirms the replacement explicitly.

/** Marker in the JSON; anything else is not ours. */
export const ARCHIVE_APP = 'LocalSight';
/** File schema. Bump only with a parser that also understands the old one. */
export const ARCHIVE_SCHEMA = 1;

/** Bounds, so a hostile or corrupt file cannot exhaust the tab. */
export const ARCHIVE_LIMITS = Object.freeze({
  /** Download size cap; also the first check before parsing. */
  maxBytes: 50 * 1024 * 1024,
  /** The persistence store keeps at most 200 incidents, so a bigger file is a bug. */
  maxEvents: 200,
  maxEvidence: 200,
  maxAcks: 400,
  maxMeta: 20,
  /** One snapshot: the engine's blurred JPEGs are far below this. */
  maxEvidenceBytes: 8 * 1024 * 1024,
  maxIdLength: 200,
  maxExportDateLength: 64,
});

/** The only image formats the snapshot panel can render and the store can have written. */
export const ARCHIVE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/** The operator statuses a confirmation can carry (`theme/status.js` owns the labels). */
export const ARCHIVE_ACK_STATUSES = Object.freeze([
  'open',
  'acknowledged',
  'escalated',
  'false_positive',
  'resolved',
]);

/** Fields an ack override owns, mirroring `ACK_FIELDS` in the persistence store. */
const ACK_FIELDS = Object.freeze([
  'status',
  'acked_at',
  'acked_by',
  'escalated_at',
  'false_positive_by',
  'false_positive_note',
]);

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();
/** Chunk size used while encoding, so one huge string allocation does not double memory. */
const BASE64_CHUNK = 8192;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value !== '';
const isStatus = (value) => ARCHIVE_ACK_STATUSES.includes(value);
const isMime = (value) => ARCHIVE_MIME_TYPES.includes(value);

/**
 * Contract event types are upper-case identifiers (`RESTRICTED_ZONE`, `NO_PPE`). Checking
 * the shape keeps a foreign file from using a prototype key or arbitrary markup as a label;
 * the screens look the value up in a plain object, and React only ever renders strings.
 */
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A typed failure; `code` is what the UI branches on, the message is already readable. */
export class ArchiveError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

/** UTF-8 byte length of a string, without a dependency on the platform's encoder. */
function utf8Length(text) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  // Conservative fallback for an environment without TextEncoder: UTF-16 units.
  return text.length * 2;
}

/**
 * Incident ids are machine-generated (`evt_...`). Restricting the alphabet keeps a foreign
 * or hostile file from smuggling control characters into an IndexedDB key and a DOM label.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEventId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > ARCHIVE_LIMITS.maxIdLength) return false;
  return /^[A-Za-z0-9_.:@/-]+$/.test(value);
}

/** Stable JSON for equality checks: object keys sorted, array order kept. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Deep copy through JSON, the same per-record guarantee the persistence store gives. */
function jsonCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** Validate one incident envelope and return a private copy (never the caller's object). */
function normalizeEvent(value) {
  if (!isObject(value) || !isValidEventId(value.event_id)) {
    throw new ArchiveError('bad-events', 'Un incident din fișier nu are un event_id valid.');
  }
  const copy = jsonCopy(value);
  if (!copy || copy.event_id !== value.event_id) {
    throw new ArchiveError('bad-events', `Incidentul ${value.event_id} nu poate fi citit ca JSON.`);
  }
  if ('type' in copy && !(typeof copy.type === 'string' && EVENT_TYPE_PATTERN.test(copy.type))) {
    throw new ArchiveError('bad-events', `Incidentul ${value.event_id} are un tip necunoscut.`);
  }
  return copy;
}

/** Validate and normalise an ack override; unknown fields are dropped, known ones typed. */
function normalizeOverride(value) {
  if (!isObject(value) || !isStatus(value.status)) {
    throw new ArchiveError('bad-acks', 'O confirmare din fișier nu are un status cunoscut.');
  }
  const override = { status: value.status };
  for (const field of ACK_FIELDS) {
    if (field === 'status' || !(field in value)) continue;
    const fieldValue = value[field];
    if (fieldValue === null || typeof fieldValue === 'string') override[field] = fieldValue;
    else throw new ArchiveError('bad-acks', `Câmpul ${field} al unei confirmări nu e text sau null.`);
  }
  return override;
}

/** Decode base64 strictly: alphabet, padding, length. Throws `ArchiveError`. */
function decodeBase64(text, maxBytes) {
  if (typeof text !== 'string') {
    throw new ArchiveError('bad-base64', 'Snapshot-ul nu are un câmp base64 text.');
  }
  if (text.length % 4 !== 0) {
    throw new ArchiveError('bad-base64', 'Snapshot-ul are base64 cu lungime invalidă.');
  }
  if (/[^A-Za-z0-9+/=]/.test(text)) {
    throw new ArchiveError('bad-base64', 'Snapshot-ul are caractere care nu sunt base64.');
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (text.slice(0, text.length - padding).includes('=')) {
    throw new ArchiveError('bad-base64', 'Snapshot-ul are padding base64 în mijloc.');
  }
  const byteLength = (text.length / 4) * 3 - padding;
  if (maxBytes != null && byteLength > maxBytes) {
    throw new ArchiveError('bad-evidence', 'Un snapshot din fișier depășește limita de 8 MB.');
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < text.length; index += 4) {
    const last = index + 4 === text.length;
    const pad = last ? padding : 0;
    const a = BASE64_LOOKUP[text.charCodeAt(index)];
    const b = BASE64_LOOKUP[text.charCodeAt(index + 1)];
    const c = pad === 2 ? 0 : BASE64_LOOKUP[text.charCodeAt(index + 2)];
    const d = pad >= 1 ? 0 : BASE64_LOOKUP[text.charCodeAt(index + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new ArchiveError('bad-base64', 'Snapshot-ul are caractere care nu sunt base64.');
    }
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < byteLength) bytes[offset] = (chunk >> 16) & 0xff;
    offset += 1;
    if (offset < byteLength) bytes[offset] = (chunk >> 8) & 0xff;
    offset += 1;
    if (offset < byteLength) bytes[offset] = chunk & 0xff;
    offset += 1;
  }
  return bytes;
}

/**
 * Encode bytes as padded base64. Written out instead of using `btoa` so the same code runs
 * in Node and in the browser, and so a 40 MB archive does not hit a call-stack limit.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new ArchiveError('bad-blob', 'Snapshot-ul nu poate fi citit ca bytes.');
  }
  const parts = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const a = bytes[index];
    const b = remaining > 1 ? bytes[index + 1] : 0;
    const c = remaining > 2 ? bytes[index + 2] : 0;
    chunk += BASE64_ALPHABET[a >> 2];
    chunk += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    chunk += remaining > 1 ? BASE64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)] : '=';
    chunk += remaining > 2 ? BASE64_ALPHABET[c & 0x3f] : '=';
    if (chunk.length >= BASE64_CHUNK) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join('');
}

/**
 * Read a stored snapshot as base64.
 *
 * @param {Blob|{arrayBuffer: Function}} blob
 * @returns {Promise<string>}
 */
export async function blobToBase64(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new ArchiveError('bad-blob', 'Un snapshot salvat nu poate fi citit ca Blob.');
  }
  let buffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    throw new ArchiveError('bad-blob', 'Un snapshot salvat nu a putut fi citit.');
  }
  return encodeBase64(new Uint8Array(buffer));
}

/**
 * Turn an archive snapshot back into a Blob the store can keep and the page can render.
 *
 * @param {string} base64
 * @param {string} [mime]
 * @returns {Blob}
 */
export function base64ToBlob(base64, mime = 'image/jpeg') {
  if (!isMime(mime)) {
    throw new ArchiveError('bad-evidence', `Tipul ${mime} nu este o imagine acceptată.`);
  }
  const bytes = decodeBase64(base64, ARCHIVE_LIMITS.maxEvidenceBytes);
  return new Blob([bytes], { type: mime });
}

/**
 * The download name: UTC, because the file may be imported in another timezone and the
 * stamp is an identifier, not a local clock reading.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function archiveFilename(date = new Date()) {
  const stamp = date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : new Date(0).toISOString();
  const day = stamp.slice(0, 10).replace(/-/g, '');
  const time = stamp.slice(11, 19).replace(/:/g, '');
  return `localsight-archive-${day}-${time}.json`;
}

/**
 * Counts of the three arrays, recomputed rather than trusted from the file.
 *
 * @param {{events?: Array<unknown>, evidence?: Array<unknown>, acks?: Array<unknown>}} archive
 * @returns {{events: number, evidence: number, acks: number}}
 */
export function archiveCounts(archive) {
  return {
    events: Array.isArray(archive?.events) ? archive.events.length : 0,
    evidence: Array.isArray(archive?.evidence) ? archive.evidence.length : 0,
    acks: Array.isArray(archive?.acks) ? archive.acks.length : 0,
  };
}

/**
 * Build the archive object from the raw rows `readLocalEvidence()` returns.
 *
 * Rows that cannot be encoded abort the export: a backup that silently leaves a snapshot
 * out is worse than an error that says which one failed.
 *
 * @param {{
 *   events?: Array<object>,
 *   evidence?: Array<object>,
 *   acks?: Array<object>,
 *   meta?: Array<object>,
 *   now?: Date|number,
 * }} input
 * @returns {Promise<object>} the archive, ready for `JSON.stringify`
 */
export async function serializeArchive({
  events = [],
  evidence = [],
  acks = [],
  meta = [],
  now = new Date(),
} = {}) {
  if (!Array.isArray(events) || !Array.isArray(evidence) || !Array.isArray(acks)) {
    throw new ArchiveError('bad-archive', 'Arhiva nu poate fi construită din aceste rânduri.');
  }
  const date = now instanceof Date ? now : new Date(now);
  const exportedAt = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();

  const normalizedEvents = events.map((record) => {
    // `readLocalEvidence` returns wrappers; a test or a caller may pass bare incidents.
    const event = isObject(record?.event) ? record.event : record;
    if (!isObject(event) || !isValidEventId(event.event_id)) {
      throw new ArchiveError('bad-events', 'Un incident salvat nu are un event_id valid.');
    }
    if (record?.event_id != null && record.event_id !== event.event_id) {
      throw new ArchiveError('bad-events', `Incidentul ${record.event_id} are alt id în interior.`);
    }
    return normalizeEvent(event);
  });

  const evidenceItems = [];
  for (const record of evidence) {
    if (!isObject(record) || !isValidEventId(record.event_id)) {
      throw new ArchiveError('bad-evidence', 'Un snapshot salvat nu are un event_id valid.');
    }
    const mime = isMime(record.type) ? record.type : isMime(record.mime) ? record.mime : 'image/jpeg';
    let base64;
    let size;
    if (isText(record.base64)) {
      // Already encoded (a test or a re-export): validate it before trusting the size.
      base64 = record.base64;
      size = decodeBase64(base64, ARCHIVE_LIMITS.maxEvidenceBytes).length;
    } else {
      const blob = record.blob;
      if (!blob || typeof blob.arrayBuffer !== 'function') {
        throw new ArchiveError('bad-blob', `Snapshot-ul ${record.event_id} nu poate fi citit.`);
      }
      let bytes;
      try {
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch {
        throw new ArchiveError('bad-blob', `Snapshot-ul ${record.event_id} nu a putut fi citit.`);
      }
      if (bytes.length > ARCHIVE_LIMITS.maxEvidenceBytes) {
        throw new ArchiveError('bad-evidence', `Snapshot-ul ${record.event_id} depășește 8 MB.`);
      }
      base64 = encodeBase64(bytes);
      size = bytes.length;
    }
    evidenceItems.push({ event_id: record.event_id, mime, size, base64 });
  }

  const ackItems = acks.map((record) => {
    if (!isObject(record) || !isValidEventId(record.event_id)) {
      throw new ArchiveError('bad-acks', 'O confirmare salvată nu are un event_id valid.');
    }
    return { event_id: record.event_id, override: normalizeOverride(record.override ?? record) };
  });

  const metaItems = (Array.isArray(meta) ? meta : []).map((record) => {
    if (!isObject(record) || !isText(record.key)) {
      throw new ArchiveError('bad-meta', 'Un rând meta salvat nu are cheie.');
    }
    const value = record.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new ArchiveError('bad-meta', `Cheia meta ${record.key} are o valoare neacceptată.`);
    }
    return { key: record.key, value };
  });

  return {
    app: ARCHIVE_APP,
    schema: ARCHIVE_SCHEMA,
    exported_at: exportedAt,
    counts: {
      events: normalizedEvents.length,
      evidence: evidenceItems.length,
      acks: ackItems.length,
    },
    events: normalizedEvents,
    evidence: evidenceItems,
    acks: ackItems,
    meta: metaItems,
  };
}

/**
 * Parse and validate the text of a chosen file. Never throws: the caller gets a result it
 * can print, and nothing is written until the operator confirms.
 *
 * @param {string} text
 * @param {{ limits?: object }} [options]
 * @returns {{ok: true, archive: object}|{ok: false, code: string, error: string}}
 */
export function parseArchive(text, { limits = ARCHIVE_LIMITS } = {}) {
  try {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ArchiveError('empty-file', 'Fișierul este gol.');
    }
    // Cheap check first: a UTF-8 string is never shorter than its UTF-16 length.
    if (text.length > limits.maxBytes || utf8Length(text) > limits.maxBytes) {
      throw new ArchiveError(
        'too-large',
        `Fișierul depășește limita de ${Math.round(limits.maxBytes / (1024 * 1024))} MB.`
      );
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ArchiveError('invalid-json', 'Fișierul nu este JSON valid.');
    }
    if (!isObject(raw)) throw new ArchiveError('not-an-archive', 'Fișierul nu conține un obiect JSON.');
    if (raw.app !== ARCHIVE_APP) {
      throw new ArchiveError('not-an-archive', 'Fișierul nu a fost creat de LocalSight.');
    }
    if (raw.schema !== ARCHIVE_SCHEMA) {
      throw new ArchiveError(
        'unsupported-schema',
        `Versiunea arhivei (${String(raw.schema)}) nu este acceptată; acest build citește schema ${ARCHIVE_SCHEMA}.`
      );
    }
    if (raw.exported_at != null) {
      if (typeof raw.exported_at !== 'string' || raw.exported_at.length > limits.maxExportDateLength) {
        throw new ArchiveError('bad-archive', 'Data exportului nu este validă.');
      }
    }
    for (const field of ['events', 'evidence', 'acks']) {
      if (raw[field] != null && !Array.isArray(raw[field])) {
        throw new ArchiveError('bad-archive', `Câmpul ${field} nu este o listă.`);
      }
    }

    const rawEvents = raw.events || [];
    if (rawEvents.length > limits.maxEvents) {
      throw new ArchiveError('too-many-events', `Fișierul are peste ${limits.maxEvents} incidente.`);
    }
    const events = rawEvents.map(normalizeEvent);
    const seenEvents = new Set();
    for (const event of events) {
      if (seenEvents.has(event.event_id)) {
        throw new ArchiveError('duplicate-event', `Incidentul ${event.event_id} apare de două ori.`);
      }
      seenEvents.add(event.event_id);
    }

    const rawEvidence = raw.evidence || [];
    if (rawEvidence.length > limits.maxEvidence) {
      throw new ArchiveError('too-many-evidence', `Fișierul are peste ${limits.maxEvidence} snapshot-uri.`);
    }
    const seenEvidence = new Set();
    const evidence = rawEvidence.map((item) => {
      if (!isObject(item) || !isValidEventId(item.event_id)) {
        throw new ArchiveError('bad-evidence', 'Un snapshot din fișier nu are un event_id valid.');
      }
      if (seenEvidence.has(item.event_id)) {
        throw new ArchiveError('duplicate-evidence', `Snapshot-ul ${item.event_id} apare de două ori.`);
      }
      seenEvidence.add(item.event_id);
      if (!isMime(item.mime)) {
        throw new ArchiveError('bad-evidence', `Snapshot-ul ${item.event_id} are un tip de imagine necunoscut.`);
      }
      const bytes = decodeBase64(item.base64, limits.maxEvidenceBytes);
      if (item.size != null && item.size !== bytes.length) {
        throw new ArchiveError('bad-evidence', `Snapshot-ul ${item.event_id} are o dimensiune inconsistentă.`);
      }
      return {
        event_id: item.event_id,
        mime: item.mime,
        size: bytes.length,
        base64: item.base64,
      };
    });

    const rawAcks = raw.acks || [];
    if (rawAcks.length > limits.maxAcks) {
      throw new ArchiveError('too-many-acks', `Fișierul are peste ${limits.maxAcks} confirmări.`);
    }
    const seenAcks = new Set();
    const acks = rawAcks.map((item) => {
      if (!isObject(item) || !isValidEventId(item.event_id)) {
        throw new ArchiveError('bad-acks', 'O confirmare din fișier nu are un event_id valid.');
      }
      if (seenAcks.has(item.event_id)) {
        throw new ArchiveError('duplicate-ack', `Confirmarea ${item.event_id} apare de două ori.`);
      }
      seenAcks.add(item.event_id);
      return { event_id: item.event_id, override: normalizeOverride(item.override) };
    });

    const rawMeta = raw.meta || [];
    if (!Array.isArray(rawMeta) || rawMeta.length > limits.maxMeta) {
      throw new ArchiveError('bad-meta', `Fișierul are prea multe rânduri meta (max. ${limits.maxMeta}).`);
    }
    const meta = rawMeta.map((item) => {
      if (!isObject(item) || !isText(item.key) || item.key.length > limits.maxIdLength) {
        throw new ArchiveError('bad-meta', 'Un rând meta din fișier nu are cheie validă.');
      }
      const value = item.value;
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new ArchiveError('bad-meta', `Cheia meta ${item.key} are o valoare neacceptată.`);
      }
      return { key: item.key, value };
    });

    return {
      ok: true,
      archive: {
        app: ARCHIVE_APP,
        schema: ARCHIVE_SCHEMA,
        exported_at: typeof raw.exported_at === 'string' ? raw.exported_at : null,
        counts: { events: events.length, evidence: evidence.length, acks: acks.length },
        events,
        evidence,
        acks,
        meta,
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof ArchiveError ? error.code : 'invalid-json',
      error: error instanceof Error ? error.message : 'Fișierul nu poate fi citit.',
    };
  }
}

/** One comparison bucket: how many rows of the file are new, identical or different. */
function bucket(total) {
  return { total, new: 0, duplicate: 0, conflicting: 0 };
}

/**
 * Compare an incoming archive with what is already in this browser.
 *
 * The summary exists so "Replace" is an informed decision. Evidence is compared by id,
 * MIME type and byte size: the same id with a different image is a conflict even when the
 * file happens to be the same length, and reading every stored blob just for a summary
 * would make the check as expensive as the export.
 *
 * @param {{events?: Array<object>, evidence?: Array<object>, acks?: Array<object>}} current
 *   rows as returned by `readLocalEvidence()`
 * @param {object} incoming archive as returned by `parseArchive()`
 * @returns {{
 *   events: {total: number, new: number, duplicate: number, conflicting: number},
 *   evidence: {total: number, new: number, duplicate: number, conflicting: number},
 *   acks: {total: number, new: number, duplicate: number, conflicting: number},
 *   current: {events: number, evidence: number, acks: number},
 * }}
 */
export function summarizeImport(current = {}, incoming = {}) {
  const currentEvents = new Map(
    (Array.isArray(current.events) ? current.events : [])
      .filter((record) => isObject(record) && isValidEventId(record.event_id))
      .map((record) => [record.event_id, canonical(record.event)])
  );
  const currentEvidence = new Map(
    (Array.isArray(current.evidence) ? current.evidence : [])
      .filter((record) => isObject(record) && isValidEventId(record.event_id))
      .map((record) => [record.event_id, `${record.type || ''}|${Number(record.size) || 0}`])
  );
  const currentAcks = new Map(
    (Array.isArray(current.acks) ? current.acks : [])
      .filter((record) => isObject(record) && isValidEventId(record.event_id))
      .map((record) => [record.event_id, canonical(record.override)])
  );

  const incomingEvents = Array.isArray(incoming.events) ? incoming.events : [];
  const incomingEvidence = Array.isArray(incoming.evidence) ? incoming.evidence : [];
  const incomingAcks = Array.isArray(incoming.acks) ? incoming.acks : [];

  const events = bucket(incomingEvents.length);
  for (const event of incomingEvents) {
    if (!currentEvents.has(event.event_id)) events.new += 1;
    else if (currentEvents.get(event.event_id) === canonical(event)) events.duplicate += 1;
    else events.conflicting += 1;
  }

  const evidence = bucket(incomingEvidence.length);
  for (const item of incomingEvidence) {
    const key = `${item.mime}|${Number(item.size) || 0}`;
    if (!currentEvidence.has(item.event_id)) evidence.new += 1;
    else if (currentEvidence.get(item.event_id) === key) evidence.duplicate += 1;
    else evidence.conflicting += 1;
  }

  const acks = bucket(incomingAcks.length);
  for (const ack of incomingAcks) {
    if (!currentAcks.has(ack.event_id)) acks.new += 1;
    else if (currentAcks.get(ack.event_id) === canonical(ack.override)) acks.duplicate += 1;
    else acks.conflicting += 1;
  }

  return {
    events,
    evidence,
    acks,
    current: {
      events: currentEvents.size,
      evidence: currentEvidence.size,
      acks: currentAcks.size,
    },
  };
}
