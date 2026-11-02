// React wiring for the Live screen. The rules live in liveMedia.js; these hooks own only
// the lifecycles that need effects: the WebGPU probe and the local camera tracks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { webgpuAvailable } from '../../engine/webgpu';
import {
  CAMERA_ERRORS,
  cameraErrorFor,
  readEnginePreference,
  storeEnginePreference,
} from './liveMedia';

// The browser engine is a stored preference with a measured default. One probe decides
// the default and the copy; it uses the engine's own rule (`webgpuAvailable`), so a
// browser that exposes WebGPU but is kept on wasm by the engine (Firefox today) does not
// auto-start the slow path.
export function useEnginePreference() {
  const [preference, setPreference] = useState(readEnginePreference);
  const [gpuAvailable, setGpuAvailable] = useState(null);

  useEffect(() => {
    let cancelled = false;
    webgpuAvailable().then((usable) => {
      if (!cancelled) setGpuAvailable(usable);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Default ON only on the fast path. Without an adapter the engine runs on WASM at
  // ~2 fps, so it stays OFF until the visitor explicitly asks for it. The automatic
  // answer is not stored: a reload re-probes instead of freezing today's GPU state.
  useEffect(() => {
    if (preference !== null || gpuAvailable === null) return;
    setPreference(gpuAvailable);
  }, [preference, gpuAvailable]);

  const toggle = useCallback(() => {
    setPreference((previous) => {
      const next = previous !== true;
      storeEnginePreference(next);
      return next;
    });
  }, []);

  return { browserEngineOn: preference === true, gpuAvailable, toggle };
}

/**
 * Owns the only source the page has to open itself: the visitor's camera.
 *
 * A MediaStream cannot go through `src` (React never writes srcObject) and Chromium does
 * not re-arm autoplay for a new resource, so this hook also owns "attach the current
 * stream and start it". The <video> node keeps the same key while the engine is toggled,
 * so switching detection off never re-requests the camera.
 */
export function useWebcamFeed({ isWebcam, videoRef, browserEngineOn }) {
  const [state, setState] = useState('idle'); // idle | requesting | live | error
  const [error, setError] = useState(null);
  const [stream, setStream] = useState(null);
  // The live stream lives in refs as well, so the unmount hook and the request-race guard
  // can stop tracks without waiting for a render.
  const streamRef = useRef(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const stop = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    if (current) current.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    // getUserMedia exists only in a secure context (https or localhost). Saying so beats a
    // black rectangle on a LAN IP over plain http.
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError({
        code: 'insecure',
        name: 'getUserMedia undefined',
        message: '',
        ...CAMERA_ERRORS.insecure,
      });
      return;
    }

    // A second request (double click, camera switch) invalidates the one still in flight.
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState('requesting');
    setError(null);

    // Close what is open before asking again: some drivers refuse a second open of the
    // same device with NotReadableError.
    const previous = streamRef.current;
    streamRef.current = null;
    if (previous) previous.getTracks().forEach((track) => track.stop());
    setStream(null);

    try {
      // Same 720p shape as the demo clips, so the engine sees comparable frames.
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // A newer request (or an unmount) won the race: this stream is already stale.
      if (!mountedRef.current || request !== requestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
      setState('live');
    } catch (caught) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setState('error');
      setError(cameraErrorFor(caught));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1; // invalidate any getUserMedia still pending
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!isWebcam) {
      // Leaving the local camera must release the device: the LED goes off, and the next
      // clip does not inherit a stream nobody is watching.
      stop();
      setState('idle');
      setError(null);
      return;
    }
    start();
  }, [isWebcam, start, stop]);

  // Attach is separate from request: a source swap updates the existing element in place.
  // The engine toggle is deliberately not part of the request lifecycle: turning detection
  // off stops the worker, never the camera, and the raw feed keeps playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isWebcam || !stream) {
      // Back on a clip the same DOM node may be reused (engine on keeps one element):
      // detach the stream explicitly, otherwise the <video> keeps playing the camera.
      if (video.srcObject) video.srcObject = null;
      if (!isWebcam && video.src) {
        const played = video.play();
        if (played?.catch) played.catch(() => {});
      }
      return;
    }
    if (video.srcObject !== stream) video.srcObject = stream;
    const played = video.play();
    if (played?.catch) {
      // Muted playback is allowed by the autoplay policy, so a rejection here is real.
      played.catch((reason) =>
        console.warn('Redarea camerei locale a fost refuzată', reason)
      );
    }
  }, [isWebcam, stream, browserEngineOn, videoRef]);

  return {
    state,
    error,
    stream,
    // "live" means the browser really holds a track. Permission errors, a pending request
    // and the moment after a switch all fall outside it.
    live: isWebcam && state === 'live' && Boolean(stream),
    retry: start,
  };
}

// Engine incidents are real incidents for the application: they enter the shared list,
// not just the panel under the feed. The store deduplicates by `event_id`, so an extra
// render (or StrictMode) cannot add them twice.
export function useEngineIncidents(engineEvents, addEngineEvents) {
  useEffect(() => {
    if (!engineEvents.length) return;
    addEngineEvents(engineEvents);
  }, [engineEvents, addEngineEvents]);
}

// Both failure flags belong to one camera: switching cameras is a fresh source, so the
// fallback from the previous one must not stick.
export function useMediaFailures(cameraId) {
  const [streamFailed, setStreamFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setStreamFailed(false);
    setVideoFailed(false);
  }, [cameraId]);

  return {
    streamFailed,
    videoFailed,
    onStreamError: useCallback(() => setStreamFailed(true), []),
    onVideoError: useCallback(() => setVideoFailed(true), []),
  };
}
