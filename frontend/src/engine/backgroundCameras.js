// Background camera orchestration: the pure lifecycle core, with no React, no DOM and no
// worker. The integration layer (hidden <video>, worker factory, context wiring) lives in
// `BACKGROUND.md`; this module only decides when per-camera engines run.
//
// The application can run the private engine for every camera, not only the one Live is
// showing. This manager owns that decision:
//
// - the active camera is skipped, because Live owns its frames and incidents;
// - one engine per camera is built by `engineFactory({ cameraId, zones })`; the factory
//   returns `{ start(), stop(), onEvent(cb) }` (an optional `status()` is also read);
// - events are accepted only if they carry a string `event_id`, are deduplicated per
//   camera and are drained to `onEvent` at a low rate, once per `intervalMs`;
// - a failing engine is isolated: it is stopped, retried with exponential backoff and
//   never throws into the caller;
// - a resource guard refuses the whole run when there are more cameras than `maxCameras`
//   or when the machine is too small for one more ORT session per camera. Partial silent
//   coverage is not offered: a camera without a worker is a blind spot.
//
// Default is **off**. `enabled` starts as `false`; nothing is constructed and no timer is
// armed until the operator calls `setEnabled(true)`. `start()` arms the mount lifecycle and
// `setEnabled()` is the preference, so Settings can flip the option without remounting the
// app; engines run only while both are true.
//
// Low rate has two parts. This module delivers at most once per `intervalMs` (default 2 s),
// which keeps React state writes and event persistence low-rate. The engine itself must
// also sample frames slowly: the factory is expected to build a low-rate engine (see
// `BACKGROUND.md`); buffering alone would still burn a full-rate inference budget.
//
// Testability: `now` and `scheduler` are injected. `scheduler.setInterval(fn, ms)` returns
// a handle and `scheduler.clearInterval(handle)` cancels it, like the globals. Tests call
// the tick by hand, so no wall clock and no global timer patching is needed.

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_CAMERAS = 3;
// One ORT session per worker: below four logical cores a second session fights Live for
// the machine, so the guard refuses instead of degrading the camera the operator watches.
const DEFAULT_MIN_CORES = 4;
const DEFAULT_RETRY_BASE_MS = 5000;
const DEFAULT_RETRY_MAX_MS = 60000;
const DEFAULT_MAX_EVENTS_PER_CAMERA = 200;
const DEFAULT_MAX_QUEUED_PER_CAMERA = 32;

function defaultScheduler() {
  return {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle),
  };
}

/** `navigator.hardwareConcurrency` when the browser exposes it, else null (unknown). */
function readHardwareConcurrency() {
  if (typeof navigator === 'undefined') return null;
  const cores = navigator.hardwareConcurrency;
  return typeof cores === 'number' && Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : null;
}

function requireFunction(value, field) {
  if (typeof value !== 'function') throw new TypeError(`${field} must be a function`);
  return value;
}

function requirePositiveNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
  return value;
}

function requireInteger(value, field, min) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new RangeError(`${field} must be an integer >= ${min}`);
  }
  return value;
}

/** One message for any thrown value; `undefined` must not become `"undefined"` noise. */
function messageOf(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string' && error) return error;
  return 'engine failure';
}

function normalizeCameras(cameras) {
  if (!Array.isArray(cameras)) throw new TypeError('cameras must be an array');
  const seen = new Set();
  return cameras.map((camera, index) => {
    if (camera === null || typeof camera !== 'object') {
      throw new TypeError(`cameras[${index}] must be an object`);
    }
    if (typeof camera.id !== 'string' || camera.id.length === 0) {
      throw new TypeError(`cameras[${index}].id must be a non-empty string`);
    }
    if (seen.has(camera.id)) throw new RangeError(`duplicate camera id: ${camera.id}`);
    seen.add(camera.id);
    return camera;
  });
}

