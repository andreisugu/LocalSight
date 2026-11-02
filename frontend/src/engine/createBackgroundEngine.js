// One hidden, low-rate engine for a camera the Live view is not showing.
//
// The manager in `backgroundCameras.js` decides *which* cameras run; this file owns the
// pixels for one of them. It creates an off-screen <video> from the camera's demo clip, one
// `worker.js` session and a 2 s pump that feeds a single frame at a time. That is ~0.5
// inferences per second, not the Live overlay's display rate: the point is incident
// coverage while the operator is on another screen, not smooth video.
//
// Why a worker per camera: one ORT session would serialize every camera behind one queue
// and a crash in one clip would take the others with it. The cost is one session per
// camera, which is exactly what the Settings warning describes.
//
// Sampling lives on the page, not in `worker.js`. The worker is untouched: it answers a
// `frame` with a `result`, and this factory closes the returned bitmap without drawing it.
// Nothing here is shown, recorded or uploaded; snapshots are page-owned blob URLs, created
// exactly like `useEngine` does, and the head-band blur is forced ON for backgrounds
// because nobody is watching these feeds live.

import { demoClipFor, parseList } from '../components/live/liveMedia.js';
import { readEngineSettings } from '../utils/engineSettings.js';

/** One frame every two seconds, for both the page pump and the manager's delivery pump. */
export const BACKGROUND_INTERVAL_MS = 2000;
/** Frame cap for the hidden copy between threads; the detector resizes to its own input. */
export const BACKGROUND_INPUT_SIZE = 640;
/** A paused demo clip is restarted; no frame loop, so this is the only liveness check. */
const WATCHDOG_MS = 5000;

