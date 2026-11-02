// Shift arguments of the API, independent of the transport.
//
// The backend names shifts `morning`/`afternoon`/`night` and dates a shift by its
// operational day (before 06:00 it is still yesterday). Mock mode uses the same helpers,
// so the report selector never asks a different question than production.

import { operationalDateAt, shiftIdAt, zonedDateString } from '../data/clock.js';
import { SHIFT_API_NAMES } from '../data/shift.js';

/** `shift_2` → `afternoon`; unknown input keeps the backend's default. */
export function shiftToApi(shiftId) {
  return SHIFT_API_NAMES[shiftId] || 'morning';
}

/** Shift that contains `now`, on Romania's clock. */
export function currentShiftId(now = new Date()) {
  return shiftIdAt(now);
}

/** Operational date of the shift (`YYYY-MM-DD`). */
export function shiftDate(_shiftId, now = new Date()) {
  return operationalDateAt(now);
}

/** Calendar date in Romania, for requests that do not depend on the shift boundary. */
export function localDateString(now = new Date()) {
  return zonedDateString(now);
}
