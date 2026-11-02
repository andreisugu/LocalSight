// Model loading for the in-browser spike. Everything here runs inside the module
// worker (src/engine/worker.js); nothing touches the DOM or the backend.
//
// Two ONNX graphs are used:
//   yolo26n.onnx - person detector, 640x640 letterboxed input, [1, 84, 8400] output
//   yunet.onnx   - face detector, the same model the Python edge uses for blurring
//
// The wasm binary is bundled by Vite (`?url`) instead of being fetched from a CDN, so
// the page works offline and from a static Pages build with no extra copy step.
//
// Only the asset *URL* is imported at module scope: it is a short string and fetching the
// 28.7 MB binary is what ORT does later, on the first session. The runtime itself is
// loaded on demand in `loadOrt`, so a visitor who never starts the engine (Live toggle
// off, /lab never opened) does not download or parse it. The worker is built as an ES
// module (see `worker.format` in vite.config.js), which is what allows the dynamic import
// below to become its own chunk; an IIFE worker cannot code-split and would inline ORT.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

const MODEL_BASE = `${import.meta.env.BASE_URL}models`;
export const YOLO_MODEL_URL = `${MODEL_BASE}/yolo26n.onnx`;
export const YUNET_MODEL_URL = `${MODEL_BASE}/yunet.onnx`;

export const YOLO_INPUT_SIZE = 640;
// Ultralytics pads with 114 grey; matching it keeps the detector in its training regime.
export const LETTERBOX_PAD = 114;

let configured = false;
// Resolved once per module instance; a rejected import clears it so a retry can work.
let ortPromise = null;

/**
 * Fetch and evaluate onnxruntime-web. Vite emits it as its own chunk, so the cost is paid
 * on the first `loadModels` of a session, not when the worker module loads.
 * @returns {Promise<typeof import('onnxruntime-web/webgpu')>}
 */
function loadOrt() {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web/webgpu').catch((error) => {
      ortPromise = null;
      throw new Error(`cannot load onnxruntime-web: ${error.message}`);
    });
  }
  return ortPromise;
}

function configureOrt(ort) {
  if (configured) return;
  // The webgpu bundle embeds the asyncify glue, so it asks for the asyncify .wasm file.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  // Multi-threaded wasm needs COOP/COEP headers; GitHub Pages does not send them, so a
  // static build silently falls back to one thread instead of failing to start.
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? 4 : 1;
  ort.env.wasm.proxy = false;
  // The YuNet shape mismatch warning is expected (see the model README) and would print
  // twice per frame; fatal keeps the console clean while real failures still throw.
  ort.env.logLevel = 'fatal';
  configured = true;
}

/**
 * WebGPU when the browser exposes a usable adapter, wasm otherwise.
 * @returns {Promise<string[]>}
 */
export async function preferredProviders() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return ['wasm'];
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? ['webgpu', 'wasm'] : ['wasm'];
  } catch {
    return ['wasm'];
  }
}

/**
 * Letterbox math: scale the frame to fit the square input, centre it and pad.
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} [size]
 */
