// Tests for the zone port. They mirror the meaningful cases of
// ml/tests/test_zones.py and the triggers_event cases of ml/tests/test_pipeline.py,
// so the browser engine is pinned to the same behaviour as the edge.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RuleEngine,
  TRUNCATED_BOTTOM,
  ZoneMembership,
  pointInPolygon,
  signedDistance,
  triggersEvent,
  zoneActive,
} from './zones.js';

// The demo engine zone from docs/contract.md.
const POLYGON = [
  [0.46, 0.16],
  [0.76, 0.16],
  [0.76, 0.68],
  [0.46, 0.68],
];

const SQUARE = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

function makeZone(overrides = {}) {
  return {
    id: 'engine-left',
    camera_id: 'stand12',
    name: 'Motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    required_ppe: [],
    severity: 'CRITICAL',
    debounce_s: 1.0,
    escalate_after_s: 30,
    notify_channel: 'slack',
    polygon: POLYGON,
    reference_frame: null,
    ...overrides,
  };
}

/** Person box centred at x=0.5 with the feet at `footY` (the Python `_box` helper). */
function box(footY, height = 0.4) {
  return [0.45, footY - height, 0.55, footY];
}

/** pytest.approx: 1e-6 relative, enough for the float32 narrowing the reference does. */
function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)),
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

describe('pointInPolygon', () => {
  test('inside, outside and below the demo zone', () => {
    assert.equal(pointInPolygon([0.6, 0.6], POLYGON), true);
    assert.equal(pointInPolygon([0.2, 0.6], POLYGON), false);
    assert.equal(pointInPolygon([0.6, 0.9], POLYGON), false);
  });

  test('an edge point follows the reference half-open rule', () => {
    // The strict `x < xCross` comparison means the left/top boundary counts as inside
    // and the right/bottom boundary as outside. Kept as-is so the port matches the edge.
    assert.equal(pointInPolygon([0.46, 0.4], POLYGON), true);
    assert.equal(pointInPolygon([0.76, 0.4], POLYGON), false);
  });
});

describe('signedDistance', () => {
  test('positive inside, negative outside, in frame heights', () => {
    closeTo(signedDistance([0.5, 0.75], SQUARE), 0.05);
    closeTo(signedDistance([0.5, 0.85], SQUARE), -0.05);
  });

  test('aspect scales x so the result stays in person-heights', () => {
    // On a 16:9 frame, 0.05 of the width is 0.05 * 16 / 9 frame heights.
    closeTo(signedDistance([0.85, 0.5], SQUARE, 16 / 9), (-0.05 * 16) / 9);
  });

  test('distance is measured to the nearest contour segment, corners included', () => {
    // cv2.pointPolygonTest measures to the segment, not to the edge's infinite line:
    // a point diagonally off the corner is sqrt(2) * 0.1 away, not 0.1.
    closeTo(signedDistance([0.9, 0.9], SQUARE), -Math.SQRT2 * 0.1);
  });

  test('a point on the edge is 0', () => {
    closeTo(signedDistance([0.5, 0.8], SQUARE), 0, 1e-9);
    closeTo(Math.abs(signedDistance([0.2, 0.5], SQUARE)), 0, 1e-9);
  });
});

