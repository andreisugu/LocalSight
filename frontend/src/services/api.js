// The API surface the screens use.
//
// `USE_MOCK` is decided at build time. In mock mode every method answers from the demo
// fixtures (`mockApi.js`); otherwise the same call goes to the backend through
// `backendApi.js`. Both expose identical names, arguments and return shapes, and the shift
// helpers are transport-independent, so a component never branches on the mode.
import { USE_MOCK } from './config.js';
import { backendApi } from './backendApi.js';
import { mockApi } from './mockApi.js';
import { currentShiftId, shiftDate, shiftToApi } from './shift.js';
// The type label table has one home (`data/labels.js`); this re-export keeps the API surface
// self-contained for screens that already import it. New code imports the table from
// `data/labels.js` directly.
export { TYPE_LABELS } from '../data/labels.js';
export { USE_MOCK };
const transport = USE_MOCK ? mockApi : backendApi;
// Health and cameras: the connection strip and the engine switch. Frozen: a screen may read
// these, never replace one of them.
const statusApi = Object.freeze({
  getHealth: () => transport.getHealth(),
  getCameras: () => transport.getCameras(),
  /** `PUT /cameras/{id}/engine`; `on` is the desired state, not a toggle request. */
  setEngineState: (cameraId, on) => transport.setEngineState(cameraId, on),
  /** Same call under the name the MOTOR button uses in the UI. */
  toggleEngine: (cameraId, on) => transport.setEngineState(cameraId, Boolean(on)),
});
// Zones and their reference frames.
const zoneApi = Object.freeze({
  getZones: (cameraId) => transport.getZones(cameraId),
  saveZone: (zoneId, zoneData) => transport.saveZone(zoneId, zoneData),
  deleteZone: (zoneId) => transport.deleteZone(zoneId),
  captureReferenceFrame: (zoneId, file) => transport.captureReferenceFrame(zoneId, file),
  captureReferenceFromLive: (zoneId) => transport.captureReferenceFromLive(zoneId),
  deleteReferenceFrame: (zoneId) => transport.deleteReferenceFrame(zoneId),
});
// Incidents: the list, one record, and the operator decisions on it.
const incidentApi = Object.freeze({
  getEvents: (filters) => transport.getEvents(filters),
  getEventById: (eventId) => transport.getEventById(eventId),
  acknowledgeEvent: (eventId, operator) => transport.acknowledgeEvent(eventId, operator),
  markFalsePositive: (eventId, operator, note) =>
    transport.markFalsePositive(eventId, operator, note),
  reopenEvent: (eventId, operator) => transport.reopenEvent(eventId, operator),
  regenerateReport: (eventId) => transport.regenerateReport(eventId),
});
// KPIs, the shift report and the live event socket.
const reportingApi = Object.freeze({
  getKPIs: (date, shift) => transport.getKPIs(date, shift),
  getShiftReport: (shift, date, options) => transport.getShiftReport(shift, date, options),
  connectEventsSocket: (onMessage, onError, onOpen) =>
    transport.connectEventsSocket(onMessage, onError, onOpen),
});
// Shift helpers are pure functions, so they keep working without any transport.
const shiftApi = Object.freeze({ shiftToApi, currentShiftId, shiftDate });
export const localSightApi = Object.freeze({
  ...statusApi,
  ...zoneApi,
  ...incidentApi,
  ...reportingApi,
  ...shiftApi,
});
