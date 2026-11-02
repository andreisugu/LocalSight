// Tests for the browser pipeline glue: tracker -> zone rules -> event.
//
// The cases mirror `ml/tests/test_pipeline.py` where the reference behaviour is
// observable: debounce, one event per presence, the engine switch, the PPE gate and the
// 60 s incident cooldown. Synthetic boxes only: no video, no models, no DOM.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline } from './pipeline.js';

const CAMERA = 'stand12';
// A 13-digit epoch, because `event_id` needs Unix milliseconds (`events.js`).
const BASE_MS = 1_793_356_933_120;
const FRAME = { frameWidth: 1920, frameHeight: 1080 };
const SNAPSHOT = 'blob:http://localhost:5173/snapshot-1';
// 0.125 s steps at 8 fps: exact in binary, so the debounce boundary is not a float race.
const STEP_MS = 125;

// The demo engine zone from docs/contract.md.
const ENGINE_ZONE = [
  [0.46, 0.16],
  [0.76, 0.16],
  [0.76, 0.68],
  [0.46, 0.68],
];

function makeZone(overrides = {}) {
  return {
    id: 'engine-left',
    camera_id: CAMERA,
    name: 'Motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'CRITICAL',
    debounce_s: 1.0,
    escalate_after_s: 30,
    notify_channel: 'slack',
    polygon: ENGINE_ZONE,
    reference_frame: null,
    ...overrides,
  };
}

/** A person box with the feet at `footY`, detached from the frame bottom. */
function person({ x = 0.55, footY = 0.55, height = 0.3, confidence = 0.9 } = {}) {
  return { bbox: [x - 0.05, footY - height, x + 0.05, footY], confidence };
}

/**
 * One pipeline plus a frame driver. `state.ms` is an integer clock so every frame time is
 * exact and the event timestamps are deterministic.
 */
function harness({ zones, engineOn = true, incidentCooldownS = 60 } = {}) {
  const state = { ms: 0, nowS: 0, events: [], tracked: [] };
  const pipeline = createPipeline({
    cameraId: CAMERA,
    zones,
    engineOn,
    incidentCooldownS,
    clock: () => BASE_MS + state.ms,
  });

  const feed = (detections, { frames = 1, vestStates, snapshotUrl = SNAPSHOT } = {}) => {
    const produced = [];
    for (let frame = 0; frame < frames; frame += 1) {
      state.ms += STEP_MS;
      state.nowS = state.ms / 1000;
      const result = pipeline.step(detections, state.nowS, {
        ...FRAME,
        vestStates,
        snapshotUrl,
      });
      state.tracked = result.tracked;
      state.events.push(...result.events);
      produced.push(...result.events);
    }
    return produced;
  };

  return { pipeline, state, feed };
}

describe('createPipeline', () => {
  test('a person in a RESTRICTED zone raises exactly one event after the debounce', () => {
    const { state, feed } = harness({ zones: [makeZone()] });

    feed([person()], { frames: 15 });

    assert.equal(state.events.length, 1);
    const [event] = state.events;
    assert.equal(event.type, 'RESTRICTED_ZONE');
    assert.equal(event.severity, 'CRITICAL');
    assert.equal(event.status, 'open');
    assert.equal(event.camera_id, CAMERA);
    assert.equal(event.zone_id, 'engine-left');
    assert.equal(event.track_id, 1);
    assert.equal(event.snapshot_url, SNAPSHOT);
    assert.equal(event.model, 'yolo26n');
    assert.deepEqual(event.context, { engine_on: true });
    assert.equal(event.confidence.detector, 0.9);
    // 0.125 s per frame: frame 9 is the first with a full-second presence, and the whole
    // window was inside.
    assert.deepEqual(event.confidence.temporal, { seen: 9, window: 9 });
    assert.equal(event.duration_s, 1);
    assert.match(event.event_id, /^evt_stand12_\d{13}_1$/);

    // The same frame also hands the renderer the box it blurs and draws.
    assert.equal(state.tracked.length, 1);
    assert.deepEqual(state.tracked[0].bbox, person().bbox);
    assert.equal(state.tracked[0].trackId, 1);
  });

  test('leaving and re-entering after the cooldown raises a second event', () => {
    const { state, feed } = harness({ zones: [makeZone()] });

    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 1);

    // Walk out in 0.04 steps, so each frame overlaps the last and the id survives, then
    // stay outside until past both the rule cooldown (10 s) and the incident one (60 s).
    let x = 0.55;
    for (let frame = 0; frame < 10; frame += 1) {
      x -= 0.04;
      feed([person({ x })], { frames: 1 });
    }
    assert.equal(state.events.length, 1);
    feed([person({ x })], { frames: 470 });

    // Walk back in at the same pace.
    for (let frame = 0; frame < 10; frame += 1) {
      x += 0.04;
      feed([person({ x })], { frames: 1 });
    }
    assert.equal(state.events.length, 1);

    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 2);
    assert.equal(state.events[1].track_id, 1, 'the track survived the walk outside');
    assert.notEqual(state.events[1].event_id, state.events[0].event_id);
  });

  test('a PPE zone fires only when required_ppe is provably unmet', () => {
    const zone = makeZone({
      id: 'ppe-gate',
      rule_type: 'PPE_REQUIRED',
      required_ppe: ['hi_vis_vest'],
      severity: 'WARNING',
    });

    const uncovered = harness({ zones: [zone] });
    uncovered.feed([person()], { frames: 15, vestStates: ['no_vest'] });
    assert.equal(uncovered.state.events.length, 1);
    assert.equal(uncovered.state.events[0].type, 'NO_PPE');
    assert.equal(uncovered.state.events[0].severity, 'WARNING');

    const covered = harness({ zones: [zone] });
    covered.feed([person()], { frames: 15, vestStates: ['vest'] });
    assert.equal(covered.state.events.length, 0);

    // The colour heuristic reports `unknown` for small or hidden people; that is silent.
    const unknown = harness({ zones: [zone] });
    unknown.feed([person()], { frames: 15 });
    assert.equal(unknown.state.events.length, 0);
  });

  test('an engine_on zone waits for the engine switch', () => {
    const { pipeline, state, feed } = harness({
      zones: [makeZone({ active_when: 'engine_on' })],
      engineOn: false,
    });

    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 0);

    pipeline.setEngineOn(true);
    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 1);
    assert.deepEqual(state.events[0].context, { engine_on: true });
  });

  test('the incident cooldown suppresses a second track in the same zone', () => {
    const { state, feed } = harness({ zones: [makeZone()], incidentCooldownS: 60 });

    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 1);

    // A different person, inside the same zone, well inside the 60 s window: the rule
    // engine confirms a second presence, but the cooldown keeps it off the incident list.
    feed([person({ x: 0.68 })], { frames: 40 });
    assert.equal(state.events.length, 1);
    assert.ok(state.events.every((event) => event.track_id === 1));
  });

  test('setZones hot-applies the config and ignores other cameras', () => {
    const { pipeline, state, feed } = harness({ zones: [] });

    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 0);

    pipeline.setZones([makeZone()]);
    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 1);

    pipeline.setZones([makeZone({ camera_id: 'taxiway-b' })]);
    feed([person()], { frames: 15 });
    assert.equal(state.events.length, 1, 'a zone from another camera must stay silent');
  });
});
