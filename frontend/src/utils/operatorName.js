// Operator name persistence.
//
// The name is the one thing an operator types that must survive a reload. It lives under
// `localsight.operator`; a name saved before the rename (`safesight.operator`) is copied
// to the new key on first read so the legacy entry can rot without losing the name.
// Storage can be absent or throw (private mode, quota, disabled cookies); the name then
// lives for the session only and the app still works.

import { STORAGE_LIMITS, readStoredText } from './storage.js';

export const OPERATOR_STORAGE_KEY = 'localsight.operator';
export const LEGACY_OPERATOR_STORAGE_KEY = 'safesight.operator';
// A name is a short label, not a document: the same value is shown in the header and in
// every audit line, so a planted 10 000 character name is capped when it is read.
export const OPERATOR_NAME_LIMIT = STORAGE_LIMITS.operatorName;

/**
 * Trim a typed name. A non-string (null from storage, an event object passed by mistake)
 * becomes the empty name instead of the string "null".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOperatorName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {Storage|null|undefined} storage
 * @returns {string} the stored name, or '' when there is none
 */
export function readStoredOperatorName(storage) {
  if (!storage) return '';
  try {
    const current = normalizeOperatorName(
      readStoredText(storage, OPERATOR_STORAGE_KEY, { maxChars: OPERATOR_NAME_LIMIT })
    );
    if (current) return current;
    const legacy = normalizeOperatorName(
      readStoredText(storage, LEGACY_OPERATOR_STORAGE_KEY, { maxChars: OPERATOR_NAME_LIMIT })
    );
    if (!legacy) return '';
    // Migrate: the next read uses the current key and the legacy one is never needed again.
    storage.setItem(OPERATOR_STORAGE_KEY, legacy);
    return legacy;
  } catch {
    return '';
  }
}

/**
 * Save a name (or clear it when empty). Returns the normalized value even when storage
 * fails, because the session should still show what the operator just typed.
 *
 * @param {Storage|null|undefined} storage
 * @param {unknown} value
 * @returns {string}
 */
export function writeStoredOperatorName(storage, value) {
  const name = normalizeOperatorName(value);
  if (!storage) return name;
  try {
    if (name) storage.setItem(OPERATOR_STORAGE_KEY, name);
    else storage.removeItem(OPERATOR_STORAGE_KEY);
  } catch {
    // Session-only name.
  }
  return name;
}
