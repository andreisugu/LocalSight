// Incident/event layer of the browser engine.
//
// Reference: `ml/safesight_ml/pipeline.py` (how an event is built),
// `ml/safesight_ml/events.py` (field constraints), `backend/app/services/events.py`
// (ACTIONS / status machine) and `backend/app/services/escalation.py` (threshold and
// what an ack cancels). `docs/contract.md` is historical for SafeSight but still owns the
// envelope shape and the `evt_<camera>_<unix_ms>_<track>` id format.
//
// One field deviates from the contract on purpose and only in the static build:
// `snapshot_url` is a `blob:` URL from `URL.createObjectURL`, because no server exists to
// serve `/snapshots/...`. See `docs/browser-engine.md` §3. This is a build deviation, not
// a contract change: nothing here writes or accepts `minio://`.
//
// There is no backend in the tab, so the fields the backend owns (`status`, `report` and
// the timestamps) are initialised here by `buildEvent` and moved only by `applyAction`
// and `escalateIfDue`. All times are Unix epoch **milliseconds**; a `Date` is accepted
// wherever a timestamp is.

const DEFAULT_INCIDENT_COOLDOWN_S = 60;
const EVENT_TYPES = new Set(['RESTRICTED_ZONE', 'NO_PPE', 'SMOKING', 'CAMERA_OFFLINE']);
const SEVERITIES = new Set(['CRITICAL', 'WARNING']);
const EVENT_ID_CAMERA = /^[a-z0-9-]+$/;
// Mirrors ACTIONS in backend/app/services/events.py: action -> (allowed from, new status).
const ACTIONS = {
  ack: { from: ['open', 'escalated'], to: 'acknowledged' },
  false_positive: { from: ['open', 'escalated', 'acknowledged'], to: 'false_positive' },
  reopen: { from: ['acknowledged', 'false_positive', 'escalated', 'resolved'], to: 'open' },
};

/** Coerce a Date or epoch-millisecond number to integer epoch milliseconds. */
function toEpochMs(value, field) {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new TypeError(`${field} must be a Date or epoch milliseconds`);
  }
  return Math.trunc(ms);
}

