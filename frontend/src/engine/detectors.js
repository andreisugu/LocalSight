// Model loading for the in-browser engine. Everything here runs inside the module
// worker (src/engine/worker.js); nothing touches the DOM or the backend.
//
// Two ONNX graphs are used:
//   efficientdet_lite0.onnx / efficientdet_lite2.onnx - person detector, uint8 NHWC input
//   yunet.onnx                                        - face detector, the blur guard
//
// Both person graphs are the Apache-2.0 EfficientDet-Lite ONNX export: 320 px square for
// Lite0, 448 px for Lite2, four outputs (boxes, classes, scores, count). Lite0 is the
// default; the settings choice swaps the URL and nothing else. There is no third detector.
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
import { withTimeout } from './webgpu.js';
import { matchEfficientDetOutputs } from './decode.js';

const MODEL_BASE = `${import.meta.env.BASE_URL}models`;
export const YUNET_MODEL_URL = `${MODEL_BASE}/yunet.onnx`;

// The two shipped person detectors. Both are the ONNX export of Google's EfficientDet-Lite
// (Apache-2.0 weights, CC BY 3.0 conversion note in THIRD_PARTY.md), run on the same
// onnxruntime-web session as YuNet: uint8 NHWC input, 320 / 448 px square, 25 detections.
export const EFFICIENTDET_LITE0_MODEL_URL = `${MODEL_BASE}/efficientdet_lite0.onnx`;
export const EFFICIENTDET_LITE2_MODEL_URL = `${MODEL_BASE}/efficientdet_lite2.onnx`;
// `efficientdet` is the settings value without a suffix and means Lite0.
export const EFFICIENTDET_MODEL_URL = EFFICIENTDET_LITE0_MODEL_URL;

/** Fallback input side if a graph declares none; Lite0 is the default graph. */
export const DEFAULT_PERSON_INPUT_SIZE = 320;

// `detector` values accepted by `loadModels`, mapped to the graph. Anything else (missing
// value included) resolves to Lite0: the default must not move because of a typo in a
// hand-edited storage blob.
const PERSON_MODELS = Object.freeze({
  efficientdet: { id: 'efficientdet', url: EFFICIENTDET_LITE0_MODEL_URL },
  'efficientdet-lite2': { id: 'efficientdet-lite2', url: EFFICIENTDET_LITE2_MODEL_URL },
});

/**
 * Resolve a settings value to the person graph. Unknown values fall back to Lite0.
 * @param {string} [detector]
 * @returns {{id: 'efficientdet'|'efficientdet-lite2', url: string}}
 */
export function resolvePersonModel(detector) {
  return PERSON_MODELS[detector] ?? PERSON_MODELS.efficientdet;
}

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

/**
 * Apply the runtime configuration once per worker.
 *
 * `threads` comes from the page (`resolveWasmThreads`), which is the only place that
 * knows the isolation state and the operator's choice. A caller that omits it keeps the
 * historical default: four threads when isolated, one otherwise.
 *
 * @param {typeof import('onnxruntime-web/webgpu')} ort
 * @param {number} [threads]
 * @returns {void}
 */
export function configureOrt(ort, threads) {
  if (configured) return;
  // The webgpu bundle embeds the asyncify glue, so it asks for the asyncify .wasm file.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  // Multi-threaded wasm needs COOP/COEP headers; without them there is no
  // SharedArrayBuffer, so the runtime stays at one thread.
  ort.env.wasm.numThreads = Number.isFinite(threads) && threads >= 1
    ? Math.floor(threads)
    : (globalThis.crossOriginIsolated ? 4 : 1);
  ort.env.wasm.proxy = false;
  // The YuNet shape mismatch warning is expected (see the model README) and would print
  // twice per frame; fatal keeps the console clean while real failures still throw.
  ort.env.logLevel = 'fatal';
  configured = true;
}

