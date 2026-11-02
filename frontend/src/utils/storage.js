// Bounded reads for values that live in localStorage.
//
// localStorage is untrusted input: it survives reloads, anyone can edit it from DevTools,
// and a value planted by another script on the same origin (or left by an older build) is
// handed back verbatim. The helpers below cap the value before it is parsed or rendered,
// and treat a missing key, a blocked storage or malformed content as "no value". Callers
// therefore keep the same harmless fallback they already use for an empty key.
//
// Limits are measured in characters, not bytes: `Storage.getItem` returns a JS string and
// the cost being guarded against is parsing/rendering it, which scales with its length.

/** Caps for every user-controlled key the app reads today. */
export const STORAGE_LIMITS = Object.freeze({
  operatorName: 256,
  enum: 32,
  engineSettings: 4096,
  // `/bench` history: up to 200 runs, each a small object. The view that reads it still
  // parses the raw string itself (it is owned by another change), so this cap is exported
  // for that call site:
  //   readStoredJson(storage, 'localsight.bench', { maxChars: STORAGE_LIMITS.benchRuns })
  // then keep only `Array.isArray(runs)` entries and shape-check every run before render.
  benchRuns: 64 * 1024,
});

/**
 * Read one raw string. Never throws and never returns anything but a string or null.
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @param {string} key
 * @returns {string|null}
 */
function readRaw(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(key);
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    // Private mode, disabled cookies and a hostile getter all mean "no value".
    return null;
  }
}

/**
 * A bounded text value. A longer value is truncated to `maxChars`, so a planted 10 000
 * character name becomes a usable prefix instead of breaking every screen that renders it.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @param {string} key
 * @param {{maxChars?: number}} [options]
 * @returns {string|null} the stored text, or null when there is none
 */
export function readStoredText(storage, key, { maxChars = STORAGE_LIMITS.operatorName } = {}) {
  const raw = readRaw(storage, key);
  if (raw === null) return null;
  return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
}

/**
 * A stored value that must be one of a fixed set. Anything else (including a value that is
 * too long to be a member) is rejected rather than guessed at.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @param {string} key
 * @param {Iterable<string>|{has(value: string): boolean}} allowed
 * @returns {string|null}
 */
export function readStoredEnum(storage, key, allowed) {
  const raw = readRaw(storage, key);
  if (raw === null || raw.length > STORAGE_LIMITS.enum) return null;
  const isAllowed = typeof allowed.has === 'function'
    ? allowed.has(raw)
    : Array.from(allowed).includes(raw);
  return isAllowed ? raw : null;
}

/**
 * Parse a stored JSON value with a hard size cap. Oversized, corrupt and missing values all
 * return null; the caller's defaults are the only fallback, so a bad blob can never produce
 * a half-applied object.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @param {string} key
 * @param {{maxChars?: number}} [options]
 * @returns {unknown} the parsed value, or null
 */
export function readStoredJson(storage, key, { maxChars = STORAGE_LIMITS.engineSettings } = {}) {
  const raw = readRaw(storage, key);
  if (raw === null || raw.length > maxChars) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
