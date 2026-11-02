// Stable identifiers for the demo incidents.
//
// The contract asks for `evt_<camera_id>_<unix_ms>_<track_id>`, and the middle number is
// an identifier, not the detection time. It comes from a fixed anchor plus a per-incident
// step, so a deep link such as `/incidents/evt_stand12_1700000000000_17` keeps pointing at
// the same incident after a reload, in another tab and on another machine. `detected_at`
// is the field that follows the clock.

export const EVENT_ID_ANCHOR_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z, 13 digits
export const EVENT_ID_STEP_MS = 60_000;

export const EVENT_ID_PATTERN = /^evt_[\w-]+_\d{13}_\d+$/;

/**
 * Identifier of the incident at position `index` in the fixture list.
 *
 * @param {string} cameraId Camera the incident belongs to.
 * @param {number} index Position in the list; its only job is uniqueness.
 * @param {number} trackId Tracker id, the last segment the contract defines.
 */
export function fixtureEventId(cameraId, index, trackId) {
  const stamp = EVENT_ID_ANCHOR_MS + index * EVENT_ID_STEP_MS;
  return `evt_${cameraId}_${stamp}_${trackId}`;
}
