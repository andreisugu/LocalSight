// Module worker: the whole per-frame pipeline of the spike lives here, off the main
// thread. Frames arrive as ImageBitmaps (transferred), the processed frame leaves as one
// ImageBitmap plus the numbers the overlay shows and the incidents the rule engine
// produced for that frame.
//
// The order per frame is the reference's: detect, blur the faces, render, then let the
// pipeline (tracker -> zones -> rule engine -> event) run on the boxes. Blur stays first
// class: nothing leaves this worker before the faces are blurred, and a frame that cannot
// be blurred never leaves at all (see `guardBitmap`).
import { ZoneAligner, WORK_WIDTH } from './align.js';
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
import { faceInputPlan, padToMultiple, scaleFaceBoxes } from './perf.js';
import { createTracker } from './tracker.js';
import { EDGE, MIN_PERSON_PX, VestTracker, hivisRatio } from './vest.js';
import { zoneActive } from './zones.js';
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

// Zone alignment (`align.js`): how often the current frame is matched to the reference
// and how wide the working image is. The aligner computes the reference features once in
// its constructor; `update()` throttles itself, so this cadence is not a second counter.
const ALIGN_EVERY_N = 5;
const ALIGN_MIN_INLIERS = 40;

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

// Wasm thread count for ORT, resolved by the page (`resolveWasmThreads`). `null` keeps the
// historical default in detectors.js (4 when isolated, 1 otherwise) for `/lab`.
let modelThreads = null;
// The extra head-band blur is a safety net, not the face blur: the operator can turn it
// off for a demo, and the face boxes still stay blurred. Defaults to ON (fail safe).
// It also gates the face-detector input cap in `perf.js`: the cap trades YuNet recall for
// speed, which is only acceptable while this net covers the faces the cap can drop.
let safetyBlur = true;

// Bench options. Defaults are the spike's: probe providers, process the frame at its own
// resolution. `/lab` never sends an `init` payload, so it keeps exactly that behaviour.
let initProviders = null;
// Longest side of the frame handed to the detectors; 0 means "native size". The YOLO graph
// is fixed at 640x640, so this limit changes the frame, not the YOLO tensor.
let frameLimit = 0;
// Opt-in telemetry for the `/lab` ground-plane prototype: the result message then carries
// the tracked boxes and the frame time, instead of only the event count. Live and `/bench`
// never set it, so their messages stay exactly as before.
let trackFeed = false;

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

// The zones drawn on the processed frame, resolved exactly like the pipeline's own list
// (same camera filter, same lab fixture fallback). Drawing is presentation only: the rule
// engine never reads these, so a bad polygon can cost a frame's outline, never a frame.
let overlayZones = [];
// `active_when: engine_on` zones are outlined dimmer while the camera's engine switch is
// off, so the operator can tell configuration from what is actually armed.
let overlayEngineOn = true;

// --- Zone alignment ----------------------------------------------------------------
// One aligner per (camera, reference frame). The reference is the exact frame the polygons
// were drawn on: the Live view resolves it from the zone's `reference_frame_url` or the
// demo still and sends it on `init`/`config`. Without a reference (webcam, no still) there
// is nothing to map from and the configured polygons stay as they are, exactly as before.
let aligner = null;
// Identity of the current aligner input. A different camera or reference rebuilds; equal
// keys are a no-op, so `config` messages do not re-fetch the image.
let alignerKey = null;
// The in-flight reference fetch/decode. Frames await it so the first frames after a camera
// switch cannot race a half-built aligner.
let alignerTask = Promise.resolve();
// One warning per aligner: a repeating failure would flood the console on every frame.
let alignerWarned = false;
// The last zone list an aligned frame produced: if the aligner throws, the frame keeps the
// previous polygons (or none) instead of dropping the outline and the rules mid-pan.
let lastAlignedZones = null;
// The resolved reference URL of the current aligner. Kept so a `config` that only carries
// zones or the engine switch cannot silently disable alignment: `undefined` means "keep the
// reference", while an explicit `null` (webcam) clears it.
let alignerReferenceUrl = null;
// Scratch canvas for the 640-wide working image the aligner reads. Separate from
// `frameCanvas` because the aligner needs the raw frame, before blur and annotations.
let alignCanvas = null;
let alignCtx = null;

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

// Aceeași listă pe care o vede `pipeline.js` după filtrarea pe cameră: zona de laborator
// când nu vine nicio configurație, altfel exact zonele camerei curente. E o funcție
// separată pentru că desenul e best-effort, în timp ce pipeline-ul trebuie să rămână strict.
function overlayZonesFor(cameraId, zones) {
  const list = Array.isArray(zones) ? zones : [];
  if (cameraId === LAB_CAMERA_ID && list.length === 0) return [DEFAULT_LAB_ZONE];
  return list.filter(
    (zone) => zone !== null && typeof zone === 'object' && zone.camera_id === cameraId,
  );
}

