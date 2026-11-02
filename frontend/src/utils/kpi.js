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

/**
 * The two tiles that only a demo shift can fill: compliance is measured over every person
 * detection, and the latency is the gap the edge measured before Slack notified. Neither
 * can be derived from the incidents this tab holds, so with the fixtures hidden they say
 * "no data" instead of repeating a demo number.
 *
 * @param {object} kpis
 * @returns {object} a new object
 */
export function withoutDemoOnlyValues(kpis) {
  return {
    ...kpis,
    ppe_compliance_pct: EMPTY_KPIS.ppe_compliance_pct,
    detection_to_alert_latency_s: EMPTY_KPIS.detection_to_alert_latency_s,
  };
}

/**
 * Recompute the tiles the incident list can move, and decide what the two demo-only tiles
 * may say.
 *
 * @param {object} kpis currently shown tiles
 * @param {Array<object>} events the events the operator can actually see
 * @param {{showDemoData?: boolean, demoKpis?: object|null}} [options]
 *   `demoKpis` carries the supplied demo values (PPE, latency) that come back when the
 *   fixtures are switched on; without it those tiles keep whatever the last load produced.
 * @returns {object} a new object; the inputs are not mutated
 */
export function applyKpiVisibility(kpis, events, { showDemoData = false, demoKpis = null } = {}) {
  const next = applyActiveCounts(kpis, events);
  if (!showDemoData) return withoutDemoOnlyValues(next);
  if (!demoKpis) return next;
  return {
    ...next,
    ppe_compliance_pct: demoKpis.ppe_compliance_pct ?? next.ppe_compliance_pct,
    detection_to_alert_latency_s:
      demoKpis.detection_to_alert_latency_s ?? next.detection_to_alert_latency_s,
  };
}
