// Owns the engine worker and feeds it frames from a <video>. React only sees the numbers
// the overlay prints; the pixels go straight from the worker's ImageBitmap to the canvas.
import { useEffect, useRef, useState } from 'react';
import { readEngineSettings, resolveWasmThreads } from '../utils/engineSettings.js';

const INITIAL_STATS = {
  fps: 0,
  persons: 0,
  faces: 0,
  ms: 0,
  // What the worker's PPE colour pass saw in the last frame: tracks with a vest, tracks
  // provably without one, tracks not judgeable yet. Rendered by nobody while the overlay
  // is being rewritten; the numbers are already here so the UI can show them.
  vest: { vest: 0, noVest: 0, unknown: 0 },
  status: 'idle',
  message: '',
  providers: [],
  actualProviders: [],
  events: [],
  totalEvents: 0,
};

// The overlay shows the last few incidents; the hook keeps a short history so the panel
// can render after the frame that produced the event is long gone.
const MAX_EVENTS = 50;

// The worker can return a frame every 16 ms; re-rendering the overlay that often is waste.
const STATS_INTERVAL_MS = 250;

// A <video> fed by a MediaStream has no duration and never seeks: the only thing that says
// "new frames are coming" is the media pipeline itself, so the loop is restarted from these
// events instead of being started once. Swapping src/srcObject restarts it the same way.
const LOOP_EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'resize', 'seeked'];

// Some browsers stay quiet after a device swap or a track mute: one cheap check keeps the
// loop alive without polling frames.
const LOOP_WATCHDOG_MS = 1000;
// A WebGPU session that is still "loading" after this long is treated as wedged, not slow:
// the worker is terminated (it may be blocked synchronously) and rebuilt on wasm.
const ENGINE_STALL_MS = 30_000;
// A cold first visit downloads ~38.9 MB (28.7 MB ORT wasm + 9.9 MB YOLO) before the
// worker can say `ready`; on venue wifi that legitimately takes minutes. The old timer
// started at worker creation and killed such a worker as if WebGPU had wedged. The ready
// timeout is generous; the 30 s stall timer only starts after `ready`.
const ENGINE_READY_TIMEOUT_MS = 180_000;

/**
 * @param {{ videoRef: import('react').RefObject<HTMLVideoElement>,
 *           canvasRef: import('react').RefObject<HTMLCanvasElement>,
 *           enabled?: boolean,
 *           provider?: 'webgpu'|'wasm',
 *           inputSize?: number,
 *           onSample?: (sample: {ms: number, fps: number, persons: number, faces: number,
 *                               error?: string|null, at: number}) => void }} options
 *
 * `provider`/`inputSize` are bench-only knobs. Omitting both sends the same init message
 * the spike always sent, so `/lab` is untouched. `onSample` sees every result frame; the
 * 250 ms state throttle above is for overlays, not for measurement.
 *
 * `zones`, `engineOn` and `cameraId` sunt configurația Live: zonele vin deja în forma din
 * contract (poligon `[[x, y], ...]`), iar worker-ul le folosește la construirea pipeline-ului.
 * `/lab` și `/bench` nu le trimit, deci rămân pe fixture-ul lor. Modificările de zone nu
 * repornesc worker-ul: ajung ca mesaj `config` și se aplică pe loc.
 */
