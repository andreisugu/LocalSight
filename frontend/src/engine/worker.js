// Module worker: the whole per-frame pipeline of the spike lives here, off the main
// thread. Frames arrive as ImageBitmaps (transferred), the processed frame leaves as one
// ImageBitmap plus the numbers the overlay shows.
//
// Deliberately small: YOLO person boxes + YuNet face blur, no zones, no events, no
// backend. It is the piece that proves the models run in a browser on a looping video.
import {
  LETTERBOX_PAD,
  YOLO_INPUT_SIZE,
  letterbox,
  loadModels,
  rgbaToNchw,
  runYolo,
  runYuNet,
} from './detectors.js';
import { decodeYolo, decodeYuNet } from './decode.js';

const PERSON_CONF = 0.35;
const PERSON_NMS = 0.45;
const FACE_CONF = 0.6;
const FACE_NMS = 0.3;
// Same anonymising strength as the Python `_strong_blur`: shrink 8x, blur, scale back.
const BLUR_SCALE = 8;
const BLUR_SIGMA = 25 / BLUR_SCALE;

let models = null;
let modelError = null;
let loading = null;

// Bench options. Defaults are the spike's: probe providers, process the frame at its own
// resolution. `/lab` never sends an `init` payload, so it keeps exactly that behaviour.
let initProviders = null;
// Longest side of the frame handed to the detectors; 0 means "native size". The YOLO graph
// is fixed at 640x640, so this limit changes the frame, not the YOLO tensor.
let frameLimit = 0;

let frameCanvas = null;
let frameCtx = null;
let letterboxCanvas = null;
let letterboxCtx = null;
let faceCanvas = null;
let faceCtx = null;

let lastFrameAt = 0;
let fps = 0;

function post(message, transfer = []) {
  self.postMessage(message, transfer);
}

