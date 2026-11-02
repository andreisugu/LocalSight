// Demo fixtures for the static build (`VITE_USE_MOCK=true`) and `npm run dev`.
//
// The data itself lives in `src/data/*`, split by domain, with the derivations (IDs,
// shift window, KPIs, report) as pure helpers tested in Node. This file stays the single
// import path the screens already use, so moving the fixtures did not touch a component.

export { INITIAL_CAMERAS } from '../data/cameras.js';
export { INITIAL_EVENTS } from '../data/incidents.js';
export { INITIAL_KPIS } from '../data/kpis.js';
export { DEMO_REFERENCE_FRAMES, DEMO_STILLS } from '../data/media.js';
export { AVAILABLE_OPERATORS } from '../data/operators.js';
export { INITIAL_SHIFT_REPORT } from '../data/report.js';
export { OPERATIONAL_DATE, OPERATIONAL_SHIFT_ID } from '../data/shift.js';
export { INITIAL_ZONES } from '../data/zones.js';
