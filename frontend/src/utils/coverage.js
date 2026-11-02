// Coverage receipt: were we actually watching?
//
// The browser is the camera operator here, and its own throttling creates the blind spots:
// a hidden tab, a paused engine, a stalled decode. So coverage is derived from *processed
// frame samples*, never from "the tab was open". This module turns those samples into
// per-camera coverage: how long frames were processed, how long the picture was degraded,
// and every window where the system was blind — plus incident ticks, so a gap can be read
// next to what happened inside it.
//
// The model, in five rules:
//
// 1. A sample is a statement about one instant: at `at` a frame with `status` was processed.
//    Its state holds until the next sample of the *same camera*.
// 2. A gap starts when the expected cadence is exceeded. A live/degraded sample covers at
//    most `expectedFrameMs`; the rest of the interval until the next sample is `no-frames`.
//    A blind status (`paused`, `hidden`) is an explicit blind declaration and covers the
//    whole interval.
// 3. A camera switch closes the previous camera. A camera whose last sample is followed by
//    another camera's sample stops at `last + cadence`; it is not blind after that, it was
//    simply no longer the active source.
// 4. The last active camera extends to the window end. If frames stop arriving while it is
//    still the active source, the tail is a `no-frames` gap — a frozen picture must never
//    look live.
// 5. Coverage is measured over the camera's own watched span (`watchedMs`), not over the
//    whole window: a camera that was never the active source should not score 0%.
//
// Duplicate and out-of-order samples are idempotent: samples are sorted by time and folded
// to one per (camera, instant), keeping the most conservative status (hidden > paused >
// degraded > live), so re-sending the same frame can never inflate coverage. Unreadable
// samples are dropped and counted in `invalid`; valid samples outside the window are
// counted in `ignored`. With no samples at all the result is 0% and `noData: true` — the
// UI must print "fără date", never a full green bar.

/** Default expected sample cadence, in milliseconds. Pass `expectedFrameMs` to change it. */
export const expectedFrameMs = 1000;

/** The four states a frame sample can declare. */
export const COVERAGE_STATE = Object.freeze({
  LIVE: 'live',
  DEGRADED: 'degraded',
  PAUSED: 'paused',
  HIDDEN: 'hidden',
});

/** Reasons a coverage gap carries. `paused` and `hidden` are explicit blind declarations. */
export const GAP_REASON = Object.freeze({
  NO_FRAMES: 'no-frames',
  PAUSED: 'paused',
  HIDDEN: 'hidden',
});

const STATE_SET = new Set(Object.values(COVERAGE_STATE));
const BLIND_STATES = new Set([COVERAGE_STATE.PAUSED, COVERAGE_STATE.HIDDEN]);
// Fold duplicates at the same instant toward the least flattering state.
const STATE_SEVERITY = {
  [COVERAGE_STATE.LIVE]: 0,
  [COVERAGE_STATE.DEGRADED]: 1,
  [COVERAGE_STATE.PAUSED]: 2,
  [COVERAGE_STATE.HIDDEN]: 3,
};

/** Bucket a segment state lands in; every bucket is a distinct millisecond total. */
const STATE_BUCKET = {
  [COVERAGE_STATE.LIVE]: 'liveMs',
  [COVERAGE_STATE.DEGRADED]: 'degradedMs',
  [COVERAGE_STATE.PAUSED]: 'pausedMs',
  [COVERAGE_STATE.HIDDEN]: 'hiddenMs',
  [GAP_REASON.NO_FRAMES]: 'noFramesMs',
};

const NUMERIC_STRING = /^-?\d+$/;

/**
 * Epoch milliseconds from a number, an ISO string or a Date; `null` when unreadable.
 * ISO strings stay in UTC: the sample clock is the source of truth, not the local zone.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseAt(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (NUMERIC_STRING.test(text)) {
    const ms = Number(text);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A camera id from either casing. The edge/contract spells it `camera_id`; a local sample
 * may use `cameraId`. Both are accepted so a caller never has to translate mid-stream.
 *
 * @param {object} sample
 * @returns {string}
 */