function errorText(caught) {
  return caught instanceof Error ? caught.message : String(caught);
}

// The reference image is the frame the polygons were drawn on. It is decoded once per
// camera/reference and scaled to the aligner's working width (640): the aligner normalizes
// coordinates, so a 1280-wide still and a 1920-wide stream describe the same geometry as
// long as their aspect ratio matches.
async function readReferenceImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} pentru ${url}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const width = Math.max(1, Math.min(WORK_WIDTH, bitmap.width));
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('OffscreenCanvas 2d indisponibil');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

// One 640-wide RGBA readback of the raw frame (drawn from `frameCanvas` before the blur and
// the boxes), so the aligner does not downscale the full-resolution frame itself.
function alignImage(width, height) {
  const targetWidth = Math.max(1, Math.min(WORK_WIDTH, width));
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
  if (
    !alignCanvas ||
    alignCanvas.width !== targetWidth ||
    alignCanvas.height !== targetHeight
  ) {
    alignCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    alignCtx = alignCanvas.getContext('2d', { willReadFrequently: true });
  }
  alignCtx.drawImage(frameCanvas, 0, 0, targetWidth, targetHeight);
  return alignCtx.getImageData(0, 0, targetWidth, targetHeight);
}

// Build the aligner for this camera and reference. The key makes repeat `config` messages
// free: the reference is only fetched and decoded when the camera or the URL changes, and
// a stale decode (a second camera switch while the first still downloads) is discarded.
// `referenceUrl: undefined` keeps the reference that is already configured; only an explicit
// string or `null` replaces it.
function configureAligner(cameraId, referenceUrl) {
  const explicit = referenceUrl !== undefined;
  const url = explicit
    ? typeof referenceUrl === 'string' && referenceUrl
      ? referenceUrl
      : null
    : alignerReferenceUrl;
  const key = `${cameraId || ''}\u0000${url || ''}`;
  if (key === alignerKey) return;
  alignerKey = key;
  alignerReferenceUrl = url;
  aligner = null;
  alignerWarned = false;
  lastAlignedZones = null;
  if (!url) {
    // No reference (webcam, camera without a stored frame): keep the configured image-space
    // polygons. Inventing a reference would move zones on motion the operator never drew.
    alignerTask = Promise.resolve();
    return;
  }
  alignerTask = (async () => {
    try {
      const reference = await readReferenceImage(url);
      if (alignerKey !== key) return;
      const candidate = new ZoneAligner({
        reference,
        everyN: ALIGN_EVERY_N,
        minInliers: ALIGN_MIN_INLIERS,
      });
      if (candidate.referenceFeatureCount === 0) {
        console.warn(`[engine] referința de aliniere nu are textură utilă (${url}); alinierea rămâne oprită`);
        return;
      }
      aligner = candidate;
    } catch (caught) {
      if (alignerKey !== key) return;
      console.warn(`[engine] alinierea nu a pornit: ${errorText(caught)}`);
    }
  })();
}

// Per-frame alignment: `null` means "no reference, configured zones as-is"; otherwise the
// list to draw and to test the rules against, plus the state the UI reports. When the view
// is lost the list is empty: a guessed polygon is worse than none, so no zone rule fires.
function alignedZonesFor(width, height) {
  if (!aligner) return { zones: null, aligned: null };
  try {
    const image = alignImage(width, height);
    if (!aligner.update(image)) {
      lastAlignedZones = null;
      return { zones: [], aligned: false };
    }
    const mapped = aligner.alignZones(overlayZones);
    if (!mapped) {
      lastAlignedZones = null;
      return { zones: [], aligned: false };
    }
    lastAlignedZones = mapped;
    return { zones: mapped, aligned: true };
  } catch (caught) {
    // A bug here must not cost the frame: keep the last known polygons (or none), say so
    // once, and let the rest of the pipeline run.
    if (!alignerWarned) {
      alignerWarned = true;
      console.warn(`[engine] alinierea a eșuat pe cadru: ${errorText(caught)}`);
    }
    return {
      zones: Array.isArray(lastAlignedZones) ? lastAlignedZones : [],
      aligned: Boolean(lastAlignedZones),
    };
  }
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
        {
          ...(initProviders ? { providers: initProviders } : {}),
          ...(Number.isFinite(modelThreads) && modelThreads >= 1 ? { threads: modelThreads } : {}),
        },
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

function detectFaces(width, height, plan = faceInputPlan({ safetyBlur, width, height })) {
  if (models.yunetDynamic) {
    // Whole frame (or the capped copy from `perf.js`), padded to multiples of 32 with
    // zeros: the Python edge path. When the head-band safety blur is on, `plan` hands
    // YuNet a downscaled copy; the boxes are then in copy pixels and `frameScale` maps
    // them back in `handleFrame`. The copy never upscales, so a small frame keeps its size.
    const paddedW = padToMultiple(plan.width);
    const paddedH = padToMultiple(plan.height);
    if (!faceCanvas || faceCanvas.width !== paddedW || faceCanvas.height !== paddedH) {
      faceCanvas = new OffscreenCanvas(paddedW, paddedH);
      faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });
    }
    faceCtx.fillStyle = '#000';
    faceCtx.fillRect(0, 0, paddedW, paddedH);
    faceCtx.drawImage(frameCanvas, 0, 0, plan.width, plan.height);
    const { data } = faceCtx.getImageData(0, 0, paddedW, paddedH);
    return {
      blob: rgbaToNchw(data, paddedW, paddedH, { swapRB: true, normalize: false }),
      width: paddedW,
      height: paddedH,
      scale: 1,
      padX: 0,
      padY: 0,
      frameScaleX: plan.scaleX,
      frameScaleY: plan.scaleY,
    };
  }

  // Frozen 640x640 graph: letterbox, then undo it in the decode. The graph already shrinks
  // the frame to 640, so the cap is a no-op here and the factors stay at identity.
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
    frameScaleX: 1,
    frameScaleY: 1,
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
      // The frame never reached the aligner, so no claim is made either way.
      aligned: null,
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

