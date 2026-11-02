// KPI numbers derived from the incident list.
//
// In mock mode there is no `/kpi` endpoint: the two counts the operator can change (open
// and escalated) are recomputed from `events`, so an acknowledge immediately moves the
// number and stops being "escalated". The other two tiles (PPE compliance, detection to
// alert latency) cannot be derived from incidents and are never invented here — they stay
// as loaded. The real build takes every number from the API.

/** Shape shown while the real backend has not answered yet. */
export const EMPTY_KPIS = Object.freeze({
  ppe_compliance_pct: '—',
  open_incidents_count: 0,
  detection_to_alert_latency_s: '—',
  escalated_incidents_count: 0,
});

/**
 * @param {Array<object>} events
 * @returns {{open_incidents_count: number, escalated_incidents_count: number}}
 */
export function activeCounts(events) {
  let open = 0;
  let escalated = 0;
  for (const event of events) {
    if (event?.status === 'escalated') {
      open += 1;
      escalated += 1;
    } else if (event?.status === 'open') {
      open += 1;
    }
  }
  return { open_incidents_count: open, escalated_incidents_count: escalated };
}

/**
 * @param {object} kpis
 * @param {Array<object>} events
 * @returns {object} a new object; the input is not mutated
 */
export function applyActiveCounts(kpis, events) {
  return { ...kpis, ...activeCounts(events) };
}
