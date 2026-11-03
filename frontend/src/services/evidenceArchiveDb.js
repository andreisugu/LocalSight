// The IndexedDB half of the archive.
//
// `evidenceArchive.js` is pure and knows the file; `evidencePersistence.js` knows the
// database and rebuilds the UI from it. This module is the seam between them: it reads
// the raw rows the export needs and replaces all four stores in one transaction on import.
//
// It deliberately does not edit `evidencePersistence.js`: that store stays the single
// owner of the schema, and this file only opens the same database version, filters the same
// record shapes and writes the wrappers the store hydrates. The store names, key paths and
// `schema` marker all come from its exported constants, so a schema bump breaks this file
// loudly instead of drifting silently.
//
// The read is one readonly transaction over all stores; the replace is one readwrite
// transaction that clears and rewrites them. IndexedDB aborts a failed transaction whole,
// which is what lets the screen say "local data was not changed" after an error.

import {
  EVIDENCE_DB_NAME,
  EVIDENCE_DB_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_STORES,
} from './evidencePersistence.js';
import { ArchiveError, base64ToBlob, isValidEventId } from './evidenceArchive.js';

/** The four stores, in the order every transaction below opens them. */
const STORE_NAMES = Object.freeze([
  EVIDENCE_STORES.events,
  EVIDENCE_STORES.evidence,
  EVIDENCE_STORES.acks,
  EVIDENCE_STORES.meta,
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value !== '';

/** Read `indexedDB` without letting a throwing getter (private modes) escape. */
function resolveIndexedDb() {
  try {
    return globalThis.indexedDB || null;
  } catch {
    return null;
  }
}

/**
 * Open the same database `evidencePersistence.js` owns.
 *
 * The upgrade path is identical on purpose: an import can be the first thing a fresh tab
 * does, and then this connection creates the stores instead of the store's adapter.
 *
 * @param {IDBFactory|null} factory
 * @returns {Promise<IDBDatabase|null>} null when storage is unavailable
 */
function openDatabase(factory) {
  if (!factory || typeof factory.open !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = factory.open(EVIDENCE_DB_NAME, EVIDENCE_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [EVIDENCE_STORES.events, EVIDENCE_STORES.evidence, EVIDENCE_STORES.acks]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'event_id' });
        }
      }
      if (!db.objectStoreNames.contains(EVIDENCE_STORES.meta)) {
        db.createObjectStore(EVIDENCE_STORES.meta, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    // An old tab holding the database must not make the archive hang forever.
    request.onblocked = () => resolve(null);
  });
}

/** A row the persistence store would accept; anything else is counted as skipped. */
function isUsableRecord(name, record) {
  if (!isObject(record)) return false;
  if (name === EVIDENCE_STORES.meta) return isText(record.key);
  if (record.schema !== EVIDENCE_SCHEMA_VERSION) return false;
  if (!isValidEventId(record.event_id)) return false;
  if (name === EVIDENCE_STORES.events) {
    return isObject(record.event) && record.event.event_id === record.event_id;
  }
  if (name === EVIDENCE_STORES.evidence) {
    return isObject(record.blob) && typeof record.blob.arrayBuffer === 'function';
  }
  if (name === EVIDENCE_STORES.acks) {
    return isObject(record.override) && typeof record.override.status === 'string';
  }
  return false;
}

/**
 * Read every row the archive needs, in one readonly transaction.
 *
 * The result is raw by design: `serializeArchive` validates and encodes it. Rows the store
 * itself would skip are dropped here and counted in `skipped`, so the screen can say that
 * rather than pretending the backup is complete.
 *
 * @param {{ indexedDB?: IDBFactory|null }} [options]
 * @returns {Promise<{
 *   supported: boolean,
 *   events: Array<object>,
 *   evidence: Array<object>,
 *   acks: Array<object>,
 *   meta: Array<object>,
 *   skipped: {events: number, evidence: number, acks: number},
 * }>}
 */
export async function readLocalEvidence({ indexedDB: injected } = {}) {
  const empty = {
    supported: false,
    events: [],
    evidence: [],
    acks: [],
    meta: [],
    skipped: { events: 0, evidence: 0, acks: 0 },
  };
  const factory = injected === undefined ? resolveIndexedDb() : injected;
  const db = await openDatabase(factory);
  if (!db) return empty;
  try {
    const rows = await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE_NAMES, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const requests = STORE_NAMES.map((name) => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(requests.map((request) => {
        const result = request.result;
        return Array.isArray(result) ? result : [];
      }));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB read failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB read aborted'));
    });
    const [events, evidence, acks, meta] = rows;
    const usable = (name, records) => records.filter((record) => isUsableRecord(name, record));
    const keptEvents = usable(EVIDENCE_STORES.events, events);
    const keptEvidence = usable(EVIDENCE_STORES.evidence, evidence);
    const keptAcks = usable(EVIDENCE_STORES.acks, acks);
    const keptMeta = usable(EVIDENCE_STORES.meta, meta);
    return {
      supported: true,
      events: keptEvents,
      evidence: keptEvidence,
      acks: keptAcks,
      meta: keptMeta,
      skipped: {
        events: events.length - keptEvents.length,
        evidence: evidence.length - keptEvidence.length,
        acks: acks.length - keptAcks.length,
      },
    };
  } catch (error) {
    // A read failure is reported like an unavailable store: the screen disables export and
    // says why, instead of handing back an empty archive that looks like "nothing stored".
    throw new ArchiveError(
      'read-failed',
      `Nu am putut citi IndexedDB: ${error?.message || 'eroare necunoscută'}.`
    );
  } finally {
    db.close();
  }
}