// --- Zone outlines ---------------------------------------------------------------
// Configuration, not a detection: the polygon comes from the zone editor and the worker
// strokes the same list the rules consume, after the blur and the person boxes. The event
// snapshot is captured from this canvas, so an incident JPEG carries the zone the rule
// fired in as well.
const ZONE_STROKE = '#FFEB33';
const ZONE_DASH = [10, 7];
// A zone whose `active_when` follows the engine switch stays visible while the switch is
// off, dimmed and labelled, instead of disappearing and looking deleted.
const ZONE_INACTIVE_ALPHA = 0.4;

// Normalized `[x, y]` points; accepts `{x, y}` too, because the editor stores objects.
// Below three usable points the polygon is not drawable and the zone is skipped.
function zonePoints(zone) {
  const raw = Array.isArray(zone?.polygon) ? zone.polygon : [];
  const points = [];
  for (const point of raw) {
    const x = Array.isArray(point) ? Number(point[0]) : Number(point?.x);
    const y = Array.isArray(point) ? Number(point[1]) : Number(point?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  }
  return points.length >= 3 ? points : null;
}

function drawZones(ctx, zones, engineOn) {
  if (!Array.isArray(zones) || zones.length === 0) return;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (!width || !height) return;

  const fontPx = Math.max(10, Math.round(width / 64));
  const padding = 4;
  for (const zone of zones) {
    const points = zonePoints(zone);
    if (!points) continue;
    const active = zoneActive(zone, engineOn);
    ctx.save();
    try {
      ctx.globalAlpha = active ? 1 : ZONE_INACTIVE_ALPHA;
      ctx.strokeStyle = ZONE_STROKE;
      ctx.lineWidth = 3;
      ctx.setLineDash(ZONE_DASH);
      ctx.lineJoin = 'round';

      ctx.beginPath();
      points.forEach(([x, y], index) => {
        const px = x * width;
        const py = y * height;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();

      // Label on the polygon's top vertex: the corner a reader scans first, and the one
      // least likely to sit under a person box.
      let top = points[0];
      for (const point of points) {
        if (point[1] < top[1] || (point[1] === top[1] && point[0] < top[0])) top = point;
      }
      const name = String(zone.name || zone.id || '?');
      ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';
      const label = fitText(ctx, `ZONĂ: ${name}${active ? '' : ' (inactiv)'}`, Math.max(40, width - padding * 4));
      const boxWidth = Math.min(width, Math.ceil(ctx.measureText(label).width) + padding * 2);
      const boxHeight = fontPx + padding * 2;
      const labelX = Math.max(0, Math.min(width - boxWidth, top[0] * width));
      let labelY = top[1] * height - boxHeight - 3;
      if (labelY < 0) labelY = Math.min(height - boxHeight, top[1] * height + 3);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(labelX, labelY, boxWidth, boxHeight);
      ctx.fillStyle = ZONE_STROKE;
      ctx.fillText(label, labelX + padding, labelY + padding);
    } finally {
      // A malformed zone must not leak a dash pattern or a dim alpha into the next frame.
      ctx.restore();
    }
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
  // The reference decode is a one-off per camera/reference; a frame that raced it would be
  // reported "lost" for no reason, so the first frames wait for it.
  await alignerTask;
  // Alignment reads the raw frame, before the blur and the boxes: after this point the
  // pixels are annotated and the match would describe the overlay, not the camera.
  const alignment = alignedZonesFor(width, height);
  let persons = [];
  let faces = [];
  let events = [];
  let tracked = [];
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

    const facePlan = faceInputPlan({ safetyBlur, width, height });
    const face = detectFaces(width, height, facePlan);
    const outputs = await runYuNet(models, face.blob, face.width, face.height);
    const decodedFaces = decodeYuNet(outputs, {
      inputW: face.width,
      inputH: face.height,
      scoreThreshold: FACE_CONF,
      nmsThreshold: FACE_NMS,
      scale: face.scale,
      padX: face.padX,
      padY: face.padY,
    });
    // A capped detector sees a copy, so its boxes are in copy pixels. The blur, the overlay
    // and the snapshot all stay at frame resolution; map the boxes back once, here.
    faces = scaleFaceBoxes(decodedFaces, face.frameScaleX, face.frameScaleY);
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
    // The head band is the safety net for faces YuNet misses. The operator can turn it
    // off; `blurFaces` above and the fail-closed path below stay untouched either way.
    if (safetyBlur) blurHeads(frameCtx, detections, width, height);
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

  // Zones are configuration, not a detection: a malformed polygon must never cost a
  // frame, so this runs outside the fail-closed blur guard and only warns on failure.
  // `alignment.zones` is the aligned list for this frame, `[]` when the view is lost (no
  // outline implies no armed rule), and `null` when there is no reference at all.
  try {
    drawZones(frameCtx, alignment.zones ?? overlayZones, overlayEngineOn);
  } catch (caught) {
    console.warn(
      `[engine] zonele nu au putut fi desenate: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
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
        // Per-frame zones: the aligned polygons, or none when the view is lost. Omitted
        // (`null`) without a reference, so the pipeline keeps its configured list.
        ...(alignment.zones ? { zones: alignment.zones } : {}),
      });
      events = result.events;
      tracked = result.tracked;
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
      // Zone alignment for this frame: `true` while the polygons were mapped onto the
      // camera view, `false` when the view is lost (no zone rule ran), `null` when the
      // camera has no reference and the configured polygons are used as-is.
      aligned: alignment.aligned,
      // `/lab` only (see `trackFeed`): the tracker's boxes and the frame time, so the
      // ground-plane prototype can turn foot points into metres. `bbox` is frame-normalized,
      // the same coordinates the pipeline and the zone rules use.
      ...(trackFeed
        ? {
          tracks: {
            time: nowS,
            boxes: tracked.map((track) => ({ id: track.trackId, bbox: track.bbox })),
          },
        }
        : {}),
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
    // Engine settings resolved by the page. `/lab` sends neither, so ORT keeps its
    // isolation-based default and the head-band safety blur stays ON.
    if (Number.isFinite(message.wasmThreads) && message.wasmThreads >= 1) {
      modelThreads = Math.floor(message.wasmThreads);
    }
    if (typeof message.safetyBlur === 'boolean') safetyBlur = message.safetyBlur;
    // `/lab` ground-plane prototype only: forward the tracked boxes with each result.
    if (message.trackFeed === true) trackFeed = true;
    pipeline = buildPipeline({
      cameraId: message.cameraId,
      zones: message.zones,
      engineOn: message.engineOn,
    });
    overlayZones = overlayZonesFor(pipelineCameraId, message.zones);
    overlayEngineOn = typeof message.engineOn === 'boolean' ? message.engineOn : true;
    // The reference frame the polygons were drawn on, resolved by the Live view (zone
    // `reference_frame_url`, else the demo still; `null` for the webcam). Fetched once.
    configureAligner(pipelineCameraId, message.referenceUrl);
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
      overlayZones = overlayZonesFor(pipelineCameraId, message.zones);
      overlayEngineOn = typeof message.engineOn === 'boolean' ? message.engineOn : true;
      // A new camera means new zone geometry: the aligner is rebuilt, never re-used.
      configureAligner(pipelineCameraId, message.referenceUrl);
      return;
    }
    if (Array.isArray(message.zones)) {
      pipeline.setZones(message.zones);
      // The outline follows the same camera filter as the rules.
      overlayZones = overlayZonesFor(pipelineCameraId, message.zones);
    }
    if (typeof message.engineOn === 'boolean') {
      pipeline.setEngineOn(message.engineOn);
      overlayEngineOn = message.engineOn;
    }
    // Same camera, possibly a new reference (the operator replaced the frame): the key
    // makes an unchanged URL a no-op.
    configureAligner(pipelineCameraId, message.referenceUrl);
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
