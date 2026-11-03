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
import { WhepError, connectWhep, whepErrorInfo } from './whepClient';

// The browser engine is a stored preference with a measured default. The person detector
// always runs on WASM (see `preferredProviders` in detectors.js): EfficientDet on
// Chromium's WebGPU EP measured 0.1 fps on a software adapter, so WebGPU stays a bench-only
// experiment. The adapter probe therefore only decides whether the demo auto-starts: a
// machine that exposes WebGPU is a desktop demo machine, not a slow-path phone.
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

  // Default ON for a machine that exposes a GPU adapter, OFF otherwise so a slow phone
  // never starts an inference loop unasked. The detector itself is WASM either way. The
  // automatic answer is not stored: a reload re-probes instead of freezing today's GPU
  // state.
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
  // The exact MediaStream this hook wrote to `video.srcObject`. The stage has three kinds
  // of source on one element and only one of them is a getUserMedia track: detaching must
  // never clear a stream another source (the WHEP gateway) attached.
  const attachedRef = useRef(null);
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
      // Only a stream this hook attached is detached: the network camera puts its own
      // MediaStream on the same element, and toggling the engine must not kill it.
      if (attachedRef.current && video.srcObject === attachedRef.current) {
        video.srcObject = null;
      }
      attachedRef.current = null;
      if (!isWebcam && video.src) {
        const played = video.play();
        if (played?.catch) played.catch(() => {});
      }
      return;
    }
    if (video.srcObject !== stream) video.srcObject = stream;
    attachedRef.current = stream;
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

/**
 * Owns the network camera session: one WHEP peer connection on the same <video> the engine
 * reads frames from.
 *
 * The lifecycle mirrors `useWebcamFeed` on purpose — the stage has one element and one
 * source at a time — with one difference: a failed handshake must be retryable without
 * reloading the page, because the gateway is a process the operator starts by hand.
 *
 * @param {{isNetwork: boolean, videoRef: import('react').RefObject<HTMLVideoElement>,
 *          url: string|null}} options
 */
export function useWhepFeed({ isNetwork, videoRef, url }) {
  const [state, setState] = useState('idle'); // idle | connecting | live | error
  const [error, setError] = useState(null);
  // A retry is a new attempt number, not a mutation of the URL: the address the operator
  // typed stays the one in the address bar.
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef(null);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    // `close()` clears srcObject only when it is the stream this session attached, so a
    // webcam track or a clip on the same element is never detached by the wrong source.
    if (session) session.close();
  }, []);

  useEffect(() => {
    if (!isNetwork || !url) {
      stop();
      setState('idle');
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setState('connecting');
    setError(null);
    stop();

    const fail = (caught) => {
      if (cancelled) return;
      setState('error');
      setError(whepErrorInfo(caught));
    };

    connectWhep(url, videoRef.current, {
      onConnectionState: (connectionState) => {
        if (cancelled || connectionState !== 'failed') return;
        fail(new WhepError('disconnected', 'starea WebRTC a trecut pe „failed”.'));
      },
      onAutoplayBlocked: (reason) => {
        if (cancelled) return;
        setState('error');
        setError(whepErrorInfo(new WhepError('autoplay', reason?.message)));
      },
    })
      .then((session) => {
        // A newer attempt (or an unmount) won: this session is already stale.
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setState('live');
      })
      .catch(fail);

    return () => {
      cancelled = true;
      stop();
    };
  }, [isNetwork, url, attempt, stop, videoRef]);

  return {
    state,
    error,
    // "live" means a negotiated WebRTC session, not merely a configured URL.
    live: Boolean(isNetwork) && state === 'live',
    retry,
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
