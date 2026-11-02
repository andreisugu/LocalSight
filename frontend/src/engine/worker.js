// Module worker: the whole per-frame pipeline of the spike lives here, off the main
// thread. Frames arrive as ImageBitmaps (transferred), the processed frame leaves as one
// ImageBitmap plus the numbers the overlay shows and the incidents the rule engine
// produced for that frame.
//
// The order per frame is the reference's: detect, blur the faces, render, then let the
// pipeline (tracker -> zones -> rule engine -> event) run on the boxes. Blur stays first
// class: nothing leaves this worker before the faces are blurred, and a frame that cannot
// be blurred never leaves at all (see `guardBitmap`).
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
import { clampRect, expandedRect, headBandRects } from './blur.js';
import { SNAPSHOT_PENDING, createPipeline } from './pipeline.js';
import { createTracker } from './tracker.js';
import { EDGE, MIN_PERSON_PX, VestTracker, hivisRatio } from './vest.js';
import { DEFAULT_LAB_ZONE } from './zones.default.js';

const PERSON_CONF = 0.35;
const PERSON_NMS = 0.45;
const FACE_CONF = 0.6;
const FACE_NMS = 0.3;
// Same anonymising strength as the Python `_strong_blur`: shrink 8x, blur, scale back.
const BLUR_SCALE = 8;
const BLUR_SIGMA = 25 / BLUR_SCALE;

// Event snapshot: the frame that produced an incident, downscaled to a thumbnail-sized
// JPEG. 960 px on the long side keeps each capture ~50-90 KB while staying readable in the
// incident card and the detail view, and it is cheap enough to do on the rare event frame.
const SNAPSHOT_MAX_EDGE = 960;
const SNAPSHOT_QUALITY = 0.8;

// PPE state -> badge. `unknown` is a first-class state: a track that has not collected
// enough colour samples yet must be visible and must never look like a pass.
const PPE_BADGES = Object.freeze({
  vest: { text: 'VESTĂ', colour: '#16A34A' },
  no_vest: { text: 'FĂRĂ VESTĂ', colour: '#D73833' },
  unknown: { text: 'PPE ?', colour: '#475569' },
});

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
// Dedicated scratch canvas for the event snapshot, sized to the downscaled frame. It is
// separate from `frameCanvas` because that one is transferred to the page on every frame.
let snapshotCanvas = null;
let snapshotCtx = null;

// Fail-closed placeholder. `guardCanvas` is the one offscreen canvas that never receives a
// source frame, so when the models are missing (or a blur pass throws) this is the only
// bitmap that can reach the main thread. A raw frame then has no path out of the worker.
let guardCanvas = null;
let guardCtx = null;
const GUARD_BG = '#0B0B0B';
const GUARD_TITLE = 'PRIVACY: modelul de blur nu este disponibil';

let lastFrameAt = 0;
let fps = 0;

// One pipeline per worker: it owns the tracker ids, the rule state and the incident
// cooldown for this camera. The lab has no backend, so its zone is the hard-coded
// full-frame fixture in zones.default.js; Live sends the configured zones instead.
const LAB_CAMERA_ID = 'lab';
let pipeline = null;
let pipelineCameraId = LAB_CAMERA_ID;

// PPE colour state, one per pipeline. `vests` is the ppe.py `VestTracker`; `vestTracks`
// mirrors the pipeline's IoU tracker only to learn each detection's track id before
// `step` runs (see `measureVests`). Both start empty when the pipeline is rebuilt.
let vests = null;
let vestTracks = null;
// Every result message carries this shape, so the UI never has to guess at a missing key.
const EMPTY_VEST = Object.freeze({ vest: 0, noVest: 0, unknown: 0 });

function resetVestState() {
  vests = new VestTracker();
  vestTracks = createTracker();
}

