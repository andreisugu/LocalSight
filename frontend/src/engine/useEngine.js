// Owns the engine worker and feeds it frames from a <video>. React only sees the numbers
// the overlay prints; the pixels go straight from the worker's ImageBitmap to the canvas.
import { useEffect, useRef, useState } from 'react';

const INITIAL_STATS = {
  fps: 0,
  persons: 0,
  faces: 0,
  ms: 0,
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
    if (!enabled) {
      // Nothing to feed: clear the old numbers so the overlay never claims a running engine.
      setStats(INITIAL_STATS);
      return undefined;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      setStats({
        ...INITIAL_STATS,
        status: 'unsupported',
        message: 'Acest browser nu are module workers sau OffscreenCanvas.',
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
    // The worker outlives a source swap on purpose: recreating it would reload the ONNX
    // graphs. Only the frame loop is torn down and restarted.
    let loopActive = false;
    let videoFrameHandle = 0;
    let rafHandle = 0;

    const draw = (bitmap) => {
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
        const incoming = Array.isArray(message.events) ? message.events : [];
        const now = performance.now();
        if (incoming.length === 0 && now - lastStatsRef.current < STATS_INTERVAL_MS) return;
        lastStatsRef.current = now;
        setStats((previous) => ({
          ...previous,
          fps: message.fps,
          persons: message.persons,
          faces: message.faces,
          ms: message.ms,
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

    const init = { type: 'init' };
    if (provider) {
      // A single provider is a demand, not a preference: if ORT refuses it, the engine
      // falls back to wasm and says so through `actualProviders`.
      init.providers = [provider];
    }
    if (Number.isFinite(inputSize) && inputSize > 0) init.inputSize = inputSize;
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
      LOOP_EVENTS.forEach((name) => video.removeEventListener(name, onLoopHint));
      video.removeEventListener('loadstart', resetCounters);
      video.removeEventListener('emptied', onSourceReset);
      workerRef.current = null;
      worker.terminate();
      // Do not let a remount (or a source switch that disables the engine) inherit numbers
      // from the video that was just detached.
      setStats((previous) => ({ ...INITIAL_STATS, providers: previous.providers }));
    };
  }, [enabled, provider, inputSize, videoRef, canvasRef]);

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
