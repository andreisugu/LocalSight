// Presentation values for the shift report screen.
//
// The report itself (counts, distributions, summary) is composed by
// `constants/shiftReport.js`; this module only turns those numbers into the shares and the
// CSV export the page renders. Dates and durations are formatted by `utils/time.js`, the
// one home for display times, so the picker, the header and the export cannot disagree.
// Keeping the arithmetic here means the view has none and every rule below has a node test.
//
// The CSV is the report plus the incident list it was counted from, so a reader can check
// each total against the rows.

/** The label the UI and the export give the report writer. Never "AI". */
export const REPORT_SOURCE = 'șablon';

/**
 * The tallest hour bar, floored at 1 so an empty report divides by a real number.
 * @param {Array<{events: number}>} byHour
 * @returns {number}
 */
export function maxHourEvents(byHour) {
  const counts = (Array.isArray(byHour) ? byHour : []).map((row) => Number(row?.events) || 0);
  return Math.max(1, ...counts);
}

/**
 * A count as a share of the total, in percent, capped to the bar width.
 * @param {number} count
 * @param {number} total
 * @returns {number}
 */
export function sharePercent(count, total) {
  const whole = Number(total);
  const part = Number(count);
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  if (!Number.isFinite(part) || part <= 0) return 0;
  return Math.min(100, (part / whole) * 100);
}

/**
 * Download name without extension, stable across platforms.
 * @param {{date?: string, shift?: string}} report
 * @returns {string}
 */
export function reportFileBase(report) {
  const date = report?.date ?? '';
  const shift = report?.shift ?? '';
  return `LocalSight_raport_${date}_${shift}`.replace(/[^\w.-]+/g, '_');
}

/**
 * The incidents the CSV lists: objects only, newest detection first.
 * @param {Array<object>} events
 * @returns {Array<object>}
 */
export function incidentsForExport(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event !== null && typeof event === 'object')
    .slice()
    .sort((a, b) => String(b.detected_at ?? '').localeCompare(String(a.detected_at ?? '')));
}

const row = (...cells) => cells;
const quote = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;

/**
 * The CSV as an array of rows: report header, KPIs, the three distributions, then the
 * incidents the KPIs were counted from. Blank rows separate the sections.
 * @param {object} report Result of `buildShiftReport`.
 * @param {Array<object>} events The list the report was built from.
 * @returns {Array<Array<string|number>>}
 */
export function reportCsvRows(report, events) {
  const kpi = report?.kpi ?? {};
  const byType = Array.isArray(report?.by_type) ? report.by_type : [];
  const byZone = Array.isArray(report?.by_zone) ? report.by_zone : [];
  const byHour = Array.isArray(report?.by_hour) ? report.by_hour : [];

  return [
    row('Tură', report?.shift ?? ''),
    row('Dată', report?.date ?? ''),
    row('Sursă', REPORT_SOURCE),
    row('Total evenimente', kpi.total_events ?? 0),
    row('Critice', kpi.critical_events ?? 0),
    row('Avertizări', kpi.warning_events ?? 0),
    row('Deschise', kpi.open_events ?? 0),
    row('Escalate', kpi.escalated_events ?? 0),
    row('Confirmate', kpi.acknowledged_events ?? 0),
    row('Cu confirmare', kpi.acked_events ?? 0),
    row('Rezolvate', kpi.resolved_events ?? 0),
    row('Fals pozitive', kpi.false_positive_events ?? 0),
    row('Timp mediu confirmare (s)', kpi.avg_ack_time_s ?? '—'),
    row('Incidente fără PPE (NO_PPE)', kpi.no_ppe_events ?? 0),
    row(),
    row('Tip', 'Critice', 'Avertizări', 'Total'),
    ...byType.map((type) => row(type.label, type.critical, type.warning, type.count)),
    row(),
    row('Zonă', 'Critice', 'Avertizări', 'Timp mediu confirmare (s)'),
    ...byZone.map((zone) => row(zone.zone, zone.critical, zone.warning, zone.avg_ack_s ?? '—')),
    row(),
    row('Oră', 'Incidente'),
    ...byHour.map((hour) => row(hour.hour, hour.events)),
    row(),
    row('ID', 'Tip', 'Severitate', 'Status', 'Zonă', 'Cameră', 'Detectat la', 'Confirmat la', 'Sursă raport'),
    ...incidentsForExport(events).map((event) =>
      row(
        event.event_id,
        event.type,
        event.severity,
        event.status,
        event.zone_id,
        event.camera_id,
        event.detected_at,
        event.acked_at ?? '—',
        event.report?.source || '—'
      )
    ),
  ];
}

/**
 * The CSV text (without a BOM; the caller adds it for Excel). Every cell is quoted, so
 * commas and quotes in a zone name or a summary never shift a column.
 * @param {object} report
 * @param {Array<object>} events
 * @returns {string}
 */
export function buildReportCsv(report, events) {
  return reportCsvRows(report, events)
    .map((cells) => cells.map(quote).join(','))
    .join('\n');
}