/**
 * Create the background camera manager. See the file header for the rules.
 *
 * `cameras` is the same list the app renders; only `id` and whatever `zonesForCamera`
 * reads are used, so nothing is invented. `zonesForCamera(camera)` is called once per
 * engine start, so a zone edit that triggers a restart is picked up. `onEvent(event)` is
 * called with the engine's own event object, unmodified; the caller adds it to the
 * incident store.
 *
 * @param {object} options
 * @param {Array<{id: string}>} [options.cameras=[]] Cameras known to the app.
 * @param {(camera: object) => Array<object>} [options.zonesForCamera] Zones handed to one
 *   camera's engine; the engine start is the only place they are read.
 * @param {(input: {cameraId: string, zones: Array<object>}) => {
 *   start: () => void|Promise<void>,
 *   stop: () => void,
 *   onEvent: (cb: (event: object) => void) => (void|(() => void)),
 *   status?: () => ({state?: string, message?: string}|undefined),
 * }} options.engineFactory Builds one engine; may throw, which becomes a retry.
 * @param {number} [options.intervalMs=2000] Low-rate pump: event delivery and retries.
 * @param {number} [options.maxCameras=3] Most background engines in one run.
 * @param {(event: object) => void} [options.onEvent] Accepted incidents, one per call.
 * @param {() => number} [options.now] Clock in epoch milliseconds, for backoff.
 * @param {number} [options.minHardwareConcurrency=4] Cores required before any engine runs.
 * @param {number|null} [options.hardwareConcurrency] Override the machine's core count.
 * @param {number} [options.retryBaseMs=5000] First retry delay after a failure.
 * @param {number} [options.retryMaxMs=60000] Backoff ceiling.
 * @param {number} [options.maxEventsPerCamera=200] Remembered event ids per camera; the
 *   oldest id is forgotten first, so a duplicate older than that can be accepted again.
 * @param {number} [options.maxQueuedPerCamera=32] Events buffered between two pumps; past
 *   that the event is dropped and counted.
 * @param {{setInterval: Function, clearInterval: Function}} [options.scheduler] Timer
 *   injection for tests.
 * @returns {{
 *   start: () => object,
 *   stop: () => object,
 *   setEnabled: (enabled: boolean) => object,
 *   setActiveCamera: (cameraId: string|null) => object,
 *   status: () => {
 *     enabled: boolean,
 *     running: boolean,
 *     refusedReason: string|null,
 *     cameras: Array<object>,
 *   },
 * }}
 * @throws {TypeError|RangeError} An option has the wrong type or shape.
 */
