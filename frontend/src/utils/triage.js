// Operator triage core: the queue rule, episode grouping, holds and the reading freeze.
//
// This is a read model over contract events plus a small session-local record. It is pure
// (an injected clock, no React, no browser API) so the queue can be explained and tested
// outside the UI. It never writes an event: holds live in their own map, and every function
// returns a new state object instead of mutating the one it was given.
//
// The ranking is the documented lexicographic rule, deliberately not a score:
//
//   escalated → CRITICAL before WARNING → nearest deadline → oldest → event_id
//
// Deadline = `detected_at + escalate_after_s`. A missing or non-positive threshold, or an
// unreadable `detected_at`, means "unknown deadline": the row sorts last inside its
// severity and says `termen necunoscut` rather than inventing a timer.

import { canDo } from '../constants/eventActions.js';

/** A hold may never last longer than 15 minutes; the cap is not a caller parameter. */
export const HOLD_MAX_S = 900;

/** Default episode window: one walk-through inside two minutes is one story. */
export const DEFAULT_EPISODE_WINDOW_S = 120;

/** Longest hold reason kept in the session record, in characters. */
const HOLD_REASON_MAX_LENGTH = 140;

const CRITICAL = 'CRITICAL';
const WARNING = 'WARNING';

/**
 * @param {unknown} value ISO timestamp, epoch milliseconds or Date.
 * @returns {number|null} epoch milliseconds, or null when unreadable.
 */
function toEpochMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

/**
 * @param {unknown} now epoch milliseconds or Date; invalid input falls back to the wall clock.
 * @returns {number} epoch milliseconds
 */
function clock(now) {
  return toEpochMs(now) ?? Date.now();
}

/** Codepoint order, so a tie-break never depends on the browser locale. */
function compareIds(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Escalation deadline for one event.
 *
 * @param {object|null|undefined} event
 * @returns {number|null} epoch milliseconds, or null when the event has no timer.
 */
export function deadlineFor(event) {
  const raw = event?.escalate_after_s;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const threshold = Number(raw);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  const detected = toEpochMs(event?.detected_at);
  if (detected == null) return null;
  return detected + threshold * 1000;
}

/**
 * Seconds left until the escalation deadline; negative once it has passed.
 *
 * @param {object|null|undefined} event
 * @param {number|Date} [now=Date.now()]
 * @returns {number|null} null when the deadline is unknown.
 */
export function remainingS(event, now = Date.now()) {
  const deadline = deadlineFor(event);
  if (deadline == null) return null;
  return (deadline - clock(now)) / 1000;
}

function severityRank(event) {
  if (event?.severity === CRITICAL) return 0;
  if (event?.severity === WARNING) return 1;
  return 2;
}

function deadlineText(seconds) {
  if (seconds <= 0) return 'termen depășit';
  return `deadline ${Math.round(seconds)} s`;
}

/** A row plus the sort keys; built once, never exposed. */
function toRow(event, now) {
  const deadlineAt = deadlineFor(event);
  return {
    eventId: String(event.event_id),
    event,
    deadlineAt,
    remainingS: deadlineAt == null ? null : (deadlineAt - now) / 1000,
    detectedMs: toEpochMs(event.detected_at),
    escalated: event.status === 'escalated',
    severity: severityRank(event),
  };
}

/** The ranking tuple, criterion by criterion. */
function compareRows(a, b) {
  if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
  if (a.severity !== b.severity) return a.severity - b.severity;

  const aKnown = a.remainingS != null;
  const bKnown = b.remainingS != null;
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (aKnown && a.remainingS !== b.remainingS) return a.remainingS - b.remainingS;

  const aDated = a.detectedMs != null;
  const bDated = b.detectedMs != null;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated && a.detectedMs !== b.detectedMs) return a.detectedMs - b.detectedMs;

  return compareIds(a.eventId, b.eventId);
}

/**
 * The reason line: the first criterion that puts this row where it is, relative to the row
 * above it. The first row names the strongest criterion that applies to it.
 *
 * @param {object} row
 * @param {object|null|undefined} previous
 * @returns {string}
 */
