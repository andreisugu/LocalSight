// The browser frame pipeline: tracked detections -> zone rules -> incident event.
//
// Reference (removed from this fork): `Pipeline.process` in `ml/safesight_ml/pipeline.py`. The order of operations
// is the same: prune the rule state, update membership for every (track, zone) pair, fold
// the PPE state into the membership flag, let `RuleEngine.observe` decide, then check the
// incident cooldown and build the event. Everything that needs pixels or I/O stays out:
//
// - detection is the worker's job (`decode.js` produces the boxes this module receives);
// - the blurred snapshot is produced by the renderer, so this module cannot store one.
//   It takes the URL the caller already made and keeps a clearly fake placeholder until
//   then (see `SNAPSHOT_PENDING`);
// - the hi-vis colour heuristic (`ppe.py`) is not ported here; the caller passes the vest
//   state it measured, exactly like the Python pipeline consumes `VestTracker.update`;
// - the alert banner and the video/live writers have no browser equivalent.
//
// Pure: no DOM, no inference, no fetch. The clock is injected so a looped clip and a test
// share the same code path.

import { buildEvent, IncidentCooldown } from './events.js';
import { createTracker } from './tracker.js';
import { RuleEngine, ZoneMembership, triggersEvent } from './zones.js';

/** Zone rule -> contract event type. Every other rule type stays silent. */
export const EVENT_TYPE_BY_RULE = Object.freeze({
  RESTRICTED: 'RESTRICTED_ZONE',
  PPE_REQUIRED: 'NO_PPE',
});

/** Detector name the browser build runs, stored in `model` (`events.js` requires it). */
export const DEFAULT_MODEL = 'yolo26n';

/**
 * `snapshot_url` used when the caller has not rendered a blurred frame yet. The static
 * build has no server, so the real value is a `blob:` URL from the renderer; this
 * placeholder is deliberately not a working URL, to make a missing snapshot visible in
 * the UI instead of silently pointing at `/snapshots/...`.
 */
export const SNAPSHOT_PENDING = 'blob:pending';

/**
 * One person detection for a frame, already normalized to 0..1 by the caller. The box is
 * the same shape the tracker and the zone geometry use.
 *
 * @typedef {object} PipelineDetection
 * @property {import('./tracker.js').Bbox} bbox Normalized `[x1, y1, x2, y2]`.
 * @property {number} confidence Detector score in 0..1.
 */

/**
 * @param {number} trackId
 * @param {string} zoneId
 * @returns {string}
 */