function readEnv(name) {
  try {
    const env = import.meta.env;
    return env ? env[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The clip URL a background engine would decode. Reuses the Live resolution rules instead
 * of keeping a second table: `VITE_MEDIA_VIDEO` wins, then `VITE_DEMO_CLIP`, then the
 * seeded `media/<id>.mp4`. Returns null when the id cannot name a file.
 *
 * @param {string} cameraId
 * @param {{baseUrl?: string, clipEntries?: string[]}} [options]
 * @returns {string|null}
 */
export function backgroundVideoSource(cameraId, { baseUrl, clipEntries } = {}) {
  if (typeof cameraId !== 'string' || cameraId.length === 0) return null;
  const base = baseUrl ?? readEnv('BASE_URL') ?? '/';
  const entries = clipEntries ?? parseList(readEnv('VITE_DEMO_CLIP'));
  const override = String(readEnv('VITE_MEDIA_VIDEO') || '').trim();
  const entry = demoClipFor(cameraId, entries);
  return override || entry || `${base}media/${cameraId}.mp4`;
}

/**
 * A browser can decode this URL without leaving the origin. Network `rtsp://` rows and a
 * cross-origin media override are not playable here, and the engine reports them as
 * unsupported instead of pretending a real camera feed is being processed.
 *
 * @param {string|null} url
 * @param {string} [origin]
 * @returns {boolean}
 */
export function isPlayableSameOriginClip(url, origin) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const pageOrigin = origin || (typeof window === 'undefined' ? null : window.location.origin);
    if (!pageOrigin) return false;
    const parsed = new URL(url, pageOrigin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.origin === pageOrigin;
  } catch {
    return false;
  }
}

/**
 * Build one background engine.
 *
 * The returned object is exactly what `createBackgroundCameras` expects:
 * `{ start, stop, onEvent, status }`. `status().state` is `loading`, `running`, `error` or
 * `unsupported`; the manager turns `error` into a retry and never retries `unsupported`.
 *
 * @param {{
 *   cameraId: string,
 *   zones?: Array<object>,
 *   referenceUrl?: string|null,
 *   intervalMs?: number,
 *   videoSource?: string|null,
 *   detector?: string,
 * }} options
 * @returns {{start: () => void, stop: () => void,
 *   onEvent: (cb: (event: object) => void) => () => void,
 *   status: () => {state: string, message: string, frames: number, events: number,
 *     ms: number, fps: number}}}
 */
export function createBackgroundEngine({
  cameraId,
  zones = [],
  referenceUrl = null,
  intervalMs = BACKGROUND_INTERVAL_MS,
  videoSource,
  detector,
} = {}) {
  let video = null;
  let worker = null;
  let pumpTimer = null;
  let watchdogTimer = null;
  let listener = null;
  let inFlight = false;
  let modelReady = false;
  let disposed = false;
  let started = false;
  let state = 'idle';
  let message = '';
  let frames = 0;
  let events = 0;
  let readFailures = 0;
  let lastMs = 0;
  let lastFps = 0;
  // URLs created for events that have not been handed to the listener yet. A handed URL
  // belongs to the incident store, exactly like Live's: the incident keeps rendering after
  // this engine is stopped. Only the undelivered ones are revoked here.
  const undeliveredUrls = new Set();

  const status = () => ({
    state,
    message,
    frames,
    events,
    ms: lastMs,
    fps: lastFps,
  });

  const clipUrl = videoSource === undefined
    ? backgroundVideoSource(cameraId)
    : videoSource;
  // Same Settings value Live uses. A caller may pass one (read once when the manager was
  // built); without it the stored choice is read here, at start, so a background camera
  // never silently falls back to a detector the operator did not pick.
  const personDetector = detector ?? readEngineSettings().detector;

  const unsupported = (reason) => {
    state = 'unsupported';
    message = reason;
    return { start: () => {}, stop: () => {}, onEvent: () => () => {}, status };
  };

  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return unsupported(
      'Browserul nu poate rula motorul privat (Worker sau OffscreenCanvas lipsește).'
    );
  }
  if (!isPlayableSameOriginClip(clipUrl)) {
    return unsupported(
      'Sursa nu este un clip same-origin redabil; camera nu rulează în fundal.'
    );
  }

  function deliver(event) {
    const url = event?.snapshot_url;
    if (listener) {
      try {
        listener(event);
        events += 1;
        if (typeof url === 'string' && undeliveredUrls.delete(url)) {
          // The incident store owns this URL from here on.
        }
        return;
      } catch {
        // A consumer that throws must not kill the worker message handler; fall through
        // and release a URL nobody accepted.
      }
    }
    // No consumer: do not let a page-owned URL outlive the engine.
    if (typeof url === 'string' && undeliveredUrls.has(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // A revoked URL is already gone.
      }
      undeliveredUrls.delete(url);
    }
  }

  function handleResult(payload) {
    inFlight = false;
    if (disposed) return;
    if (Number.isFinite(payload.ms)) lastMs = payload.ms;
    if (Number.isFinite(payload.fps)) lastFps = payload.fps;
    state = 'running';
    message = typeof payload.error === 'string' ? payload.error : '';
    // No canvas, no draw: the processed pixels are not presented anywhere.
    payload.bitmap?.close?.();

    const incoming = Array.isArray(payload.events) ? payload.events : [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') {
        deliver(raw);
        continue;
      }
      if (!raw.snapshot_blob) {
        deliver(raw);
        continue;
      }
      const { snapshot_blob: blob, ...rest } = raw;
      let url = null;
      try {
        url = URL.createObjectURL(blob);
      } catch {
        deliver(rest);
        continue;
      }
      undeliveredUrls.add(url);
      deliver({ ...rest, snapshot_url: url });
    }
  }

  function onWorkerMessage(event) {
    if (disposed) return;
    const payload = event.data || {};
    if (payload.type === 'result') {
      handleResult(payload);
      return;
    }
    if (payload.type === 'ready') {
      modelReady = true;
      if (state !== 'running') {
        state = 'running';
        message = 'modele încărcate';
      }
      return;
    }
    if (payload.type === 'status') {
      if (!modelReady) {
        state = 'loading';
        message = typeof payload.stage === 'string' ? payload.stage : 'se încarcă';
      }
      return;
    }
    if (payload.type === 'error') {
      inFlight = false;
      state = 'error';
      message = typeof payload.message === 'string' ? payload.message : 'eroare în worker';
    }
  }

  function pump() {
    if (disposed || !started || inFlight || !modelReady || !video) return;
    // A tab that never decoded a frame or a clip that is still buffering has nothing to
    // post; the watchdog keeps the clip playing and the next tick tries again.
    if (video.readyState < 2 || !video.videoWidth) return;
    inFlight = true;
    createImageBitmap(video)
      .then((bitmap) => {
        if (disposed || !worker) {
          bitmap.close();
          inFlight = false;
          return;
        }
        worker.postMessage(
          {
            type: 'frame',
            bitmap,
            timestamp: performance.now(),
            mediaTime: video.currentTime,
          },
          [bitmap],
        );
        frames += 1;
        readFailures = 0;
      })
      .catch((error) => {
        inFlight = false;
        readFailures += 1;
        // One decode hiccup is not a dead camera: the next tick retries. Five in a row
        // means the element cannot produce frames, and the manager should rebuild it.
        message = error instanceof Error ? error.message : 'cadrul nu a putut fi citit';
        if (readFailures >= 5) state = 'error';
      });
  }

  function createVideo() {
    const element = document.createElement('video');
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.loop = true;
    element.preload = 'auto';
    element.tabIndex = -1;
    element.setAttribute('aria-hidden', 'true');
    element.dataset.backgroundCamera = cameraId;
    // Off-screen, but not `display: none`: Chromium may stop decoding a hidden element,
    // and this element exists only to hand frames to the worker.
    Object.assign(element.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    });
    element.src = clipUrl;
    element.addEventListener('error', () => {
      state = 'unsupported';
      message = 'Clipul demo nu poate fi redat; camera nu rulează în fundal.';
    });
    document.body.appendChild(element);
    return element;
  }

  function start() {
    if (disposed || started) return;
    started = true;
    state = 'loading';
    message = 'se pregătește';
    try {
      video = createVideo();
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      state = 'error';
      message = error instanceof Error ? error.message : 'worker-ul nu a pornit';
      stop();
      return;
    }
    worker.onmessage = onWorkerMessage;
    worker.onerror = (event) => {
      if (disposed) return;
      inFlight = false;
      state = 'error';
      message = event.message || 'worker-ul motorului a picat';
    };
    worker.postMessage({
      type: 'init',
      cameraId,
      zones,
      // The camera switch on the Live card is not an operator decision for this option: a
      // background worker exists for safety coverage, so it always runs the zone rules.
      engineOn: true,
      // One thread per background session: Live keeps its 4. More would fight Live for
      // the same cores while the operator is watching a different camera.
      wasmThreads: 1,
      // Forced, even if Settings turned the safety blur off: nobody watches this feed, so a
      // missed profile must still be covered. The worker fails closed on blur errors.
      safetyBlur: true,
      // EfficientDet-Lite0 unless Settings picked Lite2: the same two graphs Live ships.
      detector: personDetector,
      inputSize: BACKGROUND_INPUT_SIZE,
      referenceUrl: referenceUrl || undefined,
      // Providers default to the worker's probe; a background session must not demand
      // WebGPU and then retry the whole camera on another path.
    });
    video.play().catch((error) => {
      // Autoplay is allowed because the element is muted; a refusal is reported, and the
      // watchdog retries once the page is interacted with.
      if (disposed) return;
      state = 'error';
      message = error instanceof Error ? error.message : 'redarea clipului nu a pornit';
    });
    pumpTimer = setInterval(pump, intervalMs);
    watchdogTimer = setInterval(() => {
      if (disposed || !video) return;
      if (video.paused && video.readyState >= 2) video.play().catch(() => {});
    }, WATCHDOG_MS);
  }

  function stop() {
    if (disposed) return;
    disposed = true;
    started = false;
    if (pumpTimer !== null) clearInterval(pumpTimer);
    if (watchdogTimer !== null) clearInterval(watchdogTimer);
    pumpTimer = null;
    watchdogTimer = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      } catch {
        // A detached element is already gone.
      }
      video = null;
    }
    for (const url of undeliveredUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Already revoked.
      }
    }
    undeliveredUrls.clear();
    // Handed snapshot URLs stay alive on purpose: they belong to incidents already in the
    // list, exactly like Live's. Revoking here would blank their evidence for the session.
    if (state !== 'unsupported' && state !== 'error') state = 'stopped';
    inFlight = false;
  }

  function onEvent(callback) {
    listener = typeof callback === 'function' ? callback : null;
    return () => {
      if (listener === callback) listener = null;
    };
  }

  return { start, stop, onEvent, status };
}

export default createBackgroundEngine;