describe('ZoneMembership', () => {
  const membershipZone = () => makeZone({ polygon: SQUARE });

  test('needs the margin to enter and to leave', () => {
    const member = new ZoneMembership({ margin: 0.1 }); // band = 0.1 * 0.4 = 0.04
    const step = (footY) =>
      member.update({ trackId: 1, bbox: box(footY), zone: membershipZone(), now: 0 });

    assert.equal(step(0.79), false); // 0.01 inside: on the edge, not in yet
    assert.equal(step(0.75), true); // 0.05 inside: entered
    assert.equal(step(0.81), true); // 0.01 outside: still in (inside the band)
    assert.equal(step(0.85), false); // 0.05 outside: left
    assert.equal(member.transitions, 2);
  });

  test('zero margin is the bare point test', () => {
    const member = new ZoneMembership({ margin: 0 });
    const zone = membershipZone();
    assert.equal(member.update({ trackId: 1, bbox: box(0.79), zone, now: 0 }), true);
    assert.equal(member.update({ trackId: 1, bbox: box(0.81), zone, now: 0 }), false);
  });

  test('a box cut by the frame bottom keeps the last state', () => {
    assert.equal(TRUNCATED_BOTTOM, 0.985);
    const zone = makeZone({
      polygon: [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.8, 1.0],
        [0.2, 1.0],
      ],
    });
    const member = new ZoneMembership();
    // Feet hidden below the frame: a new track does not enter on a guess...
    assert.equal(member.update({ trackId: 1, bbox: box(0.995), zone, now: 0 }), false);
    // ...and a track already inside stays inside.
    assert.equal(member.update({ trackId: 2, bbox: box(0.9), zone, now: 0 }), true);
    assert.equal(member.update({ trackId: 2, bbox: box(0.995), zone, now: 0.1 }), true);
  });

  test('a box bottom exactly at TRUNCATED_BOTTOM already holds', () => {
    const zone = makeZone({
      polygon: [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.8, 1.0],
        [0.2, 1.0],
      ],
    });
    // Margin 0 makes the truncation the only reason to refuse this entry.
    const member = new ZoneMembership({ margin: 0 });
    assert.equal(member.update({ trackId: 1, bbox: box(TRUNCATED_BOTTOM), zone, now: 0 }), false);
    assert.equal(member.update({ trackId: 1, bbox: box(0.9), zone, now: 0.1 }), true);
    assert.equal(member.update({ trackId: 1, bbox: box(TRUNCATED_BOTTOM), zone, now: 0.2 }), true);
  });

  test('membership state is pruned after the ttl', () => {
    const zone = membershipZone();
    const member = new ZoneMembership({ ttl_s: 5.0 });
    assert.equal(member.update({ trackId: 1, bbox: box(0.75), zone, now: 0 }), true);
    member.prune(4.999); // still fresh: the edge band keeps the old state
    assert.equal(member.update({ trackId: 1, bbox: box(0.79), zone, now: 4.999 }), true);
    member.prune(9.999); // 9.999 - 4.999 >= 5: forgotten
    // The same track on the edge band starts again from "outside".
    assert.equal(member.update({ trackId: 1, bbox: box(0.79), zone, now: 9.999 }), false);
  });

  test('a negative margin is rejected', () => {
    assert.throws(() => new ZoneMembership({ margin: -0.1 }), RangeError);
  });
});

