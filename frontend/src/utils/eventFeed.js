// The Live feed filter and search, extracted from the provider so it can be tested
// without React. The same `searchQuery` also drives the Incidents screen, but that screen
// has its own wider matcher (`utils/incidentList.js`); this one is the inherited Live
// rule and is kept exactly as it behaved.

/** Filter tabs on the Live feed. `all` is "everything today", not "everything ever". */
export const FEED_FILTERS = Object.freeze(['open', 'critical', 'all']);

const SEARCH_FIELDS = ['event_id', 'type', 'camera_id'];

/**
 * @param {object} event
 * @param {string} query already normalized (trimmed, lower case)
 * @returns {boolean}
 */
function matchesSearch(event, query) {
  if (!query) return true;
  const fields = SEARCH_FIELDS.map((key) => event?.[key]);
  fields.push(event?.report?.what, event?.report?.where);
  return fields.some((value) => (
    typeof value === 'string' && value.toLowerCase().includes(query)
  ));
}

/**
 * @param {object} event
 * @param {string} filterMode
 * @returns {boolean}
 */
export function matchesFeedFilter(event, filterMode) {
  if (filterMode === 'open') return event?.status === 'open' || event?.status === 'escalated';
  if (filterMode === 'critical') return event?.severity === 'CRITICAL';
  // 'all' and any unknown mode keep the event: a stale tab must not hide incidents.
  return true;
}

/**
 * @param {Array<object>} events
 * @param {{filterMode?: string, searchQuery?: string}} [options]
 * @returns {Array<object>}
 */
export function filterFeedEvents(events, { filterMode = 'open', searchQuery = '' } = {}) {
  const query = String(searchQuery ?? '').toLowerCase().trim();
  return events.filter(
    (event) => matchesFeedFilter(event, filterMode) && matchesSearch(event, query)
  );
}
