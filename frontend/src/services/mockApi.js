// Mock implementation of the API for the static build.
//
// It answers with the demo fixtures and the same method names, argument lists and return
// shapes as the real client, so `USE_MOCK` is the only switch between them. There is no
// simulated latency and no random failure: the demo is deterministic, and the browser
// state (optimistic updates, the escalation tick) already behaves like a backend would.
// Actions return the incident after the transition instead of a bare status, which lets
// the UI merge the confirmation and escalation fields in one step.

import { INITIAL_CAMERAS } from '../data/cameras.js';
import { INITIAL_EVENTS } from '../data/incidents.js';
import { INITIAL_KPIS } from '../data/kpis.js';
import { resolveOperatorName } from '../data/operators.js';
import { INITIAL_SHIFT_REPORT } from '../data/report.js';
import {
  filterEvents,
  selectCameraZones,
  selectEvent,
} from '../data/selectors.js';
import { INITIAL_ZONES } from '../data/zones.js';
import {
  FALLBACK_REPORT,
  acknowledge,
  cloneEvent,
  markFalsePositive,
  regenerateReport,
  reopen,
} from './mockEvents.js';

/** Apply a transition to a known fixture; `null` when the id is not one of ours. */
function transitionEvent(eventId, transition) {
  const known = selectEvent(INITIAL_EVENTS, eventId);
  return known ? transition(cloneEvent(known)) : null;
}

export const mockApi = {
  async getHealth() {
    return { status: 'ok', db: true, edge_last_seen_s: 0, mock: true };
  },

  async getCameras() {
    return INITIAL_CAMERAS;
  },

  async setEngineState(cameraId, on) {
    return { id: cameraId, camera_id: cameraId, engine_on: Boolean(on), status: 'online' };
  },

  async getZones(cameraId) {
    return selectCameraZones(INITIAL_ZONES, cameraId);
  },

  async saveZone(zoneId, zoneData) {
    return { ...zoneData, zone_id: zoneId, saved: true };
  },

  async captureReferenceFrame(zoneId) {
    return { zone_id: zoneId, captured_at: new Date().toISOString() };
  },

  async captureReferenceFromLive(zoneId) {
    return { zone_id: zoneId, reference_frame: null };
  },

  async deleteZone() {
    return true;
  },

  async deleteReferenceFrame(zoneId) {
    return { zone_id: zoneId, reference_frame: null };
  },

  async getEvents(filters = {}) {
    return filterEvents(INITIAL_EVENTS, filters);
  },

  async getEventById(eventId) {
    return selectEvent(INITIAL_EVENTS, eventId);
  },

  async acknowledgeEvent(eventId, operator = 'Operator') {
    const actor = resolveOperatorName(operator);
    return (
      transitionEvent(eventId, (event) => acknowledge(event, actor)) || {
        event_id: eventId,
        status: 'acknowledged',
        acked_by: actor,
      }
    );
  },

  async markFalsePositive(eventId, _operator = 'Operator', note = '') {
    const updated = transitionEvent(eventId, (event) => markFalsePositive(event));
    return updated
      ? { ...updated, note }
      : { event_id: eventId, status: 'false_positive', note };
  },

  async reopenEvent(eventId) {
    return (
      transitionEvent(eventId, (event) => reopen(event)) || {
        event_id: eventId,
        status: 'open',
      }
    );
  },

  async regenerateReport(eventId) {
    const updated = transitionEvent(eventId, (event) => regenerateReport(event));
    return {
      event_id: eventId,
      report: updated?.report || { ...FALLBACK_REPORT, when: new Date().toISOString(), source: 'llm' },
    };
  },

  async getKPIs() {
    return { ...INITIAL_KPIS };
  },

  async getShiftReport() {
    return { ...INITIAL_SHIFT_REPORT };
  },

  connectEventsSocket() {
    // No periodic KPI tick in mock: open/escalated counts are recomputed from `events` in
    // SecurityContext, otherwise a confirmation would be undone after four seconds.
    return () => {};
  },
};
