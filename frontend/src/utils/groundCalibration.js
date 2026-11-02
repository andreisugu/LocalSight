// Per-camera ground calibration, stored in localStorage and validated defensively.
//
// The metric ground plane (`engine/groundPlane.js`) turns foot points into metres once it
// has a homography. The four image points and the real rectangle they enclose are the
// operator's input: the zone editor draws on one reference still, so the calibration is
// tied to that still too. This module owns everything around that input, so the UI stays
// layout while the rules stay testable:
//
// - the storage key (`localsight.groundCalibration.<cameraId>`), one per camera;
// - parsing and validation of whatever localStorage hands back, which is untrusted input;
// - building the homography from the stored points and dimensions, rejecting degenerate
//   clicks instead of printing a confident 0 m/s;
// - the EMA speed fold the engine card renders, so a missing calibration, a truncated box
//   or a gap longer than a reading may bridge stays `null` rather than becoming a number.
//
// Nothing here is persisted outside the tab's localStorage except the four points and the
// two dimensions. No sample, speed or coverage value is ever written.

import {
  footPointFromBox,
  groundMetrics,
  homographyFromPoints,
  smoothSpeed,
} from '../engine/groundPlane.js';
import { readStoredJson } from './storage.js';

/** One key per camera. The id is part of the key, so a camera switch cannot inherit one. */
export const GROUND_CALIBRATION_KEY_PREFIX = 'localsight.groundCalibration.';

/** The rectangle the operator measures when they do not type one: 10 m by 10 m. */
export const DEFAULT_GROUND_RECT_M = Object.freeze({ widthM: 10, heightM: 10 });

/** A stored blob is four small points and two numbers; anything longer is not ours. */
export const GROUND_CALIBRATION_MAX_CHARS = 4096;

// A box whose bottom sits on the frame edge has no visible foot, so a metre value there
// would describe a point that is off-frame. The tracker's own gate (`TRUNCATED_BOTTOM` in
// pipeline.js) uses the same idea.
export const TRUNCATED_BOTTOM = 0.985;

/** Weight of the newest speed sample; about four frames of memory at ~5 fps. */
export const SPEED_SMOOTHING_ALPHA = 0.35;

/** Longest gap a speed reading may bridge. Beyond this the track was not watched. */
export const MAX_SAMPLE_GAP_S = 2.5;

// A reference rectangle is measured by hand; these bounds only reject nonsense, not a
// large apron. A non-positive side is already degenerate and rejected by the homography.
const MIN_RECT_SIDE_M = 0.01;
const MAX_RECT_SIDE_M = 10_000;

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * `localsight.groundCalibration.<cameraId>`, or `null` when there is no usable id.
 *
 * @param {unknown} cameraId
 * @returns {string|null}
 */
export function calibrationStorageKey(cameraId) {
  if (typeof cameraId !== 'string') return null;
  const trimmed = cameraId.trim();
  return trimmed === '' ? null : `${GROUND_CALIBRATION_KEY_PREFIX}${trimmed}`;
}

function isFinitePoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isRectSide(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_RECT_SIDE_M &&
    value <= MAX_RECT_SIDE_M
  );
}

/**
 * Validate a calibration, whether it came from localStorage, a caller or a draft.
 *
 * The four points are frame-normalized (the same coordinates the worker's track boxes
 * use), so anything outside 0..1 cannot have been clicked on the reference still. The two
 * sides are metres on the ground and must be finite and positive.
 *
 * @param {unknown} value
 * @returns {{points: Array<{x: number, y: number}>, widthM: number, heightM: number}|null}
 *   A normalized copy, or `null` when the value is malformed, incomplete or out of bounds.
 */
export function normalizeGroundCalibration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { points, widthM, heightM } = /** @type {{points?: unknown, widthM?: unknown, heightM?: unknown}} */ (value);
  if (!Array.isArray(points) || points.length !== 4) return null;
  if (!points.every(isFinitePoint)) return null;
  if (!points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) {
    return null;
  }
  if (!isRectSide(widthM) || !isRectSide(heightM)) return null;
  return {
    points: points.map((point) => ({ x: point.x, y: point.y })),
    widthM,
    heightM,
  };
}