/** Build the wrapper records the persistence store hydrates from an archive. */
function toRecords(archive, storedAt) {
  if (!isObject(archive) || !Array.isArray(archive.events)
    || !Array.isArray(archive.evidence) || !Array.isArray(archive.acks)) {
    throw new ArchiveError('bad-archive', 'Arhiva nu are listele necesare pentru import.');
  }

  const seen = new Set();
  const events = archive.events.map((event) => {
    if (!isObject(event) || !isValidEventId(event.event_id) || seen.has(event.event_id)) {
      throw new ArchiveError('bad-events', 'Un incident din arhivă nu poate fi scris.');
    }
    seen.add(event.event_id);
    let copy;
    try {
      copy = JSON.parse(JSON.stringify(event));
    } catch {
      throw new ArchiveError('bad-events', `Incidentul ${event.event_id} nu poate fi copiat.`);
    }
    if (copy.event_id !== event.event_id) {
      throw new ArchiveError('bad-events', `Incidentul ${event.event_id} și-a schimbat id-ul.`);
    }
    // The URL belonged to the exporting document (or was a remote URL in a foreign file).
    // The snapshot is the stored blob below; hydration rebuilds a fresh `blob:` URL from it,
    // so an import must never make the page fetch a third-party image.
    copy.snapshot_url = '';
    return { event_id: copy.event_id, schema: EVIDENCE_SCHEMA_VERSION, stored_at: storedAt, event: copy };
  });

  const evidence = archive.evidence.map((item) => {
    if (!isObject(item) || !isValidEventId(item.event_id)) {
      throw new ArchiveError('bad-evidence', 'Un snapshot din arhivă nu are event_id valid.');
    }
    // Decoding here, before the transaction opens, keeps the write short and atomic.
    const blob = base64ToBlob(item.base64, item.mime);
    return {
      event_id: item.event_id,
      schema: EVIDENCE_SCHEMA_VERSION,
      stored_at: storedAt,
      size: blob.size,
      type: blob.type,
      blob,
    };
  });

  const acks = archive.acks.map((item) => {
    if (!isObject(item) || !isValidEventId(item.event_id) || !isObject(item.override)) {
      throw new ArchiveError('bad-acks', 'O confirmare din arhivă nu poate fi scrisă.');
    }
    return {
      event_id: item.event_id,
      schema: EVIDENCE_SCHEMA_VERSION,
      updated_at: storedAt,
      override: { ...item.override },
    };
  });

  const meta = (Array.isArray(archive.meta) ? archive.meta : [])
    .filter((item) => isObject(item) && isText(item.key))
    .map((item) => ({ key: item.key, value: item.value ?? null }));
  if (!meta.some((item) => item.key === 'schema_version')) {
    meta.push({ key: 'schema_version', value: EVIDENCE_SCHEMA_VERSION });
  }

  return { events, evidence, acks, meta };
}

/**
 * Replace the four stores with the archive, in one transaction.
 *
 * A merge is not offered: the screen shows what would change and the operator confirms the
 * replacement. On any failure the transaction aborts, so the previous data is intact.
 *
 * @param {object} archive parsed archive from `parseArchive`
 * @param {{ indexedDB?: IDBFactory|null, now?: () => number }} [options]
 * @returns {Promise<{events: number, evidence: number, acks: number, meta: number}>}
 */
export async function replaceLocalEvidence(archive, { indexedDB: injected, now = () => Date.now() } = {}) {
  const stamp = now();
  const storedAt = Number.isFinite(stamp) ? stamp : Date.now();
  const records = toRecords(archive, storedAt);

  const factory = injected === undefined ? resolveIndexedDb() : injected;
  const db = await openDatabase(factory);
  if (!db) {
    throw new ArchiveError('write-failed', 'IndexedDB este indisponibil; datele locale nu au fost modificate.');
  }
  try {
    await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE_NAMES, 'readwrite');
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      try {
        for (const name of STORE_NAMES) transaction.objectStore(name).clear();
        for (const record of records.events) {
          transaction.objectStore(EVIDENCE_STORES.events).put(record);
        }
        for (const record of records.evidence) {
          transaction.objectStore(EVIDENCE_STORES.evidence).put(record);
        }
        for (const record of records.acks) {
          transaction.objectStore(EVIDENCE_STORES.acks).put(record);
        }
        for (const record of records.meta) {
          transaction.objectStore(EVIDENCE_STORES.meta).put(record);
        }
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction is already unusable; the rejection below is what matters.
        }
        reject(error);
      }
    });
  } catch (error) {
    throw new ArchiveError(
      'write-failed',
      `Scrierea în IndexedDB a eșuat: ${error?.message || 'eroare necunoscută'}.`
    );
  } finally {
    db.close();
  }

  return {
    events: records.events.length,
    evidence: records.evidence.length,
    acks: records.acks.length,
    meta: records.meta.length,
  };
}
