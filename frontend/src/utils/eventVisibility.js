// Which incidents a screen may show.
//
// Four kinds of row end up in the same list, and the operator is entitled to know which is
// which:
//
//   local      an incident the in-browser engine produced — the product, not a demo
//   simulated  an incident the explicit Simulare menu created — a demo action, but one the
//              operator asked for in this session, so it stays visible
//   demo       one of the eight SafeSight fixtures — demo data, not a camera
//   backend    a row the real backend loaded (non-mock builds)
//
// Only fixtures are hidden by default. `showDemoData` is the single switch every surface
// reads, so the Live feed, the incident list, the reports and the KPI counts can never
// disagree about what exists.

import { INITIAL_EVENTS } from '../constants/mockData.js';

export const EVENT_SOURCE = Object.freeze({
  local: 'local',
  simulated: 'simulated',
  demo: 'demo',
  backend: 'backend',
});

/** The fixture ids are stable across reloads, so a Set is enough to recognise them. */
const FIXTURE_IDS = new Set(
  (Array.isArray(INITIAL_EVENTS) ? INITIAL_EVENTS : []).map((event) => event.event_id)
);

/**
 * @param {object|null|undefined} event
 * @param {{fixtureIds?: Set<string>}} [options]
 * @returns {'local'|'simulated'|'demo'|'backend'}
 */
export function eventSource(event, { fixtureIds = FIXTURE_IDS } = {}) {
  if (event?.simulated === true) return EVENT_SOURCE.simulated;
  if (event?.local === true) return EVENT_SOURCE.local;
  if (fixtureIds.has(event?.event_id)) return EVENT_SOURCE.demo;
  return EVENT_SOURCE.backend;
}

/**
 * @param {object|null|undefined} event
 * @param {{fixtureIds?: Set<string>}} [options]
 * @returns {boolean}
 */
export function isDemoEvent(event, options = {}) {
  return eventSource(event, options) === EVENT_SOURCE.demo;
}

/**
 * Whether this row belongs on the screens right now.
 * @param {object|null|undefined} event
 * @param {{showDemoData?: boolean, fixtureIds?: Set<string>}} [options]
 * @returns {boolean}
 */
export function isVisibleEvent(event, { showDemoData = false, ...options } = {}) {
  return showDemoData || !isDemoEvent(event, options);
}

/**
 * @param {Array<object>} events
 * @param {{showDemoData?: boolean, fixtureIds?: Set<string>}} [options]
 * @returns {Array<object>} the same rows when demo data is on, fixtures out when it is off
 */
export function visibleEvents(events, options = {}) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => isVisibleEvent(event, options));
}

/** The tag a row shows; `null` for a real backend row, which needs no label. */
export function sourceLabel(source) {
  if (source === EVENT_SOURCE.local) return 'local';
  if (source === EVENT_SOURCE.simulated) return 'simulat';
  if (source === EVENT_SOURCE.demo) return 'date demo';
  return null;
}