function pairKey(trackId, zoneId) {
  return `${trackId}\u0000${zoneId}`;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function requirePositive(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0`);
  }
  return value;
}

/**
 * Keep the zones this camera owns, as `Pipeline.__init__` does.
 *
 * @param {unknown} zones
 * @param {string} cameraId
 * @returns {import('./zones.js').Zone[]}
 */
function zonesForCamera(zones, cameraId) {
  if (!Array.isArray(zones)) throw new TypeError('zones must be an array');
  return zones.filter(
    (zone) => zone !== null && typeof zone === 'object' && zone.camera_id === cameraId,
  );
}

/**
 * Create the per-camera pipeline.
 *
 * One instance belongs to one camera and owns its tracker, rule engine, membership and
 * incident cooldown, so ids and cooldowns never leak across cameras. `setZones` and
 * `setEngineOn` hot-apply the UI config without rebuilding the state, like
 * `Pipeline.set_config`.
 *
 * @param {object} input
 * @param {string} input.cameraId Camera id, lowercase letters/digits/hyphens.
 * @param {import('./zones.js').Zone[]} [input.zones] Zones as served by the API (`GET /zones`).
 * @param {boolean} input.engineOn The UI engine switch at start-up.
 * @param {number} [input.incidentCooldownS] One incident per (type, zone) per window;
 *   `0` disables it, e.g. for a looped demo clip. Defaults to 60.
 * @param {() => number} [input.clock] Event-clock source in epoch milliseconds. Defaults
 *   to `Date.now`; pass a media-time clock when a replay must stay deterministic.
 * @param {string} [input.model] Detector name stored in `model`. Defaults to `yolo26n`.
 * @returns {{
 *   step: (detections: PipelineDetection[], nowS: number,
 *          options: { frameWidth: number, frameHeight: number,
 *                     vestStates?: Array<string|null>, snapshotUrl?: string }) =>
 *           { events: object[], tracked: import('./tracker.js').TrackedBox[] },
 *   setZones: (zones: import('./zones.js').Zone[]) => void,
 *   setEngineOn: (engineOn: boolean) => void,
 * }}
 * @throws {TypeError|RangeError} A required input is missing or malformed.
 */
export function createPipeline({
  cameraId,
  zones = [],
  engineOn,
  incidentCooldownS = 60,
  clock = Date.now,
  model = DEFAULT_MODEL,
} = {}) {
  if (typeof cameraId !== 'string' || cameraId.length === 0) {
    throw new TypeError('cameraId must be a non-empty string');
  }
  if (typeof engineOn !== 'boolean') throw new TypeError('engineOn must be a boolean');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof model !== 'string' || model.length === 0) {
    throw new TypeError('model must be a non-empty string');
  }

  const tracker = createTracker();
  const rules = new RuleEngine();
  const membership = new ZoneMembership();
  const cooldown = new IncidentCooldown(incidentCooldownS);
  let currentZones = zonesForCamera(zones, cameraId);
  let engine = engineOn;

  /**
   * Process one frame.
   *
   * `nowS` is the pipeline clock in seconds (media time in the browser). It drives the
   * rule window, `debounce_s` and the incident cooldown, while `clock()` stamps the event
   * itself, the same split as `now_s` vs `start_epoch + now_s` in `pipeline.py`.
   *
   * `vestStates` is indexed like `detections` (the tracker returns one entry per
   * detection, in order). A missing entry is `unknown`, which keeps a PPE zone silent.
   *
   * @param {PipelineDetection[]} detections Normalized person detections.
   * @param {number} nowS Frame time in seconds, monotonic.
   * @param {object} options
   * @param {number} options.frameWidth Frame width in pixels, for the zone aspect.
   * @param {number} options.frameHeight Frame height in pixels.
   * @param {Array<string|null>} [options.vestStates] `vest` | `no_vest` | `unknown` per detection.
   * @param {string} [options.snapshotUrl] Blurred snapshot URL for a new event.
   * @returns {{ events: object[], tracked: import('./tracker.js').TrackedBox[] }}
   *   New events and the person boxes the renderer draws and blurs.
   * @throws {TypeError|RangeError} A detection, dimension or time is malformed.
   */
  function step(
    detections,
    nowS,
    { frameWidth, frameHeight, vestStates = [], snapshotUrl = SNAPSHOT_PENDING } = {},
  ) {
    if (!Array.isArray(detections)) throw new TypeError('detections must be an array');
    requirePositive(frameWidth, 'frameWidth');
    requirePositive(frameHeight, 'frameHeight');
    if (typeof nowS !== 'number' || !Number.isFinite(nowS) || nowS < 0) {
      throw new RangeError('nowS must be a finite number >= 0');
    }
    const nowMs = clock();
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('clock must return epoch milliseconds');
    }

    // Pipeline.process: prune first, then update state. The membership is updated while
    // events are muted as well, so the state never goes stale.
    rules.prune(nowS);
    membership.prune(nowS);

    const tracked = tracker.update(detections, nowMs);
    const aspect = frameWidth / frameHeight;

    const inZone = new Map();
    for (const track of tracked) {
      for (const zone of currentZones) {
        if (!Object.hasOwn(EVENT_TYPE_BY_RULE, zone.rule_type)) continue;
        const inside = membership.update({
          trackId: track.trackId,
          bbox: track.bbox,
          zone,
          now: nowS,
          aspect,
        });
        inZone.set(pairKey(track.trackId, zone.id), inside);
      }
    }

    const events = [];
    // The cooldown follows `nowS`, like `_in_cooldown` in the reference; the event
    // timestamps follow `clock()`.
    const cooldownNowMs = nowS * 1000;

    for (let index = 0; index < tracked.length; index += 1) {
      const track = tracked[index];
      const vestState = vestStates[index] ?? 'unknown';
      for (const zone of currentZones) {
        if (!Object.hasOwn(EVENT_TYPE_BY_RULE, zone.rule_type)) continue;
        const decision = rules.observe({
          trackId: track.trackId,
          zone,
          // A PPE zone only counts while the requirement is actually broken: putting the
          // vest on stops the accumulation, taking it off starts fresh after the cooldown.
          inZone: inZone.get(pairKey(track.trackId, zone.id)) === true && triggersEvent(zone, vestState),
          now: nowS,
          engineOn: engine,
        });
        if (decision === null) continue;

        const type = EVENT_TYPE_BY_RULE[zone.rule_type];
        if (!cooldown.allow(type, zone.id, cooldownNowMs)) continue;

        events.push(
          buildEvent({
            cameraId,
            type,
            severity: zone.severity,
            zoneId: zone.id,
            trackId: track.trackId,
            confidence: {
              detector: track.confidence,
              seen: decision.seen,
              window: decision.window,
            },
            durationS: decision.duration_s,
            engineOn: engine,
            snapshotUrl,
            model,
            detectedAt: nowMs,
          }),
        );
        cooldown.record(type, zone.id, cooldownNowMs);
      }
    }

    return { events, tracked };
  }

  /**
   * Replace the zone list, e.g. after the operator edits a polygon.
   * @param {import('./zones.js').Zone[]} zones
   * @returns {void}
   */
  function setZones(zones) {
    currentZones = zonesForCamera(zones, cameraId);
  }

  /**
   * Flip the engine switch; `engine_on` zones follow it, `always` zones do not.
   * @param {boolean} engineOn
   * @returns {void}
   */
  function setEngineOn(engineOn) {
    if (typeof engineOn !== 'boolean') throw new TypeError('engineOn must be a boolean');
    engine = engineOn;
  }

  return { step, setZones, setEngineOn };
}
