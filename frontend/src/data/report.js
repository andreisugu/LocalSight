// Shift report of the demo shift, composed from the incidents themselves.
//
// The report follows the shape the backend returns (`docs/contract.md`): KPIs, per-type,
// per-zone and per-hour rows, coverage and an explicit false-positive count. It is derived
// rather than written down, so the numbers on screen always agree with the list; the only
// supplied value is PPE compliance, which cannot be counted from incidents.

import { pad2, roDecimal, SECOND_MS, zonedParts } from './clock.js';
import { INITIAL_EVENTS } from './incidents.js';
import { PPE_COMPLIANCE_PCT } from './kpis.js';
import { TYPE_LABELS } from './labels.js';
import { selectZoneName } from './selectors.js';
import {
  FIXTURE_WINDOW,
  OPERATIONAL_DATE,
  OPERATIONAL_SHIFT_ID,
  SHIFT_LABELS,
  shortShiftLabel,
} from './shift.js';
import { INITIAL_ZONES } from './zones.js';

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Seconds between detection and confirmation; `null` when the incident has no ack. */
function ackSecondsOf(event) {
  if (!event?.acked_at) return null;
  const detectedMs = Date.parse(event.detected_at);
  const ackedMs = Date.parse(event.acked_at);
  if (!Number.isFinite(detectedMs) || !Number.isFinite(ackedMs)) return null;
  return (ackedMs - detectedMs) / SECOND_MS;
}

const countSeverity = (rows, severity) => rows.filter((row) => row.severity === severity).length;

const countFalsePositives = (rows) => rows.filter((row) => row.status === 'false_positive').length;

// Contract rule: a false positive is not an incident. It stays in the history, appears in
// the `false_positive` column of its type and zone, and is counted separately; severities,
// totals and the acknowledgement average ignore it.
const incidentsOnly = (rows) => rows.filter((row) => row.status !== 'false_positive');

function byType(events) {
  // Insertion order of the list, so the table follows the incidents, not the alphabet.
  return [...new Set(events.map((event) => event.type))].map((type) => {
    const rows = incidentsOnly(events).filter((event) => event.type === type);
    return {
      type,
      label: TYPE_LABELS[type] || type,
      count: rows.length,
      critical: countSeverity(rows, 'CRITICAL'),
      warning: countSeverity(rows, 'WARNING'),
      false_positive: countFalsePositives(events.filter((event) => event.type === type)),
    };
  });
}

function byZone(events, zones, fallbackAckSeconds) {
  const incidents = incidentsOnly(events);
  const rows = [...new Set(events.map((event) => event.zone_id))].map((zoneId) => {
    const zoneRows = incidents.filter((event) => event.zone_id === zoneId);
    const acks = zoneRows.map(ackSecondsOf).filter((value) => value != null);
    return {
      zone: selectZoneName(zones, zoneId),
      critical: countSeverity(zoneRows, 'CRITICAL'),
      warning: countSeverity(zoneRows, 'WARNING'),
      false_positive: countFalsePositives(events.filter((event) => event.zone_id === zoneId)),
      // Without a single confirmation in the zone, the shift average is the honest
      // reference for the demo instead of a made-up zero.
      avg_ack_s: acks.length ? Math.round(mean(acks)) : fallbackAckSeconds,
    };
  });

  // Busiest zone first; the sort is stable, so ties keep the order of the incident list.
  return rows.sort((a, b) => b.critical + b.warning - (a.critical + a.warning));
}

function byHour(events) {
  const buckets = new Map();
  for (const event of events) {
    const detectedAt = new Date(event.detected_at);
    if (Number.isNaN(detectedAt.getTime())) continue;
    const { hour } = zonedParts(detectedAt);
    const key = `${pad2(hour)}:00`;
    const bucket = buckets.get(key) || { hour: key, events: 0, firstMs: detectedAt.getTime() };
    bucket.events += 1;
    bucket.firstMs = Math.min(bucket.firstMs, detectedAt.getTime());
    buckets.set(key, bucket);
  }
  // Chronological by the first incident of each hour, so midnight does not reorder.
  return [...buckets.values()]
    .sort((a, b) => a.firstMs - b.firstMs)
    .map(({ hour, events: count }) => ({ hour, events: count }));
}

function summaryLine({ shiftId, total, critical, warning, open, escalated, avgAck, ppePct }) {
  return (
    `${shortShiftLabel(shiftId)}: ${total} evenimente, ` +
    `${critical} critice și ${warning} avertismente. ` +
    `${open} incidente sunt încă deschise, iar ${escalated} au escaladat după ` +
    `termenul de confirmare. Timpul mediu de confirmare a fost ${avgAck} s, ` +
    `conformitatea PPE ${roDecimal(ppePct)}%, iar cele mai frecvente abateri ` +
    `rămân traversarea Taxiway B și lipsa vestei hi-vis la trierea bagajelor.`
  );
}

/**
 * Compose the shift report from the incident list.
 *
 * @param {Array<object>} events Incidents of the shift.
 * @param {object} [options]
 * @param {string} [options.shiftId] `shift_1`…`shift_3`.
 * @param {string} [options.operationalDate] `YYYY-MM-DD`.
 * @param {number} [options.minutesIntoShift] Minutes covered by the shift so far.
 * @param {Array<object>} [options.zones] Zones used to label the per-zone table.
 * @param {number} [options.ppeCompliancePct] Supplied compliance rate.
 */
export function buildShiftReport(events, options = {}) {
  const {
    shiftId = OPERATIONAL_SHIFT_ID,
    operationalDate = OPERATIONAL_DATE,
    minutesIntoShift = FIXTURE_WINDOW.minutesIntoShift,
    zones = INITIAL_ZONES,
    ppeCompliancePct = PPE_COMPLIANCE_PCT,
  } = options;

  const list = (Array.isArray(events) ? events : []).filter(Boolean);
  const incidents = incidentsOnly(list);
  const critical = countSeverity(incidents, 'CRITICAL');
  const warning = countSeverity(incidents, 'WARNING');
  const open = incidents.filter((event) => event.status === 'open').length;
  const escalated = incidents.filter((event) => event.status === 'escalated').length;
  const falsePositives = countFalsePositives(list);

  const acks = incidents.map(ackSecondsOf).filter((value) => value != null);
  const avgAck = acks.length ? Math.round(mean(acks)) : 0;

  // Minutes in the shift where a camera was blind are not incidents; they are coverage.
  const coveredMinutes = Math.max(minutesIntoShift, 1);
  const offlineMinutes = Math.min(4, Math.floor(coveredMinutes / 60));

  return {
    shift: SHIFT_LABELS[shiftId] || shiftId,
    date: operationalDate,
    kpi: {
      total_events: incidents.length,
      critical_events: critical,
      warning_events: warning,
      avg_ack_time_s: avgAck,
      ppe_compliance_pct: ppeCompliancePct,
    },
    summary: summaryLine({
      shiftId,
      total: incidents.length,
      critical,
      warning,
      open,
      escalated,
      avgAck,
      ppePct: ppeCompliancePct,
    }),
    by_type: byType(list),
    by_zone: byZone(list, zones, avgAck),
    by_hour: byHour(incidents),
    coverage: {
      coverage: Math.round((1 - offlineMinutes / coveredMinutes) * 1000) / 1000,
      offline_minutes: offlineMinutes,
    },
    total_events: incidents.length,
    false_positives: falsePositives,
  };
}

export const INITIAL_SHIFT_REPORT = buildShiftReport(INITIAL_EVENTS);
