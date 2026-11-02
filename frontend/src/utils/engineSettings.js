// Browser-engine settings, kept on the main thread: the worker never imports this file.
//
// Three knobs live under one JSON key. The reader is tolerant field by field, so a value
// written by an older build (or by hand) can never break the engine: an unknown thread
// count falls back to `auto`, a non-boolean blur flag to the privacy-safe `true`, an
// unknown detector to the default Lite0. `resolveWasmThreads` is the only place that
// decides how many ORT threads actually run, and it is pure, so every branch is checked
// with `node --test` instead of guessed at.

import { STORAGE_LIMITS, readStoredJson } from './storage.js';

export const ENGINE_SETTINGS_KEY = 'localsight.engineSettings';

/** The thread choices the settings panel offers. `auto` resolves from the machine. */
export const WASM_THREAD_CHOICES = Object.freeze(['auto', 1, 2, 4, 6, 8]);

/**
 * The shipped person detectors, Apache-2.0 weights either way: Lite0 is the fast default
 * (320 px), Lite2 the slower, more accurate option (448 px). There is no third choice.
 */
export const DETECTOR_CHOICES = Object.freeze(['efficientdet', 'efficientdet-lite2']);

/** Defaults: efficient threads, head-band safety blur ON, EfficientDet-Lite0. */
export const DEFAULT_ENGINE_SETTINGS = Object.freeze({
  wasmThreads: 'auto',
  safetyBlur: true,
  detector: 'efficientdet',
});

// `navigator.hardwareConcurrency` is allowed to be missing (some hardened browsers); the
// old hardcoded default when isolated was 4, so an unknown machine keeps that behaviour.
const FALLBACK_CORES = 4;
// ORT starts `numThreads - 1` pthread workers next to the engine worker; past 8 the tab
// fights the rest of the machine for cores and the fps flattens out.
const MAX_THREADS = 8;
const AUTO_MAX_THREADS = 4;

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * `'auto'` or one of the offered counts, else `null`.
 * @param {unknown} value
 * @returns {'auto' | 1 | 2 | 4 | 6 | 8 | null}
 */
export function normalizeWasmThreads(value) {
  if (value === 'auto') return 'auto';
  return typeof value === 'number' && WASM_THREAD_CHOICES.includes(value) ? value : null;
}

/**
 * One of the two shipped detectors, else `null`.
 * @param {unknown} value
 * @returns {'efficientdet' | 'efficientdet-lite2' | null}
 */
export function normalizeDetector(value) {
  return DETECTOR_CHOICES.includes(value) ? value : null;
}

/**
 * Read all three settings. Never throws and never returns a partial object.
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {{wasmThreads: 'auto'|1|2|4|6|8, safetyBlur: boolean,
 *            detector: 'efficientdet'|'efficientdet-lite2'}}
 */
export function readEngineSettings(storage = defaultStorage()) {
  const settings = { ...DEFAULT_ENGINE_SETTINGS };
  const parsed = readStoredJson(storage, ENGINE_SETTINGS_KEY, {
    maxChars: STORAGE_LIMITS.engineSettings,
  });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return settings;

  const threads = normalizeWasmThreads(parsed.wasmThreads);
  if (threads !== null) settings.wasmThreads = threads;
  if (typeof parsed.safetyBlur === 'boolean') settings.safetyBlur = parsed.safetyBlur;
  const detector = normalizeDetector(parsed.detector);
  if (detector !== null) settings.detector = detector;
  return settings;
}

/**
 * How many wasm threads ORT may start.
 *
 * Without cross-origin isolation there is no `SharedArrayBuffer`, so the only working
 * count is one: the setting is reported as 1 instead of pretending the choice applied.
 * `auto` caps at 4 (past that the frame is detector-bound in this tab); an explicit
 * choice is clamped to the machine's cores and to 8.
 *
 * @param {'auto'|1|2|4|6|8} setting
 * @param {{crossOriginIsolated?: boolean, hardwareConcurrency?: number}} [environment]
 * @returns {number}
 */
export function resolveWasmThreads(setting, environment = {}) {
  const {
    crossOriginIsolated = Boolean(globalThis.crossOriginIsolated),
    hardwareConcurrency,
  } = environment;
  if (!crossOriginIsolated) return 1;

  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency >= 1
    ? Math.floor(hardwareConcurrency)
    : FALLBACK_CORES;
  const choice = normalizeWasmThreads(setting);
  if (choice === 'auto' || choice === null) return Math.max(1, Math.min(AUTO_MAX_THREADS, cores));
  return Math.max(1, Math.min(choice, MAX_THREADS, cores));
}

/**
 * Merge a validated patch into what is stored and write it back.
 *
 * An invalid field is ignored (the previous value stays), so a typo in a JSON blob or a
 * stale select value cannot silently degrade the next engine start. The returned object
 * is what the caller should put in state, even when storage refused the write.
 *
 * @param {{wasmThreads?: unknown, safetyBlur?: unknown, detector?: unknown}} patch
 * @param {{getItem(key: string): string|null, setItem(key: string, value: string): void}|null|undefined} [storage]
 * @returns {{wasmThreads: 'auto'|1|2|4|6|8, safetyBlur: boolean,
 *            detector: 'efficientdet'|'efficientdet-lite2'}}
 */
export function storeEngineSettings(patch = {}, storage = defaultStorage()) {
  const next = readEngineSettings(storage);
  if (Object.hasOwn(patch, 'wasmThreads')) {
    const threads = normalizeWasmThreads(patch.wasmThreads);
    if (threads !== null) next.wasmThreads = threads;
  }
  if (Object.hasOwn(patch, 'safetyBlur') && typeof patch.safetyBlur === 'boolean') {
    next.safetyBlur = patch.safetyBlur;
  }
  if (Object.hasOwn(patch, 'detector')) {
    const detector = normalizeDetector(patch.detector);
    if (detector !== null) next.detector = detector;
  }
  try {
    storage?.setItem(ENGINE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // The choice still applies to this tab; only persistence is lost.
  }
  return next;
}

/**
 * @param {unknown} value
 * @param {{getItem(key: string): string|null, setItem(key: string, value: string): void}|null|undefined} [storage]
 */
export function storeWasmThreads(value, storage = defaultStorage()) {
  return storeEngineSettings({ wasmThreads: value }, storage);
}

/**
 * @param {unknown} value
 * @param {{getItem(key: string): string|null, setItem(key: string, value: string): void}|null|undefined} [storage]
 */
export function storeSafetyBlur(value, storage = defaultStorage()) {
  return storeEngineSettings({ safetyBlur: value }, storage);
}

/**
 * @param {unknown} value
 * @param {{getItem(key: string): string|null, setItem(key: string, value: string): void}|null|undefined} [storage]
 */
export function storeDetector(value, storage = defaultStorage()) {
  return storeEngineSettings({ detector: value }, storage);
}