function readCameraId(sample) {
  const value = sample?.cameraId ?? sample?.camera_id;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate one sample and normalise it to `{ cameraId, at, status }`.
 *
 * @param {unknown} sample
 * @returns {{cameraId: string, at: number, status: string}|null} null when unusable
 */
function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const cameraId = readCameraId(sample);
  if (!cameraId) return null;
  const at = parseAt(sample.at);
  if (at === null) return null;
  const status = typeof sample.status === 'string' ? sample.status.trim().toLowerCase() : '';
  if (!STATE_SET.has(status)) return null;
  // A frame with no pixels is not a frame. Dimensions are optional, but if present they
  // must be usable, otherwise the sample is dropped instead of credited as coverage.
  for (const dimension of ['width', 'height']) {
    const value = sample[dimension];
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  }
  return { cameraId, at, status };
}

/**
 * Resolve the session window. A missing or inverted window falls back to the sample
 * extremes, so a caller with a short list still gets a usable denominator.
 *
 * @param {{from?: unknown, to?: unknown}|null|undefined} window
 * @param {Array<{at: number}>} points
 * @returns {{from: number, to: number, durationMs: number}}
 */
function resolveWindow(window, points) {
  const from = parseAt(window?.from);
  const to = parseAt(window?.to);
  if (from !== null && to !== null && to > from) {
    return { from, to, durationMs: to - from };
  }
  if (!points.length) return { from: 0, to: 0, durationMs: 0 };
  if (from !== null && to === null && points.length) {
    const end = Math.max(...points.map((point) => point.at));
    return end > from
      ? { from, to: end, durationMs: end - from }
      : { from: 0, to: 0, durationMs: 0 };
  }
  let start = points[0].at;
  let end = points[0].at;
  for (const point of points) {
    if (point.at < start) start = point.at;
    if (point.at > end) end = point.at;
  }
  return end > start ? { from: start, to: end, durationMs: end - start } : { from: 0, to: 0, durationMs: 0 };
}

/**
 * Merge blind windows that touch or overlap and share a reason.
 *
 * @param {Array<{from: number, to: number, reason: string}>} gaps
 * @returns {Array<{from: number, to: number, reason: string, durationMs: number}>}
 */
