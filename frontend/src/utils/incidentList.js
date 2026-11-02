// Pure list logic for the Incidents screen: filtering, counting and the summary line.
// Extracted from the inherited component so the behaviour is testable without a browser
// and the component itself is only presentation.
//
// The detection time is formatted by `utils/time.js`, like every other timestamp in the UI.

export const STATUS_FILTERS = [
  { id: 'all', label: 'Toate', match: () => true },
  { id: 'active', label: 'Active', match: (status) => status === 'open' || status === 'escalated' },
  { id: 'closed', label: 'Rezolvate', match: (status) => status === 'acknowledged' || status === 'resolved' },
  { id: 'false_positive', label: 'Fals pozitiv', match: (status) => status === 'false_positive' },
];

export function countByStatus(events) {
  const counts = {};
  for (const filter of STATUS_FILTERS) {
    counts[filter.id] = events.filter((event) => filter.match(event.status)).length;
  }
  return counts;
}

function searchableText(event, typeLabels) {
  return [
    event.event_id,
    event.type,
    typeLabels?.[event.type],
    event.camera_id,
    event.zone_id,
    event.report?.what,
    event.report?.where,
    event.acked_by,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * @param {Array<object>} events
 * @param {{status?: string, query?: string, typeLabels?: Record<string,string>}} [options]
 * @returns {Array<object>} newest first
 */
export function filterIncidents(events, { status = 'all', query = '', typeLabels } = {}) {
  const filter = STATUS_FILTERS.find((item) => item.id === status) || STATUS_FILTERS[0];
  const needle = query.trim().toLowerCase();

  return events
    .filter((event) => filter.match(event.status))
    .filter((event) => !needle || searchableText(event, typeLabels).includes(needle))
    .slice()
    .sort((a, b) => String(b.detected_at || '').localeCompare(String(a.detected_at || '')));
}

export function summaryLine(event, cameraName) {
  const who = cameraName(event.camera_id) || event.camera_id;
  const zone = event.zone_id ? ` · ${event.zone_id}` : '';
  const ack = event.acked_by ? ` · confirmat de ${event.acked_by}` : '';
  return `${who}${zone}${ack}`;
}
