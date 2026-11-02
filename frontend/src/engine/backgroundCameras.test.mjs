// Tests for the background camera manager: lifecycle, active-camera skip, resource guard,
// isolated failures, dedupe, caps and timers.
//
// No React, no DOM, no worker. Engines and timers are fakes injected through the public
// options, and the clock is a number the test moves, so every backoff branch is checked
// deterministically instead of with `sleep`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBackgroundCameras } from './backgroundCameras.js';

/** `setInterval`/`clearInterval` with a manual tick, plus the live handle count. */
function fakeScheduler() {
  let nextId = 1;
  const timers = new Map();
  return {
    setInterval(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    tick() {
      for (const { fn } of [...timers.values()]) fn();
    },
    get size() {
      return timers.size;
    },
    get delays() {
      return [...timers.values()].map((timer) => timer.ms);
    },
  };
}

function createFakeEngine(options = {}) {
  const state = {
    starts: 0,
    stops: 0,
    listeners: [],
    failStart: options.failStart === true,
    rejectStart: options.rejectStart === true,
    reported: options.reported ?? { state: 'running' },
  };
  return {
    state,
    start() {
      state.starts += 1;
      if (state.failStart) throw new Error('start failed');
      if (state.rejectStart) return Promise.reject(new Error('start rejected'));
      return undefined;
    },
    stop() {
      state.stops += 1;
    },
    onEvent(listener) {
      state.listeners.push(listener);
      return () => {
        state.listeners = state.listeners.filter((item) => item !== listener);
      };
    },
    status() {
      return state.reported;
    },
    emit(event) {
      for (const listener of [...state.listeners]) listener(event);
    },
  };
}

/** Build one manager plus the handles a test needs to inspect it. */
function setup({
  cameraIds = ['stand12', 'taxiway-b', 'baggage-area'],
  engineOptions = () => ({}),
  hardwareConcurrency = 8,
  maxCameras = 3,
  maxEventsPerCamera = 200,
  maxQueuedPerCamera = 32,
  intervalMs = 2000,
  onEvent,
} = {}) {
  const scheduler = fakeScheduler();
  const delivered = [];
  const created = [];
  const factoryCalls = [];
  let clock = 1_000_000;

  const manager = createBackgroundCameras({
    cameras: cameraIds.map((id) => ({ id })),
    zonesForCamera: (camera) => [{ id: `zone-${camera.id}` }],
    engineFactory: ({ cameraId, zones }) => {
      factoryCalls.push(cameraId);
      const options = engineOptions(cameraId) || {};
      if (options.throwFactory) throw new Error('worker unavailable');
      if (options.malformed) return null;
      const engine = createFakeEngine(options);
      created.push({ cameraId, zones, engine });
      return engine;
    },
    intervalMs,
    maxCameras,
    hardwareConcurrency,
    maxEventsPerCamera,
    maxQueuedPerCamera,
    now: () => clock,
    scheduler,
    onEvent: (event) => {
      delivered.push(event);
      onEvent?.(event);
    },
  });

  return {
    manager,
    scheduler,
    delivered,
    created,
    factoryCalls,
    advance(ms) {
      clock += ms;
    },
    createdFor(cameraId) {
      return created.filter((item) => item.cameraId === cameraId);
    },
    callsFor(cameraId) {
      return factoryCalls.filter((id) => id === cameraId).length;
    },
    engineFor(cameraId) {
      return this.createdFor(cameraId).at(-1)?.engine;
    },
    cameraState(cameraId) {
      return manager.status().cameras.find((camera) => camera.id === cameraId);
    },
  };
}

const eventFor = (cameraId, serial) => ({
  event_id: `evt_${cameraId}_1793356933120_${serial}`,
  camera_id: cameraId,
  type: 'RESTRICTED_ZONE',
});

describe('createBackgroundCameras lifecycle', () => {
  test('is off by default: start() alone constructs no engine and arms no timer', () => {
    const h = setup();

    assert.equal(h.manager.status().enabled, false);
    assert.equal(h.manager.status().running, false);
    assert.equal(h.created.length, 0);
    assert.equal(h.scheduler.size, 0);

    const started = h.manager.start();
    assert.equal(started.running, false);
    assert.equal(h.created.length, 0);
    assert.equal(h.scheduler.size, 0);
    assert.deepEqual(
      started.cameras.map((camera) => camera.state),
      ['stopped', 'stopped', 'stopped'],
    );
  });

  test('setEnabled(true) starts one engine per camera and reports the low-rate pump', () => {
    const h = setup();
    h.manager.start();
    const status = h.manager.setEnabled(true);

    assert.equal(status.enabled, true);
    assert.equal(status.running, true);
    assert.equal(status.refusedReason, null);
    assert.equal(h.created.length, 3);
    assert.equal(h.scheduler.size, 1);
    assert.deepEqual(h.scheduler.delays, [2000]);
    assert.deepEqual(
      status.cameras.map((camera) => camera.state),
      ['running', 'running', 'running'],
    );
    // The factory gets the camera and the zones resolved at start time, nothing invented.
    assert.deepEqual(h.createdFor('stand12')[0].zones, [{ id: 'zone-stand12' }]);
    assert.deepEqual(h.createdFor('stand12')[0].engine.state.starts, 1);
  });

  test('start, stop and setEnabled are idempotent and never leak a timer', () => {
    const h = setup();
    h.manager.start();
    h.manager.start();
    h.manager.setEnabled(true);
    h.manager.setEnabled(true);

    assert.equal(h.scheduler.size, 1);
    assert.equal(h.created.length, 3);

    h.manager.stop();
    assert.equal(h.scheduler.size, 0);
    for (const { engine } of h.created) assert.equal(engine.state.stops, 1);

    h.manager.stop();
    assert.equal(h.scheduler.size, 0);
    for (const { engine } of h.created) assert.equal(engine.state.stops, 1);

    // stop() keeps the preference: a later start resumes the run with fresh engines.
    h.manager.start();
    assert.equal(h.scheduler.size, 1);
    assert.equal(h.created.length, 6);
  });

  test('setEnabled(false) stops every engine at once; re-enabling starts fresh ones', () => {
    const h = setup();
    h.manager.start();
    h.manager.setEnabled(true);
    const firstRun = h.created.slice();

    const disabled = h.manager.setEnabled(false);
    assert.equal(disabled.running, false);
    assert.equal(h.scheduler.size, 0);
    for (const { engine } of firstRun) assert.equal(engine.state.stops, 1);

    h.manager.setEnabled(false);
    assert.equal(h.scheduler.size, 0);

    h.manager.setEnabled(true);
    assert.equal(h.scheduler.size, 1);
    assert.equal(h.created.length, 6);
    assert.equal(h.engineFor('stand12').state.starts, 1);
  });
});

describe('createBackgroundCameras active camera', () => {
  test('skips the active camera, reuses the others, and resumes when Live unmounts', () => {
    const h = setup();
    h.manager.start();
    h.manager.setEnabled(true);

    h.manager.setActiveCamera('stand12');
    assert.equal(h.engineFor('stand12').state.stops, 1);
    assert.equal(h.cameraState('stand12').state, 'active');
    assert.equal(h.cameraState('stand12').skipReason, 'active-camera');
    assert.equal(h.cameraState('taxiway-b').state, 'running');

    h.manager.setActiveCamera(null);
    assert.equal(h.createdFor('stand12').length, 2);
    assert.equal(h.createdFor('taxiway-b').length, 1);
    assert.equal(h.engineFor('stand12').state.starts, 1);
    assert.equal(h.scheduler.size, 1);

    // Moving Live to another camera stops the old one and reuses everything else.
    h.manager.setActiveCamera('taxiway-b');
    assert.equal(h.engineFor('taxiway-b').state.stops, 1);
    assert.equal(h.cameraState('taxiway-b').state, 'active');
    assert.equal(h.createdFor('taxiway-b').length, 1);

    // Setting the same id twice is a no-op, not a second stop.
    h.manager.setActiveCamera('taxiway-b');
    assert.equal(h.engineFor('taxiway-b').state.stops, 1);
  });

  test('an active camera set before start is skipped from the first engine build', () => {
    const h = setup();
    h.manager.setActiveCamera('stand12');
    h.manager.start();
    h.manager.setEnabled(true);

    assert.equal(h.created.length, 2);
    assert.equal(h.engineFor('stand12'), undefined);
    assert.equal(h.cameraState('stand12').state, 'active');
    assert.deepEqual(
      h.created.map((item) => item.cameraId),
      ['taxiway-b', 'baggage-area'],
    );
  });

  test('rejects a malformed active camera id instead of guessing', () => {
    const h = setup();
    assert.throws(() => h.manager.setActiveCamera(''), TypeError);
    assert.throws(() => h.manager.setActiveCamera(42), TypeError);
    assert.equal(h.manager.status().cameras[0].state, 'stopped');
  });
});

describe('createBackgroundCameras resource guard', () => {
  test('refuses the whole run above maxCameras and recovers when Live takes one', () => {
    const h = setup({
      cameraIds: ['stand12', 'taxiway-b', 'baggage-area', 'gate-7'],
      maxCameras: 3,
    });
    h.manager.start();
    const refused = h.manager.setEnabled(true);

    assert.equal(refused.refusedReason, 'camera-limit');
    assert.equal(refused.running, false);
    assert.equal(h.created.length, 0);
    assert.equal(h.scheduler.size, 0);
    assert.deepEqual(
      refused.cameras.map((camera) => camera.state),
      ['skipped', 'skipped', 'skipped', 'skipped'],
    );
    assert.equal(refused.cameras[0].skipReason, 'camera-limit');

    const recovered = h.manager.setActiveCamera('stand12');
    assert.equal(recovered.refusedReason, null);
    assert.equal(recovered.running, true);
    assert.equal(h.created.length, 3);
    assert.equal(h.scheduler.size, 1);
    assert.equal(recovered.cameras[0].state, 'active');
  });

  test('refuses on too few cores or an unknown core count', () => {
    const low = setup({ hardwareConcurrency: 2 });
    low.manager.start();
    assert.equal(low.manager.setEnabled(true).refusedReason, 'low-hardware');
    assert.equal(low.created.length, 0);

    const unknown = setup({ hardwareConcurrency: null });
    unknown.manager.start();
    assert.equal(unknown.manager.setEnabled(true).refusedReason, 'hardware-unknown');
    assert.equal(unknown.created.length, 0);

    // Exactly the threshold is allowed: 4 cores runs the three default cameras.
    const edge = setup({ hardwareConcurrency: 4 });
    edge.manager.start();
    const status = edge.manager.setEnabled(true);
    assert.equal(status.refusedReason, null);
    assert.equal(edge.created.length, 3);
  });
});

describe('createBackgroundCameras engine failures', () => {
  test('a factory that throws is retried with exponential backoff and isolates the rest', () => {
    const h = setup({
      cameraIds: ['stand12', 'taxiway-b'],
      engineOptions: (cameraId) => (cameraId === 'stand12' ? { throwFactory: true } : {}),
    });
    h.manager.start();
    h.manager.setEnabled(true);

    const failed = h.cameraState('stand12');
    assert.equal(failed.state, 'backoff');
    assert.equal(failed.attempts, 1);
    assert.equal(failed.failures, 1);
    assert.match(failed.lastError, /worker unavailable/);
    assert.equal(h.cameraState('taxiway-b').state, 'running');
    assert.equal(h.scheduler.size, 1);

    const before = h.callsFor('stand12');
    h.scheduler.tick();
    assert.equal(h.callsFor('stand12'), before);

    h.advance(5000);
    h.scheduler.tick();
    assert.equal(h.callsFor('stand12'), before + 1);
    assert.equal(h.cameraState('stand12').attempts, 2);

    // The second retry is 10 s later, not another 5 s.
    h.advance(9999);
    h.scheduler.tick();
    assert.equal(h.callsFor('stand12'), before + 1);
    h.advance(1);
    h.scheduler.tick();
    assert.equal(h.callsFor('stand12'), before + 2);
  });

  test('recovers on a later retry and resets the attempt counter', () => {
    let failures = 1;
    const h = setup({
      cameraIds: ['stand12'],
      engineOptions: () => {
        if (failures > 0) {
          failures -= 1;
          return { failStart: true };
        }
        return {};
      },
    });
    h.manager.start();
    h.manager.setEnabled(true);
    assert.equal(h.cameraState('stand12').state, 'backoff');

    h.advance(5000);
    h.scheduler.tick();
    const recovered = h.cameraState('stand12');
    assert.equal(recovered.state, 'running');
    assert.equal(recovered.attempts, 0);
    assert.equal(h.createdFor('stand12').length, 2);
  });

  test('an async start rejection becomes a retry, not an unhandled rejection', async () => {
    const h = setup({
      cameraIds: ['stand12'],
      engineOptions: () => ({ rejectStart: true }),
    });
    h.manager.start();
    h.manager.setEnabled(true);
    await new Promise((resolve) => setImmediate(resolve));

    const failed = h.cameraState('stand12');
    assert.equal(failed.state, 'backoff');
    assert.match(failed.lastError, /start rejected/);
    assert.equal(h.scheduler.size, 1);
  });

  test('a reported error backs off; unsupported is exposed and not retried', () => {
    const h = setup({ cameraIds: ['stand12'] });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');

    engine.state.reported = { state: 'error', message: 'detector crashed' };
    h.scheduler.tick();
    const errored = h.cameraState('stand12');
    assert.equal(errored.state, 'backoff');
    assert.match(errored.lastError, /detector crashed/);
    assert.equal(errored.engineStatus.state, 'error');
    assert.equal(engine.state.stops, 1);

    const unsupported = setup({ cameraIds: ['stand12'] });
    unsupported.manager.start();
    unsupported.manager.setEnabled(true);
    const unsupportedEngine = unsupported.engineFor('stand12');
    unsupportedEngine.state.reported = { state: 'unsupported', message: 'no OffscreenCanvas' };
    unsupported.scheduler.tick();

    const exposed = unsupported.cameraState('stand12');
    assert.equal(exposed.state, 'unsupported');
    assert.equal(exposed.lastError, 'no OffscreenCanvas');
    assert.equal(exposed.engineStatus.state, 'unsupported');

    unsupported.advance(600000);
    unsupported.scheduler.tick();
    assert.equal(unsupported.createdFor('stand12').length, 1);
  });

  test('a malformed factory result fails only that camera', () => {
    const h = setup({
      cameraIds: ['stand12', 'taxiway-b'],
      engineOptions: (cameraId) => (cameraId === 'stand12' ? { malformed: true } : {}),
    });
    h.manager.start();
    h.manager.setEnabled(true);
    const camera = h.cameraState('stand12');
    assert.equal(camera.state, 'backoff');
    assert.match(camera.lastError, /must return \{ start, stop, onEvent \}/);
    assert.equal(camera.events, 0);
    assert.equal(h.cameraState('taxiway-b').state, 'running');
    assert.equal(h.createdFor('stand12').length, 0);
  });
});

describe('createBackgroundCameras events', () => {
  test('deduplicates by event_id and delivers at the low-rate pump, not immediately', () => {
    const h = setup({ cameraIds: ['stand12'] });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');
    const event = eventFor('stand12', 1);

    engine.emit(event);
    engine.emit(event);
    assert.equal(h.delivered.length, 0);

    h.scheduler.tick();
    assert.equal(h.delivered.length, 1);
    assert.deepEqual(h.delivered[0], event);
    assert.equal(h.cameraState('stand12').events, 1);
    assert.equal(h.cameraState('stand12').duplicates, 1);

    engine.emit(event);
    h.scheduler.tick();
    assert.equal(h.delivered.length, 1);
    assert.equal(h.cameraState('stand12').duplicates, 2);
  });

  test('caps the queue per camera and counts the drop', () => {
    const h = setup({ cameraIds: ['stand12'], maxQueuedPerCamera: 2 });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');

    engine.emit(eventFor('stand12', 1));
    engine.emit(eventFor('stand12', 2));
    engine.emit(eventFor('stand12', 3));
    h.scheduler.tick();

    assert.equal(h.delivered.length, 2);
    assert.equal(h.cameraState('stand12').dropped, 1);
    assert.equal(h.cameraState('stand12').events, 2);
  });

  test('caps remembered ids per camera, forgetting the oldest at the limit', () => {
    const h = setup({ cameraIds: ['stand12'], maxEventsPerCamera: 2 });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');

    engine.emit(eventFor('stand12', 1));
    engine.emit(eventFor('stand12', 2));
    h.scheduler.tick();
    engine.emit(eventFor('stand12', 3));
    h.scheduler.tick();
    assert.equal(h.delivered.length, 3);

    // id 1 was evicted when id 3 arrived, so it is accepted again. This is the documented
    // cost of a bounded dedupe memory, not a silent second delivery of a recent event.
    engine.emit(eventFor('stand12', 1));
    h.scheduler.tick();
    assert.equal(h.delivered.length, 4);
    assert.equal(h.cameraState('stand12').duplicates, 0);
  });

  test('drops events without an id or from another camera instead of inventing fields', () => {
    const h = setup({ cameraIds: ['stand12', 'taxiway-b'] });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');

    engine.emit({ camera_id: 'stand12', type: 'RESTRICTED_ZONE' });
    engine.emit(eventFor('taxiway-b', 2));
    engine.emit(null);
    h.scheduler.tick();

    assert.equal(h.delivered.length, 0);
    assert.equal(h.cameraState('stand12').invalid, 3);
    assert.equal(h.cameraState('taxiway-b').events, 0);
  });

  test('a throwing consumer is counted and does not starve other cameras', () => {
    const h = setup({
      cameraIds: ['stand12', 'taxiway-b'],
      onEvent: (event) => {
        if (event.camera_id === 'stand12') throw new Error('store failed');
      },
    });
    h.manager.start();
    h.manager.setEnabled(true);

    h.engineFor('stand12').emit(eventFor('stand12', 1));
    h.engineFor('taxiway-b').emit(eventFor('taxiway-b', 1));
    h.scheduler.tick();

    assert.equal(h.delivered.length, 2);
    assert.equal(h.cameraState('stand12').deliveryErrors, 1);
    assert.equal(h.cameraState('taxiway-b').deliveryErrors, 0);
    assert.equal(h.cameraState('taxiway-b').events, 1);
    assert.equal(h.cameraState('stand12').state, 'running');
  });

  test('a late callback from a stopped engine is ignored', () => {
    const h = setup({ cameraIds: ['stand12'] });
    h.manager.start();
    h.manager.setEnabled(true);
    const engine = h.engineFor('stand12');
    const staleListener = engine.state.listeners[0];

    h.manager.stop();
    staleListener(eventFor('stand12', 1));
    h.scheduler.tick();

    assert.equal(h.delivered.length, 0);
  });
});
