// Shift labels and the single clock reading the demo dataset is built on.
//
// `FIXTURE_NOW` is captured once per page load: every fixture timestamp is derived from
// it, so the incidents always describe the shift the operator is currently in. Only the
// display times move; `event_id` stays pinned (see `eventIds.js`).

import { createShiftWindow } from './clock.js';

export const SHIFT_LABELS = Object.freeze({
  shift_1: 'Tura 1 (Dimineață: 06:00 - 14:00)',
  shift_2: 'Tura 2 (Prânz: 14:00 - 22:00)',
  shift_3: 'Tura 3 (Noapte: 22:00 - 06:00)',
});

/** The names the HTTP API uses for the same three shifts. */
export const SHIFT_API_NAMES = Object.freeze({
  shift_1: 'morning',
  shift_2: 'afternoon',
  shift_3: 'night',
});

const FIXTURE_NOW = new Date();
export const FIXTURE_WINDOW = createShiftWindow(FIXTURE_NOW);

/** Shift whose incidents the fixtures describe (the shift of the viewer). */
export const OPERATIONAL_SHIFT_ID = FIXTURE_WINDOW.shiftId;

/** Operational date the fixtures and the shift report share. */
export const OPERATIONAL_DATE = FIXTURE_WINDOW.operationalDate;

/** `Tura 2 (Prânz: ...)` → `Tura 2`, the short form the summary starts with. */
export function shortShiftLabel(shiftId) {
  const label = SHIFT_LABELS[shiftId];
  return label ? label.split(' (')[0] : 'Tură';
}

/** Full label for an API shift name (`morning`, `afternoon`, `night`). */
export function shiftLabelForApi(apiName) {
  const shiftId = Object.keys(SHIFT_API_NAMES).find((id) => SHIFT_API_NAMES[id] === apiName);
  return SHIFT_LABELS[shiftId] || apiName;
}
