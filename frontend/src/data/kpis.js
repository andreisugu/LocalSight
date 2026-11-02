// KPI strip, counted from the incidents the screen already shows.
//
// Everything except PPE compliance is a count over the event list: open plus escalated is
// what the operator calls "open incidents", and the alert latency is the gap between
// detection and the first real Slack delivery. PPE compliance is measured on every person
// detection in the shift, not on incidents, so it stays a supplied number and is never
// inferred from this list.

import { SECOND_MS } from './clock.js';
import { INITIAL_EVENTS } from './incidents.js';

/** 8 missed checks out of ~129 person detections in the demo shift. */
export const PPE_COMPLIANCE_PCT = 93.8;

const EMPTY_VALUE = '—';

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Detection → notification, in seconds, one decimal as the panel displays it. */
function averageAlertLatency(events) {
  const latencies = [];
  for (const event of events) {
    const detectedMs = Date.parse(event.detected_at);
    const notifiedMs = Date.parse(event.notified_at);
    if (Number.isFinite(detectedMs) && Number.isFinite(notifiedMs)) {
      latencies.push((notifiedMs - detectedMs) / SECOND_MS);
    }
  }
  return latencies.length ? Math.round(mean(latencies) * 10) / 10 : EMPTY_VALUE;
}

/**
 * @param {Array<object>} events Incidents of the shift (`EventOut` shape).
 * @param {number} [ppeCompliancePct] Supplied compliance rate, 0–100.
 * @returns {{ppe_compliance_pct: number, open_incidents_count: number,
 *   detection_to_alert_latency_s: number|string, escalated_incidents_count: number}}
 */
export function deriveKpis(events, ppeCompliancePct = PPE_COMPLIANCE_PCT) {
  const list = (Array.isArray(events) ? events : []).filter(Boolean);
  const isOpen = (event) => event.status === 'open' || event.status === 'escalated';

  return {
    ppe_compliance_pct: ppeCompliancePct,
    open_incidents_count: list.filter(isOpen).length,
    detection_to_alert_latency_s: averageAlertLatency(list),
    escalated_incidents_count: list.filter((event) => event.status === 'escalated').length,
  };
}

export const INITIAL_KPIS = deriveKpis(INITIAL_EVENTS, PPE_COMPLIANCE_PCT);