async function ensureModels() {
  if (models) return models;
  if (modelError) throw modelError;
  if (loading) return loading;
  loading = (async () => {
    try {
      const loaded = await loadModels(
        (stage) => post({ type: 'status', stage }),
        initProviders ? { providers: initProviders } : {},
      );
      models = loaded;
      post({
        type: 'ready',
        providers: loaded.providers,
        actualProviders: loaded.actualProviders,
        fallback: loaded.fallback,
      });
      return loaded;
    } catch (error) {
      modelError = error instanceof Error ? error : new Error(String(error));
      post({ type: 'error', message: modelError.message });
      throw modelError;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function ensureFrameCanvas(width, height) {
  if (frameCanvas && frameCanvas.width === width && frameCanvas.height === height) {
    return;
  }
  frameCanvas = new OffscreenCanvas(width, height);
  frameCtx = frameCanvas.getContext('2d', { alpha: false });
  // Any size change invalidates the scratch canvases as well.
  letterboxCanvas = null;
  letterboxCtx = null;
  faceCanvas = null;
  faceCtx = null;
}

// `frameLimit` caps the long side without upscaling: a 1280-wide clip stays 1280 at size
// 1280 and becomes 640x360 at size 640. Native frames (and `/lab`) return their own size.
function targetFrameSize(width, height) {
  if (!frameLimit) return { width, height };
  const scale = Math.min(1, frameLimit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function yoloInputSize() {
  return models?.yoloInput?.width || models?.yoloInput?.height || YOLO_INPUT_SIZE;
}

function ensureLetterboxCanvas(size) {
  if (letterboxCanvas && letterboxCanvas.width === size) return letterboxCtx;
  letterboxCanvas = new OffscreenCanvas(size, size);
  letterboxCtx = letterboxCanvas.getContext('2d', { willReadFrequently: true });
  return letterboxCtx;
}

function detectPersons(width, height, size) {
  const box = letterbox(width, height, size);
  const ctx = ensureLetterboxCanvas(size);
  ctx.fillStyle = `rgb(${LETTERBOX_PAD}, ${LETTERBOX_PAD}, ${LETTERBOX_PAD})`;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(frameCanvas, box.padX, box.padY, box.drawW, box.drawH);

  const { data } = ctx.getImageData(0, 0, size, size);
  const blob = rgbaToNchw(data, size, size, { swapRB: false });
  return { blob, box };
}

function detectFaces(width, height) {
  if (models.yunetDynamic) {
    // Whole frame, padded to multiples of 32 with zeros: the Python edge path. No rescale,
    // so the boxes come out already in frame pixels.
    const paddedW = Math.ceil(width / 32) * 32;
    const paddedH = Math.ceil(height / 32) * 32;
    if (!faceCanvas || faceCanvas.width !== paddedW || faceCanvas.height !== paddedH) {
      faceCanvas = new OffscreenCanvas(paddedW, paddedH);
      faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });
    }
    faceCtx.fillStyle = '#000';
    faceCtx.fillRect(0, 0, paddedW, paddedH);
    faceCtx.drawImage(frameCanvas, 0, 0, width, height);
    const { data } = faceCtx.getImageData(0, 0, paddedW, paddedH);
    return {
      blob: rgbaToNchw(data, paddedW, paddedH, { swapRB: true, normalize: false }),
      width: paddedW,
      height: paddedH,
      scale: 1,
      padX: 0,
      padY: 0,
    };
  }

  // Frozen 640x640 graph: letterbox, then undo it in the decode.
  const box = letterbox(width, height, models.yunetInput.width || 640);
  if (!faceCanvas || faceCanvas.width !== box.size || faceCanvas.height !== box.size) {
    faceCanvas = new OffscreenCanvas(box.size, box.size);
    faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });
  }
  faceCtx.fillStyle = '#000';
  faceCtx.fillRect(0, 0, box.size, box.size);
  faceCtx.drawImage(frameCanvas, box.padX, box.padY, box.drawW, box.drawH);
  const { data } = faceCtx.getImageData(0, 0, box.size, box.size);
  return {
    blob: rgbaToNchw(data, box.size, box.size, { swapRB: true, normalize: false }),
    width: box.size,
    height: box.size,
    scale: box.scale,
    padX: box.padX,
    padY: box.padY,
  };
}

function clampRect(x1, y1, x2, y2, width, height) {
  const left = Math.max(0, Math.min(width, Math.floor(x1)));
  const top = Math.max(0, Math.min(height, Math.floor(y1)));
  const right = Math.max(0, Math.min(width, Math.ceil(x2)));
  const bottom = Math.max(0, Math.min(height, Math.ceil(y2)));
  return { left, top, width: right - left, height: bottom - top };
}

function blurRect(ctx, rect) {
  if (rect.width < 2 || rect.height < 2) return;
  const smallW = Math.max(1, Math.floor(rect.width / BLUR_SCALE));
  const smallH = Math.max(1, Math.floor(rect.height / BLUR_SCALE));
  const small = new OffscreenCanvas(smallW, smallH);
  const smallCtx = small.getContext('2d', { alpha: false });
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(
    frameCanvas,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    smallW,
    smallH,
  );

  const blurred = new OffscreenCanvas(smallW, smallH);
  const blurredCtx = blurred.getContext('2d', { alpha: false });
  blurredCtx.filter = `blur(${BLUR_SIGMA}px)`;
  blurredCtx.drawImage(small, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(blurred, 0, 0, smallW, smallH, rect.left, rect.top, rect.width, rect.height);
}

function blurFaces(ctx, faces, width, height) {
  for (const face of faces) {
    const margin = Math.max(1, 0.2 * Math.max(face.x2 - face.x1, face.y2 - face.y1));
    const rect = clampRect(
      face.x1 - margin,
      face.y1 - margin,
      face.x2 + margin,
      face.y2 + margin,
      width,
      height,
    );
    blurRect(ctx, rect);
  }
}

function drawBoxes(ctx, boxes, colour, label) {
  ctx.lineWidth = Math.max(2, Math.round(ctx.canvas.width / 640));
  ctx.font = `${Math.round(ctx.canvas.width / 55)}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  for (const box of boxes) {
    const rect = clampRect(box.x1, box.y1, box.x2, box.y2, ctx.canvas.width, ctx.canvas.height);
    if (rect.width < 2 || rect.height < 2) continue;
    ctx.strokeStyle = colour;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    if (!label) continue;
    const text = `${label} ${box.score.toFixed(2)}`;
    const padding = 3;
    const textWidth = ctx.measureText(text).width;
    const textHeight = Math.round(ctx.canvas.width / 55);
    ctx.fillStyle = colour;
    ctx.fillRect(rect.left, Math.max(0, rect.top - textHeight - padding * 2), textWidth + padding * 2, textHeight + padding * 2);
    ctx.fillStyle = '#1F1F1F';
    ctx.fillText(text, rect.left + padding, Math.max(0, rect.top - textHeight - padding));
  }
}

function updateFps() {
  const now = performance.now();
  if (lastFrameAt > 0) {
    const delta = now - lastFrameAt;
    if (delta > 0) {
      const instant = 1000 / delta;
      fps = fps > 0 ? fps * 0.8 + instant * 0.2 : instant;
    }
  }
  lastFrameAt = now;
}

async function handleFrame(bitmap) {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (!sourceWidth || !sourceHeight) {
    bitmap.close();
    return;
  }
  updateFps();
  const target = targetFrameSize(sourceWidth, sourceHeight);
  const width = target.width;
  const height = target.height;
  ensureFrameCanvas(width, height);
  frameCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  if (modelError) {
    // Models unavailable: mirror the video so the page still shows something, and let the
    // overlay report the failure. No crash, no retry storm.
    const passthrough = frameCanvas.transferToImageBitmap();
    post(
      {
        type: 'result',
        bitmap: passthrough,
        fps: Math.round(fps * 10) / 10,
        persons: 0,
        faces: 0,
        ms: 0,
        error: modelError.message,
      },
      [passthrough],
    );
    return;
  }

  const started = performance.now();
  let persons = [];
  let faces = [];
  let error = null;
  try {
    await ensureModels();
    const yoloSize = yoloInputSize();
    const yolo = detectPersons(width, height, yoloSize);
    const scores = await runYolo(models, yolo.blob, yoloSize);
    persons = decodeYolo(scores, {
      numClasses: 80,
      conf: PERSON_CONF,
      iou: PERSON_NMS,
      scale: yolo.box.scale,
      padX: yolo.box.padX,
      padY: yolo.box.padY,
    });

    const face = detectFaces(width, height);
    const outputs = await runYuNet(models, face.blob, face.width, face.height);
    faces = decodeYuNet(outputs, {
      inputW: face.width,
      inputH: face.height,
      scoreThreshold: FACE_CONF,
      nmsThreshold: FACE_NMS,
      scale: face.scale,
      padX: face.padX,
      padY: face.padY,
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    if (!modelError) modelError = new Error(error);
  }

  blurFaces(frameCtx, faces, width, height);
  drawBoxes(frameCtx, persons, '#FFEB33', 'PERSON');
  drawBoxes(frameCtx, faces, '#33E1FF', null);

  const output = frameCanvas.transferToImageBitmap();
  post(
    {
      type: 'result',
      bitmap: output,
      fps: Math.round(fps * 10) / 10,
      persons: persons.length,
      faces: faces.length,
      ms: Math.round(performance.now() - started),
      error,
    },
    [output],
  );
}

let queue = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    // Bench options. `/lab` sends a bare `{ type: 'init' }`, so both stay at their
    // defaults and the spike behaves exactly as before.
    if (Array.isArray(message.providers) && message.providers.length) {
      initProviders = message.providers;
    }
    if (Number.isFinite(message.inputSize) && message.inputSize > 0) {
      frameLimit = message.inputSize;
    }
    ensureModels().catch(() => {});
    return;
  }
  if (message.type === 'frame' && message.bitmap) {
    // One frame at a time; the hook already drops frames while a result is pending, this
    // queue only protects against a late arrival during model loading.
    const bitmap = message.bitmap;
    queue = queue.then(() => handleFrame(bitmap)).catch((error) => {
      bitmap.close?.();
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  if (message.type === 'close') {
    queue = queue.then(async () => {
      await models?.close();
      models = null;
      self.close();
    });
  }
};