/** ISO 8601 UTC with milliseconds, e.g. `2026-10-30T10:42:13.120Z`. */
function isoUtc(ms) {
  return new Date(ms).toISOString();
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${field} must be a number in [${min}, ${max}]`);
  }
  return value;
}

/** Composite key for the cooldown map; event types and zone ids contain neither `|` nor `\0`. */
function cooldownKey(eventType, zoneId) {
  return `${eventType}\u0000${zoneId}`;
}

/**
 * Build the contract event id: `evt_<camera_id>_<unix_ms>_<track_id>`.
 *
 * Same formula as `Pipeline.process` (`pipeline.py`): the epoch comes from the event
 * clock, the track id from the tracker (`0` for events without a person track).
 * Validated against the same shape the backend enforces
 * (`^evt_[a-z0-9-]+_\d{13}_\d+$`), so a typo fails here instead of producing an id the
 * API would reject with 422.
 *
 * @param {string} cameraId Seeded camera id, lowercase letters/digits/hyphens (`stand12`).
 * @param {number|Date} epochMs Detection time in Unix epoch milliseconds (13 digits).
 * @param {number} trackId Tracker id, integer >= 0.
 * @returns {string} `evt_stand12_1793356933120_17`.
 * @throws {TypeError} cameraId is not a string.
 * @throws {RangeError} cameraId shape, epochMs width or trackId is invalid.
 */
export function eventId(cameraId, epochMs, trackId) {
  if (typeof cameraId !== 'string' || !EVENT_ID_CAMERA.test(cameraId)) {
    throw new RangeError('cameraId must match [a-z0-9-]+');
  }
  const ms = toEpochMs(epochMs, 'epochMs');
  if (String(ms).length !== 13) {
    throw new RangeError('epochMs must be Unix epoch milliseconds (13 digits)');
  }
  requireInteger(trackId, 'trackId', { min: 0 });
  return `evt_${cameraId}_${ms}_${trackId}`;
}

/**
 * Per-camera incident cooldown: one incident per `(type, zone)` per window.
 *
 * Mirrors `Pipeline._in_cooldown` / `self._last_incident` in `pipeline.py`: the key is the
 * event type **and** the zone id, the window defaults to 60 s, and `0` disables the
 * cooldown entirely (used by the demo clip so a looped pass can raise its event again).
 * One instance belongs to one camera; zones from another camera never share a window.
 * `allow()` is a pure query — `record()` is what the caller does after emitting.
 */
export class IncidentCooldown {
  /**
   * @param {number} [windowS=60] Window in seconds; `0` disables the cooldown.
   * @throws {RangeError} windowS is not a finite number >= 0.
   */
  constructor(windowS = DEFAULT_INCIDENT_COOLDOWN_S) {
    requireNumber(windowS, 'windowS', { min: 0 });
    /** @type {number} */
    this.windowS = windowS;
    /** @type {Map<string, number>} last emitted incident per `(type, zone)`, epoch ms. */
    this.lastIncident = new Map();
  }

  /**
   * May a new incident of this type in this zone be raised now?
   * True when the window is disabled, nothing was recorded yet, or the window expired.
   * The boundary is inclusive: at exactly `windowS` the incident is allowed again, like
   * `now_s - last < incident_cooldown_s` returning False in Python.
   *
   * @param {string} eventType Contract event type, e.g. `RESTRICTED_ZONE`.
   * @param {string} zoneId Zone id, e.g. `engine-left`.
   * @param {number|Date} [now=Date.now()] Current time, epoch ms.
   * @returns {boolean} True when the caller may build and emit an event.
   */
  allow(eventType, zoneId, now = Date.now()) {
    requireNonEmptyString(eventType, 'eventType');
    requireNonEmptyString(zoneId, 'zoneId');
    if (this.windowS <= 0) return true;
    const last = this.lastIncident.get(cooldownKey(eventType, zoneId));
    return last === undefined || toEpochMs(now, 'now') - last >= this.windowS * 1000;
  }

  /**
   * Mark that an incident was emitted, starting (or restarting) its window.
   *
   * @param {string} eventType Contract event type.
   * @param {string} zoneId Zone id.
   * @param {number|Date} [now=Date.now()] Emission time, epoch ms.
   * @returns {void}
   */
  record(eventType, zoneId, now = Date.now()) {
    requireNonEmptyString(eventType, 'eventType');
    requireNonEmptyString(zoneId, 'zoneId');
    this.lastIncident.set(cooldownKey(eventType, zoneId), toEpochMs(now, 'now'));
  }
}

/**
 * Build the complete event object the UI stores, in contract field order.
 *
 * Edge fields come from detection (`pipeline.py` builds the same set: severity from the
 * zone, `confidence` as `{ detector, temporal: { seen, window } }`, `duration_s` rounded
 * to milliseconds, `context.engine_on` frozen at detection time). Backend fields are
 * initialised for the local store: `status: "open"`, `report: null`, no notification and
 * no escalation yet. `received_at` defaults to `detected_at` because "ingest" happens in
 * the same tick here; pass it explicitly when the detection clock is media time.
 *
 * `snapshotUrl` is a `blob:` URL in the browser; `/snapshots/...` and `http(s)` are still
 * accepted so a recorded fixture from the Python edge can be replayed unchanged.
 *
 * @param {object} input
 * @param {string} input.cameraId Camera id.
 * @param {string} input.type `RESTRICTED_ZONE` | `NO_PPE` | `SMOKING` | `CAMERA_OFFLINE`.
 * @param {string} input.severity `CRITICAL` | `WARNING` (from the zone).
 * @param {string} input.zoneId Zone id.
 * @param {number} input.trackId Tracker id, `0` when there is no person track.
 * @param {{ detector: number, seen: number, window: number }} input.confidence Detector
 *   score 0..1 and the temporal window (`seen` of `window` frames).
 * @param {number} input.durationS Seconds in the zone.
 * @param {boolean} input.engineOn `context.engine_on` at detection time.
 * @param {string} input.snapshotUrl Blob URL (or `/snapshots/...` / http(s)) of the
 *   already blurred frame.
 * @param {string} input.model Detector name and version, e.g. `yolo26n`.
 * @param {number|Date} [input.detectedAt=Date.now()] Detection time, epoch ms.
 * @param {number|Date} [input.receivedAt=input.detectedAt] Local ingest time, epoch ms.
 * @returns {object} Event with the `EventOut` shape (`status`, timestamps, `report`).
 * @throws {TypeError|RangeError} Any field is missing or outside the contract.
 */
export function buildEvent({
  cameraId,
  type,
  severity,
  zoneId,
  trackId,
  confidence,
  durationS,
  engineOn,
  snapshotUrl,
  model,
  detectedAt = Date.now(),
  receivedAt,
} = {}) {
  requireNonEmptyString(cameraId, 'cameraId');
  if (!EVENT_ID_CAMERA.test(cameraId)) throw new RangeError('cameraId must match [a-z0-9-]+');
  if (!EVENT_TYPES.has(type)) throw new RangeError(`type must be one of ${[...EVENT_TYPES].join(', ')}`);
  if (!SEVERITIES.has(severity)) throw new RangeError('severity must be CRITICAL or WARNING');
  requireNonEmptyString(zoneId, 'zoneId');
  requireInteger(trackId, 'trackId', { min: 0 });
  requireNumber(durationS, 'durationS', { min: 0 });
  if (typeof engineOn !== 'boolean') throw new TypeError('engineOn must be a boolean');
  requireNonEmptyString(snapshotUrl, 'snapshotUrl');
  if (snapshotUrl.startsWith('minio://')) {
    throw new RangeError('snapshotUrl must never be minio://');
  }
  requireNonEmptyString(model, 'model');

  if (confidence === null || typeof confidence !== 'object') {
    throw new TypeError('confidence must be an object');
  }
  const { detector, seen, window } = confidence;
  requireNumber(detector, 'confidence.detector', { min: 0, max: 1 });
  requireInteger(seen, 'confidence.seen', { min: 0 });
  requireInteger(window, 'confidence.window', { min: 1 });

  const detectedMs = toEpochMs(detectedAt, 'detectedAt');
  const receivedMs = receivedAt === undefined ? detectedMs : toEpochMs(receivedAt, 'receivedAt');

  return {
    event_id: eventId(cameraId, detectedMs, trackId),
    type,
    severity,
    status: 'open',
    camera_id: cameraId,
    zone_id: zoneId,
    track_id: trackId,
    confidence: { detector, temporal: { seen, window } },
    // pipeline.py: round(decision.duration_s, 3)
    duration_s: Math.round(durationS * 1000) / 1000,
    context: { engine_on: engineOn },
    snapshot_url: snapshotUrl,
    model,
    detected_at: isoUtc(detectedMs),
    received_at: isoUtc(receivedMs),
    notified_at: null,
    escalated_at: null,
    acked_at: null,
    acked_by: null,
    report: null,
  };
}

/**
 * Apply an operator action, returning a new event; the input is never mutated.
 *
 * The transitions and the fields each action touches are exactly those of
 * `apply_action` in `backend/app/services/events.py`:
 * - `ack`: `open` | `escalated` -> `acknowledged`, sets `acked_at` / `acked_by` and
 *   cancels a pending escalation (`escalated_at` is left as it was).
 * - `markFalsePositive`: `open` | `escalated` | `acknowledged` -> `false_positive`,
 *   cancels a pending escalation. The operator note lives in the action log in Python,
 *   not on the event, so it is not stored here.
 * - `reopen`: `acknowledged` | `false_positive` | `escalated` | `resolved` -> `open`,
 *   clears `acked_at`, `acked_by` and `escalated_at`; the caller re-arms escalation
 *   (Python calls `schedule_escalation` again).
 *
 * An action the backend would reject with 409 throws instead, with `statusCode = 409`
 * and `code = 'conflict'`, so the UI can show the same message.
 *
 * @param {object} event Event produced by `buildEvent` (or a previous action).
 * @param {'ack'|'markFalsePositive'|'false_positive'|'reopen'} action Operator action;
 *   the UI constant names and the API path names are both accepted.
 * @param {{ operator?: string, now?: number|Date }} [options] Operator name (required by
 *   the API) and action time, epoch ms.
 * @returns {object} A new event with the updated status and timestamps.
 * @throws {Error} The transition is not allowed from the current status (409).
 * @throws {TypeError|RangeError} Unknown action, missing operator or malformed event.
 */
export function applyAction(event, action, { operator, now = Date.now() } = {}) {
  if (event === null || typeof event !== 'object') throw new TypeError('event must be an object');
  requireNonEmptyString(event.event_id, 'event.event_id');
  requireNonEmptyString(event.status, 'event.status');

  const key = action === 'markFalsePositive' ? 'false_positive' : action;
  const rule = ACTIONS[key];
  if (rule === undefined) {
    throw new RangeError(`unknown action: ${String(action)}`);
  }
  if (!rule.from.includes(event.status)) {
    const error = new Error(`cannot ${key} an event with status ${event.status}`);
    error.code = 'conflict';
    error.statusCode = 409;
    throw error;
  }

  const actor = requireNonEmptyString(operator, 'operator');
  if (actor.length > 64) throw new RangeError('operator must be at most 64 characters');
  const at = isoUtc(toEpochMs(now, 'now'));

  if (key === 'ack') {
    return { ...event, status: rule.to, acked_at: at, acked_by: actor };
  }
  if (key === 'false_positive') {
    return { ...event, status: rule.to };
  }
  return { ...event, status: rule.to, acked_at: null, acked_by: null, escalated_at: null };
}

/**
 * Escalate an open event once its zone threshold has passed, else return null.
 *
 * Same rule as `escalation.schedule_escalation` + `escalate`: the delay is the zone's
 * `escalate_after_s`, the clock starts at `received_at` (Python re-arms from
 * `received_at` in `recover_timers`), only `open` events escalate, `CAMERA_OFFLINE` never
 * escalates, and `thresholdS` null/absent means the zone has no escalation. At exactly
 * the threshold the event escalates, mirroring `remaining <= 0`.
 *
 * @param {object} event Event produced by `buildEvent` / `applyAction`.
 * @param {number|Date} [now=Date.now()] Current time, epoch ms.
 * @param {number|null} thresholdS Zone `escalate_after_s` in seconds; null disables.
 * @returns {object|null} New escalated event, or null when nothing is due.
 * @throws {TypeError|RangeError} The event has no readable `received_at`.
 */
export function escalateIfDue(event, now = Date.now(), thresholdS = null) {
  if (event === null || typeof event !== 'object') throw new TypeError('event must be an object');
  if (event.status !== 'open') return null;
  if (event.type === 'CAMERA_OFFLINE') return null;
  if (typeof thresholdS !== 'number' || !Number.isFinite(thresholdS) || thresholdS <= 0) return null;

  const receivedMs = Date.parse(event.received_at);
  if (Number.isNaN(receivedMs)) {
    throw new TypeError('event.received_at must be an ISO 8601 timestamp');
  }
  const nowMs = toEpochMs(now, 'now');
  if (nowMs - receivedMs < thresholdS * 1000) return null;

  return { ...event, status: 'escalated', escalated_at: isoUtc(nowMs) };
}