function reasonFor(row, previous) {
  if (!previous) {
    if (row.escalated) return 'escaladat';
    if (row.severity === 0) return 'critic';
    if (row.remainingS != null) return deadlineText(row.remainingS);
    return 'fără termen';
  }

  // Escalation can only lift a row above a non-escalated one; the first non-escalated row
  // below an escalated block is explained by the next criterion, not by "not escalated".
  if (row.escalated && !previous.escalated) return 'escaladat';
  if (row.severity !== previous.severity) {
    return row.severity === 0 ? 'critic' : 'avertisment';
  }

  const known = row.remainingS != null;
  const previousKnown = previous.remainingS != null;
  if (known !== previousKnown) return known ? deadlineText(row.remainingS) : 'termen necunoscut';
  if (known && row.remainingS !== previous.remainingS) return deadlineText(row.remainingS);

  const dated = row.detectedMs != null;
  const previousDated = previous.detectedMs != null;
  if (dated !== previousDated) return dated ? 'vechime' : 'fără oră';
  if (dated && row.detectedMs !== previous.detectedMs) return 'vechime';

  return 'ordine stabilă';
}

function withReasons(rows) {
  return rows.map((row, index) => ({
    eventId: row.eventId,
    event: row.event,
    reason: reasonFor(row, index > 0 ? rows[index - 1] : null),
    deadlineAt: row.deadlineAt,
    remainingS: row.remainingS,
  }));
}

/**
 * Order incidents by the documented rule.
 *
 * Every object with an `event_id` comes back exactly once, whatever its status: this is
 * the whole queue, and the caller decides which subset (open/escalated) it renders. A null,
 * non-object or id-less entry is skipped; the input array is never modified.
 *
 * @param {Array<object>} events
 * @param {number|Date} [now=Date.now()] injected clock, epoch milliseconds.
 * @returns {Array<{eventId: string, event: object, reason: string,
 *   deadlineAt: number|null, remainingS: number|null}>} ranked rows.
 */
export function rankIncidents(events, now = Date.now()) {
  if (!Array.isArray(events)) return [];
  const at = clock(now);
  const rows = events
    .filter((event) => event && typeof event === 'object' && event.event_id != null)
    .map((event) => toRow(event, at))
    .sort(compareRows);
  return withReasons(rows);
}

function isTracked(trackId) {
  if (trackId == null || trackId === '') return false;
  const numeric = Number(trackId);
  // The contract uses track 0 for events without a person track (camera offline).
  return !Number.isFinite(numeric) || numeric > 0;
}

/** One walk-through: same camera, zone and track; without a track, camera and zone. */
function episodeKey(event) {
  const camera = String(event.camera_id ?? '');
  const zone = String(event.zone_id ?? '');
  const track = isTracked(event.track_id) ? String(event.track_id) : null;
  return track == null ? `${camera}|${zone}` : `${camera}|${zone}|${track}`;
}

function episodeTitle(events) {
  const what = events[0]?.report?.what;
  if (typeof what === 'string' && what.trim() !== '') return what;
  const type = events[0]?.type;
  return typeof type === 'string' && type !== '' ? type : 'Incident';
}