export function mergeGaps(gaps) {
  const list = (Array.isArray(gaps) ? gaps : [])
    .filter(
      (gap) =>
        gap &&
        typeof gap.reason === 'string' &&
        gap.reason !== '' &&
        Number.isFinite(gap.from) &&
        Number.isFinite(gap.to) &&
        gap.to > gap.from
    )
    .map((gap) => ({ from: gap.from, to: gap.to, reason: gap.reason }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const merged = [];
  for (const gap of list) {
    const previous = merged[merged.length - 1];
    if (previous && previous.reason === gap.reason && gap.from <= previous.to) {
      previous.to = Math.max(previous.to, gap.to);
    } else {
      merged.push(gap);
    }
  }
  return merged.map((gap) => ({ ...gap, durationMs: gap.to - gap.from }));
}

/**
 * Merge touching/overlapping segments that share a state.
 *
 * @param {Array<{from: number, to: number, state: string}>} segments
 * @returns {Array<{from: number, to: number, state: string}>}
 */
function mergeSegments(segments) {
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.state === segment.state && segment.from <= previous.to) {
      previous.to = Math.max(previous.to, segment.to);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/**
 * Percentage with one decimal, `0` when there is nothing to divide by.
 *
 * @param {number} part
 * @param {number} total
 * @returns {number}
 */
function percent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Incident ticks inside the window, for one camera or for the whole session.
 *
 * @param {Array<object>} incidents
 * @param {{from: number, durationMs: number}} window
 * @param {string|null} cameraId `null` for the session-wide list
 * @returns {{ticks: Array<{eventId: string, at: number, offsetPct: number}>, ignored: number}}
 */
function buildTicks(incidents, window, cameraId) {
  const ticks = [];
  let ignored = 0;
  for (const incident of Array.isArray(incidents) ? incidents : []) {
    const eventId = incident?.eventId ?? incident?.event_id;
    const at = parseAt(incident?.at);
    if (typeof eventId !== 'string' || eventId.trim() === '' || at === null) {
      ignored += 1;
      continue;
    }
    if (window.durationMs <= 0) {
      ignored += 1;
      continue;
    }
    if (at < window.from || at > window.from + window.durationMs) {
      ignored += 1;
      continue;
    }
    if (cameraId !== null) {
      const tickCamera = typeof incident?.cameraId === 'string'
        ? incident.cameraId.trim()
        : typeof incident?.camera_id === 'string'
          ? incident.camera_id.trim()
          : '';
      if (tickCamera !== cameraId) continue;
    }
    const offset = ((at - window.from) / window.durationMs) * 100;
    ticks.push({
      eventId: eventId.trim(),
      at,
      offsetPct: Math.round(Math.min(100, Math.max(0, offset)) * 100) / 100,
    });
  }
  ticks.sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId));
  return { ticks, ignored };
}

/**
 * Incident ticks for a window, without building the rest of the coverage model. A surface
 * that already holds incidents and a window can place the ticks itself; a camera id of
 * `null` keeps every incident in the window.
 *
 * @param {Array<object>} incidents
 * @param {{from: number|string|Date, to: number|string|Date}|null} window
 * @param {string|null} [cameraId]
 * @returns {Array<{eventId: string, at: number, offsetPct: number}>}
 */
export function incidentTicks(incidents, window, cameraId = null) {
  const option = typeof cameraId === 'string' && cameraId.trim() !== '' ? cameraId.trim() : null;
  return buildTicks(incidents, resolveWindow(window, []), option).ticks;
}

/** Empty per-camera shape, used for a declared camera with no samples. */
function emptyCamera(cameraId) {
  return {
    cameraId,
    noData: true,
    sampleCount: 0,
    spanFrom: null,
    spanTo: null,
    watchedMs: 0,
    liveMs: 0,
    degradedMs: 0,
    pausedMs: 0,
    hiddenMs: 0,
    noFramesMs: 0,
    gapMs: 0,
    coveragePct: 0,
    longestGapMs: 0,
    gaps: [],
    segments: [],
    ticks: [],
  };
}

/**
 * @typedef {object} CoverageCamera
 * @property {string} cameraId
 * @property {boolean} noData no usable sample in the window
 * @property {number} sampleCount valid samples folded into this camera
 * @property {number|null} spanFrom first claimed millisecond (epoch)
 * @property {number|null} spanTo last claimed millisecond (epoch)
 * @property {number} watchedMs territory the camera actually claimed
 * @property {number} liveMs
 * @property {number} degradedMs
 * @property {number} pausedMs
 * @property {number} hiddenMs
 * @property {number} noFramesMs cadence exceeded while live/degraded
 * @property {number} gapMs blind total (`noFramesMs + pausedMs + hiddenMs`)
 * @property {number} coveragePct `(liveMs + degradedMs) / watchedMs`, one decimal
 * @property {number} longestGapMs longest merged blind window
 * @property {Array<{from: number, to: number, reason: string, durationMs: number}>} gaps
 * @property {Array<{from: number, to: number, state: string}>} segments drawable ribbon run
 * @property {Array<{eventId: string, at: number, offsetPct: number}>} ticks
 */

/**
 * Coverage for one camera. Exported for the tests that pin the interval arithmetic; the
 * public entry point is `coverageFor`.
 *
 * @param {string} cameraId
 * @param {Array<{cameraId: string, at: number, status: string}>} points sorted, deduped
 * @param {object} context
 * @returns {CoverageCamera}
 */
export function coverageForCamera(cameraId, points, context) {
  const { from, to, expectedFrameMs: cadence, firstOtherAt, incidents } = context;
  if (!points.length) {
    return { ...emptyCamera(cameraId), ticks: buildTicks(incidents, { from, to, durationMs: to - from }, cameraId).ticks };
  }

  // The last sample at or before the window start anchors the state at `from`.
  let startIndex = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].at <= from) startIndex = index;
  }

  const lastIndex = points.length - 1;
  // A later sample from another camera means this camera was switched away from.
  const switchAt = firstOtherAt(cameraId, points[lastIndex].at);
  const raw = [];

  const add = (state, start, end) => {
    if (end > start) raw.push({ from: start, to: end, state });
  };

  for (let index = startIndex; index <= lastIndex; index += 1) {
    const current = points[index];
    const start = Math.max(current.at, from);
    let end;
    let closedBySwitch = false;
    if (index < lastIndex) {
      end = Math.min(points[index + 1].at, to);
    } else if (switchAt != null && switchAt <= to) {
      end = switchAt;
      closedBySwitch = true;
    } else {
      // Still the active source at the end of the window: frames should have kept coming.
      end = to;
    }
    if (end <= start) continue;

    if (BLIND_STATES.has(current.status)) {
      add(current.status, start, end);
      continue;
    }

    // The sample only vouches for its own cadence; the rest is a measured gap.
    const coveredEnd = Math.min(end, current.at + cadence);
    if (coveredEnd > start) add(current.status, start, coveredEnd);
    if (end > coveredEnd && !closedBySwitch) add(GAP_REASON.NO_FRAMES, Math.max(coveredEnd, start), end);
  }

  const segments = mergeSegments(raw);
  const buckets = {
    liveMs: 0,
    degradedMs: 0,
    pausedMs: 0,
    hiddenMs: 0,
    noFramesMs: 0,
  };
  for (const segment of segments) {
    const bucket = STATE_BUCKET[segment.state];
    if (bucket) buckets[bucket] += segment.to - segment.from;
  }

  const gaps = mergeGaps(
    segments
      .filter((segment) => segment.state !== COVERAGE_STATE.LIVE && segment.state !== COVERAGE_STATE.DEGRADED)
      .map((segment) => ({ from: segment.from, to: segment.to, reason: segment.state }))
  );

  const blurred = buckets.pausedMs + buckets.hiddenMs + buckets.noFramesMs;
  const watchedMs = buckets.liveMs + buckets.degradedMs + blurred;
  const longestGapMs = gaps.reduce((longest, gap) => Math.max(longest, gap.durationMs), 0);
  const cameraWindow = { from, to, durationMs: to - from };

  return {
    cameraId,
    noData: watchedMs === 0,
    sampleCount: points.length,
    spanFrom: segments.length ? segments[0].from : null,
    spanTo: segments.length ? segments[segments.length - 1].to : null,
    watchedMs,
    liveMs: buckets.liveMs,
    degradedMs: buckets.degradedMs,
    pausedMs: buckets.pausedMs,
    hiddenMs: buckets.hiddenMs,
    noFramesMs: buckets.noFramesMs,
    gapMs: blurred,
    coveragePct: percent(buckets.liveMs + buckets.degradedMs, watchedMs),
    longestGapMs,
    gaps,
    segments,
    ticks: buildTicks(incidents, cameraWindow, cameraId).ticks,
  };
}

