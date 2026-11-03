// Tests for the HUD colour pass. The boxes are annotated before `pipeline.step`, so these
// cases pin the same membership rules the pipeline uses, on the same normalized detections.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { HUD_COLOURS, hudColourFor, personHudStates } from './hud.js';
import { TRUNCATED_BOTTOM } from './zones.js';

const SQUARE = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

const OFF_SCREEN = [
  [0.85, 0.85],
  [0.95, 0.85],
  [0.95, 0.95],
  [0.85, 0.95],
];

function makeZone(overrides = {}) {
  return {
    id: 'engine-left',
    camera_id: 'stand12',
    name: 'Motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'CRITICAL',
    debounce_s: 1.0,
    polygon: SQUARE,
    ...overrides,
  };
}

/** A pipeline-shaped detection with the feet at `footY`, centred on x = 0.5. */
function detection(footY = 0.6, height = 0.4) {
  return { bbox: [0.45, footY - height, 0.55, footY], confidence: 0.9 };
}

const DEFAULT_STATE = {
  colour: HUD_COLOURS.default,
  severity: null,
  zoneId: null,
  ruleType: null,
};

describe('personHudStates', () => {
  test('a person under no zone keeps the default yellow', () => {
    const states = personHudStates([detection()], { zones: [], engineOn: true });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });

  test('a RESTRICTED zone with CRITICAL severity paints the box red', () => {
    const states = personHudStates([detection()], {
      zones: [makeZone()],
      engineOn: true,
      vestStates: ['vest'],
    });
    assert.deepEqual(states, [
      {
        colour: '#D73833',
        severity: 'CRITICAL',
        zoneId: 'engine-left',
        ruleType: 'RESTRICTED',
      },
    ]);
  });

  test('a RESTRICTED zone with WARNING severity paints the box amber', () => {
    const states = personHudStates([detection()], {
      zones: [makeZone({ severity: 'WARNING' })],
      engineOn: true,
      vestStates: ['vest'],
    });
    assert.equal(states[0].colour, '#FFB020');
    assert.equal(states[0].severity, 'WARNING');
  });

  test('PPE_REQUIRED paints amber when the hi-vis vest is provably missing', () => {
    const zone = makeZone({
      id: 'apron-stand12',
      rule_type: 'PPE_REQUIRED',
      required_ppe: ['hi_vis_vest'],
      severity: 'WARNING',
    });
    const states = personHudStates([detection()], {
      zones: [zone],
      engineOn: true,
      vestStates: ['no_vest'],
    });
    assert.deepEqual(states[0], {
      colour: HUD_COLOURS.warning,
      severity: 'WARNING',
      zoneId: 'apron-stand12',
      ruleType: 'PPE_REQUIRED',
    });
  });

  test('PPE_REQUIRED stays silent with the vest on', () => {
    const zone = makeZone({ rule_type: 'PPE_REQUIRED', required_ppe: ['hi_vis_vest'] });
    const states = personHudStates([detection()], {
      zones: [zone],
      engineOn: true,
      vestStates: ['vest'],
    });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });

  test('PPE_REQUIRED stays silent while the vest state is unknown', () => {
    const zone = makeZone({ rule_type: 'PPE_REQUIRED', required_ppe: ['hi_vis_vest'] });
    const states = personHudStates([detection()], {
      zones: [zone],
      engineOn: true,
      vestStates: ['unknown'],
    });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });

  test('an engine_on zone is silent while the engine switch is off', () => {
    const zone = makeZone({ active_when: 'engine_on' });
    const off = personHudStates([detection()], { zones: [zone], engineOn: false });
    const on = personHudStates([detection()], { zones: [zone], engineOn: true });
    assert.deepEqual(off, [DEFAULT_STATE]);
    assert.equal(on[0].colour, HUD_COLOURS.critical);
  });

  test('two zones choose the higher severity, whatever the order', () => {
    const warning = makeZone({ id: 'warn-zone', severity: 'WARNING' });
    const critical = makeZone({ id: 'crit-zone', severity: 'CRITICAL' });
    const states = personHudStates([detection()], {
      zones: [warning, critical],
      engineOn: true,
    });
    assert.equal(states[0].severity, 'CRITICAL');
    assert.equal(states[0].colour, HUD_COLOURS.critical);
    assert.equal(states[0].zoneId, 'crit-zone');
  });

  test('a severity tie keeps the first zone in the list', () => {
    const first = makeZone({ id: 'first-zone', severity: 'WARNING' });
    const second = makeZone({ id: 'second-zone', severity: 'WARNING' });
    const states = personHudStates([detection()], {
      zones: [first, second],
      engineOn: true,
    });
    assert.equal(states[0].zoneId, 'first-zone');
  });

  test('the feet decide membership: outside is default, inside is coloured', () => {
    const zone = makeZone();
    const outside = personHudStates([detection(0.9)], { zones: [zone], engineOn: true });
    const inside = personHudStates([detection(0.6)], { zones: [zone], engineOn: true });
    assert.deepEqual(outside, [DEFAULT_STATE]);
    assert.equal(inside[0].colour, HUD_COLOURS.critical);
  });

  test('a box cut off by the bottom edge keeps the default colour', () => {
    const states = personHudStates([detection(TRUNCATED_BOTTOM)], {
      zones: [makeZone()],
      engineOn: true,
    });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });

  test('states are aligned by index with the detections they describe', () => {
    const zone = makeZone();
    const states = personHudStates([detection(0.6), detection(0.1)], {
      zones: [zone],
      engineOn: true,
      vestStates: ['vest', 'vest'],
    });
    assert.equal(states.length, 2);
    assert.equal(states[0].colour, HUD_COLOURS.critical);
    assert.deepEqual(states[1], DEFAULT_STATE);
  });

  test('a silent rule type is ignored, even when the feet are inside', () => {
    const states = personHudStates([detection()], {
      zones: [makeZone({ rule_type: 'NO_SMOKING' })],
      engineOn: true,
    });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });

  test('a malformed polygon is skipped instead of throwing', () => {
    const zones = [
      makeZone({ id: 'two-points', polygon: [[0.1, 0.1], [0.9, 0.9]] }),
      makeZone({ id: 'object-points', polygon: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }] }),
      makeZone({ id: 'not-a-list', polygon: 'nope' }),
      null,
    ];
    const states = personHudStates([detection()], { zones, engineOn: true });
    assert.deepEqual(states, [DEFAULT_STATE]);
  });
});

describe('hudColourFor', () => {
  test('falls back to the default for a missing state and reads a real one', () => {
    assert.equal(hudColourFor(undefined), HUD_COLOURS.default);
    assert.equal(hudColourFor({ colour: HUD_COLOURS.warning }), '#FFB020');
  });
});