// Pipeline-ul se construiește din configurația primită la `init`. `/lab` și `/bench` nu
// trimit nici cameră, nici zone, deci primesc fixture-ul de laborator. Pentru Live, lipsa
// zonelor înseamnă „nu detecta nimic”: nu cădem niciodată pe zona pe tot cadrul.
function buildPipeline({ cameraId, zones, engineOn } = {}) {
  const resolvedCameraId = typeof cameraId === 'string' && cameraId ? cameraId : LAB_CAMERA_ID;
  let resolvedZones = Array.isArray(zones) ? zones : [];
  if (resolvedCameraId === LAB_CAMERA_ID && resolvedZones.length === 0) {
    resolvedZones = [DEFAULT_LAB_ZONE];
  }
  pipelineCameraId = resolvedCameraId;
  // A camera change means new tracker ids, so the vest history keyed by them starts over.
  resetVestState();
  return createPipeline({
    cameraId: resolvedCameraId,
    zones: resolvedZones,
    engineOn: typeof engineOn === 'boolean' ? engineOn : true,
    incidentCooldownS: 60,
  });
}

// --- Media clock ---------------------------------------------------------------
// `pipeline.step` needs monotonic seconds that follow the video, not the wall clock: a
// looping clip rewinds `currentTime` to 0, and "1 s in the zone" must stay 1 s of the
// footage the operator is watching. The hook sends `mediaTime` (video.currentTime) with
// every frame; the clock accumulates the advance between processed frames, so a dropped
// frame still counts, and falls back to the arrival clock across a loop or a seek.
const BACKWARD_JUMP_S = 0.5;
const FALLBACK_STEP_S = 1 / 30;
let lastMediaRawS = null;
let lastMediaNowS = 0;
let lastArrivalS = null;

function mediaSeconds(message) {
  const raw = message.mediaTime;
  const arrivalS = message.timestamp / 1000;
  const hasArrival = Number.isFinite(arrivalS);
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    if (lastMediaRawS === null) {
      // Start at the position in the footage, not at zero: a clip opened mid-way is
      // still on its own timeline.
      lastMediaRawS = raw;
      lastMediaNowS = raw;
      if (hasArrival) lastArrivalS = arrivalS;
      return lastMediaNowS;
    }
    const delta = raw - lastMediaRawS;
    if (delta > 0 && delta <= BACKWARD_JUMP_S) {
      lastMediaRawS = raw;
      lastMediaNowS += delta;
      // Keep the fallback baseline fresh, so a later gap is not counted twice.
      if (hasArrival) lastArrivalS = arrivalS;
      return lastMediaNowS;
    }
    // A backward jump is a loop or a seek, a huge forward jump a seek: neither tells us
    // how long the tab actually watched, so the arrival clock covers that gap.
    lastMediaRawS = raw;
  }
  // No usable media clock (a frozen `currentTime`, or an older caller): advance by frame
  // arrival time, which is still monotonic and close enough for the rule windows.
  if (hasArrival && lastArrivalS !== null) {
    lastMediaNowS += Math.max(0, arrivalS - lastArrivalS);
  } else {
    lastMediaNowS += FALLBACK_STEP_S;
  }
  if (hasArrival) lastArrivalS = arrivalS;
  return lastMediaNowS;
}

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
  // The PPE colour pass reads every processed frame, so ask for a CPU-backed store:
  // without it Chrome copies the frame back from the GPU on every `getImageData`.
  frameCtx = frameCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
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

// `clampRect` lives in blur.js: the same geometry draws the blur and is pinned by tests.

// --- Fail closed ---------------------------------------------------------------
// A privacy guard that degrades to "show the raw frame" is not a guard. When the models
// are missing, or a pass that stands between the camera and the screen throws, the frame
// stays in the worker and the main thread gets this opaque placeholder instead.

// Ellipsis instead of clipping: an error message must stay readable inside the frame.
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}

