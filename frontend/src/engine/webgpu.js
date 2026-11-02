// One place decides whether WebGPU is worth using for the engine. The worker, the Live
// default and the copy all read it, so the page never says "WebGPU disponibil" while the
// worker is actually running on wasm.
//
// Firefox currently exposes WebGPU to workers behind `dom.webgpu.*`, but ONNX Runtime is
// not usable there yet: creating the two graphs concurrently wedged the worker
// synchronously (no frame, no error, no timer), and built sequentially it ran at
// 0.4–0.7 fps versus 1.5 fps on wasm (Firefox 157/159, Linux, 1080p). The engine therefore
// stays on wasm in Firefox; `/bench` can still force the provider for experiments.
const BLOCKED_BROWSER = /Firefox\//;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function webgpuAvailable() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false;
  if (BLOCKED_BROWSER.test(navigator.userAgent || '')) return false;
  try {
    const adapter = await withTimeout(navigator.gpu.requestAdapter(), 4000, 'requestAdapter');
    return Boolean(adapter);
  } catch {
    return false;
  }
}