export function createBackgroundCameras({
  cameras = [],
  zonesForCamera = () => [],
  engineFactory,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxCameras = DEFAULT_MAX_CAMERAS,
  onEvent = () => {},
  now = () => Date.now(),
  minHardwareConcurrency = DEFAULT_MIN_CORES,
  hardwareConcurrency = readHardwareConcurrency(),
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  maxEventsPerCamera = DEFAULT_MAX_EVENTS_PER_CAMERA,
  maxQueuedPerCamera = DEFAULT_MAX_QUEUED_PER_CAMERA,
  scheduler = defaultScheduler(),
} = {}) {
  requireFunction(engineFactory, 'engineFactory');
  requireFunction(zonesForCamera, 'zonesForCamera');
  requireFunction(onEvent, 'onEvent');
  requireFunction(now, 'now');
  requirePositiveNumber(intervalMs, 'intervalMs');
  requirePositiveNumber(retryBaseMs, 'retryBaseMs');
  requirePositiveNumber(retryMaxMs, 'retryMaxMs');
  requireInteger(maxCameras, 'maxCameras', 0);
  requireInteger(minHardwareConcurrency, 'minHardwareConcurrency', 1);
  requireInteger(maxEventsPerCamera, 'maxEventsPerCamera', 1);
  requireInteger(maxQueuedPerCamera, 'maxQueuedPerCamera', 1);
  if (retryMaxMs < retryBaseMs) throw new RangeError('retryMaxMs must be >= retryBaseMs');
  if (scheduler === null || typeof scheduler !== 'object') {
    throw new TypeError('scheduler must be an object');
  }
  requireFunction(scheduler.setInterval, 'scheduler.setInterval');
  requireFunction(scheduler.clearInterval, 'scheduler.clearInterval');

  const normalizedCameras = normalizeCameras(cameras);
  const cores = typeof hardwareConcurrency === 'number' && Number.isFinite(hardwareConcurrency)
    ? Math.floor(hardwareConcurrency)
    : null;

  /** @type {Array<object>} One entry per camera, in input order, for a complete status. */
  const entries = normalizedCameras.map((camera) => ({
    id: camera.id,
    camera,
    state: 'stopped',
    engine: null,
    unsubscribe: null,
    attempts: 0,
    retryAt: 0,
    lastError: null,
    skipReason: null,
    engineStatus: null,
    seen: new Set(),
    seenOrder: [],
    queue: [],
    counts: {
      events: 0,
      duplicates: 0,
      dropped: 0,
      invalid: 0,
      failures: 0,
      deliveryErrors: 0,
    },
  }));

  let started = false;
  let enabled = false;
  let activeCameraId = null;
  let refusedReason = null;
  let timer = null;

  function isEligible(entry) {
    return entry.id !== activeCameraId;
  }

  function setState(entry, state) {
    entry.state = state;
  }

  function armTimer() {
    if (timer !== null) return;
    timer = scheduler.setInterval(pump, intervalMs);
  }

  function disarmTimer() {
    if (timer === null) return;
    scheduler.clearInterval(timer);
    timer = null;
  }

  /** Drop the engine and its subscription; never let a crashing stop escape. */
  function teardown(entry, { keepQueue = false } = {}) {
    const engine = entry.engine;
    entry.engine = null;
    // `engineStatus` is kept: after a failure it is the evidence status() reports. It is
    // cleared when the next engine is built, not when this one goes away.
    if (!keepQueue) entry.queue = [];
    if (typeof entry.unsubscribe === 'function') {
      const unsubscribe = entry.unsubscribe;
      entry.unsubscribe = null;
      try {
        unsubscribe();
      } catch {
        // A broken unsubscribe must not keep the camera from being reset.
      }
    }
    if (engine) {
      try {
        const stopping = engine.stop();
        // An async stop is fire-and-forget: the engine is already unreachable here.
        if (stopping && typeof stopping.catch === 'function') stopping.catch(() => {});
      } catch {
        // Same: stop() is teardown, not a health signal.
      }
    }
  }

  function backoffFor(attempts) {
    const delay = retryBaseMs * 2 ** Math.max(0, attempts - 1);
    return Math.min(retryMaxMs, delay);
  }

  function fail(entry, error) {
    entry.lastError = messageOf(error);
    entry.counts.failures += 1;
    // Events already accepted before the failure are still real incidents; keep them.
    teardown(entry, { keepQueue: true });
    if (!started || !enabled || refusedReason) {
      setState(entry, 'stopped');
      return;
    }
    entry.attempts += 1;
    entry.retryAt = now() + backoffFor(entry.attempts);
    setState(entry, 'backoff');
  }

  function remember(entry, eventId) {
    entry.seen.add(eventId);
    entry.seenOrder.push(eventId);
    while (entry.seenOrder.length > maxEventsPerCamera) {
      entry.seen.delete(entry.seenOrder.shift());
    }
  }

  function handleEvent(entry, engine, payload) {
    // A callback from an engine that has already been stopped or replaced is stale.
    if (entry.engine !== engine || !started || !enabled) return;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      entry.counts.invalid += 1;
      return;
    }
    const eventId = payload.event_id;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      // No id means no dedupe and no safe merge into the incident store: drop it instead
      // of inventing a field the engine did not produce.
      entry.counts.invalid += 1;
      return;
    }
    if (typeof payload.camera_id === 'string' && payload.camera_id !== entry.id) {
      // One camera's engine must never contribute incidents to another camera.
      entry.counts.invalid += 1;
      return;
    }
    if (entry.seen.has(eventId)) {
      entry.counts.duplicates += 1;
      return;
    }
    remember(entry, eventId);
    if (entry.queue.length >= maxQueuedPerCamera) {
      // The pump keeps up at one delivery per interval; a queue this long means the
      // consumer is stuck. Losing the newest event is visible in status, not silent.
      entry.counts.dropped += 1;
      return;
    }
    entry.queue.push(payload);
  }

  function reportStatus(entry) {
    const engine = entry.engine;
    if (!engine || typeof engine.status !== 'function') return;
    let reported;
    try {
      reported = engine.status();
    } catch (error) {
      fail(entry, error);
      return;
    }
    if (reported === null || typeof reported !== 'object') return;
    entry.engineStatus = reported;
    if (reported.state === 'unsupported') {
      // No retry: the browser or the model set cannot support this engine at all.
      entry.lastError = typeof reported.message === 'string' ? reported.message : 'unsupported';
      teardown(entry, { keepQueue: true });
      setState(entry, 'unsupported');
      return;
    }
    if (reported.state === 'error') {
      fail(entry, new Error(typeof reported.message === 'string' ? reported.message : 'engine error'));
      return;
    }
    if (reported.state === 'running' && entry.state === 'starting') {
      setState(entry, 'running');
    }
  }

  function drain(entry) {
    if (entry.queue.length === 0) return;
    const queued = entry.queue;
    entry.queue = [];
    for (const event of queued) {
      if (!started || !enabled) break;
      try {
        onEvent(event);
        entry.counts.events += 1;
      } catch {
        // One bad consumer must not starve the other cameras.
        entry.counts.deliveryErrors += 1;
      }
    }
  }

  function pump() {
    if (!started || !enabled || refusedReason) return;
    for (const entry of entries) {
      if (entry.state === 'backoff' && now() >= entry.retryAt) startEntry(entry);
    }
    for (const entry of entries) {
      reportStatus(entry);
      drain(entry);
    }
  }

  function startEntry(entry) {
    if (!started || !enabled || refusedReason) return;
    if (!isEligible(entry) || entry.engine) return;
    if (entry.state === 'unsupported') return;
    if (entry.state === 'backoff' && now() < entry.retryAt) return;

    entry.skipReason = null;
    entry.engineStatus = null;
    setState(entry, 'starting');

    let engine;
    try {
      const zones = zonesForCamera(entry.camera);
      engine = engineFactory({ cameraId: entry.id, zones });
    } catch (error) {
      fail(entry, error);
      return;
    }
    if (
      engine === null
      || typeof engine !== 'object'
      || typeof engine.start !== 'function'
      || typeof engine.stop !== 'function'
      || typeof engine.onEvent !== 'function'
    ) {
      fail(entry, new Error('engineFactory must return { start, stop, onEvent }'));
      return;
    }

    entry.engine = engine;
    try {
      // Subscribe before start so an engine that emits during startup is not missed.
      const unsubscribe = engine.onEvent((payload) => handleEvent(entry, engine, payload));
      if (typeof unsubscribe === 'function') entry.unsubscribe = unsubscribe;
      const starting = engine.start();
      if (starting && typeof starting.then === 'function') {
        starting.then(
          () => {
            if (entry.engine !== engine) return;
            entry.attempts = 0;
            setState(entry, 'running');
          },
          (error) => {
            if (entry.engine === engine) fail(entry, error);
          },
        );
      } else {
        entry.attempts = 0;
        setState(entry, 'running');
      }
    } catch (error) {
      if (entry.engine === engine) fail(entry, error);
    }
  }

  function computeRefusal() {
    if (entries.every((entry) => !isEligible(entry))) return null;
    if (cores === null) return 'hardware-unknown';
    if (cores < minHardwareConcurrency) return 'low-hardware';
    const eligibleCount = entries.filter(isEligible).length;
    if (eligibleCount > maxCameras) return 'camera-limit';
    return null;
  }

  function reconcile() {
    if (!started || !enabled) {
      disarmTimer();
      refusedReason = null;
      for (const entry of entries) {
        teardown(entry);
        entry.skipReason = isEligible(entry) ? null : 'active-camera';
        entry.lastError = null;
        entry.engineStatus = null;
        setState(entry, isEligible(entry) ? 'stopped' : 'active');
      }
      return;
    }

    refusedReason = computeRefusal();
    if (refusedReason) disarmTimer();
    else armTimer();

    for (const entry of entries) {
      if (!isEligible(entry)) {
        teardown(entry);
        entry.skipReason = 'active-camera';
        entry.lastError = null;
        entry.engineStatus = null;
        setState(entry, 'active');
        continue;
      }
      entry.skipReason = refusedReason;
      if (refusedReason) {
        if (entry.engine) teardown(entry);
        entry.lastError = null;
        entry.engineStatus = null;
        setState(entry, 'skipped');
        continue;
      }
      // A cleared refusal means the camera may be tried again.
      if (entry.state === 'skipped') setState(entry, 'stopped');
      if (!entry.engine && entry.state !== 'unsupported' && entry.state !== 'backoff') {
        startEntry(entry);
      }
    }
  }

  /**
   * Arm the manager. Idempotent. Engines still start only when `setEnabled(true)` has been
   * called (the feature is off by default).
   * @returns {object} `status()`.
   */
  function start() {
    if (started) return status();
    started = true;
    reconcile();
    return status();
  }

  /**
   * Stop every engine, clear the timer and reset the per-camera state. Idempotent.
   * The enabled preference is kept: a later `start()` resumes it.
   * @returns {object} `status()`.
   */
  function stop() {
    disarmTimer();
    started = false;
    for (const entry of entries) {
      teardown(entry);
      entry.skipReason = null;
      entry.lastError = null;
      entry.engineStatus = null;
      setState(entry, 'stopped');
    }
    refusedReason = null;
    return status();
  }

  /**
   * Operator preference. `false` stops every background engine at once; `true` starts them
   * when the manager has also been started and the resource guard allows it.
   * @param {boolean} next
   * @returns {object} `status()`.
   */
  function setEnabled(next) {
    const value = Boolean(next);
    if (value === enabled) return status();
    enabled = value;
    reconcile();
    return status();
  }

  /**
   * Tell the manager which camera Live owns. Passing `null` (Live unmounted, engine off
   * or fullscreen) lets every camera run. The manager never starts an engine for the
   * active camera, so the same frames are not processed twice.
   * @param {string|null} cameraId
   * @returns {object} `status()`.
   */
  function setActiveCamera(cameraId) {
    if (cameraId !== null && (typeof cameraId !== 'string' || cameraId.length === 0)) {
      throw new TypeError('active camera id must be a non-empty string or null');
    }
    if (cameraId === activeCameraId) return status();
    activeCameraId = cameraId;
    reconcile();
    return status();
  }

  /**
   * Current state. `running` means the manager is supervising (started, enabled and not
   * refused); per-camera `state` says whether that camera's engine is up.
   * @returns {{enabled: boolean, running: boolean, refusedReason: string|null,
   *   cameras: Array<object>}}
   */
  function status() {
    return {
      enabled,
      running: started && enabled && refusedReason === null && timer !== null,
      refusedReason,
      cameras: entries.map((entry) => ({
        id: entry.id,
        state: entry.state,
        events: entry.counts.events,
        duplicates: entry.counts.duplicates,
        dropped: entry.counts.dropped,
        invalid: entry.counts.invalid,
        failures: entry.counts.failures,
        deliveryErrors: entry.counts.deliveryErrors,
        attempts: entry.attempts,
        lastError: entry.lastError,
        skipReason: entry.skipReason,
        engineStatus: entry.engineStatus,
      })),
    };
  }

  return { start, stop, setEnabled, setActiveCamera, status };
}

export default createBackgroundCameras;