/**
 * Execution providers for the shipped engine. WASM only.
 *
 * The EfficientDet-Lite graphs take a uint8 NHWC tensor. Run on Chromium's WebGPU EP under
 * a software adapter (Playwright, `--enable-unsafe-webgpu`), Lite0 did produce real
 * detections - 3 persons on the demo clip - but at 0.1 fps, against 8.8 fps on four-thread
 * WASM. That path is not validated on real GPUs and is far too slow to ship, so the Live
 * and background workers always ask for wasm. `/bench` still passes an explicit provider,
 * where the same measurement is visible and a failed WebGPU session falls back to wasm.
 *
 * Kept as a function because the default is a decision, not a constant: the bench and the
 * worker both call it through `loadModels`.
 * @returns {Promise<string[]>}
 */
export async function preferredProviders() {
  return ['wasm'];
}

/**
 * Letterbox math: scale the frame to fit the square input, centre it and pad.
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} [size]
 */
export function letterbox(srcW, srcH, size = DEFAULT_PERSON_INPUT_SIZE) {
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
 * `normalize` divides by 255 (the 0..1 RGB an anchor decoder expects). YuNet must NOT be
 * normalised: OpenCV's `blobFromImage` defaults, which the privacy guard relies on, feed raw
 * 0..255 BGR - normalising drops the face scores from 0.92 to below the 0.6 threshold.
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

// A WebGPU session that never settles is indistinguishable from one still compiling
// shaders; past this budget the worker rebuilds the graph on wasm.
const WEBGPU_SESSION_TIMEOUT_MS = 12_000;

async function createSession(ort, url, providers) {
  const bytes = await fetchModelBytes(url);
  const options = { executionProviders: providers, graphOptimizationLevel: 'all' };
  if (providers[0] !== 'webgpu') {
    const session = await ort.InferenceSession.create(bytes, options);
    return { session, provider: providers[0], fallback: false };
  }
  // Ask for WebGPU alone so a hang is observable; the fallback below is explicit instead
  // of ORT's silent internal one.
  try {
    const session = await withTimeout(
      ort.InferenceSession.create(bytes, { ...options, executionProviders: ['webgpu'] }),
      WEBGPU_SESSION_TIMEOUT_MS,
      'webgpu session'
    );
    return { session, provider: 'webgpu', fallback: false };
  } catch (error) {
    // A GPU session can be refused (driver blocklist, out of memory) or never settle.
    // Wasm is the documented fallback. This path is bench-only today: the shipped workers
    // ask for wasm, so a wedged GPU session can never stall Live. A session that is created
    // but fails on its first run surfaces the ORT error through the worker's fail-closed
    // frame instead of silently producing zero boxes.
    const reason = error instanceof Error ? error.message : String(error);
    const session = await ort.InferenceSession.create(bytes, {
      ...options,
      executionProviders: ['wasm']
    });
    return { session, provider: 'wasm', fallback: true, reason };
  }
}

/**
 * Read the graph input metadata. Two layouts are supported:
 *   NCHW `[1, 3, H, W]` - YuNet (the historical shape)
 *   NHWC `[1, H, W, 3]` - EfficientDet, whose channel axis is last
 * A dynamic axis comes back as 0, exactly as before (YuNet's `yunetDynamic`).
 *
 * @param {{inputMetadata?: any[], inputs?: any[], inputNames?: string[]}} session
 * @returns {{name: string, width: number, height: number,
 *            layout: 'nchw'|'nhwc'}} width/height are the declared axes, 0 when symbolic
 */
function inputShape(session) {
  const input = session.inputMetadata?.[0] ?? session.inputs?.[0];
  const dims = input?.shape ?? input?.dims ?? [];
  const second = Number(dims[1]) || 0;
  const third = Number(dims[2]) || 0;
  const fourth = Number(dims[3]) || 0;
  const name = input?.name ?? session.inputNames?.[0] ?? 'input';
  // The channel axis is the one fixed at 3; a 3-D `fourth` next to a spatial `second`
  // means NHWC. NCHW keeps `second === 3` and reads H/W from axes 2 and 3.
  const layout = fourth === 3 && second !== 3 ? 'nhwc' : 'nchw';
  return layout === 'nhwc'
    ? { name, width: third, height: second, layout }
    : { name, width: fourth, height: third, layout };
}

/**
 * Load the person detector and the face detector. Resolves with plain objects so the
 * worker can pass them around.
 *
 * @param {(stage: string) => void} [onProgress]
 * @param {{providers?: string[], threads?: number, detector?: string}} [options]
 *   explicit execution providers, wasm thread count and person detector. `detector` is the
 *   settings value (`efficientdet`, `efficientdet-lite2`); omitted or unknown loads the
 *   default Lite0. Omitting `providers` asks for wasm (`preferredProviders`), and omitting
 *   `threads` keeps ORT's isolation-based default. The bench page passes a single provider
 *   so `actualProviders` says what ran.
 */
export async function loadModels(onProgress = () => {}, options = {}) {
  const ort = await loadOrt();
  configureOrt(ort, options.threads);
  const providers = Array.isArray(options.providers) && options.providers.length
    ? options.providers
    : await preferredProviders();
  const person = resolvePersonModel(options.detector);
  onProgress(providers[0] === 'webgpu' ? 'loading (webgpu)' : 'loading (wasm)');

  const [personSession, yunet] = providers[0] === 'webgpu'
    // ORT's WebGPU EP refuses a second concurrent session ("another WebGPU EP inference
    // session is being created"), so build the graphs one after the other there. On wasm
    // the two loads are independent and run in parallel.
    ? [
        await createSession(ort, person.url, providers),
        await createSession(ort, YUNET_MODEL_URL, providers),
      ]
    : await Promise.all([
        createSession(ort, person.url, providers),
        createSession(ort, YUNET_MODEL_URL, providers),
      ]);

  const personInput = inputShape(personSession.session);
  const yunetInput = inputShape(yunet.session);
  const actualProviders = [...new Set([personSession.provider, yunet.provider])];

  return {
    // The person graph whichever detector the settings picked; the stored id travels with
    // it so the card can name the graph that really loaded (an unknown value resolves to
    // Lite0, and saying so is more honest than repeating the raw setting).
    person: personSession.session,
    personInput,
    personDetector: person.id,
    detector: person.id,
    yunet: yunet.session,
    // What was asked for: `/lab` prints this list exactly as before.
    providers,
    // What ORT actually created. `fallback` marks a WebGPU request that ended on wasm.
    actualProviders,
    fallback: personSession.fallback || yunet.fallback,
    yunetInput,
    // A graph with symbolic height/width accepts the whole frame padded to multiples of
    // 32 (exactly what the privacy guard feeds); a frozen input needs a letterbox.
    yunetDynamic: !yunetInput.width || !yunetInput.height,
    async close() {
      await Promise.allSettled([personSession.session.release?.(), yunet.session.release?.()]);
    },
  };
}

/**
 * Run the EfficientDet person detector on an NHWC uint8 RGB input.
 *
 * The graph is the ONNX export of Google's EfficientDet-Lite: `uint8 [1, H, W, 3]` in
 * (0..255, no normalisation), and four outputs - `[1, 25, 4]` normalized
 * `[ymin, xmin, ymax, xmax]`, `[1, 25]` class ids, `[1, 25]` scores, `[1]` count.
 * `matchEfficientDetOutputs` resolves the tensors by name, then by graph order, so a
 * renamed export still works and a class-0 person is never mistaken for a low score.
 *
 * @param {object} models result of `loadModels`
 * @param {Uint8Array} input size*size*3 RGB bytes
 * @param {number} width model input width (square: 320 or 448)
 * @param {number} height model input height
 * @returns {Promise<{boxes: Float32Array, classes: Float32Array,
 *                    scores: Float32Array, count: number}>}
 */
export async function runEfficientDet(models, input, width, height) {
  const { Tensor } = await loadOrt();
  const tensor = new Tensor('uint8', input, [1, height, width, 3]);
  const results = await models.person.run({ [models.personInput.name ?? 'input']: tensor });
  const output = matchEfficientDetOutputs(results);
  if (!output) {
    const shapes = Object.entries(results)
      .map(([name, value]) => `${name}:[${value?.dims?.join(',') ?? '?'}]`)
      .join(' ');
    throw new Error(`EfficientDet: unexpected output graph (${shapes})`);
  }
  return output;
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