// Draws the placeholder on a canvas that has never held a source frame, then transfers it.
function guardBitmap(width, height, detail) {
  if (!guardCanvas || guardCanvas.width !== width || guardCanvas.height !== height) {
    guardCanvas = new OffscreenCanvas(width, height);
    guardCtx = guardCanvas.getContext('2d', { alpha: false });
  }
  guardCtx.fillStyle = GUARD_BG;
  guardCtx.fillRect(0, 0, width, height);
  const titlePx = Math.max(12, Math.round(width / 42));
  const detailPx = Math.max(11, Math.round(titlePx * 0.62));
  const padding = Math.round(titlePx * 1.2);
  const maxTextWidth = width - padding * 2;
  // Below the LIVE/ÎNREGISTRARE badges the view draws over the frame, so the message is
  // readable in Live and still says the same thing in /lab.
  const titleTop = Math.max(padding, Math.round(height * 0.16));
  guardCtx.textBaseline = 'top';
  guardCtx.fillStyle = '#FF8A8A';
  guardCtx.font = `bold ${titlePx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  guardCtx.fillText(fitText(guardCtx, GUARD_TITLE, maxTextWidth), padding, titleTop);
  guardCtx.fillStyle = '#C9C9C9';
  guardCtx.font = `${detailPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  guardCtx.fillText(
    fitText(guardCtx, String(detail || ''), maxTextWidth),
    padding,
    titleTop + Math.round(titlePx * 1.6),
  );
  return guardCanvas.transferToImageBitmap();
}

// Overwrite whatever a failed frame left in the scratch canvas: the placeholder is drawn
// elsewhere, but the source pixels must not survive anywhere in the worker either.
function blankFrame(width, height) {
  frameCtx.fillStyle = GUARD_BG;
  frameCtx.fillRect(0, 0, width, height);
}

// The only message a frame that could not be blurred may produce. `fps: 0` is deliberate:
// the engine did not process this frame, and a rate here would be a number the UI can
// mistake for a working engine.
function postGuardedFrame(width, height, detail) {
  const bitmap = guardBitmap(width, height, detail);
  post(
    {
      type: 'result',
      bitmap,
      fps: 0,
      persons: 0,
      faces: 0,
      ms: 0,
      vest: EMPTY_VEST,
      events: [],
      error: detail || 'modelul de blur nu este disponibil',
    },
    [bitmap],
  );
}

// --- PPE colour, on the raw frame ----------------------------------------------
// `Pipeline.process` fills `vest` before the blur, from the unblurred frame. This is the
// same pass: the pixels are still the camera's, the ratio never leaves this worker, and
// only the state string goes to the pipeline and to the UI.

// `vest_sample`'s gate from ppe.py: a person too small, or cut by the frame edge, says
// nothing about the vest. The thresholds are vest.js's, so the two files cannot drift.
function frameCountsForVest(bbox, height) {
  if ((bbox[3] - bbox[1]) * height < MIN_PERSON_PX) return false;
  return !(bbox[0] <= EDGE || bbox[1] <= EDGE || bbox[2] >= 1 - EDGE || bbox[3] >= 1 - EDGE);
}

// One getImageData per person, over that person's box, then `hivisRatio` on the crop.
// The box is the read and not the torso band because the band layout (0.2..0.8 wide,
// 0.15..0.55 tall) lives in `hivisRatio`: on a crop, `[0, 0, 1, 1]` makes it scan the
// crop's band, which is the same pixels it would scan on the whole frame. The band is 24%
// of the box, so this copies tens of KB per person instead of a whole frame, and the
// per-pixel loop still walks the band only. Rounding the box to whole pixels can move a
// band edge by one pixel against the full-frame read, which is noise for a ratio that is
// smoothed over 30 frames.
function vestRatio(ctx, bbox, width, height) {
  const rect = clampRect(
    bbox[0] * width,
    bbox[1] * height,
    bbox[2] * width,
    bbox[3] * height,
    width,
    height,
  );
  if (rect.width < 2 || rect.height < 2) return null;
  return hivisRatio(ctx.getImageData(rect.left, rect.top, rect.width, rect.height), [0, 0, 1, 1]);
}

// ppe.py's `vest` dict and the state list `pipeline.js` indexes like `detections`: one
// ratio per person from the raw frame, one `VestTracker.update` per track, one state per
// detection, in detection order.
//
// The track ids are the only thing the reference does not have to rebuild: `step()` runs
// the pipeline's own tracker after the pixels are gone, so the id of a detection is not
// known yet when its colour has to be read. A second instance of the same deterministic
// tracker, fed the same detections in the same order every frame, produces the same ids
// (tracker.js matches greedily on IoU, nothing there is random); both start empty when
// the pipeline is built, so they cannot drift apart over a session.
// The colour is read from the capped canvas, but the size gates (the 80 px sample gate and
// `MIN_PERSON_PX_NO_VEST`) are in SOURCE-frame pixels, exactly like `ppe.py`, which runs on
// the camera frame. Otherwise capping 1080p to 1280 would silently make every person
// "small" and block `no_vest` again.
function measureVests(detections, width, height, nowS, sourceHeight = height) {
  if (!vests || !vestTracks) resetVestState();
  vests.prune(nowS);
  // Pixels first, tracker state second: a failed read leaves both trackers exactly where
  // they were, so skipping `step` on the error keeps them on the same frame.
  const ratios = detections.map((detection) =>
    frameCountsForVest(detection.bbox, sourceHeight)
      ? vestRatio(frameCtx, detection.bbox, width, height)
      : null,
  );
  const tracked = vestTracks.update(detections, nowS * 1000);
  const states = [];
  const summary = { vest: 0, noVest: 0, unknown: 0 };
  for (let index = 0; index < detections.length; index += 1) {
    const { bbox, confidence } = detections[index];
    const personPx = (bbox[3] - bbox[1]) * sourceHeight;
    const state = vests.update(tracked[index].trackId, ratios[index], confidence, nowS, personPx);
    states.push(state);
    if (state === 'vest') summary.vest += 1;
    else if (state === 'no_vest') summary.noVest += 1;
    else summary.unknown += 1;
  }
  return { states, summary };
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
    blurRect(ctx, expandedRect(face.x1, face.y1, face.x2, face.y2, width, height));
  }
}