export function useEngine({
  videoRef,
  canvasRef,
  enabled = true,
  provider,
  inputSize,
  onSample,
  zones,
  engineOn,
  cameraId,
}) {
  const [stats, setStats] = useState(INITIAL_STATS);
  // Settings live on the main thread. Reading them on every render (a tiny localStorage
  // read) is what makes the resolved thread count an effect dependency: changing it in
  // Settings tears the worker down and starts a new one with the new count, instead of
  // trying to reconfigure ORT in place (which it does not support).
  const engineSettings = readEngineSettings();
  const wasmThreads = resolveWasmThreads(engineSettings.wasmThreads, {
    crossOriginIsolated: typeof globalThis !== 'undefined' && Boolean(globalThis.crossOriginIsolated),
    hardwareConcurrency: typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
  });
  const { safetyBlur } = engineSettings;
  // Set only by the stall watchdog: a provider that never produced a frame is abandoned
  // for wasm, which is observable and safe. A deliberate `provider` prop still wins when
  // the caller changes it (the bench page).
  const [forcedProvider, setForcedProvider] = useState(null);
  const effectiveProvider = forcedProvider || provider;
  const lastStatsRef = useRef(0);
  // The callback changes on every render; keeping it in a ref avoids restarting the worker
  // (and reloading the graphs) just because the caller re-rendered.
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  // Configurația se citește din ref la init, ca efectul principal să nu depindă de ea.
  // Așa o schimbare de zone nu mai repornește worker-ul (și nu reîncarcă graficele ONNX).
  const configRef = useRef({ zones, engineOn, cameraId });
  configRef.current = { zones, engineOn, cameraId };
  const workerRef = useRef(null);

  useEffect(() => {
    setForcedProvider(null);
  }, [provider]);

  useEffect(() => {
    if (!enabled) {
      // Nothing to feed: clear the old numbers so the overlay never claims a running engine.
      setStats(INITIAL_STATS);
      return undefined;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      // No worker or no offscreen canvas means no blur: this browser cannot run the private
      // engine at all, so no run is started. The raw feed must never be presented as the
      // processed one (the view hides the video while the engine is requested).
      setStats({
        ...INITIAL_STATS,
        status: 'unsupported',
        message:
          'Acest browser nu poate rula motorul privat (Worker sau OffscreenCanvas lipsește); '
          + 'fluxul brut nu este afișat ca procesat.',
      });
      return undefined;
    }

    let worker;
    try {
      // Vite bundles the worker (and its onnxruntime-web import) as a separate chunk.
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      setStats({ ...INITIAL_STATS, status: 'error', message: error.message });
      return undefined;
    }
    workerRef.current = worker;

    let disposed = false;
    let inFlight = false;
    let receivedFrame = false;
    let modelReady = false;
    let readyTimer = null;
    let stallTimer = null;
    // The worker outlives a source swap on purpose: recreating it would reload the ONNX
    // graphs. Only the frame loop is torn down and restarted.
    let loopActive = false;
    let videoFrameHandle = 0;
    let rafHandle = 0;

    const draw = (bitmap) => {
      // A worker that cannot blur sends a placeholder bitmap, never a missing one. If a
      // result still arrives without pixels, the last processed frame stays on screen: the
      // canvas is only ever painted from the worker, so nothing raw can appear here.
      if (!bitmap) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        bitmap.close();
        return;
      }
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    };

    worker.onmessage = (event) => {
      if (disposed) return;
      const message = event.data || {};
      if (message.type === 'result') {
        inFlight = false;
        receivedFrame = true;
        draw(message.bitmap);
        const at = performance.now();
        onSampleRef.current?.({
          ms: message.ms,
          fps: message.fps,
          persons: message.persons,
          faces: message.faces,
          error: message.error || null,
          at,
        });
        // Incidents must never wait for the stats throttle: a frame budget without an
        // event is still a frame, but an event that arrives late looks like a miss.
        // The worker cannot own the snapshot URL: its blob URLs die with the worker, and
        // opening an incident unmounts Live. The page creates the URL here and keeps the
        // Blob out of the event so only a string reaches the context.
        const incoming = (Array.isArray(message.events) ? message.events : []).map((event) => {
          if (!event || !event.snapshot_blob) return event;
          const { snapshot_blob: blob, ...rest } = event;
          try {
            return { ...rest, snapshot_url: URL.createObjectURL(blob) };
          } catch {
            return rest;
          }
        });
        const now = performance.now();
        if (incoming.length === 0 && now - lastStatsRef.current < STATS_INTERVAL_MS) return;
        lastStatsRef.current = now;
        setStats((previous) => ({
          ...previous,
          fps: message.fps,
          persons: message.persons,
          faces: message.faces,
          ms: message.ms,
          // A frame without the key (an older worker) keeps the last counts instead of
          // flashing zeros; the worker always sends the three numbers today.
          vest: message.vest || previous.vest,
          // Newest first. The worker sends the events of one frame in rule order; a
          // functional update keeps a re-render from appending the same batch twice.
          events: incoming.length
            ? [...incoming.slice().reverse(), ...previous.events].slice(0, MAX_EVENTS)
            : previous.events,
          totalEvents: previous.totalEvents + incoming.length,
          // A frame can arrive while the graphs are missing; keep saying so instead of
          // pretending the engine is healthy.
          status: message.error ? 'error' : 'running',
          message: message.error ? message.error : previous.message,
        }));
        return;
      }
      if (message.type === 'ready') {
        modelReady = true;
        if (readyTimer) clearTimeout(readyTimer);
        if (!stallTimer) {
          stallTimer = setTimeout(() => {
            if (disposed || receivedFrame || effectiveProvider === 'wasm') return;
            console.warn('[engine] ready but no frame after 30 s; restarting on wasm');
            setForcedProvider('wasm');
          }, ENGINE_STALL_MS);
        }
        setStats((previous) => ({
          ...previous,
          status: 'loading',
          providers: message.providers || [],
          actualProviders: message.actualProviders || [],
        }));
        return;
      }
      if (message.type === 'status') {
        setStats((previous) => ({ ...previous, status: 'loading', message: message.stage }));
        return;
      }
      if (message.type === 'error') {
        inFlight = false;
        setStats((previous) => ({ ...previous, status: 'error', message: message.message }));
      }
    };

    worker.onerror = (event) => {
      if (disposed) return;
      inFlight = false;
      setStats((previous) => ({
        ...previous,
        status: 'error',
        message: event.message || 'worker-ul motorului a picat',
      }));
    };

    const cancelLoopHandles = () => {
      if (videoFrameHandle && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrameHandle);
      }
      videoFrameHandle = 0;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    };

    const tick = () => {
      videoFrameHandle = 0;
      rafHandle = 0;
      if (disposed || !loopActive) return;
      schedule();
      // Drop the frame while the worker is busy: latency must not grow without bound.
      if (inFlight || !video.videoWidth || video.readyState < 2) return;
      inFlight = true;
      createImageBitmap(video)
        .then((bitmap) => {
          if (disposed) {
            bitmap.close();
            inFlight = false;
            return;
          }
          // `timestamp` stays the wall clock for anything that already read it; the
          // pipeline runs on `mediaTime`, the position in the footage. For a live
          // camera `currentTime` follows the stream; the worker has a fallback for
          // sources that keep it at zero.
          worker.postMessage(
            {
              type: 'frame',
              bitmap,
              timestamp: performance.now(),
              mediaTime: video.currentTime,
            },
            [bitmap],
          );
        })
        .catch(() => {
          inFlight = false;
        });
    };

    const schedule = () => {
      if (disposed || !loopActive || videoFrameHandle || rafHandle) return;
      // A MediaStream-backed video presents frames to requestVideoFrameCallback exactly like
      // a file-backed one; the only difference is that there is no duration or seek target.
      if (typeof video.requestVideoFrameCallback === 'function') {
        videoFrameHandle = video.requestVideoFrameCallback(tick);
      } else {
        rafHandle = requestAnimationFrame(tick);
      }
    };

    const startLoop = () => {
      if (disposed || loopActive) return;
      loopActive = true;
      schedule();
    };

    const stopLoop = () => {
      loopActive = false;
      cancelLoopHandles();
    };

    // A new source means the counters on screen belong to the previous one.
    const resetCounters = () => {
      if (disposed) return;
      setStats((previous) => {
        const broken = previous.status === 'error' || previous.status === 'unsupported';
        return {
          ...previous,
          fps: 0,
          persons: 0,
          faces: 0,
          ms: 0,
          vest: { vest: 0, noVest: 0, unknown: 0 },
          // Incidents are per source: the clip the operator just left must not lend its
          // events to the next one.
          events: [],
          totalEvents: 0,
          status: broken ? previous.status : 'loading',
          message: broken ? previous.message : 'se așteaptă primele cadre',
        };
      });
    };

    const onLoopHint = () => startLoop();
    const onSourceReset = () => {
      stopLoop();
      resetCounters();
    };

    LOOP_EVENTS.forEach((name) => video.addEventListener(name, onLoopHint));
    video.addEventListener('loadstart', resetCounters);
    video.addEventListener('emptied', onSourceReset);

    const watchdog = setInterval(() => {
      if (disposed || loopActive) return;
      if (video.videoWidth && video.readyState >= 2) startLoop();
    }, LOOP_WATCHDOG_MS);

    // ONNX Runtime can block the worker thread inside WebGPU session creation, so a
    // timeout *inside* the worker would never fire. The supervisor lives on the page.
    // Phase 1 waits for `ready` (model download included); phase 2, armed in the `ready`
    // handler above, watches for the first frame. Killing during a slow download is worse
    // than a long "se încarcă" state, because it can never finish that way.
    readyTimer = setTimeout(() => {
      if (disposed || modelReady) return;
      if (effectiveProvider === 'wasm') return;
      console.warn('[engine] models not ready after 180 s; restarting on wasm');
      setForcedProvider('wasm');
    }, ENGINE_READY_TIMEOUT_MS);

    const init = { type: 'init' };
    if (effectiveProvider) {
      // A single provider is a demand, not a preference: if ORT refuses it, the engine
      // falls back to wasm and says so through `actualProviders`.
      init.providers = [effectiveProvider];
    }
    if (Number.isFinite(inputSize) && inputSize > 0) init.inputSize = inputSize;
    // Threads and the head-band blur are fixed for the life of the worker: ORT reads the
    // thread count when it starts its pool, so a change restarts the worker through the
    // dependencies below rather than being applied to a running session.
    init.wasmThreads = wasmThreads;
    init.safetyBlur = safetyBlur;
    // Configurația Live, citită la momentul pornirii. `/lab` nu trimite niciuna dintre
    // ele, deci worker-ul păstrează zona de laborator.
    const config = configRef.current;
    if (Array.isArray(config.zones)) init.zones = config.zones;
    if (typeof config.engineOn === 'boolean') init.engineOn = config.engineOn;
    if (typeof config.cameraId === 'string' && config.cameraId) init.cameraId = config.cameraId;
    worker.postMessage(init);
    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      clearInterval(watchdog);
      if (readyTimer) clearTimeout(readyTimer);
      if (stallTimer) clearTimeout(stallTimer);
      LOOP_EVENTS.forEach((name) => video.removeEventListener(name, onLoopHint));
      video.removeEventListener('loadstart', resetCounters);
      video.removeEventListener('emptied', onSourceReset);
      workerRef.current = null;
      worker.terminate();
      // Do not let a remount (or a source switch that disables the engine) inherit numbers
      // from the video that was just detached.
      setStats((previous) => ({ ...INITIAL_STATS, providers: previous.providers }));
    };
  }, [enabled, effectiveProvider, inputSize, videoRef, canvasRef, wasmThreads, safetyBlur]);

  // Zonele editate ajung la worker fără restart. `zones` vine memoizat din LiveView, deci
  // efectul chiar pornește doar când configurația se schimbă; `/lab` nu trimite nimic.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const update = { type: 'config' };
    let hasConfig = false;
    if (Array.isArray(zones)) {
      update.zones = zones;
      hasConfig = true;
    }
    if (typeof engineOn === 'boolean') {
      update.engineOn = engineOn;
      hasConfig = true;
    }
    if (typeof cameraId === 'string' && cameraId) {
      update.cameraId = cameraId;
      hasConfig = true;
    }
    if (hasConfig) worker.postMessage(update);
  }, [zones, engineOn, cameraId]);

  return stats;
}

export default useEngine;
