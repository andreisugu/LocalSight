// The API surface the screens use.
//
// `USE_MOCK` is decided at build time. In mock mode every method answers from the demo
// fixtures (`mockApi.js`); otherwise the same call goes to the backend through
// `backendApi.js`. Both expose identical names, arguments and return shapes, and the
// shift helpers are transport-independent, so a component never branches on the mode.

import { USE_MOCK } from './config.js';
import { backendApi } from './backendApi.js';
import { mockApi } from './mockApi.js';
import { currentShiftId, shiftDate, shiftToApi } from './shift.js';

export { TYPE_LABELS } from '../data/labels.js';
export { USE_MOCK };

const transport = USE_MOCK ? mockApi : backendApi;

export const localSightApi = {
  getHealth: () => transport.getHealth(),
  getCameras: () => transport.getCameras(),

  /** `PUT /cameras/{id}/engine`; `on` is the desired state, not a toggle request. */
  setEngineState: (cameraId, on) => transport.setEngineState(cameraId, on),

  /** Same call under the name the MOTOR button uses in the UI. */
  toggleEngine: (cameraId, on) => transport.setEngineState(cameraId, Boolean(on)),

  getZones: (cameraId) => transport.getZones(cameraId),
  saveZone: (zoneId, zoneData) => transport.saveZone(zoneId, zoneData),
  deleteZone: (zoneId) => transport.deleteZone(zoneId),
  captureReferenceFrame: (zoneId, file) => transport.captureReferenceFrame(zoneId, file),
  captureReferenceFromLive: (zoneId) => transport.captureReferenceFromLive(zoneId),
  deleteReferenceFrame: (zoneId) => transport.deleteReferenceFrame(zoneId),

  getEvents: (filters) => transport.getEvents(filters),
  getEventById: (eventId) => transport.getEventById(eventId),
  acknowledgeEvent: (eventId, operator) => transport.acknowledgeEvent(eventId, operator),
  markFalsePositive: (eventId, operator, note) =>
    transport.markFalsePositive(eventId, operator, note),
  reopenEvent: (eventId, operator) => transport.reopenEvent(eventId, operator),
  regenerateReport: (eventId) => transport.regenerateReport(eventId),

  getKPIs: (date, shift) => transport.getKPIs(date, shift),
  getShiftReport: (shift, date, options) => transport.getShiftReport(shift, date, options),
  connectEventsSocket: (onMessage, onError, onOpen) =>
    transport.connectEventsSocket(onMessage, onError, onOpen),

  shiftToApi,
  currentShiftId,
  shiftDate,
};