// The safety net `privacy.py` has and the browser port had dropped: after the face boxes,
// blur the top 35% of every person box. YuNet misses profile and distant faces; the person
// detector does not, so this covers the face YuNet never boxed. Ordered faces first, then
// persons, exactly like `FaceBlurrer.blur_with_faces`, so an overlap is blurred twice.
function blurHeads(ctx, detections, width, height) {
  const boxes = detections.map((detection) => detection.bbox);
  for (const rect of headBandRects(boxes, width, height)) blurRect(ctx, rect);
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

// One small badge per person, on the same processed canvas as the boxes: the incident
// snapshot therefore carries the PPE state that was true when the event fired. The badge
// sits on the person label row, right-aligned above the box; when that row is too narrow
// for both, it stacks one row above the `PERSON <score>` label, never inside the box (the
// top 35% is the head band the blur covers). The state is never hidden: every person gets
// exactly one badge, `unknown` included.
function drawPpeBadges(ctx, persons, states) {
  const fontPx = Math.round(ctx.canvas.width / 55);
  if (fontPx < 1) return;
  const padding = 3;
  const rowHeight = fontPx + padding * 2;
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';

  for (let index = 0; index < persons.length; index += 1) {
    const person = persons[index];
    const badge = PPE_BADGES[states[index]] || PPE_BADGES.unknown;
    const rect = clampRect(person.x1, person.y1, person.x2, person.y2, canvasWidth, canvasHeight);
    if (rect.width < 2 || rect.height < 2) continue;

    const badgeWidth = Math.round(ctx.measureText(badge.text).width) + padding * 2;
    const score = Number.isFinite(person.score) ? person.score.toFixed(2) : '0.00';
    const labelWidth = Math.round(ctx.measureText(`PERSON ${score}`).width) + padding * 2;
    // Same row as `drawBoxes`, which puts the PERSON label above the box's top-left.
    let y = Math.max(0, rect.top - rowHeight);
    let x = Math.max(0, Math.min(canvasWidth - badgeWidth, rect.left + rect.width - badgeWidth));
    if (x < rect.left + labelWidth + padding) {
      // No room next to the PERSON label. Never drop into the box (the top 35% is the face
      // the blur covers): stack a second row above the label instead, and only when the
      // box starts at the very top of the frame fall back to just below the box.
      const stacked = rect.top - rowHeight * 2;
      y = stacked >= 0
        ? stacked
        : Math.min(canvasHeight - rowHeight, rect.top + rect.height + 2);
    }

    ctx.fillStyle = badge.colour;
    ctx.fillRect(x, y, badgeWidth, rowHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(badge.text, x + padding, y + padding);
  }
}

// --- Event snapshot -------------------------------------------------------------
// The frame is already blurred (faces and the head band) and annotated when this runs, and
// it is read from `frameCanvas`, never from the incoming bitmap: a snapshot can therefore
// never contain a raw face. The JPEG is intentionally smaller than the processed frame;
// the live overlay keeps the full resolution, the incident store only needs a thumbnail.

// One Blob per event frame, shared by every event that frame produced. The worker must NOT
// create the object URL: a blob URL created in a worker is revoked when that worker is
// terminated, and opening an incident unmounts Live and terminates the engine worker. The
// page creates and owns the URL in `useEngine`; the app bounds the count (engine history 50,
// incident list 200), and a reload clears them with the document.
async function snapshotBlob(width, height) {
  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(width, height));
  const snapWidth = Math.max(1, Math.round(width * scale));
  const snapHeight = Math.max(1, Math.round(height * scale));
  if (!snapshotCanvas || snapshotCanvas.width !== snapWidth || snapshotCanvas.height !== snapHeight) {
    snapshotCanvas = new OffscreenCanvas(snapWidth, snapHeight);
    snapshotCtx = snapshotCanvas.getContext('2d', { alpha: false });
  }
  snapshotCtx.imageSmoothingEnabled = true;
  snapshotCtx.imageSmoothingQuality = 'high';
  snapshotCtx.drawImage(frameCanvas, 0, 0, snapWidth, snapHeight);
  const blob = await snapshotCanvas.convertToBlob({
    type: 'image/jpeg',
    quality: SNAPSHOT_QUALITY,
  });
  return blob;
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

async function handleFrame(message) {
  // Două fire de lucru au atins funcția asta: una a adăugat mărimea țintă (bench),
  // cealaltă a adăugat ceasul media și pipeline-ul. Ambele au nevoie de bitmap.
  const bitmap = message.bitmap;
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (!sourceWidth || !sourceHeight) {
    bitmap.close();
    return;
  }
  const target = targetFrameSize(sourceWidth, sourceHeight);
  const width = target.width;
  const height = target.height;

  // Fail closed before a single source pixel is read: once either graph failed to load,
  // nothing from the camera leaves this worker for the rest of its life. The page keeps an
  // opaque placeholder and the panel says "eroare", instead of a raw feed at full rate.
  if (modelError) {
    bitmap.close();
    postGuardedFrame(width, height, modelError.message);
    return;
  }

  const nowS = mediaSeconds(message);
  updateFps();
  ensureFrameCanvas(width, height);
  frameCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const started = performance.now();
  let persons = [];
  let faces = [];
  let events = [];
  let error = null;
  let detected = false;
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
    detected = true;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    if (!modelError) modelError = new Error(error);
  }

  // Without detections there is nothing to blur: `blurFaces` would have no boxes and the
  // raw frame would go out "processed". It does not go out at all.
  if (!detected) {
    blankFrame(width, height);
    postGuardedFrame(width, height, error || 'detecția a eșuat');
    return;
  }

  // The pipeline speaks frame-normalized boxes (0..1); the detector returns frame pixels.
  const detections = persons.map((person) => ({
    bbox: [
      Math.max(0, Math.min(1, person.x1 / width)),
      Math.max(0, Math.min(1, person.y1 / height)),
      Math.max(0, Math.min(1, person.x2 / width)),
      Math.max(0, Math.min(1, person.y2 / height)),
    ],
    confidence: person.score,
  }));

  // PPE colour must read the pixels the camera produced, so it runs before `blurFaces`
  // overwrites them. A failure here is a wiring bug, not a broken model: the frame
  // carries the error and `step` is skipped, because a half-read frame must not advance
  // the pipeline's tracker past the mirror in `measureVests`.
  let vestStates = [];
  let vest = EMPTY_VEST;
  let vestFailed = false;
  if (pipeline) {
    try {
      const measured = measureVests(detections, width, height, nowS, sourceHeight);
      vestStates = measured.states;
      vest = measured.summary;
    } catch (caught) {
      vestFailed = true;
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  // Blur, then boxes: a throw here means the frame is only partially covered, so it is
  // never forwarded. A render failure also stops the engine: the next frame could not be
  // trusted either.
  let blurred = false;
  try {
    blurFaces(frameCtx, faces, width, height);
    blurHeads(frameCtx, detections, width, height);
    drawBoxes(frameCtx, persons, '#FFEB33', 'PERSON');
    drawBoxes(frameCtx, faces, '#33E1FF', null);
    blurred = true;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    if (!modelError) modelError = new Error(error);
  }

  if (!blurred) {
    blankFrame(width, height);
    postGuardedFrame(width, height, error || 'blurul a eșuat');
    return;
  }

  // PPE badges are cosmetic: a failure here omits them, but the frame is already blurred
  // and annotated, so it still goes out. Skipped entirely when the colour pass failed (the
  // state is unknown for every track then, and a badge would be a guess).
  if (!vestFailed && vestStates.length > 0) {
    try {
      drawPpeBadges(frameCtx, persons, vestStates);
    } catch (caught) {
      console.warn(
        `[engine] badge-ul PPE nu a putut fi desenat: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  // A failure here is a wiring bug, not a broken model: report it per frame instead of
  // poisoning `modelError`, which would stop the engine for good.
  if (!modelError && pipeline && !vestFailed) {
    try {
      const result = pipeline.step(detections, nowS, {
        frameWidth: width,
        frameHeight: height,
        // One PPE state per detection, in the order `step` receives them; a PPE zone
        // only fires on `no_vest`, so `unknown` stays silent.
        vestStates,
        // pipeline.step runs before the snapshot exists: the rendered frame is captured
        // right below, from the same canvas that is about to be posted. The placeholder is
        // only the fallback if that capture fails.
        snapshotUrl: SNAPSHOT_PENDING,
      });
      events = result.events;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  // Only a frame that produced an incident pays for a snapshot. It is taken here, after the
  // blur and the boxes were drawn on `frameCanvas` and before that canvas is transferred,
  // so the JPEG is the processed frame, never the raw bitmap above. Every event of this
  // frame shares one Blob; the page turns it into an object URL. A failure leaves
  // pipeline.js's `SNAPSHOT_PENDING` in place and is reported on the result, because the
  // incident itself is still real.
  if (events.length > 0) {
    try {
      const blob = await snapshotBlob(width, height);
      for (const incident of events) incident.snapshot_blob = blob;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      error = error ? `${error}; captura incidentului: ${detail}` : `captura incidentului: ${detail}`;
    }
  }

  const output = frameCanvas.transferToImageBitmap();
  post(
    {
      type: 'result',
      bitmap: output,
      fps: Math.round(fps * 10) / 10,
      persons: persons.length,
      faces: faces.length,
      ms: Math.round(performance.now() - started),
      // What the PPE colour pass saw this frame, for the overlay and the lab readout:
      // tracks with a vest, tracks provably without one, and tracks not judgeable yet.
      vest,
      events,
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
    pipeline = buildPipeline({
      cameraId: message.cameraId,
      zones: message.zones,
      engineOn: message.engineOn,
    });
    ensureModels().catch(() => {});
    return;
  }
  if (message.type === 'config') {
    // O schimbare de cameră cere alt pipeline (tracker și cooldown proprii); restul
    // actualizărilor se aplică pe loc, fără să pierdem starea.
    const nextCameraId =
      typeof message.cameraId === 'string' && message.cameraId ? message.cameraId : pipelineCameraId;
    if (!pipeline || nextCameraId !== pipelineCameraId) {
      pipeline = buildPipeline({
        cameraId: nextCameraId,
        zones: message.zones,
        engineOn: message.engineOn,
      });
      return;
    }
    if (Array.isArray(message.zones)) pipeline.setZones(message.zones);
    if (typeof message.engineOn === 'boolean') pipeline.setEngineOn(message.engineOn);
    return;
  }
  if (message.type === 'frame' && message.bitmap) {
    // One frame at a time; the hook already drops frames while a result is pending, this
    // queue only protects against a late arrival during model loading.
    queue = queue.then(() => handleFrame(message)).catch((error) => {
      message.bitmap?.close?.();
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