function episodeWhere(events) {
  const parts = [events[0]?.camera_id, events[0]?.zone_id]
    .filter((part) => part != null && part !== '')
    .map(String);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function maxSeverity(events) {
  let worst = null;
  for (const event of events) {
    if (event.severity === CRITICAL) return CRITICAL;
    if (event.severity === WARNING) worst = WARNING;
  }
  return worst;
}

function buildEpisode(events, firstMs, lastMs) {
  return {
    id: `ep:${events[0].event_id}`,
    count: events.length,
    maxSeverity: maxSeverity(events),
    firstAt: firstMs == null ? null : events[0].detected_at ?? null,
    lastAt: lastMs == null ? null : events[events.length - 1].detected_at ?? null,
    eventIds: events.map((event) => String(event.event_id)),
    title: episodeTitle(events),
    where: episodeWhere(events),
    firstMs,
    lastMs,
  };
}

/**
 * Collapse a burst into episodes without losing a raw event.
 *
 * Same `camera_id` + `zone_id` + `track_id` (or `camera_id` + `zone_id` when the event has
 * no person track) and each detection at most `windowS` after the **episode's first**
 * detection (an anchored window: a long walk must eventually become a new episode instead
 * of extending one row forever). The type is deliberately not part of the key: one
 * walk-through can trigger several rules, and `maxSeverity` keeps the worst one visible.
 * An episode carries the maximum severity, never a downgrade; every event stays
 * addressable through `eventIds`. Newest episode first.
 *
 * @param {Array<object>} events
 * @param {{windowS?: number}} [options]
 * @returns {Array<{id: string, count: number, maxSeverity: string|null,
 *   firstAt: string|null, lastAt: string|null, eventIds: string[], title: string,
 *   where: string}>}
 */
export function groupEpisodes(events, { windowS = DEFAULT_EPISODE_WINDOW_S } = {}) {
  if (!Array.isArray(events)) return [];
  const requested = Number(windowS);
  const window = Number.isFinite(requested) && requested >= 0
    ? requested
    : DEFAULT_EPISODE_WINDOW_S;
  const windowMs = window * 1000;

  const buckets = new Map();
  const undated = [];

  for (const event of events) {
    if (!event || typeof event !== 'object' || event.event_id == null) continue;
    const detectedMs = toEpochMs(event.detected_at);
    // An unreadable timestamp cannot be placed in a window: its own episode keeps it
    // visible instead of attaching it to a story that may not be its own.
    if (detectedMs == null) {
      undated.push(event);
      continue;
    }
    const key = episodeKey(event);
    const bucket = buckets.get(key) ?? [];
    bucket.push({ event, detectedMs });
    buckets.set(key, bucket);
  }

  const episodes = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (
      a.detectedMs - b.detectedMs || compareIds(String(a.event.event_id), String(b.event.event_id))
    ));

    let run = [];
    let runStart = null;
    for (const item of bucket) {
      if (run.length > 0 && item.detectedMs - runStart > windowMs) {
        episodes.push(buildEpisode(run.map((entry) => entry.event), runStart, run[run.length - 1].detectedMs));
        run = [];
      }
      if (run.length === 0) runStart = item.detectedMs;
      run.push(item);
    }
    if (run.length > 0) {
      episodes.push(buildEpisode(run.map((entry) => entry.event), runStart, run[run.length - 1].detectedMs));
    }
  }

  for (const event of undated) {
    episodes.push(buildEpisode([event], null, null));
  }

  episodes.sort((a, b) => {
    if ((a.lastMs == null) !== (b.lastMs == null)) return a.lastMs == null ? 1 : -1;
    if (a.lastMs != null && a.lastMs !== b.lastMs) return b.lastMs - a.lastMs;
    if ((a.firstMs == null) !== (b.firstMs == null)) return a.firstMs == null ? 1 : -1;
    if (a.firstMs != null && a.firstMs !== b.firstMs) return b.firstMs - a.firstMs;
    return compareIds(a.id, b.id);
  });

  // Sort keys are internal; the public shape is the documented one.
  return episodes.map(({ firstMs: _firstMs, lastMs: _lastMs, ...episode }) => episode);
}

/**
 * The session-local record the queue reads. It is not persisted: until the local store
 * lands, a reload starts a fresh shift.
 *
 * @param {Array<object>} [events]
 * @param {{operator?: string|null}} [options] actor recorded on holds.
 * @returns {{events: Array<object>, holds: Record<string, object>,
 *   focusedEventId: string|null, frozenOrder: string[]|null, operator: string|null}}
 */
