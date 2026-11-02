// The one zone the static build needs, and the reason it is hard-coded here.
//
// The lab runs without a backend: there is no `GET /zones` to ask, so a browser tab
// that wants to see the rule engine work must bring its own zone. This polygon covers
// the whole frame (small inset so the feet are inside the contour, not on its edge),
// which makes any person anywhere in the clip or webcam view a RESTRICTED_ZONE
// candidate. It is a lab fixture, not a camera configuration: once the engine is wired
// behind the Live view, zones come from the API and this object is not used.
//
// Shape and values follow the zone object of `docs/contract.md` (`## Zona`), except
// `notify_channel` / `reference_frame`: the lab has no Slack and no reference frame, and
// the pipeline reads only the fields below.
/** @type {import('./zones.js').Zone} */
export const DEFAULT_LAB_ZONE = Object.freeze({
  id: 'lab-full-frame',
  camera_id: 'lab',
  name: 'Cadru întreg (laborator)',
  rule_type: 'RESTRICTED',
  // The lab has no engine switch: the zone must fire whenever frames are processed,
  // so it does not follow `engineOn`.
  active_when: 'always',
  required_ppe: [],
  severity: 'WARNING',
  debounce_s: 1.0,
  escalate_after_s: 60,
  polygon: [
    [0.02, 0.02],
    [0.98, 0.02],
    [0.98, 0.98],
    [0.02, 0.98],
  ],
});

export default DEFAULT_LAB_ZONE;
