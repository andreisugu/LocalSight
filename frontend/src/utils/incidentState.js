// Incident store transitions.
//
// The provider applies every operator action optimistically and then replaces the row with
// whatever the API returned; a failure rolls the row back, except for a 409, where the
// server's version is the truth. These functions are pure so each transition and the
// rollback can be checked in Node without a browser or a fake React tree.

/** The list keeps at most this many incidents, like the WebSocket feed. */
export const EVENT_LIMIT = 200;

/**
 * @param {Array<object>} events
 * @param {string} eventId
 * @returns {object|undefined}
 */
export function findEvent(events, eventId) {
  return events.find((event) => event.event_id === eventId);
}

/**
 * @param {Array<object>} events
 * @param {string} eventId
 * @returns {boolean}
 */
export function hasEvent(events, eventId) {
  return events.some((event) => event.event_id === eventId);
}

/**
 * @param {Array<object>} events
 * @param {string} eventId
 * @param {object} patch
 * @returns {Array<object>}
 */
export function patchEvent(events, eventId, patch) {
  return events.map((event) => (event.event_id === eventId ? { ...event, ...patch } : event));
}

/**
 * Replace a row with the API's version of the same incident.
 *
 * @param {Array<object>} events
 * @param {string} eventId
 * @param {object|null|undefined} updated fields to merge
 * @returns {Array<object>}
 */
export function mergeEvent(events, eventId, updated) {
  if (!updated) return events;
  return events.map((event) => (event.event_id === eventId ? { ...event, ...updated } : event));
}

/**
 * Undo an optimistic change. `previous` is the row as it was before the action; a missing
 * row (the incident was never loaded) leaves the list untouched.
 *
 * @param {Array<object>} events
 * @param {object|null|undefined} previous
 * @returns {Array<object>}
 */
export function revertEvent(events, previous) {
  if (!previous) return events;
  return events.map((event) => (event.event_id === previous.event_id ? previous : event));
}

/**
 * Add or replace an incident from the edge (WebSocket, polling, engine). A known id is
 * replaced in place so the list does not reorder under the operator's cursor.
 *
 * @param {Array<object>} events
 * @param {object} incoming
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export function upsertEvent(events, incoming, limit = EVENT_LIMIT) {
  if (!incoming || typeof incoming !== 'object') return events;
  const index = events.findIndex((event) => event.event_id === incoming.event_id);
  if (index >= 0) {
    const next = events.slice();
    next[index] = incoming;
    return next;
  }
  return [incoming, ...events].slice(0, limit);
}

/**
 * Optimistic acknowledge: the card leaves "open" immediately and the escalation stops.
 *
 * @param {Array<object>} events
 * @param {string} eventId
 * @param {string} operator
 * @param {Date} [at]
 * @returns {Array<object>}
 */
export function acknowledgeLocally(events, eventId, operator, at = new Date()) {
  return patchEvent(events, eventId, {
    status: 'acknowledged',
    acked_at: at.toISOString(),
    acked_by: operator,
  });
}

/**
 * Optimistic false positive: it leaves "open" and stays visible under "all".
 *
 * @param {Array<object>} events
 * @param {string} eventId
 * @param {string} operator
 * @param {string} [note]
 * @returns {Array<object>}
 */
export function markFalsePositiveLocally(events, eventId, operator, note = '') {
  return patchEvent(events, eventId, {
    status: 'false_positive',
    false_positive_note: note,
    false_positive_by: operator,
  });
}

/**
 * Optimistic reopen: back to "open" with a fresh escalation timer, so every ack/escalation
 * stamp is cleared.
 *
 * @param {Array<object>} events
 * @param {string} eventId
 * @returns {Array<object>}
 */
export function reopenLocally(events, eventId) {
  return patchEvent(events, eventId, {
    status: 'open',
    escalated_at: null,
    acked_at: null,
    acked_by: null,
  });
}

/**
 * One escalation tick (mock mode only; the real backend owns the timer). An incident is
 * escalated when it is still open and its detection is older than `escalate_after_s`.
 * Returns the same array when nothing changed, so a quiet second does not re-render.
 *
 * @param {Array<object>} events
 * @param {number} [now] epoch milliseconds
 * @returns {Array<object>}
 */
export function applyEscalations(events, now = Date.now()) {
  let changed = false;
  const next = events.map((event) => {
    if (event.status !== 'open' || !event.escalate_after_s) return event;
    const detected = Date.parse(event.detected_at);
    if (!Number.isFinite(detected)) return event;
    if (now - detected < Number(event.escalate_after_s) * 1000) return event;
    changed = true;
    return { ...event, status: 'escalated', escalated_at: new Date(now).toISOString() };
  });
  return changed ? next : events;
}

/**
 * A 409 means the incident changed elsewhere (another operator, Slack, the timer); the
 * API's version must replace the optimistic one instead of being rolled back.
 *
 * @param {{message?: unknown}|null|undefined} error
 * @returns {boolean}
 */
export function isConflictError(error) {
  return String(error?.message ?? '').startsWith('409');
}