/**
 * The ground rectangle in rectangle order: origin first, then clockwise.
 *
 * @param {number} widthM
 * @param {number} heightM
 * @returns {Array<{x: number, y: number}>}
 */
export function groundRectCorners(widthM, heightM) {
  return [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: heightM },
    { x: 0, y: heightM },
  ];
}

/**
 * Build the image -> metres homography for one calibration.
 *
 * @param {unknown} calibration
 * @returns {number[]|null} Row-major 3x3, or `null` when the calibration is incomplete,
 *   out of bounds, collinear or otherwise degenerate.
 */
export function buildGroundHomography(calibration) {
  const normalized = normalizeGroundCalibration(calibration);
  if (!normalized) return null;
  return homographyFromPoints(
    normalized.points,
    groundRectCorners(normalized.widthM, normalized.heightM)
  );
}

/**
 * Everything the UI needs to label one calibration.
 *
 * @param {unknown} calibration
 * @returns {{calibrated: boolean, degenerate: boolean, homography: number[]|null,
 *   calibration: {points: Array<{x: number, y: number}>, widthM: number, heightM: number}|null,
 *   label: string}}
 */
export function groundCalibrationStatus(calibration) {
  const normalized = normalizeGroundCalibration(calibration);
  if (!normalized) {
    const complete = Boolean(
      calibration &&
        typeof calibration === 'object' &&
        Array.isArray(/** @type {{points?: unknown}} */ (calibration).points) &&
        /** @type {{points: unknown[]}} */ (calibration).points.length === 4
    );
    return {
      calibrated: false,
      // Four stored points that normalize to nothing is a degenerate calibration, not a
      // missing one, and the panel must say which.
      degenerate: complete,
      homography: null,
      calibration: null,
      label: 'necalibrat',
    };
  }
  const homography = buildGroundHomography(normalized);
  if (!homography) {
    return {
      calibrated: false,
      degenerate: true,
      homography: null,
      calibration: normalized,
      label: 'necalibrat — puncte degenere',
    };
  }
  return {
    calibrated: true,
    degenerate: false,
    homography,
    calibration: normalized,
    label: `calibrat — ${formatGroundRect(normalized)}`,
  };
}

/**
 * `10 × 10 m`, Romanian decimals. `—` when the input is not a calibration.
 *
 * @param {{widthM?: unknown, heightM?: unknown}|null|undefined} calibration
 * @returns {string}
 */
export function formatGroundRect(calibration) {
  const widthM = calibration?.widthM;
  const heightM = calibration?.heightM;
  if (!isRectSide(widthM) || !isRectSide(heightM)) return '—';
  const format = (value) =>
    value.toLocaleString('ro-RO', { maximumFractionDigits: 2 });
  return `${format(widthM)} × ${format(heightM)} m`;
}

/**
 * Read one camera's calibration. Corrupt, oversized, out-of-bounds or blocked storage is
 * indistinguishable from "never calibrated", so the caller keeps its harmless default.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @param {string} cameraId
 * @returns {{points: Array<{x: number, y: number}>, widthM: number, heightM: number}|null}
 */
export function readStoredGroundCalibration(storage, cameraId) {
  const key = calibrationStorageKey(cameraId);
  if (!key) return null;
  return normalizeGroundCalibration(
    readStoredJson(storage, key, { maxChars: GROUND_CALIBRATION_MAX_CHARS })
  );
}

/**
 * Persist one camera's calibration. Never throws; a blocked storage returns `false` and
 * the caller must say the calibration was not saved.
 *
 * @param {{setItem(key: string, value: string): void}|null|undefined} storage
 * @param {string} cameraId
 * @param {unknown} calibration
 * @returns {boolean}
 */