export function createTriageState(events = [], { operator = null } = {}) {
  return {
    events: Array.isArray(events) ? events : [],
    holds: {},
    focusedEventId: null,
    frozenOrder: null,
    operator: typeof operator === 'string' && operator.trim() !== '' ? operator.trim() : null,
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') return createTriageState([]);
  return {
    events: Array.isArray(state.events) ? state.events : [],
    holds: state.holds && typeof state.holds === 'object' ? state.holds : {},
    focusedEventId: state.focusedEventId ?? null,
    frozenOrder: Array.isArray(state.frozenOrder) ? state.frozenOrder : null,
    operator: state.operator ?? null,
  };
}

function findEvent(events, eventId) {
  return events.find((event) => event && String(event.event_id) === String(eventId));
}

function canHoldStatus(status) {
  return status === 'open' || status === 'escalated';
}

/**
 * Only a WARNING can be held. A CRITICAL must stay in front of the operator, and an event
 * that is already closed has nothing left to defer.
 *
 * @param {object|null|undefined} event
 * @returns {boolean}
 */
export function canHold(event) {
  return Boolean(event) && event.severity === WARNING && canHoldStatus(event.status);
}

function refused(code, message, state) {
  return { ok: false, code, message, state };
}

/**
 * Hold a WARNING for at most 15 minutes. The reason is mandatory and stored with the hold,
 * because a hold without a reason is a silent suppression. The event itself is untouched.
 *
 * @param {object} state triage state (`createTriageState`).
 * @param {string} eventId
 * @param {string} reason
 * @param {number|Date} [now=Date.now()]
 * @returns {{ok: boolean, code: string|null, message: string|null, state: object}}
 */
export function holdWarning(state, eventId, reason, now = Date.now()) {
  const base = normalizeState(state);
  const text = typeof reason === 'string' ? reason.trim() : '';

  if (text === '') {
    return refused('reason-required', 'Motivul e obligatoriu pentru o amânare.', base);
  }
  if (text.length > HOLD_REASON_MAX_LENGTH) {
    return refused(
      'reason-too-long',
      `Motivul poate avea cel mult ${HOLD_REASON_MAX_LENGTH} caractere.`,
      base
    );
  }

  const event = findEvent(base.events, eventId);
  if (!event) {
    return refused('not-found', 'Incidentul nu mai există în listă.', base);
  }
  if (event.severity === CRITICAL) {
    return refused('critical', 'Criticele nu pot fi amânate.', base);
  }
  if (!canHold(event)) {
    return refused(
      event.severity === WARNING ? 'closed' : 'not-warning',
      event.severity === WARNING
        ? 'Incidentul e deja închis.'
        : 'Doar avertismentele pot fi ținute.',
      base
    );
  }

  const at = clock(now);
  return {
    ok: true,
    code: null,
    message: null,
    state: {
      ...base,
      holds: {
        ...base.holds,
        [String(eventId)]: {
          reason: text,
          until: at + HOLD_MAX_S * 1000,
          by: base.operator,
        },
      },
      // A hold is an operator action: the reading freeze is over, so the queue re-ranks.
      frozenOrder: null,
    },
  };
}

/**
 * Drop a hold. Releasing is an action too, so the order is recomputed.
 *
 * @param {object} state
 * @param {string} eventId
 * @returns {object} a state without the hold; equivalent when there was nothing to release.
 */
export function releaseHold(state, eventId) {
  const base = normalizeState(state);
  const key = String(eventId);
  if (!base.holds[key]) return base;
  const holds = { ...base.holds };
  delete holds[key];
  return { ...base, holds, frozenOrder: null };
}

/**
 * Holds that are still in force at `now`; an expired hold is gone even if nobody released
 * it, and it is never written back to the event.
 *
 * @param {object} state
 * @param {number|Date} [now=Date.now()]
 * @returns {Record<string, {reason: string, until: number, by: string|null}>}
 */
export function activeHolds(state, now = Date.now()) {
  const base = normalizeState(state);
  const at = clock(now);
  const active = {};
  for (const [eventId, hold] of Object.entries(base.holds)) {
    if (!hold || typeof hold !== 'object') continue;
    if (Number(hold.until) > at) active[eventId] = hold;
  }
  return active;
}

/**
 * Freeze the current order while the operator reads it.
 *
 * With focus inside the queue, rows must not jump when a timer flips a status underneath
 * the reader. The snapshot holds event ids only, so:
 * - same event set → the frozen sequence is kept, even if statuses changed;
 * - a new or vanished event → the set differs, so the queue re-ranks (a new CRITICAL must
 *   never wait behind a stale order);
 * - `focusedEventId` null/empty, `releaseFreeze`, a hold or a release → no freeze.
 *
 * Ranking is otherwise time-invariant (deadline differences do not change as the clock
 * advances), so only a status change, a new event or an action can move a row.
 *
 * @param {object} state
 * @param {string|null|undefined} focusedEventId null/empty releases the freeze.
 * @param {number|Date} [now=Date.now()]
 * @returns {object} new state with `focusedEventId` and `frozenOrder`.
 */
export function freezeWhileReading(state, focusedEventId, now = Date.now()) {
  const base = normalizeState(state);
  if (focusedEventId == null || focusedEventId === '') {
    return { ...base, focusedEventId: null, frozenOrder: null };
  }

  const id = String(focusedEventId);
  if (base.focusedEventId === id && base.frozenOrder) {
    // Re-focusing the same row keeps the snapshot; it must not refresh under the reader.
    return base;
  }

  return {
    ...base,
    focusedEventId: id,
    frozenOrder: rankIncidents(base.events, now).map((row) => row.eventId),
  };
}

/** Release the reading freeze and re-rank. */
export function releaseFreeze(state) {
  return freezeWhileReading(state, null);
}

function sameIdSet(rows, ids) {
  if (!Array.isArray(ids) || rows.length !== ids.length) return false;
  const seen = new Set(ids);
  if (seen.size !== ids.length) return false;
  return rows.every((row) => seen.has(row.eventId));
}

/**
 * The rows the queue renders: ranked, with the active hold attached and the reason line
 * recomputed for the order actually shown.
 *
 * @param {object} state
 * @param {number|Date} [now=Date.now()]
 * @returns {Array<object>} ranked rows plus `hold` (`null` when not held).
 */
export function queueRows(state, now = Date.now()) {
  const base = normalizeState(state);
  const at = clock(now);
  const fresh = rankIncidents(base.events, at);

  let rows = fresh;
  if (base.frozenOrder && sameIdSet(fresh, base.frozenOrder)) {
    const byId = new Map(fresh.map((row) => [row.eventId, row]));
    rows = base.frozenOrder.map((eventId) => byId.get(eventId));
  }

  const holds = activeHolds(base, at);
  const ordered = withReasons(rows.map((row) => toRow(row.event, at)));
  return ordered.map((row) => ({ ...row, hold: holds[row.eventId] ?? null }));
}

/** Keyboard map for the queue, in the operators' words. */
export const QUEUE_KEYS = Object.freeze({
  ack: Object.freeze(['a', 'A']),
  falsePositive: Object.freeze(['f', 'F']),
  open: Object.freeze(['Enter']),
  hold: Object.freeze(['h', 'H']),
  releaseHold: Object.freeze(['Escape']),
});

/**
 * Map a key press to one queue action. It returns a decision instead of performing it, so
 * the caller keeps the existing store path (and its double-press guard) for the actual ack.
 *
 * @param {string} key `KeyboardEvent.key`
 * @param {{event?: object|null, held?: boolean, typing?: boolean}} [options]
 *   `typing` is true when focus is in a text input or the note dialog: shortcuts stand down.
 * @returns {{type: 'ack'|'false-positive'|'open'|'hold'|'release-hold'|'none',
 *   eventId: string|null, allowed: boolean, hint: string|null}}
 */
export function nextAction(key, { event = null, held = false, typing = false } = {}) {
  const none = (hint = null) => ({ type: 'none', eventId: null, allowed: false, hint });
  if (typing) return none('Tastarea are prioritate.');
  if (typeof key !== 'string' || key === '') return none();

  const eventId = event && event.event_id != null ? String(event.event_id) : null;
  const action = (type, allowed, hint = null) => ({ type, eventId, allowed, hint });
  const has = (list) => list.includes(key);

  if (has(QUEUE_KEYS.ack)) {
    return action('ack', Boolean(event) && canDo('ack', event.status));
  }
  if (has(QUEUE_KEYS.falsePositive)) {
    return action('false-positive', Boolean(event) && canDo('false_positive', event.status));
  }
  if (has(QUEUE_KEYS.open)) {
    return action('open', Boolean(event));
  }
  if (has(QUEUE_KEYS.hold)) {
    if (held) return action('hold', false, 'Incidentul e deja ținut.');
    if (!event) return action('hold', false);
    if (event.severity === CRITICAL) {
      return action('hold', false, 'Criticele nu pot fi amânate.');
    }
    if (!canHold(event)) return action('hold', false, 'Doar avertismentele pot fi ținute.');
    return action('hold', true);
  }
  if (has(QUEUE_KEYS.releaseHold)) {
    return action('release-hold', Boolean(held));
  }

  return none();
}