export function letterbox(srcW, srcH, size = YOLO_INPUT_SIZE) {
  const scale = Math.min(size / srcW, size / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  return {
    scale,
    drawW,
    drawH,
    padX: Math.floor((size - drawW) / 2),
    padY: Math.floor((size - drawH) / 2),
    size,
  };
}

/**
 * HWC RGBA bytes -> NCHW float32.
 *
 * `normalize` divides by 255 (YOLO's expected 0..1 RGB). YuNet must NOT be normalised:
 * OpenCV's `blobFromImage` defaults, which the Python edge relies on, feed raw 0..255
 * BGR - normalising drops the face scores from 0.92 to below the 0.6 threshold.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {{swapRB?: boolean, normalize?: boolean}} [options]
 * @returns {Float32Array}
 */
export function rgbaToNchw(rgba, width, height, options = {}) {
  const { swapRB = false, normalize = true } = options;
  const range = normalize ? 1 / 255 : 1;
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  for (let i = 0, p = 0; i < plane; i += 1, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    out[i] = (swapRB ? b : r) * range;
    out[plane + i] = g * range;
    out[plane * 2 + i] = (swapRB ? r : b) * range;
  }
  return out;
}

async function fetchModelBytes(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'force-cache' });
  } catch (error) {
    throw new Error(`cannot fetch ${url}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`model not found: ${url} (HTTP ${response.status})`);
  }
  // A static host with an SPA fallback answers 200 + index.html for a missing model; the
  // protobuf error it would cause further down is unreadable, so say what happened.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error(`model not found: ${url} (server returned ${contentType})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function createSession(ort, url, providers) {
  const bytes = await fetchModelBytes(url);
  const options = { executionProviders: providers, graphOptimizationLevel: 'all' };
  try {
    const session = await ort.InferenceSession.create(bytes, options);
    // The first requested provider is the one ORT picked; a silent internal fallback is
    // not observable from the session object, so callers that need proof pass a single
    // provider (`['webgpu']`) instead of a preference list.
    return { session, provider: providers[0], fallback: false };
  } catch (error) {
    if (providers[0] !== 'webgpu') throw error;
    // A GPU session can still be refused (driver blocklist, out of memory); wasm is the
    // documented fallback and is what the Python edge uses anyway.
    const session = await ort.InferenceSession.create(bytes, { ...options, executionProviders: ['wasm'] });
    return { session, provider: 'wasm', fallback: true };
  }
}

function inputShape(session) {
  const input = session.inputMetadata?.[0] ?? session.inputs?.[0];
  const dims = input?.shape ?? input?.dims ?? [];
  const height = Number(dims[2]) || 0;
  const width = Number(dims[3]) || 0;
  const name = input?.name ?? session.inputNames?.[0] ?? 'input';
  return { name, width, height };
}

/**
 * Load both sessions. Resolves with plain objects so the worker can pass them around.
 *
 * @param {(stage: string) => void} [onProgress]
 * @param {{providers?: string[]}} [options] explicit execution providers. Omitting this
 *   keeps the spike behaviour: probe WebGPU and ask for `['webgpu', 'wasm']`. The bench
 *   page passes a single provider so the returned `actualProviders` says what really ran.
 */
export async function loadModels(onProgress = () => {}, options = {}) {
  const ort = await loadOrt();
  configureOrt(ort);
  const providers = Array.isArray(options.providers) && options.providers.length
    ? options.providers
    : await preferredProviders();
  onProgress(providers[0] === 'webgpu' ? 'loading (webgpu)' : 'loading (wasm)');

  const [yolo, yunet] = await Promise.all([
    createSession(ort, YOLO_MODEL_URL, providers),
    createSession(ort, YUNET_MODEL_URL, providers),
  ]);

  const yoloInput = inputShape(yolo.session);
  const yunetInput = inputShape(yunet.session);
  const actualProviders = [...new Set([yolo.provider, yunet.provider])];

  return {
    yolo: yolo.session,
    yunet: yunet.session,
    // What was asked for: `/lab` prints this list exactly as before.
    providers,
    // What ORT actually created. `fallback` marks a WebGPU request that ended on wasm.
    actualProviders,
    fallback: yolo.fallback || yunet.fallback,
    yoloInput,
    yunetInput,
    // A graph with symbolic height/width accepts the whole frame padded to multiples of
    // 32 (exactly what the Python edge feeds); a frozen 640x640 graph needs a letterbox.
    yunetDynamic: !yunetInput.width || !yunetInput.height,
    async close() {
      await Promise.allSettled([yolo.session.release?.(), yunet.session.release?.()]);
    },
  };
}

/**
 * Run the person detector on a 640x640 NCHW blob.
 * @returns {Promise<Float32Array>} raw [1, 84, 8400] scores
 */
export async function runYolo(models, blob, size = YOLO_INPUT_SIZE) {
  const { Tensor } = await loadOrt();
  const tensor = new Tensor('float32', blob, [1, 3, size, size]);
  const results = await models.yolo.run({ [models.yoloInput.name]: tensor });
  const output = results[Object.keys(results)[0]];
  return output.data;
}

/**
 * Run the face detector on a NCHW blob of the given size.
 * @returns {Promise<Float32Array[]>} cls[3], obj[3], bbox[3], kps[3] in graph order
 */
export async function runYuNet(models, blob, width, height) {
  const { Tensor } = await loadOrt();
  const tensor = new Tensor('float32', blob, [1, 3, height, width]);
  const results = await models.yunet.run({ [models.yunetInput.name]: tensor });
  const names = models.yunet.outputNames?.length
    ? models.yunet.outputNames
    : Object.keys(results);
  return names.map((name) => results[name].data);
}
