// Pure decisions behind the Live screen: sources, labels and the acknowledgement guard.
// Everything here is free of React so the rules can be checked with `node --test` and the
// view components only have to render what these functions return.
import { PERSON_DETECTOR_LABELS } from '../../engine/detectorFlag.js';

// A double-click is two clicks at the same spot within this window (Chromium uses 500 ms).
// The guard below only cares about the `detail` the browser reports and about a press that
// belongs to a different incident; the window is the upper bound for the latter.
export const ACK_POINTER_WINDOW_MS = 1500;

// The browser engine is opt-in per viewer, not per camera: a presenter enables it once and
// the static site keeps the cheap clip-only path for everyone else.
const LIVE_ENGINE_STORAGE_KEY = 'localsight.liveEngine';

// The one camera in the mock list whose frames come from this machine instead of the
// network. It ships only with the static (mock) build, so the id is the whole contract:
// no stream_url, no demo clip, and a getUserMedia request when it becomes active.
export const WEBCAM_CAMERA_ID = 'webcam-live';

// One <video> node for the life of the view: it owns the decoder and the media pipeline,
// and the worker reads frames from that exact element. Rekeying it per engine state threw
// a fresh element (and a fresh decoder, and a clip restart) at Chromium on every toggle;
// rekeying it per source would hand the worker a detached node when the camera changes
// while the engine runs. So the node never changes and a source swap is an attribute
// update: `src` for a clip, `srcObject` for the webcam.
export const STAGE_VIDEO_KEY = 'live-source';

// Same table as /lab, copied instead of imported so that spike page stays untouched. One
// block per failure the browser can report; the raw error name is appended under the
// Romanian copy so the message stays specific instead of generic.
export const CAMERA_ERRORS = {
  insecure: {
    title: 'Camera nu poate fi deschisă în acest context',
    detail: 'Browserul blochează accesul la cameră fără HTTPS sau localhost. Deschide pagina pe https:// sau pe http://localhost:5173 și încearcă din nou.',
  },
  denied: {
    title: 'Permisiune refuzată',
    detail: 'Ai refuzat accesul la cameră. Permite camera din iconița de lângă bara de adrese, apoi apasă „Încearcă din nou”.',
  },
  notfound: {
    title: 'Nicio cameră disponibilă',
    detail: 'Sistemul nu raportează nicio cameră video utilizabilă sau cea aleasă a fost deconectată. Conectează o cameră sau alege una dintre camerele demo.',
  },
  busy: {
    title: 'Camera este folosită de altă aplicație',
    detail: 'Închide aplicația sau tab-ul care ține camera deschisă, apoi apasă „Încearcă din nou”.',
  },
  unknown: {
    title: 'Camera nu a pornit',
    detail: 'Browserul a respins cererea de acces la cameră din alt motiv decât permisiunea sau lipsa dispozitivului.',
  },
};

const ERROR_CODES = {
  NotAllowedError: 'denied',
  PermissionDeniedError: 'denied',
  SecurityError: 'denied',
  NotFoundError: 'notfound',
  DevicesNotFoundError: 'notfound',
  OverconstrainedError: 'notfound',
  ConstraintNotSatisfiedError: 'notfound',
  NotReadableError: 'busy',
  TrackStartError: 'busy',
  AbortError: 'busy',
  // Headless browsers and containers without a capture backend report this instead of
  // NotFoundError; for the operator it means the same thing: there is no camera.
  NotSupportedError: 'notfound',
};

/** @param {{name?: string, message?: string}} error */
export function cameraErrorFor(error) {
  const name = error?.name || '';
  const code = ERROR_CODES[name] || 'unknown';
  return {
    code,
    name,
    message: error?.message || '',
    ...CAMERA_ERRORS[code],
  };
}

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter: the caller falls back to the probe.
    return null;
  }
}

