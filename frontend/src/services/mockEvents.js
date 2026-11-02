// Operator actions on a mock incident, as pure transitions.
//
// The demo has no backend to hold the state, so each action returns the incident as it
// would look after the call: status, confirmation and escalation fields change, the rest
// of the envelope is copied. Keeping them pure makes the allowed transitions testable in
// Node and keeps the mock API from mutating the fixtures the context also renders.

export const FALLBACK_REPORT = Object.freeze({
  what: 'Persoană în zona motorului.',
  where: 'Stand 12, zona motorului stâng.',
  severity_reason: 'Motorul este pornit.',
  recommended_action: 'Îndepărtează persoana și confirmă zona.',
});

/** Copy deep enough that a transition never writes into the fixture it started from. */
export function cloneEvent(event) {
  if (!event) return null;
  return {
    ...event,
    confidence: event.confidence
      ? { ...event.confidence, temporal: { ...event.confidence.temporal } }
      : event.confidence,
    context: event.context ? { ...event.context } : event.context,
    report: event.report ? { ...event.report } : event.report,
  };
}

/** Confirmation: record who confirmed and when; the escalation timer stops. */
export function acknowledge(event, operator, now = new Date()) {
  return {
    ...cloneEvent(event),
    status: 'acknowledged',
    acked_at: now.toISOString(),
    acked_by: operator,
  };
}

/** False positive: leaves the open list and stays in history as a rejected detection. */
export function markFalsePositive(event) {
  return {
    ...cloneEvent(event),
    status: 'false_positive',
  };
}

/** Reopen: back to open with a fresh escalation timer, so the ack fields are cleared. */
export function reopen(event) {
  return {
    ...cloneEvent(event),
    status: 'open',
    escalated_at: null,
    acked_at: null,
    acked_by: null,
  };
}

/** Regenerate: the mock has one report, so it keeps it and stamps it as LLM output. */
export function regenerateReport(event, now = new Date()) {
  const report = event?.report || {};
  return {
    ...cloneEvent(event),
    report: {
      what: report.what || FALLBACK_REPORT.what,
      where: report.where || FALLBACK_REPORT.where,
      when: report.when || now.toISOString(),
      severity_reason: report.severity_reason || FALLBACK_REPORT.severity_reason,
      recommended_action: report.recommended_action || FALLBACK_REPORT.recommended_action,
      source: 'llm',
    },
  };
}
