// Whether the demo fixtures are part of the incident list.
//
// The product shows real detections by default: the incidents the browser engine raises
// and the ones the explicit Simulare menu creates. The eight SafeSight fixtures are demo
// data, not a camera, so they stay out of every screen until someone asks for them.
//
// One key, one fallback. localStorage is untrusted input (it survives reloads and anyone
// can edit it), so only the two literals the toggle writes are accepted; anything else —
// a missing key, a planted string, a blocked storage — means "off".

import { readStoredEnum } from './storage.js';

export const DEMO_DATA_KEY = 'localsight.showDemoData';

/** The honest default: no fixture rows on any screen. */
export const DEFAULT_SHOW_DEMO_DATA = false;

const STORED_VALUES = new Set(['true', 'false']);

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {boolean|null} the stored choice, or null when there is none
 */
export function readStoredShowDemoData(storage = defaultStorage()) {
  const value = readStoredEnum(storage, DEMO_DATA_KEY, STORED_VALUES);
  return value === null ? null : value === 'true';
}

/**
 * @param {boolean} show
 * @param {{setItem(key: string, value: string): void}|null|undefined} [storage]
 */
export function storeShowDemoData(show, storage = defaultStorage()) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(DEMO_DATA_KEY, show ? 'true' : 'false');
  } catch {
    // The choice still applies to this tab; only persistence is lost.
  }
}

/**
 * The initial value: a stored choice, otherwise the real-detections-only default.
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {boolean}
 */
export function initialShowDemoData(storage = defaultStorage()) {
  return readStoredShowDemoData(storage) ?? DEFAULT_SHOW_DEMO_DATA;
}
