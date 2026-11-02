// Durable evidence for the in-browser engine.
//
// The static build has no backend, so an incident, its acknowledgement and its snapshot
// used to die with the tab. This module keeps them in IndexedDB, bounded by the same limit
// as the incident list (200) plus an age cap (7 days), and rebuilds `blob:` URLs on boot.
//
// Three things are stored, in one versioned database:
// - `events`: the incident envelope, written once when the engine produces it;
// - `evidence`: the blurred JPEG, fetched from the page-owned `blob:` URL before that URL
//   is revoked or the document dies;
// - `acks`: the operator-owned fields (status, ack, false-positive, escalation), so a
//   reload does not resurrect an incident the operator already confirmed.
//
// Everything is injected for testing: an `indexedDB` factory, an adapter, `URL`, `fetch`
// and the clock. A missing or blocked IndexedDB, a corrupt row or a quota error must never
// break boot: every method resolves a safe value and `supported` says whether it does.
//
// The schema is versioned twice on purpose: the database version (`DB_VERSION`) covers the
// object stores, the per-record `schema` allows a future version to leave old rows alone
// instead of misreading them.

/** The database name; the Settings panel and the browser test use the same one. */
export const EVIDENCE_DB_NAME = 'localsight-evidence';
/** Object-store layout version (bump only with an `onupgradeneeded` migration). */
export const EVIDENCE_DB_VERSION = 1;
/** Version written into every record; a record with another version is skipped. */
export const EVIDENCE_SCHEMA_VERSION = 1;

/** Object-store names, exported because the schema is part of the contract with the app. */
export const EVIDENCE_STORES = Object.freeze({
  events: 'events',
  evidence: 'evidence',
  acks: 'acks',
  meta: 'meta',
});

/** Retention: the newest `maxEvents` incidents, none older than `maxAgeDays`. */
export const DEFAULT_RETENTION = Object.freeze({ maxEvents: 200, maxAgeDays: 7 });

/** The engine's not-yet-rendered marker, not a loadable URL. */
const PENDING_SNAPSHOT = 'blob:pending';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fields an operator action owns; they are what an ack override restores. */
const ACK_FIELDS = Object.freeze([
  'status',
  'acked_at',
  'acked_by',
  'escalated_at',
  'false_positive_by',
  'false_positive_note',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isBlobUrl = (value) => typeof value === 'string' && value.startsWith('blob:');
const isQuotaError = (error) => {
  const name = String(error?.name || '');
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
};
const warn = (message, error) => {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  console.warn(`[evidence] ${message}:`, error?.message ?? error);
};

/**
 * A promise-based adapter over a real IndexedDB factory.
 *
 * The shape (getAll/get/put/delete/clear/ready) is the seam the unit tests replace; it is
 * deliberately smaller than IndexedDB, because the store only needs whole-store reads and
 * keyed writes.
 */
function createIndexedDbAdapter(factory) {
  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let request;
      try {
        request = factory.open(EVIDENCE_DB_NAME, EVIDENCE_DB_VERSION);
      } catch {
        // Private mode / policy can throw synchronously from `open`.
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
        // Another tab upgrading the schema must not stay blocked by this one.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => resolve(null);
      // `blocked` fires while an old tab holds the database open. Waiting forever would
      // make boot depend on another tab; declare the store unavailable instead.
      request.onblocked = () => resolve(null);
    });
    return dbPromise;
  };

  const transaction = async (name, mode, run) => {
    const db = await open();
    if (!db) throw new Error('IndexedDB is unavailable');
    if (!db.objectStoreNames.contains(name)) throw new Error(`IndexedDB store ${name} is missing`);
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(name, mode);
      } catch (error) {
        reject(error);
        return;
      }
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      try {
        result = run(tx.objectStore(name));
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // The transaction is already unusable; the rejection below is what matters.
        }
        reject(error);
      }
    });
  };

  // Read requests resolve on `onsuccess`; waiting for `oncomplete` would also work, but the
  // same helper is used for writes where only the transaction completion is meaningful.
  const read = async (name, run) => {
    const db = await open();
    if (!db) throw new Error('IndexedDB is unavailable');
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(name, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      let request;
      try {
        request = run(tx.objectStore(name));
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
  };

  return {
    async ready() {
      return Boolean(await open());
    },
    getAll(name) {
      return read(name, (store) => store.getAll());
    },
    get(name, key) {
      return read(name, (store) => store.get(key));
    },
    put(name, value) {
      return transaction(name, 'readwrite', (store) => store.put(value)).then(() => true);
    },
    delete(name, key) {
      return transaction(name, 'readwrite', (store) => store.delete(key)).then(() => true);
    },
    clear(name) {
      return transaction(name, 'readwrite', (store) => store.clear()).then(() => true);
    },
  };
}

/** Read `indexedDB` without letting a throwing getter (some private modes) escape. */
function resolveIndexedDb() {
  try {
    return globalThis.indexedDB || null;
  } catch {
    return null;
  }
}

/** A plain copy: IndexedDB can clone more, but the store only promises JSON data. */
function cloneEvent(event) {
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    return null;
  }
}

