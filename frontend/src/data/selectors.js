// Lookups and filters over the collections the API returns.
//
// They are plain functions with the collection as the first argument, so the same code
// serves the fixtures (mock API) and the real backend responses, and can be tested
// without a store, a hook or a component.

const listOrEmpty = (value) => (Array.isArray(value) ? value : []);

/** Camera by its seeded id; `null` instead of `undefined` so a render can branch once. */
export function selectCamera(cameras, cameraId) {
  return listOrEmpty(cameras).find((camera) => camera?.id === cameraId) || null;
}

/** Zone by `zone_id` (the editor's key, not the API's numeric id). */
export function selectZone(zones, zoneId) {
  return listOrEmpty(zones).find((zone) => zone?.zone_id === zoneId) || null;
}

/** Display name of a zone, falling back to the id the event already carries. */
export function selectZoneName(zones, zoneId) {
  return selectZone(zones, zoneId)?.name || zoneId;
}

/** Zones of one camera, or every zone when no camera is selected. */
export function selectCameraZones(zones, cameraId) {
  const all = listOrEmpty(zones);
  return cameraId ? all.filter((zone) => zone?.camera_id === cameraId) : all;
}

/** Incident by `event_id`; `null` when the list does not contain it (yet). */
export function selectEvent(events, eventId) {
  return listOrEmpty(events).find((event) => event?.event_id === eventId) || null;
}

/** Does an incident pass the list filters? `''` and `all` mean "no filter". */
export function matchesEventFilters(event, { status = '', severity = '', camera_id = '' } = {}) {
  if (!event) return false;
  if (status && status !== 'all' && event.status !== status) return false;
  if (severity && severity !== 'all' && event.severity !== severity) return false;
  if (camera_id && camera_id !== 'all' && event.camera_id !== camera_id) return false;
  return true;
}

/** Incident list filtered by status, severity and camera. */
export function filterEvents(events, filters = {}) {
  return listOrEmpty(events).filter((event) => matchesEventFilters(event, filters));
}