export function storeGroundCalibration(storage, cameraId, calibration) {
  const key = calibrationStorageKey(cameraId);
  const normalized = normalizeGroundCalibration(calibration);
  if (!key || !normalized || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, ...normalized }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget one camera's calibration. Never throws.
 *
 * @param {{removeItem(key: string): void}|null|undefined} storage
 * @param {string} cameraId
 * @returns {boolean} `true` when the key is gone (or was never there)
 */
export function clearStoredGroundCalibration(storage, cameraId) {
  const key = calibrationStorageKey(cameraId);
  if (!key || !storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fresh speed-fold state. `homography` is kept next to the samples so a recalibration
 * throws the old metres away instead of smoothing a new map into an old speed.
 *
 * @param {number[]|null} [homography]
 * @returns {{homography: number[]|null, entries: Map<number, {time: number,
 *   foot: {x: number, y: number}, smoothed: number|null}>}}
 */
export function createTrackSpeedState(homography = null) {
  return { homography, entries: new Map() };
}

/**
 * Fold one tracker feed into per-track ground speeds.
 *
 * Pure: it takes a state and a feed, returns a new state and the rows to render. A track
 * with no previous sample, a truncated box, a non-positive `dt`, a gap beyond
 * `MAX_SAMPLE_GAP_S` or no calibration gets `speedMps: null`; the UI prints „necalibrat”
 * or „fără eșantion”, never 0.
 *
 * @param {ReturnType<typeof createTrackSpeedState>|null|undefined} state
 * @param {{time: number, boxes: Array<{id: number, bbox: number[]}>}|null|undefined} feed
 * @param {number[]|null|undefined} homography
 * @param {{alpha?: number}} [options]
 * @returns {{state: ReturnType<typeof createTrackSpeedState>, rows: Array<{
 *   id: number, speedMps: number|null, distanceM: number|null, truncated: boolean}>}}
 */
export function advanceTrackSpeeds(state, feed, homography = null, options = {}) {
  const alpha = options.alpha ?? SPEED_SMOOTHING_ALPHA;
  const usableState =
    state && state.entries instanceof Map && state.homography === homography
      ? state
      : createTrackSpeedState(homography);
  if (!feed || !Array.isArray(feed.boxes) || !Number.isFinite(feed.time)) {
    return { state: usableState, rows: [] };
  }

  const entries = new Map(usableState.entries);
  const rows = [];
  const seen = new Set();
  for (const box of feed.boxes) {
    if (!box || !Number.isFinite(box.id)) continue;
    const foot = footPointFromBox(box.bbox);
    if (!foot) continue;
    seen.add(box.id);
    const previous = entries.get(box.id);
    const truncated = box.bbox[3] >= TRUNCATED_BOTTOM;
    let speedMps = null;
    let distanceM = null;
    let smoothed = previous?.smoothed ?? null;
    const dt = previous ? feed.time - previous.time : 0;
    if (previous && !truncated && dt > 0 && dt <= MAX_SAMPLE_GAP_S) {
      const metrics = groundMetrics({
        foot,
        previousFoot: previous.foot,
        dt,
        H: homography,
      });
      if (metrics.valid) {
        smoothed = smoothSpeed(previous.smoothed, metrics.speedMps, alpha);
        speedMps = smoothed;
        distanceM = metrics.distanceM;
      }
    }
    entries.set(box.id, { time: feed.time, foot, smoothed });
    rows.push({ id: box.id, speedMps, distanceM, truncated });
  }

  // Keep a missed frame's foot point for a moment (the tracker itself survives 30), but
  // forget it once the gap is longer than a reading may bridge, or after a loop rewind.
  for (const [id, entry] of [...entries]) {
    if (seen.has(id)) continue;
    const age = feed.time - entry.time;
    if (!Number.isFinite(age) || age < 0 || age > MAX_SAMPLE_GAP_S * 2) entries.delete(id);
  }

  rows.sort((left, right) => left.id - right.id);
  return { state: { homography, entries }, rows };
}

/**
 * The default storage, exported for the UI (the tests pass their own).
 *
 * @returns {Storage|null}
 */
export function groundCalibrationStorage() {
  return defaultStorage();
}
