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
};

// The worker can return a frame every 16 ms; re-rendering the overlay that often is waste.
const STATS_INTERVAL_MS = 250;

/**
 * @param {{ videoRef: import('react').RefObject<HTMLVideoElement>,
 *           canvasRef: import('react').RefObject<HTMLCanvasElement>,
 *           enabled?: boolean }} options
 */
export function useEngine({ videoRef, canvasRef, enabled = true }) {
  const [stats, setStats] = useState(INITIAL_STATS);
  const lastStatsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      setStats({
        ...INITIAL_STATS,
        status: 'unsupported',
        message: 'This browser has no module workers or OffscreenCanvas.',
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

    let disposed = false;
    let inFlight = false;
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
      const message = event.data || {};
      if (message.type === 'result') {
        inFlight = false;
        draw(message.bitmap);
        const now = performance.now();
        if (now - lastStatsRef.current >= STATS_INTERVAL_MS) {
          lastStatsRef.current = now;
          setStats((previous) => ({
            ...previous,
            fps: message.fps,
            persons: message.persons,
            faces: message.faces,
            ms: message.ms,
            // A frame can arrive while the graphs are missing; keep saying so instead of
            // pretending the engine is healthy.
            status: message.error ? 'error' : 'running',
            message: message.error ? message.error : previous.message,
          }));
        }
        return;
      }
      if (message.type === 'ready') {
        setStats((previous) => ({
          ...previous,
          status: 'loading',
          providers: message.providers || [],
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
      inFlight = false;
      setStats((previous) => ({
        ...previous,
        status: 'error',
        message: event.message || 'engine worker failed',
      }));
    };

    const schedule = () => {
      if (disposed) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        videoFrameHandle = video.requestVideoFrameCallback(tick);
      } else {
        rafHandle = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (disposed) return;
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
          worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
        })
        .catch(() => {
          inFlight = false;
        });
    };

    worker.postMessage({ type: 'init' });
    schedule();

    return () => {
      disposed = true;
      if (videoFrameHandle && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrameHandle);
      }
      if (rafHandle) cancelAnimationFrame(rafHandle);
      worker.terminate();
    };
  }, [enabled, videoRef, canvasRef]);

  return stats;
}

export default useEngine;