describe('RuleEngine', () => {
  test('defaults match the reference', () => {
    const engine = new RuleEngine();
    assert.equal(engine.window_frames, 15);
    assert.equal(engine.min_window, 5);
    assert.equal(engine.seen_ratio, 0.8);
    assert.equal(engine.cooldown_s, 10.0);
  });

  test('engine off emits nothing', () => {
    const engine = new RuleEngine();
    const zone = makeZone();
    for (let step = 0; step < 20; step += 1) {
      const decision = engine.observe({
        trackId: 1,
        zone,
        inZone: true,
        now: step / 10,
        engineOn: false,
      });
      assert.equal(decision, null);
    }
  });

  test('an always-active zone ignores the engine switch', () => {
    const engine = new RuleEngine();
    const zone = makeZone({ active_when: 'always', debounce_s: 0.2 });
    let decision = null;
    for (let step = 0; step < 5 && decision === null; step += 1) {
      decision = engine.observe({
        trackId: 1,
        zone,
        inZone: true,
        now: step / 10,
        engineOn: false,
      });
    }
    assert.notEqual(decision, null);
  });

  test('debounce emits exactly once, and not before debounce_s', () => {
    const engine = new RuleEngine();
    const zone = makeZone({ debounce_s: 1.0 });
    const decisions = [];
    for (let step = 0; step < 11; step += 1) {
      decisions.push(
        engine.observe({ trackId: 1, zone, inZone: true, now: step / 10, engineOn: true }),
      );
    }
    assert.deepEqual(
      decisions.slice(0, 10),
      new Array(10).fill(null),
    );
    const decision = decisions[10];
    assert.notEqual(decision, null);
    assert.equal(decision.seen, 11);
    assert.equal(decision.window, 11);
    closeTo(decision.duration_s, 1.0);

    // The same presence must not produce a second event.
    assert.equal(
      engine.observe({ trackId: 1, zone, inZone: true, now: 1.1, engineOn: true }),
      null,
    );
  });

  test('a zone without debounce_s uses the reference default of 1.0 s', () => {
    const engine = new RuleEngine();
    const zone = makeZone();
    delete zone.debounce_s;
    for (const now of [0, 0.25, 0.5, 0.75, 0.999]) {
      assert.equal(engine.observe({ trackId: 1, zone, inZone: true, now, engineOn: true }), null);
    }
    assert.notEqual(
      engine.observe({ trackId: 1, zone, inZone: true, now: 1.0, engineOn: true }),
      null,
    );
  });

  test('re-entry after the cooldown emits again', () => {
    const engine = new RuleEngine({ cooldown_s: 10.0 });
    const zone = makeZone({ debounce_s: 0.5 });

    let first = null;
    for (let step = 0; step < 6; step += 1) {
      first = first ?? engine.observe({
        trackId: 1,
        zone,
        inZone: true,
        now: step / 10,
        engineOn: true,
      });
    }
    assert.notEqual(first, null);

    // Leave the zone; after the cooldown the state is reset.
    engine.observe({ trackId: 1, zone, inZone: false, now: 1.0, engineOn: true });
    engine.observe({ trackId: 1, zone, inZone: false, now: 11.1, engineOn: true });

    const decisions = [];
    for (let step = 0; step < 6; step += 1) {
      const decision = engine.observe({
        trackId: 1,
        zone,
        inZone: true,
        now: 11.2 + step / 10,
        engineOn: true,
      });
      if (decision !== null) decisions.push(decision);
    }
    assert.equal(decisions.length, 1);
    closeTo(decisions[0].duration_s, 0.5);
  });

  test('temporal confirmation rejects a mostly missing track', () => {
    const engine = new RuleEngine({ min_window: 5, seen_ratio: 0.8, cooldown_s: 100.0 });
    const zone = makeZone({ debounce_s: 0.1 });

    // Only 2 of 8 observed frames confirm; no event.
    for (let step = 0; step < 8; step += 1) {
      const decision = engine.observe({
        trackId: 1,
        zone,
        inZone: step === 0 || step === 1,
        now: step / 10,
        engineOn: true,
      });
      assert.equal(decision, null);
    }
  });

  test('the window keeps at most window_frames entries', () => {
    const engine = new RuleEngine({ window_frames: 5, min_window: 5, seen_ratio: 1.0 });
    const zone = makeZone({ debounce_s: 0 });
    const decisions = [];
    for (let step = 0; step < 10; step += 1) {
      decisions.push(
        engine.observe({ trackId: 1, zone, inZone: true, now: step / 10, engineOn: true }),
      );
    }
    // Frames 0-3 cannot confirm, frame 4 confirms with a full window of 5.
    assert.deepEqual(decisions.slice(0, 4), new Array(4).fill(null));
    assert.notEqual(decisions[4], null);
    assert.equal(decisions[4].window, 5);
    assert.equal(decisions[4].seen, 5);
    assert.equal(decisions.slice(5).filter((decision) => decision !== null).length, 0);
  });

  test('prune drops a state that has not been seen for the cooldown', () => {
    const engine = new RuleEngine({ window_frames: 5, min_window: 5, cooldown_s: 10 });
    const zone = makeZone({ debounce_s: 0 });

    const first = [];
    for (let step = 0; step < 5; step += 1) {
      first.push(
        engine.observe({ trackId: 1, zone, inZone: true, now: step / 10, engineOn: true }),
      );
    }
    assert.equal(first.filter((decision) => decision !== null).length, 1);

    // Last seen at 0.4 s. At 10.399 s the cooldown has not elapsed, so the state is kept
    // and the already emitted presence stays silent for a full fresh window.
    engine.prune(10.399);
    const kept = [];
    for (let step = 0; step < 5; step += 1) {
      kept.push(
        engine.observe({
          trackId: 1,
          zone,
          inZone: true,
          now: 10.399 + step / 10,
          engineOn: true,
        }),
      );
    }
    assert.equal(kept.filter((decision) => decision !== null).length, 0);

    // At the cooldown exactly (>= semantics) the state is gone and a new presence
    // confirms from scratch.
    engine.prune(20.799);
    const fresh = [];
    for (let step = 0; step < 5; step += 1) {
      fresh.push(
        engine.observe({
          trackId: 1,
          zone,
          inZone: true,
          now: 20.799 + step / 10,
          engineOn: true,
        }),
      );
    }
    assert.equal(fresh.filter((decision) => decision !== null).length, 1);
  });

  test('reset forgets every state', () => {
    const engine = new RuleEngine({ window_frames: 5, min_window: 5 });
    const zone = makeZone({ debounce_s: 0 });
    for (let step = 0; step < 5; step += 1) {
      engine.observe({ trackId: 1, zone, inZone: true, now: step / 10, engineOn: true });
    }
    engine.reset();
    assert.equal(
      engine.observe({ trackId: 1, zone, inZone: true, now: 1, engineOn: true }),
      null,
    );
  });

  test('invalid windows are rejected', () => {
    assert.throws(() => new RuleEngine({ window_frames: 5, min_window: 6 }), RangeError);
    assert.throws(() => new RuleEngine({ window_frames: 0 }), RangeError);
    assert.throws(() => new RuleEngine({ seen_ratio: 1.5 }), RangeError);
  });
});