/** Validate and copy an incident; null when it is not one (corrupt or foreign). */
function normalizeEvent(event) {
  if (!isObject(event) || typeof event.event_id !== 'string' || event.event_id === '') return null;
  const copy = cloneEvent(event);
  if (!copy || copy.event_id !== event.event_id) return null;
  return copy;
}

function validateEventRecord(record) {
  if (!isObject(record) || record.schema !== EVIDENCE_SCHEMA_VERSION) return null;
  if (typeof record.event_id !== 'string' || record.event_id === '') return null;
  const event = normalizeEvent(record.event);
  if (!event || event.event_id !== record.event_id) return null;
  return { ...record, event };
}

function validateEvidenceRecord(record) {
  if (!isObject(record) || record.schema !== EVIDENCE_SCHEMA_VERSION) return null;
  if (typeof record.event_id !== 'string' || record.event_id === '') return null;
  if (!record.blob || typeof record.blob !== 'object') return null;
  return record;
}

function validateAckRecord(record) {
  if (!isObject(record) || record.schema !== EVIDENCE_SCHEMA_VERSION) return null;
  if (typeof record.event_id !== 'string' || record.event_id === '') return null;
  if (!isObject(record.override) || typeof record.override.status !== 'string') return null;
  return record;
}

/** Epoch milliseconds of an incident, falling back to when it was stored. */
function eventTime(event, storedAt = 0) {
  const parsed = Date.parse(event?.detected_at);
  if (Number.isFinite(parsed)) return parsed;
  return Number.isFinite(storedAt) ? storedAt : 0;
}

function ackOverride(event) {
  if (!isObject(event)) return null;
  const override = {};
  for (const field of ACK_FIELDS) {
    if (field in event) override[field] = event[field];
  }
  if (typeof override.status !== 'string' || override.status === '') return null;
  return override;
}

/** Approximate UTF-8 size of a JSON value; `0` when it cannot be measured. */
function approxBytes(value) {
  try {
    const text = JSON.stringify(value) ?? '';
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return text.length * 2;
  } catch {
    return 0;
  }
}

/**
 * Merge restored incidents into the in-memory list.
 *
 * Existing rows win: the fixture list and anything the socket delivered are the fresher
 * source for the same id. The result is newest first and capped like the list itself, so a
 * hydrate can never grow the feed.
 *
 * @param {Array<object>} currentEvents
 * @param {Array<object>} persistedEvents
 * @param {{ limit?: number }} [options]
 * @returns {Array<object>} the same array when nothing was restored
 */
export function mergeHydratedEvents(currentEvents = [], persistedEvents = [], { limit = 200 } = {}) {
  const current = Array.isArray(currentEvents) ? currentEvents : [];
  const known = new Set(current.map((event) => event?.event_id));
  const restored = (Array.isArray(persistedEvents) ? persistedEvents : []).filter(
    (event) => event && typeof event.event_id === 'string' && !known.has(event.event_id)
  );
  if (restored.length === 0) return currentEvents;
  return [...restored, ...current]
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, limit);
}

/**
 * Apply persisted operator fields to incidents of the same id.
 *
 * Only the operator-owned fields are replaced, never the detection fields: a restored ack
 * must not rewrite the evidence it belongs to. Unknown ids are ignored.
 *
 * @param {Array<object>} events
 * @param {Array<object>} acks overrides as returned by `listAcks`
 * @returns {Array<object>} the same array when no override matched
 */
export function applyAckOverrides(events = [], acks = []) {
  if (!Array.isArray(events) || !Array.isArray(acks) || acks.length === 0) return events;
  const byId = new Map();
  for (const ack of acks) {
    if (isObject(ack) && typeof ack.event_id === 'string') byId.set(ack.event_id, ack);
  }
  if (byId.size === 0) return events;
  let changed = false;
  const next = events.map((event) => {
    const override = byId.get(event?.event_id);
    if (!override) return event;
    const patch = {};
    for (const field of ACK_FIELDS) {
      if (field in override) patch[field] = override[field];
    }
    if (Object.keys(patch).length === 0) return event;
    changed = true;
    return { ...event, ...patch };
  });
  return changed ? next : events;
}

