// Demo zones, already calibrated on the shipped clips.
//
// A zone is configuration, not a detection: the edge worker only reports a person when
// the feet of the box land inside the polygon. The coordinates are normalised 0..1 over
// the frame, so the same polygon works on any resolution.

const outline = (...points) => points.map(([x, y]) => ({ x, y }));

const ZONE_FIXTURES = [
  {
    zone_id: 'engine-left',
    camera_id: 'stand12',
    name: 'Stand 12 — motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    required_ppe: ['ear_defenders', 'hi_vis_vest'],
    severity: 'CRITICAL',
    debounce_s: 0.5,
    notify_channel: 'slack',
    escalate_after_s: 120,
    // Calibrated on the CAM-01 clip: the left engine and the safety band up to the nose
    // wheel. `active_when: engine_on` means it only fires while the engine runs.
    polygon: outline(
      [0.02, 0.48],
      [0.4, 0.48],
      [0.62, 0.6],
      [0.64, 0.86],
      [0.2, 0.86],
      [0.02, 0.7]
    ),
  },
  {
    zone_id: 'apron-stand12',
    camera_id: 'stand12',
    name: 'Platformă Stand 12',
    rule_type: 'PPE_REQUIRED',
    active_when: 'always',
    required_ppe: ['hi_vis_vest', 'hard_hat', 'ear_defenders'],
    severity: 'WARNING',
    debounce_s: 2.0,
    notify_channel: 'slack',
    escalate_after_s: 60,
    polygon: outline(
      [0.04, 0.22],
      [0.42, 0.22],
      [0.42, 0.72],
      [0.04, 0.72]
    ),
  },
  {
    zone_id: 'taxiway-b',
    camera_id: 'taxiway-b',
    name: 'Taxiway B — linie de așteptare',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'CRITICAL',
    debounce_s: 1.0,
    notify_channel: 'slack',
    escalate_after_s: 30,
    polygon: outline(
      [0.0, 0.62],
      [1.0, 0.62],
      [1.0, 0.9],
      [0.0, 0.9]
    ),
  },
  {
    zone_id: 'baggage-area',
    camera_id: 'baggage-area',
    name: 'Zona bagaje — banda 2',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'WARNING',
    debounce_s: 2.0,
    notify_channel: 'slack',
    // The baggage ramp has no automatic escalation: the incident stays in the operator's
    // list until someone confirms it.
    escalate_after_s: null,
    polygon: outline(
      [0.02, 0.18],
      [0.98, 0.18],
      [0.98, 0.97],
      [0.02, 0.97]
    ),
  },
  {
    // The local camera's visible frame, so the engine has somewhere to run from the first
    // click. Editable and deletable like every other zone.
    zone_id: 'webcam-view',
    camera_id: 'webcam-live',
    name: 'Cameră browser — cadru vizibil',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'WARNING',
    debounce_s: 1.0,
    notify_channel: 'slack',
    // No auto-escalation: a laptop camera must never wake the tower.
    escalate_after_s: null,
    // Almost the whole frame: the laptop sees the person up close, and the rule counts
    // the feet of the box, so a small zone would never catch anyone.
    polygon: outline(
      [0.02, 0.18],
      [0.98, 0.18],
      [0.98, 0.97],
      [0.02, 0.97]
    ),
  },
];

export const INITIAL_ZONES = ZONE_FIXTURES;