/**
 * Build the coverage receipt for a session.
 *
 * @param {Array<{cameraId?: string, camera_id?: string, at: number|string|Date, status: string,
 *   width?: number, height?: number}>} samples processed-frame samples, in any order
 * @param {Array<{eventId?: string, event_id?: string, at: number|string|Date, cameraId?: string}>} incidents
 * @param {{from: number|string|Date, to: number|string|Date}|null} window session window
 * @param {{expectedFrameMs?: number, cameras?: string[]}} [options]
 *   `expectedFrameMs` is the sample cadence (default 1000 ms); `cameras` declares cameras
 *   that should appear even with no samples, so the UI can render "fără date".
 * @returns {object}
 */
export function coverageFor(samples, incidents = [], window = null, options = {}) {
  const cadence =
    Number.isFinite(options?.expectedFrameMs) && options.expectedFrameMs > 0
      ? options.expectedFrameMs
      : expectedFrameMs;
  const declared = Array.isArray(options?.cameras)
    ? options.cameras.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim())
    : [];

  const normalized = [];
  let invalid = 0;
  let ignored = 0;
  for (const sample of Array.isArray(samples) ? samples : []) {
    const point = normalizeSample(sample);
    if (point === null) {
      invalid += 1;
      continue;
    }
    normalized.push(point);
  }

  const resolved = resolveWindow(window, normalized);
  const { from, to, durationMs } = resolved;

  // Fold duplicates toward the least flattering state, then sort: re-sent or reordered
  // samples cannot change the result.
  const byCamera = new Map();
  for (const point of normalized) {
    if (point.at > to) {
      // A clock-skewed sample in the future must not stretch the window.
      ignored += 1;
      continue;
    }
    let list = byCamera.get(point.cameraId);
    if (!list) {
      list = new Map();
      byCamera.set(point.cameraId, list);
    }
    const previous = list.get(point.at);
    if (!previous || STATE_SEVERITY[point.status] > STATE_SEVERITY[previous.status]) {
      list.set(point.at, point);
    }
  }

  const pointsByCamera = new Map();
  for (const [cameraId, list] of byCamera) {
    pointsByCamera.set(
      cameraId,
      [...list.values()].sort((a, b) => a.at - b.at)
    );
  }

  // Only the latest sample before the window matters as an anchor; older ones are noise.
  for (const [cameraId, points] of pointsByCamera) {
    let anchor = -1;
    for (let index = 0; index < points.length; index += 1) {
      if (points[index].at <= from) anchor = index;
      else break;
    }
    if (anchor > 0) pointsByCamera.set(cameraId, points.slice(anchor));
  }

  const firstOtherAt = (cameraId, at) => {
    let earliest = null;
    for (const [otherId, points] of pointsByCamera) {
      if (otherId === cameraId) continue;
      for (const point of points) {
        if (point.at > at) {
          if (earliest === null || point.at < earliest) earliest = point.at;
          break;
        }
      }
    }
    return earliest;
  };

  const cameraIds = [...new Set([...pointsByCamera.keys(), ...declared])];
  const context = { from, to, expectedFrameMs: cadence, firstOtherAt, incidents };

  const cameras = cameraIds
    .map((cameraId) => coverageForCamera(cameraId, pointsByCamera.get(cameraId) ?? [], context))
    .sort((a, b) => {
      const left = a.spanFrom ?? Number.POSITIVE_INFINITY;
      const right = b.spanFrom ?? Number.POSITIVE_INFINITY;
      return left - right || a.cameraId.localeCompare(b.cameraId);
    });

  const sessionTicks = buildTicks(incidents, resolved, null);

  const totals = {
    cameras: cameras.length,
    durationMs,
    sampleCount: cameras.reduce((sum, camera) => sum + camera.sampleCount, 0),
    watchedMs: cameras.reduce((sum, camera) => sum + camera.watchedMs, 0),
    liveMs: cameras.reduce((sum, camera) => sum + camera.liveMs, 0),
    degradedMs: cameras.reduce((sum, camera) => sum + camera.degradedMs, 0),
    pausedMs: cameras.reduce((sum, camera) => sum + camera.pausedMs, 0),
    hiddenMs: cameras.reduce((sum, camera) => sum + camera.hiddenMs, 0),
    noFramesMs: cameras.reduce((sum, camera) => sum + camera.noFramesMs, 0),
    gapMs: cameras.reduce((sum, camera) => sum + camera.gapMs, 0),
    longestGapMs: cameras.reduce((sum, camera) => Math.max(sum, camera.longestGapMs), 0),
    coveragePct: 0,
    ticks: sessionTicks.ticks,
    noData: true,
  };
  totals.coveragePct = percent(totals.liveMs + totals.degradedMs, totals.watchedMs);
  totals.noData = totals.watchedMs === 0;

  return {
    window: resolved,
    expectedFrameMs: cadence,
    cameras,
    totals,
    noData: totals.noData,
    invalid,
    ignored,
    ignoredIncidents: sessionTicks.ignored,
  };
}
