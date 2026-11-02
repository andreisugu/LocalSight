// Engine incidents entering the shared list.
//
// The in-tab engine writes detection fields only, exactly like the edge. Prepending them to
// the same `events` list is what makes them appear in Live, Incidents, the KPI counts and
// the shift report. The provider re-runs this on every render of the engine card, so the
// dedupe is by `event_id`; a re-render (or React StrictMode) must never add twice.
//
// One field the engine does not write is added on the way in: `escalate_after_s` lives on
// the zone, but the escalation tick reads it off the event.

import { EVENT_LIMIT } from './incidentState.js';

/** The model name the engine reports when it does not set one itself. */
export const DEFAULT_ENGINE_MODEL = 'efficientdet-lite0';

/**
 * @param {Array<object>} events current list
 * @param {Array<object>} incoming events the engine just produced
 * @param {{
 *   cameras?: Array<object>,
 *   zones?: Array<object>,
 *   buildReport?: (event: object, names: {cameraName?: string, zoneName?: string}) => object|null,
 *   limit?: number,
 * }} [options]
 * @returns {Array<object>} the same array when nothing new arrived
 */
export function mergeEngineEvents(events, incoming, {
  cameras = [],
  zones = [],
  buildReport,
  limit = EVENT_LIMIT,
} = {}) {
  if (!Array.isArray(incoming) || incoming.length === 0) return events;

  const known = new Set(events.map((event) => event.event_id));
  const fresh = incoming
    .filter((event) => event && typeof event.event_id === 'string' && !known.has(event.event_id))
    .map((event) => {
      const camera = cameras.find((item) => item.id === event.camera_id);
      const zone = zones.find(
        (item) => item.id === event.zone_id || item.zone_id === event.zone_id
      );
      // The engine has no LLM: the report is a template derived from the event and the
      // detail view labels it as such. An event that already carries one keeps it.
      const report = event.report || (buildReport
        ? buildReport(event, { cameraName: camera?.name, zoneName: zone?.name })
        : null);
      return {
        ...event,
        local: true,
        status: 'open',
        model: event.model || DEFAULT_ENGINE_MODEL,
        // The engine writes detection fields only, but the escalation tick reads the
        // threshold off the event (`applyEscalations` in `incidentState.js`). Taking it
        // from the zone is what makes an engine incident escalate like a fixture one;
        // `null` means "this zone has no timer", exactly like the fixtures.
        escalate_after_s: event.escalate_after_s ?? zone?.escalate_after_s ?? null,
        report,
      };
    });

  if (fresh.length === 0) return events;
  return [...fresh, ...events].slice(0, limit);
}