// `null` means "no choice stored yet": the view probes WebGPU and decides ON only when an
// adapter exists. A stored '0' or '1' always wins, so a reload keeps the operator's choice.
export function readEnginePreference(storage = defaultStorage()) {
  try {
    const stored = storage?.getItem(LIVE_ENGINE_STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Storage can be unavailable; the WebGPU probe decides instead.
  }
  return null;
}

export function storeEnginePreference(next, storage = defaultStorage()) {
  try {
    storage?.setItem(LIVE_ENGINE_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // The choice still applies to this tab even when storage refuses to keep it.
  }
}

/** VITE_DEMO_CAMERA / VITE_DEMO_CLIP syntax: comma-separated, whitespace tolerated. */
export function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// A clip entry may be `camera=clip.mp4` or, from older launchers, a single plain value
// that applies to every camera.
export function demoClipFor(cameraId, entries) {
  if (!cameraId) return null;
  const match = entries.find((entry) => entry.startsWith(`${cameraId}=`));
  if (match) return match.slice(cameraId.length + 1);
  return entries.length === 1 && !entries[0].includes('=') ? entries[0] : null;
}

/** Label shown in the camera menu: status plus why a camera has no demo feed. */
export function cameraOptionLabel(camera, demoCameraIds) {
  const offline = camera?.status === 'offline';
  const local = camera?.id === WEBCAM_CAMERA_ID;
  const inDemo = !demoCameraIds.length || demoCameraIds.includes(camera?.id);
  const suffix = offline ? ' • offline' : local ? ' • cameră locală' : inDemo ? '' : ' • fără feed în demo';
  const name = camera?.code || camera?.id || '';
  const full = camera?.name && camera.name !== name ? `${name} — ${camera.name}` : name;
  return `${full}${suffix}`;
}

/**
 * Resolves everything the stage needs to pick a source. The webcam is never a stream_url
 * or a clip: it is a track owned by the page, so every network path is disabled by id.
 *
 * @returns {{
 *   isOffline: boolean, demoClip: string|null, demoCameraLabel: string,
 *   noLiveForCamera: boolean, showStream: boolean, demoVideoSrc: string|null,
 *   showDemoVideo: boolean, streamFailed: boolean, videoFailed: boolean,
 * }}
 */
export function mediaPlan({
  camera,
  cameras = [],
  demoCameraIds = [],
  demoClipEntries = [],
  baseUrl = '/',
  videoOverride = '',
  streamFailed = false,
  videoFailed = false,
  isWebcam = false,
}) {
  const isOffline = camera?.status === 'offline';
  const demoCameraLabel = demoCameraIds
    .map((id) => cameras.find((item) => item.id === id)?.code || id)
    .join(', ');
  const noLiveForCamera = Boolean(
    demoCameraIds.length && camera?.id && !demoCameraIds.includes(camera.id)
  );
  const showStream = Boolean(
    camera?.stream_url && !streamFailed && !isOffline && !noLiveForCamera && !isWebcam
  );
  const demoClip = isWebcam ? null : demoClipFor(camera?.id, demoClipEntries);
  const mediaVideoOverride = String(videoOverride || '').trim();
  const mediaBaseUrl = baseUrl || '/';
  const demoVideoSrc =
    mediaVideoOverride || (camera?.id ? `${mediaBaseUrl}media/${camera.id}.mp4` : null);
  const showDemoVideo = Boolean(
    demoVideoSrc && !videoFailed && !isOffline && !noLiveForCamera && !isWebcam
  );

  return {
    isOffline,
    demoClip,
    demoCameraLabel,
    noLiveForCamera,
    showStream,
    demoVideoSrc,
    showDemoVideo,
    streamFailed,
    videoFailed,
  };
}

/** The zone the active camera is watched against: configuration, never a detection. */
export function pickActiveZone(zones, camera) {
  const cameraZones = (zones || []).filter((zone) => zone.camera_id === camera?.id);
  return cameraZones.find((zone) => zone.zone_id === camera?.zone_id) || cameraZones[0] || null;
}

// Conversion from the editor's `[{ x, y }, ...]` to the pipeline's `[[x, y], ...]` happens
// in one place. `zone_id` becomes `id`, the only name `zones.js` reads. LiveView memoizes
// the result so `useEngine` receives identical configurations across renders.
export function toEngineZones(zones, cameraId) {
  return (zones || [])
    .filter((zone) => zone.camera_id === cameraId)
    .map((zone) => ({
      id: zone.zone_id,
      camera_id: zone.camera_id,
      name: zone.name,
      rule_type: zone.rule_type,
      active_when: zone.active_when,
      required_ppe: zone.required_ppe || [],
      severity: zone.severity,
      debounce_s: zone.debounce_s,
      escalate_after_s: zone.escalate_after_s,
      polygon: (zone.polygon || [])
        .map((point) =>
          Array.isArray(point)
            ? [Number(point[0]), Number(point[1])]
            : [Number(point?.x), Number(point?.y)]
        )
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
    }));
}

// Why the engine starts on or off: the visitor must be able to tell a fast path from the
// WASM fallback before they press the button.
export function engineReason(gpuAvailable, isWebcam) {
  if (gpuAvailable === null) return 'se verifică WebGPU…';
  if (gpuAvailable) {
    return isWebcam
      ? 'WebGPU disponibil — detecția reală rulează pe fluxul camerei locale.'
      : 'WebGPU disponibil — detecția reală rulează pe acest clip.';
  }
  return 'rulează pe WASM cu 4 fire când izolarea e activă; ~5–6 fps';
}

/**
 * Readouts for the single "Motor & senzori" card. Nothing here invents a number: the
 * browser fps exists only while the worker is running, and the clip fps only when the
 * backend measured it.
 */
export function engineReadout({
  engine,
  isWebcam,
  webcamLive,
  activeZone,
  activeCamera,
  showStream,
  browserEngineOn,
  engineSource,
  health,
  kpis,
}) {
  const browserEngineFps = engine.status === 'running' && engine.fps ? engine.fps : null;
  const liveFps = activeCamera?.id ? health?.live_fps?.[activeCamera.id] : null;
  const pipelineActive = Boolean(liveFps) || Boolean(browserEngineFps);
  const pipelineLabel = isWebcam
    ? webcamLive
      ? browserEngineFps
        ? `${browserEngineFps.toFixed(1)} FPS • browser`
        : 'cameră locală • oprit'
      : 'cameră locală • fără flux'
    : browserEngineFps
      ? `${browserEngineFps.toFixed(1)} FPS • browser`
      : liveFps
        ? `${liveFps} FPS • Live`
        : 'FPS necunoscut';
  const zoneInactive = activeZone?.active_when === 'engine_on' && !activeCamera?.engine_on;
  const zoneLabel = activeZone
    ? `${activeZone.name}${zoneInactive ? ' (inactiv)' : ''}`
    : activeCamera?.subtitle || activeCamera?.name || '—';
  // The provider is the one ORT actually created, not the one we asked for: on a machine
  // where WebGPU is refused, saying "browser" would hide which path is running. The model
  // half names the person graph the worker loaded; `?detector` is the only way it is not
  // YOLO26n, and the default build never sends it.
  const personModel = PERSON_DETECTOR_LABELS[engine.detector] || PERSON_DETECTOR_LABELS.yolo;
  const modelLabel = browserEngineOn && engineSource
    ? `${personModel} · ${engine.actualProviders?.length ? engine.actualProviders.join('+') : 'browser'}`
    : showStream
      ? 'edge · YOLO26'
      : 'oprit';
  const latencyLabel =
    kpis.detection_to_alert_latency_s === '—' ? '—' : `${kpis.detection_to_alert_latency_s}s`;

  return { pipelineActive, pipelineLabel, zoneLabel, modelLabel, latencyLabel };
}

export function engineBadgeCopy({ status, fps, useMock }) {
  if (status === 'running') {
    return `${useMock ? 'detecție reală · ' : ''}procesat local · ${fps ? fps.toFixed(1) : '—'} fps`;
  }
  if (status === 'error' || status === 'unsupported') {
    return 'motor indisponibil · flux brut ascuns';
  }
  return 'se pregătește · flux brut ascuns';
}

// The message under the opaque placeholder. While the worker is running the canvas covers
// the placeholder, so this copy is only the warm-up/failure state.
export function hiddenRawCopy(status) {
  return status === 'error' || status === 'unsupported'
    ? 'motorul nu a produs cadre procesate — fluxul brut rămâne ascuns'
    : 'se pregătește — fluxul brut rămâne ascuns până la primul cadru procesat';
}

export function edgeIsActive(health) {
  const age = health?.edge_last_seen_s;
  return Boolean(health?.db && age != null && age < 60);
}

/**
 * Configuration outline for the active zone. Returns null when the polygon is not
 * drawable, and keeps the label on the polygon's own top-left corner so it never covers
 * the honest note at the bottom.
 */
export function outlineForZone(zone) {
  const points = (zone?.polygon || []).filter(
    (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (points.length < 3) return null;
  return {
    pointsAttr: points.map((point) => `${point.x},${point.y}`).join(' '),
    leftPct: Math.min(...points.map((point) => point.x)) * 100,
    topPct: Math.min(...points.map((point) => point.y)) * 100,
  };
}

/**
 * The acknowledgement guard. `detail > 1` is the second click of a double-click: the
 * browser reports it because both clicks share coordinates and timing, even when the
 * second one lands on a different card. Keyboard activation reports `detail === 0` and
 * has no pointerdown, so it is always a deliberate decision. A real click also has to
 * name the incident pressed on: a card that slid under the pointer is not a target.
 */
export function shouldAcceptAck({
  detail,
  eventId,
  press,
  now,
  windowMs = ACK_POINTER_WINDOW_MS,
}) {
  if (detail > 1) return false;
  const samePress = Boolean(
    press && press.eventId === eventId && now - press.at <= windowMs
  );
  if (detail > 0 && !samePress) return false;
  return true;
}