describe('zoneActive', () => {
  test('always zones are live whatever the engine does', () => {
    const zone = makeZone({ active_when: 'always' });
    assert.equal(zoneActive(zone, false), true);
    assert.equal(zoneActive(zone, true), true);
  });

  test('engine_on zones follow the switch', () => {
    const zone = makeZone({ active_when: 'engine_on' });
    assert.equal(zoneActive(zone, false), false);
    assert.equal(zoneActive(zone, true), true);
  });

  test('a missing active_when defaults to always, like the Pydantic model', () => {
    const zone = makeZone();
    delete zone.active_when;
    assert.equal(zoneActive(zone, false), true);
  });

  test('the roadmap schedule value behaves like engine_on', () => {
    const zone = makeZone({ active_when: 'schedule' });
    assert.equal(zoneActive(zone, false), false);
    assert.equal(zoneActive(zone, true), true);
  });
});

describe('triggersEvent', () => {
  test('RESTRICTED fires for anyone inside, PPE state irrelevant', () => {
    const zone = makeZone({ rule_type: 'RESTRICTED' });
    for (const state of ['no_vest', 'vest', 'unknown', null]) {
      assert.equal(triggersEvent(zone, state), true);
    }
  });

  test('PPE_REQUIRED fires only on a proven vest violation', () => {
    const zone = makeZone({ rule_type: 'PPE_REQUIRED', required_ppe: ['hi_vis_vest'] });
    assert.equal(triggersEvent(zone, 'no_vest'), true);
    assert.equal(triggersEvent(zone, 'vest'), false);
    assert.equal(triggersEvent(zone, 'unknown'), false);
    assert.equal(triggersEvent(zone, null), false);
  });

  test('PPE_REQUIRED ignores items the edge cannot check', () => {
    // No hard-hat detector: the zone must neither raise nor count as satisfied.
    const zone = makeZone({ rule_type: 'PPE_REQUIRED', required_ppe: ['hard_hat'] });
    assert.equal(triggersEvent(zone, 'no_vest'), false);
    const empty = makeZone({ rule_type: 'PPE_REQUIRED', required_ppe: [] });
    assert.equal(triggersEvent(empty, 'no_vest'), false);
  });

  test('rule types without a person rule stay silent', () => {
    for (const ruleType of ['NO_SMOKING', 'CROWD_WATCH', 'FOD_WATCH']) {
      const zone = makeZone({ rule_type: ruleType });
      assert.equal(triggersEvent(zone, 'no_vest'), false);
    }
  });
});