/**
 * Create the durable store.
 *
 * @param {{
 *   adapter?: object,
 *   indexedDB?: IDBFactory|null,
 *   urlApi?: { createObjectURL?: Function, revokeObjectURL?: Function }|null,
 *   fetchImpl?: Function|null,
 *   now?: () => number,
 *   retention?: { maxEvents?: number, maxAgeDays?: number },
 * }} [options]
 * @returns {object} the store; every method is async and never rejects for a storage error
 */
export function createEvidenceStore({
  adapter: injectedAdapter = null,
  indexedDB: factory = undefined,
  urlApi = undefined,
  fetchImpl = undefined,
  now = () => Date.now(),
  retention: retentionOption = {},
} = {}) {
  const retention = {
    maxEvents: Number.isFinite(retentionOption.maxEvents) && retentionOption.maxEvents > 0
      ? Math.floor(retentionOption.maxEvents)
      : DEFAULT_RETENTION.maxEvents,
    maxAgeDays: Number.isFinite(retentionOption.maxAgeDays) && retentionOption.maxAgeDays >= 0
      ? retentionOption.maxAgeDays
      : DEFAULT_RETENTION.maxAgeDays,
  };
  const adapter = injectedAdapter
    || (() => {
      const dbFactory = factory === undefined ? resolveIndexedDb() : factory;
      return dbFactory ? createIndexedDbAdapter(dbFactory) : null;
    })();
  const url = urlApi === undefined ? (typeof URL === 'function' ? URL : null) : urlApi;
  const doFetch = fetchImpl === undefined
    ? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
    : fetchImpl;
  // Object URLs created by hydration; prune and clear revoke them so the tab does not leak.
  const objectUrls = new Map();
  let available = Boolean(adapter);
  let metaWritten = false;

  const revoke = (objectUrl) => {
    if (!objectUrl) return;
    try {
      url?.revokeObjectURL?.(objectUrl);
    } catch (error) {
      warn('could not revoke an object URL', error);
    }
  };
  const createUrl = (blob) => {
    try {
      const objectUrl = url?.createObjectURL?.(blob);
      return typeof objectUrl === 'string' && objectUrl ? objectUrl : null;
    } catch (error) {
      warn('could not create an object URL', error);
      return null;
    }
  };
  const revokeAllUrls = () => {
    for (const objectUrl of objectUrls.values()) revoke(objectUrl);
    objectUrls.clear();
  };

  /** Confirm the adapter really opens; a blocked database flips `supported` to false. */
  const ensure = async () => {
    if (!available) return false;
    if (typeof adapter.ready === 'function') {
      try {
        if (!(await adapter.ready())) available = false;
      } catch (error) {
        warn('IndexedDB could not be opened', error);
        available = false;
      }
    }
    if (!available) return false;
    if (!metaWritten) {
      metaWritten = true;
      try {
        await adapter.put(EVIDENCE_STORES.meta, {
          key: 'schema_version',
          value: EVIDENCE_SCHEMA_VERSION,
        });
      } catch (error) {
        // Metadata is diagnostics only; a failed write must not disable the store.
        warn('could not write the schema marker', error);
      }
    }
    return true;
  };

  /** Run `operation`, turning any adapter failure into `fallback`. */
  const guard = async (label, operation, fallback) => {
    if (!(await ensure())) return fallback;
    try {
      return await operation();
    } catch (error) {
      warn(label, error);
      return fallback;
    }
  };

  const readRecords = async (name, validate) => guard(
    `could not read ${name}`,
    async () => {
      const records = await adapter.getAll(name);
      if (!Array.isArray(records)) return [];
      return records.map(validate).filter(Boolean);
    },
    []
  );

  /**
   * Write one record, pruning once and retrying when the browser says the quota is full.
   *
   * @returns {Promise<boolean>} whether the record was written
   */
  const writeRecord = async (name, record, { allowPrune = true } = {}) => {
    if (!(await ensure())) return false;
    try {
      await adapter.put(name, record);
      return true;
    } catch (error) {
      if (isQuotaError(error) && allowPrune) {
        // Free half of the count budget, then try the same record once. A blob that still
        // does not fit keeps the incident instead of failing the whole operation.
        await prune({ maxEvents: Math.max(1, Math.floor(retention.maxEvents / 2)) });
        try {
          await adapter.put(name, record);
          return true;
        } catch (retryError) {
          warn(`quota still exceeded while writing ${name}`, retryError);
          return false;
        }
      }
      warn(`could not write ${name}`, error);
      return false;
    }
  };

  const putEvent = async (event) => {
    const normalized = normalizeEvent(event);
    if (!normalized) return false;
    return writeRecord(EVIDENCE_STORES.events, {
      event_id: normalized.event_id,
      schema: EVIDENCE_SCHEMA_VERSION,
      stored_at: now(),
      event: normalized,
    });
  };

  const putEvidence = async (eventId, blob) => {
    if (typeof eventId !== 'string' || eventId === '') return false;
    if (!blob || typeof blob !== 'object' || typeof blob.size !== 'number') return false;
    return writeRecord(EVIDENCE_STORES.evidence, {
      event_id: eventId,
      schema: EVIDENCE_SCHEMA_VERSION,
      stored_at: now(),
      size: blob.size,
      type: typeof blob.type === 'string' && blob.type ? blob.type : 'image/jpeg',
      blob,
    });
  };

  const putAck = async (event, patch = null) => {
    const merged = isObject(patch) ? { ...event, ...patch } : event;
    const override = ackOverride(merged);
    if (!override || typeof merged?.event_id !== 'string' || merged.event_id === '') return false;
    return writeRecord(EVIDENCE_STORES.acks, {
      event_id: merged.event_id,
      schema: EVIDENCE_SCHEMA_VERSION,
      updated_at: now(),
      override,
    });
  };

  /** Fetch the snapshot behind a page-owned `blob:` URL, before that URL dies. */
  const captureEvidence = async (event) => {
    const eventId = event?.event_id;
    const snapshotUrl = event?.snapshot_url;
    if (typeof eventId !== 'string' || eventId === '') return false;
    if (!isBlobUrl(snapshotUrl) || snapshotUrl === PENDING_SNAPSHOT) return false;
    if (!doFetch) return false;
    try {
      const response = await doFetch(snapshotUrl);
      if (!response || (typeof response.ok === 'boolean' && !response.ok)) return false;
      const blob = await response.blob();
      return putEvidence(eventId, blob);
    } catch (error) {
      // A revoked URL (the incident was pruned or the tab is going away) is expected.
      warn('could not capture the snapshot', error);
      return false;
    }
  };

  const prune = async ({
    maxEvents = retention.maxEvents,
    maxAgeDays = retention.maxAgeDays,
  } = {}) => {
    const fallback = { removed: 0, remaining: 0 };
    return guard('could not prune', async () => {
      const records = await readRecords(EVIDENCE_STORES.events, validateEventRecord);
      const cutoff = now() - maxAgeDays * DAY_MS;
      const newestFirst = records.slice().sort(
        (left, right) => eventTime(right.event, right.stored_at) - eventTime(left.event, left.stored_at)
      );
      const keep = new Set();
      const remove = new Set();
      newestFirst.forEach((record, index) => {
        const at = eventTime(record.event, record.stored_at);
        const withinCount = index < maxEvents;
        const withinAge = maxAgeDays === 0 ? false : at >= cutoff;
        if (withinCount && withinAge) keep.add(record.event_id);
        else remove.add(record.event_id);
      });

      // Evidence is only meaningful while its incident is retained; an ack, however, may
      // override a demo fixture that was never stored as an incident here, so it is dropped
      // only when its retained incident really left.
      const evidence = await readRecords(EVIDENCE_STORES.evidence, validateEvidenceRecord);
      const acks = await readRecords(EVIDENCE_STORES.acks, validateAckRecord);
      for (const record of evidence) {
        if (!keep.has(record.event_id)) await adapter.delete(EVIDENCE_STORES.evidence, record.event_id);
      }
      for (const record of acks) {
        if (remove.has(record.event_id)) await adapter.delete(EVIDENCE_STORES.acks, record.event_id);
      }
      for (const eventId of remove) {
        await adapter.delete(EVIDENCE_STORES.events, eventId);
        // The restored URL belongs to an incident nobody can open any more.
        revoke(objectUrls.get(eventId));
        objectUrls.delete(eventId);
      }
      return { removed: remove.size, remaining: keep.size };
    }, fallback);
  };

  const listEvents = async () => {
    const records = await readRecords(EVIDENCE_STORES.events, validateEventRecord);
    return records
      .sort((left, right) => eventTime(right.event, right.stored_at) - eventTime(left.event, left.stored_at))
      .map((record) => record.event);
  };

  const listAcks = async () => {
    const records = await readRecords(EVIDENCE_STORES.acks, validateAckRecord);
    return records.map((record) => ({ event_id: record.event_id, ...record.override }));
  };

  const getEvidence = async (eventId) => {
    if (typeof eventId !== 'string' || eventId === '') return null;
    return guard('could not read a snapshot', async () => {
      const record = await adapter.get(EVIDENCE_STORES.evidence, eventId);
      const valid = validateEvidenceRecord(record);
      return valid ? valid.blob : null;
    }, null);
  };

  const clear = async () => {
    const cleared = await guard('could not clear', async () => {
      for (const name of [
        EVIDENCE_STORES.events,
        EVIDENCE_STORES.evidence,
        EVIDENCE_STORES.acks,
        EVIDENCE_STORES.meta,
      ]) {
        await adapter.clear(name);
      }
      metaWritten = false;
      return true;
    }, false);
    revokeAllUrls();
    return cleared;
  };

  const stats = async () => {
    const base = {
      supported: available,
      count: 0,
      evidenceCount: 0,
      ackCount: 0,
      bytes: 0,
      maxEvents: retention.maxEvents,
      maxAgeDays: retention.maxAgeDays,
    };
    if (!(await ensure())) return { ...base, supported: false };
    try {
      const [records, evidence, acks] = await Promise.all([
        readRecords(EVIDENCE_STORES.events, validateEventRecord),
        readRecords(EVIDENCE_STORES.evidence, validateEvidenceRecord),
        readRecords(EVIDENCE_STORES.acks, validateAckRecord),
      ]);
      const blobBytes = evidence.reduce(
        (total, record) => total + (Number.isFinite(record.size) ? record.size : 0),
        0
      );
      const recordBytes = records.length > 0 ? approxBytes(records) : 0;
      const ackBytes = acks.length > 0 ? approxBytes(acks) : 0;
      return {
        ...base,
        supported: available,
        count: records.length,
        evidenceCount: evidence.length,
        ackCount: acks.length,
        bytes: blobBytes + recordBytes + ackBytes,
      };
    } catch (error) {
      warn('could not compute stats', error);
      return { ...base, supported: available };
    }
  };

  /**
   * Read back everything boot needs: retained incidents (pruned first), fresh object URLs
   * for their snapshots, and the operator overrides to re-apply.
   *
   * @returns {Promise<{ events: Array<object>, acks: Array<object> }>}
   */
  const hydrate = async () => {
    const empty = { events: [], acks: [] };
    if (!(await ensure())) return empty;
    // Retention is enforced on boot too: a store left for weeks must not come back whole.
    await prune();
    const [events, acks, evidence] = await Promise.all([
      listEvents(),
      listAcks(),
      readRecords(EVIDENCE_STORES.evidence, validateEvidenceRecord),
    ]);
    if (events.length === 0) {
      revokeAllUrls();
      return { events: [], acks };
    }
    const byId = new Map(evidence.map((record) => [record.event_id, record]));
    // Anything restored before this hydrate belongs to the previous read; drop its URLs.
    revokeAllUrls();
    const restored = events.map((event) => {
      const record = byId.get(event.event_id);
      const previousUrl = typeof event.snapshot_url === 'string' ? event.snapshot_url : '';
      let snapshotUrl = previousUrl;
      if (record) {
        const objectUrl = createUrl(record.blob);
        if (objectUrl) {
          objectUrls.set(event.event_id, objectUrl);
          snapshotUrl = objectUrl;
        }
      } else if (isBlobUrl(previousUrl)) {
        // The URL belonged to the tab that wrote the record; it is dead here.
        snapshotUrl = '';
      }
      return { ...event, snapshot_url: snapshotUrl };
    });
    return { events: restored, acks };
  };

  return {
    get supported() {
      return available;
    },
    retention: Object.freeze({ ...retention }),
    putEvent,
    listEvents,
    putEvidence,
    getEvidence,
    putAck,
    listAcks,
    prune,
    clear,
    stats,
    hydrate,
    /** Persist an incident and, when its snapshot is a live blob URL, the image too. */
    async recordEvent(event) {
      const saved = await putEvent(event);
      if (saved) await captureEvidence(event);
      return saved;
    },
    /** Revoke every object URL this store created (clear/prune do it themselves). */
    revokeObjectUrls: revokeAllUrls,
  };
}
