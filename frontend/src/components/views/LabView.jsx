import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CameraOff,
  Cpu,
  Crosshair,
  Ruler,
  RotateCcw,
  Upload,
  Video,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useEngine } from '../../engine/useEngine';
import { DEFAULT_LAB_ZONE } from '../../engine/zones.default';
import {
  footPointFromBox,
  groundMetrics,
  homographyFromPoints,
  projectPoint,
  smoothSpeed,
} from '../../engine/groundPlane.js';

const MODEL_HINT = `${import.meta.env.BASE_URL}models/efficientdet_lite0.onnx + ${import.meta.env.BASE_URL}models/yunet.onnx`;

const SOURCE_CLIP = 'clip';
const SOURCE_CAMERA = 'camera';

// Ground-plane prototype (docs/product/innovation-engine.md §2.1). The four clicked points
// are stored frame-normalized so they survive a resize, and mapped in click order onto a
// rectangle that starts at the origin. The dimensions are the operator's tape measure, not
// a number this page can check.
const DEFAULT_RECT_WIDTH_M = 10;
const DEFAULT_RECT_HEIGHT_M = 10;
// A box whose bottom sits on the frame edge has no visible foot: the tracker's own gate
// (`TRUNCATED_BOTTOM` in pipeline.js) uses the same idea, and a truncated person would
// otherwise report a metre value for a point that is off-frame.
const TRUNCATED_BOTTOM = 0.985;
// Weight of the newest speed sample. At ~5 fps this is about four frames of memory.
const SPEED_SMOOTHING_ALPHA = 0.35;
// Longest gap a speed reading may bridge. A track that vanishes and comes back with the same
// id would otherwise average over the occlusion. The headless single-thread run processes at
// ~0.7 fps, so two consecutive frames already take ~1.4 s: anything below that would discard
// real samples on slow hardware.
const MAX_SAMPLE_GAP_S = 2.5;

/** Romanian decimal formatting for metres; `—` when there is no number. */
function formatMetres(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ro-RO', { maximumFractionDigits: 2 });
}

/** Two decimals for a speed, or `null` when the reading is not usable. */
function formatSpeed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}



// One block per failure the browser can report. The copy says what the operator can do;
// the raw error name is appended below it so the message stays specific, never generic.
const CAMERA_ERRORS = {
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
    detail: 'Sistemul nu raportează nicio cameră video utilizabilă sau cea aleasă a fost deconectată. Conectează o cameră sau alege sursa „Clip”.',
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

function cameraErrorFor(error) {
  const name = error?.name || '';
  const code = {
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
  }[name] || 'unknown';
  return {
    code,
    name,
    message: error?.message || '',
    ...CAMERA_ERRORS[code],
  };
}

// Spike page: proves EfficientDet + YuNet + the zone rule engine run in the browser on a looping
// clip or on the laptop webcam. No backend: the zone is the full-frame lab fixture, and
// the incidents live in memory for as long as the tab is open.
export default function LabView() {
  const { isDarkMode, themeStyles } = useTheme();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [clipUrl, setClipUrl] = useState(import.meta.env.VITE_DEMO_VIDEO || '');
  const [objectUrl, setObjectUrl] = useState('');
  const [source, setSource] = useState(SOURCE_CLIP);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [stream, setStream] = useState(null);
  const [cameraState, setCameraState] = useState('idle'); // idle | requesting | live | error
  const [cameraError, setCameraError] = useState(null);

  // The live MediaStream is also held in a ref: unmount hooks and the request-race guard
  // must stop tracks without going through React state.
  const streamRef = useRef(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  // The engine runs only when there is something to feed it: a loaded clip or a live camera
  // stream. Disabling it is what tears the worker and its frame loop down, so a denied
  // permission (or a clip that was never picked) never loads the ONNX graphs for nothing.
  // A clip that is already loaded keeps the worker warm across a switch to the camera.
  const engineEnabled = Boolean(stream) || Boolean(clipUrl);

  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: engineEnabled,
    // Prototype only: ask the worker for the tracker's boxes so foot points can be turned
    // into metres here. Without this the engine's numbers reach the page as counts only.
    trackFeed: true,
  });

  // --- Ground plane calibration (prototype) -------------------------------------
  // Four clicks on the current frame, in order around the rectangle; `widthM`/`heightM` are
  // the real dimensions the operator measured. `/lab` only: Live and the rules never see it.
  const [calibration, setCalibration] = useState({
    points: [],
    widthM: DEFAULT_RECT_WIDTH_M,
    heightM: DEFAULT_RECT_HEIGHT_M,
  });
  const [picking, setPicking] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [trackRows, setTrackRows] = useState([]);
  const overlayRef = useRef(null);
  // `H` is kept next to the samples so a recalibration throws the old metres away instead of
  // smoothing a new map into an old speed.
  const trackStateRef = useRef({ H: null, entries: new Map() });

  const groundH = useMemo(() => {
    const { points, widthM, heightM } = calibration;
    if (points.length !== 4) return null;
    if (!Number.isFinite(widthM) || !Number.isFinite(heightM)) return null;
    if (!(widthM > 0) || !(heightM > 0)) return null;
    return homographyFromPoints(points, [
      { x: 0, y: 0 },
      { x: widthM, y: 0 },
      { x: widthM, y: heightM },
      { x: 0, y: heightM },
    ]);
  }, [calibration]);

  /** Where the processed frame actually sits inside its CSS box (`object-contain`). */
  const contentRect = useCallback((canvas) => {
    const boxWidth = canvas.clientWidth;
    const boxHeight = canvas.clientHeight;
    const frameWidth = canvas.width || boxWidth;
    const frameHeight = canvas.height || boxHeight;
    if (!boxWidth || !boxHeight || !frameWidth || !frameHeight) return null;
    const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight);
    return {
      scale,
      offsetX: (boxWidth - frameWidth * scale) / 2,
      offsetY: (boxHeight - frameHeight * scale) / 2,
      frameWidth,
      frameHeight,
    };
  }, []);

  const releaseStream = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    if (current) current.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((device) => device.kind === 'videoinput'));
    } catch (error) {
      // Without the list the select falls back to the default camera; the stream itself
      // still works, so this is a warning and not a page-level error.
      console.warn('enumerateDevices a eșuat', error);
      setDevices([]);
    }
  }, []);

  const startCamera = useCallback(async (wantedId) => {
    // getUserMedia exists only in a secure context (https or localhost). Saying so beats a
    // black canvas on a LAN IP over plain http.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraError({ code: 'insecure', name: 'getUserMedia undefined', message: '', ...CAMERA_ERRORS.insecure });
      return;
    }

    const request = requestRef.current + 1;
    requestRef.current = request;
    setCameraState('requesting');
    setCameraError(null);

    // Stop the previous track before asking again: some drivers refuse a second open of the
    // same device ("NotReadableError").
    const previous = streamRef.current;
    streamRef.current = null;
    if (previous) previous.getTracks().forEach((track) => track.stop());
    setStream(null);

    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        ...(wantedId ? { deviceId: { exact: wantedId } } : {}),
      },
      audio: false,
    };

    try {
      const next = await navigator.mediaDevices.getUserMedia(constraints);
      // A newer request (or an unmount) won the race: this stream is already stale.
      if (!mountedRef.current || request !== requestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
      setCameraState('live');
      const settings = next.getVideoTracks()[0]?.getSettings?.() || {};
      if (settings.deviceId) setDeviceId(settings.deviceId);
      // Labels are empty until a permission is granted; refresh so the select fills in.
      refreshDevices();
    } catch (error) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setCameraState('error');
      setCameraError(cameraErrorFor(error));
    }
  }, [refreshDevices]);

  // Mount guard + the only unmount-side teardown: no stream may outlive this page.
  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1; // invalidate any getUserMedia still pending
      const current = streamRef.current;
      streamRef.current = null;
      if (current) current.getTracks().forEach((track) => track.stop());
    };
  }, [refreshDevices]);

  // New camera plugged in or removed: keep the picker honest.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return undefined;
    const onChange = () => refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  // Source switch: opening the camera asks for permission, leaving it releases the device.
  useEffect(() => {
    if (source !== SOURCE_CAMERA) {
      releaseStream();
      setCameraState('idle');
      setCameraError(null);
      return;
    }
    startCamera(deviceId || '');
    // deviceId is read on purpose when the source changes; picking another device calls
    // startCamera directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // A MediaStream cannot go through the `src` attribute (React drops srcObject), and Chromium
  // does not re-arm autoplay for a new resource on an element that already played, so this
  // effect owns "attach the current source and start it".
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const start = () => {
      const played = video.play();
      if (played?.catch) {
        played.catch((error) => {
          // Muted playback is allowed by the autoplay policy, so a rejection here is real.
          // The overlay keeps saying no frame has been processed yet.
          console.warn('play() a fost respins pentru sursa curentă', error);
        });
      }
    };

    if (source === SOURCE_CAMERA) {
      if (!stream) {
        if (video.srcObject) video.srcObject = null;
        return undefined;
      }
      video.srcObject = stream;
      start();
      return undefined;
    }

    if (video.srcObject) video.srcObject = null;
    if (clipUrl) start();
    return undefined;
  }, [source, stream, clipUrl]);

  // The canvas keeps the last frame of the previous source until the next one arrives.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvas.width) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [source, deviceId]);

  // Draw the calibration quad on its own canvas, positioned exactly like the processed
  // frame. A separate canvas is what keeps this overlay from touching the engine's pixels
  // or its blur: the worker's frame is drawn by `useEngine`, this one only by us.
  const drawCalibration = useCallback(() => {
    const overlay = overlayRef.current;
    const base = canvasRef.current;
    if (!overlay || !base) return;
    const content = contentRect(base);
    if (!content || !overlay.clientWidth || !overlay.clientHeight) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(overlay.clientWidth * dpr);
    const pixelHeight = Math.round(overlay.clientHeight * dpr);
    if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
      overlay.width = pixelWidth;
      overlay.height = pixelHeight;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);

    const toPixel = (point) => ({
      x: content.offsetX + point.x * content.frameWidth * content.scale,
      y: content.offsetY + point.y * content.frameHeight * content.scale,
    });
    const { points } = calibration;
    if (points.length === 0) return;

    const pixels = points.map(toPixel);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#33E1FF';
    ctx.fillStyle = 'rgba(51, 225, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(pixels[0].x, pixels[0].y);
    for (const pixel of pixels.slice(1)) ctx.lineTo(pixel.x, pixel.y);
    if (pixels.length === 4) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();

    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    pixels.forEach((pixel, index) => {
      ctx.fillStyle = '#0B0B0B';
      ctx.beginPath();
      ctx.arc(pixel.x, pixel.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#33E1FF';
      ctx.stroke();
      ctx.fillStyle = '#33E1FF';
      ctx.fillText(String(index + 1), pixel.x + 10, pixel.y - 8);
    });

    if (pixels.length === 4) {
      const centre = pixels.reduce(
        (sum, pixel) => ({ x: sum.x + pixel.x / 4, y: sum.y + pixel.y / 4 }),
        { x: 0, y: 0 },
      );
      const label = groundH
        ? `${formatMetres(calibration.widthM)} × ${formatMetres(calibration.heightM)} m`
        : 'puncte invalide';
      ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      const width = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(11, 11, 11, 0.75)';
      ctx.fillRect(centre.x - width / 2 - 6, centre.y - 10, width + 12, 20);
      ctx.fillStyle = groundH ? '#33E1FF' : '#FF5C5C';
      ctx.fillText(label, centre.x - width / 2, centre.y + 4);
    }
  }, [calibration, contentRect, groundH]);

  useEffect(() => {
    drawCalibration();
  }, [drawCalibration, frameSize, clipUrl, source, deviceId]);

  // The processed frame changes size on a new source, and the canvas box changes with the
  // window; both move the quad, so both redraw it.
  useEffect(() => {
    const base = canvasRef.current;
    if (!base || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const next = { width: base.width, height: base.height };
      setFrameSize((previous) => (
        previous.width === next.width && previous.height === next.height ? previous : next
      ));
      drawCalibration();
    });
    observer.observe(base);
    return () => observer.disconnect();
  }, [drawCalibration]);

  const startCalibration = () => {
    setCalibration((previous) => ({ ...previous, points: [] }));
    setTrackRows([]);
    trackStateRef.current = { H: null, entries: new Map() };
    setPicking(true);
  };

  const resetCalibration = () => {
    setCalibration({ points: [], widthM: DEFAULT_RECT_WIDTH_M, heightM: DEFAULT_RECT_HEIGHT_M });
    setTrackRows([]);
    trackStateRef.current = { H: null, entries: new Map() };
    setPicking(false);
  };

  const onCalibrationClick = (event) => {
    if (!picking) return;
    const base = canvasRef.current;
    if (!base) return;
    const content = contentRect(base);
    if (!content) return;
    const box = base.getBoundingClientRect();
    const x = (event.clientX - box.left - content.offsetX) / (content.frameWidth * content.scale);
    const y = (event.clientY - box.top - content.offsetY) / (content.frameHeight * content.scale);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    const points = [...calibration.points, { x, y }].slice(0, 4);
    setCalibration({ ...calibration, points });
    if (points.length === 4) setPicking(false);
  };

  // One row per tracked person, from the tracker's own foot point. No calibration, a
  // truncated box, a missing previous sample or a non-positive dt all report `null`, which
  // the panel prints as „necalibrat” / „fără eșantion” instead of a number.
  useEffect(() => {
    const feed = engine.tracks;
    if (!feed || !Array.isArray(feed.boxes)) return;
    const state = trackStateRef.current;
    if (state.H !== groundH) {
      state.H = groundH;
      state.entries.clear();
    }
    const rows = [];
    const seen = new Set();
    for (const box of feed.boxes) {
      const foot = footPointFromBox(box.bbox);
      if (!foot) continue;
      seen.add(box.id);
      const previous = state.entries.get(box.id);
      const truncated = box.bbox[3] >= TRUNCATED_BOTTOM;
      let speedMps = null;
      let distanceM = null;
      let entry = { time: feed.time, foot, smoothed: previous?.smoothed ?? null };
      const dt = previous ? feed.time - previous.time : 0;
      if (previous && !truncated && dt > 0 && dt <= MAX_SAMPLE_GAP_S) {
        const metrics = groundMetrics({
          foot,
          previousFoot: previous.foot,
          dt,
          H: groundH,
        });
        if (metrics.valid) {
          const smoothed = smoothSpeed(previous.smoothed, metrics.speedMps, SPEED_SMOOTHING_ALPHA);
          speedMps = smoothed;
          distanceM = metrics.distanceM;
          entry = { ...entry, smoothed };
        }
      }
      state.entries.set(box.id, entry);
      rows.push({ id: box.id, truncated, speedMps, distanceM });
    }
    // Keep a missed frame's foot point for a moment (the tracker itself survives 30), but
    // forget it once the gap is longer than a reading may bridge, or after a loop rewind.
    for (const [id, entry] of [...state.entries]) {
      if (seen.has(id)) continue;
      const age = feed.time - entry.time;
      if (!Number.isFinite(age) || age < 0 || age > MAX_SAMPLE_GAP_S * 2) {
        state.entries.delete(id);
      }
    }
    rows.sort((left, right) => left.id - right.id);
    setTrackRows(rows);
  }, [engine.tracks, groundH]);

  // A new source brings new track ids, and the sampled speeds belong to the old footage.
  useEffect(() => {
    trackStateRef.current = { H: null, entries: new Map() };
    setTrackRows([]);
  }, [source, clipUrl, deviceId]);

  // Revoke the blob URL of a picked file when it is replaced or the page unmounts.
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const onPickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setClipUrl(url);
  };

  const onPickDevice = (event) => {
    const nextId = event.target.value;
    setDeviceId(nextId);
    startCamera(nextId);
  };

  const statusLabel = {
    idle: source === SOURCE_CAMERA ? 'se așteaptă camera' : 'se așteaptă un clip',
    loading: 'se încarcă',
    running: 'rulează',
    error: 'eroare motor',
    unsupported: 'browser neacceptat',
  }[engine.status] || engine.status;

  // Status colour as classes: #FFEB33 on white is 1.22:1 and #33E1FF is 1.57:1, so the
  // light theme needs the darker shades while the dark theme keeps the signal colours.
  const badgeClass =
    engine.status === 'running'
      ? 'text-cyan-700 dark:text-[#33E1FF]'
      : engine.status === 'error' || engine.status === 'unsupported'
        ? 'text-[#B91C1C] dark:text-[#FF5C5C]'
        : 'text-amber-700 dark:text-[#FFEB33]';

  const switchButton = (value, label, Icon) => {
    const active = source === value;
    return (
      <button
        type="button"
        onClick={() => setSource(value)}
        aria-pressed={active}
        className="px-3 py-2 rounded text-sm flex items-center gap-2"
        style={{
          backgroundColor: active ? '#FFEB33' : themeStyles.inputBg,
          color: active ? '#1F1F1F' : themeStyles.textColor,
          border: `1px solid ${active ? '#FFEB33' : isDarkMode ? themeStyles.panelBorder : '#64748B'}`,
          fontWeight: active ? 600 : 400,
        }}
      >
        <Icon size={14} />
        {label}
      </button>
    );
  };

  // Before any permission is granted some browsers report one entry per device with an empty
  // id and label; those cannot be picked individually, so they collapse into "default".
  const selectableDevices = devices.filter((device) => device.deviceId);
  const labelsHidden = selectableDevices.some((device) => !device.label);

  // Local scale at the centre of the rectangle: how many metres one frame pixel covers
  // there. It is the honest number to show, because a single "m/px" does not exist on an
  // oblique view.
  const calibrationScale = useMemo(() => {
    if (!groundH || !frameSize.width || calibration.points.length !== 4) return null;
    const centre = calibration.points.reduce(
      (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
      { x: 0, y: 0 },
    );
    const step = 100 / frameSize.width;
    const from = projectPoint(groundH, centre);
    const to = projectPoint(groundH, { x: centre.x + step, y: centre.y });
    if (!from || !to) return null;
    const metres = Math.hypot(to.x - from.x, to.y - from.y) / 100;
    return Number.isFinite(metres) && metres > 0 ? metres : null;
  }, [groundH, frameSize.width, calibration.points]);

  const calibrationStatus = (() => {
    const count = calibration.points.length;
    if (count < 4) {
      return { text: `necalibrat · ${count}/4 puncte`, colour: themeStyles.textColor, muted: true };
    }
    if (!groundH) {
      return {
        text: 'necalibrat · punctele sunt degenere (coliniare, duplicate sau dimensiuni invalide)',
        colour: '#FF5C5C',
        muted: false,
      };
    }
    return {
      text: `calibrat · ${formatMetres(calibration.widthM)} × ${formatMetres(calibration.heightM)} m`,
      colour: '#33E1FF',
      muted: false,
    };
  })();

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: themeStyles.textColor }}>
            <Activity size={18} />
            Lab - motor în browser
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Detecție de persoane EfficientDet-Lite0, blur de față YuNet și incidente din zona
            cadrului întreg, ONNX Runtime Web, fără backend.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded p-1" style={{ backgroundColor: themeStyles.cardBg }}>
            {switchButton(SOURCE_CLIP, 'Clip', Video)}
            {switchButton(SOURCE_CAMERA, 'Cameră', Camera)}
          </div>

          {source === SOURCE_CLIP && (
            <label
              className="px-3 py-2 rounded border border-[#64748B] text-sm cursor-pointer flex items-center gap-2 dark:border-white/20"
              style={{ backgroundColor: themeStyles.cardBg, color: themeStyles.textColor }}
            >
              <Upload size={14} />
              Alege un clip
              <input type="file" accept="video/*" className="hidden" onChange={onPickFile} />
            </label>
          )}

          {source === SOURCE_CAMERA && (
            <div className="flex items-center gap-2">
              <select
                value={deviceId}
                onChange={onPickDevice}
                aria-label="Dispozitiv video"
                className="px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: themeStyles.cardBg,
                  color: themeStyles.textColor,
                  border: `1px solid ${isDarkMode ? themeStyles.panelBorder : '#64748B'}`,
                }}
              >
                <option value="">Cameră implicită</option>
                {selectableDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Cameră ${index + 1} (fără etichetă)`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => startCamera(deviceId || '')}
                disabled={cameraState === 'requesting'}
                className="px-3 py-2 rounded border border-[#64748B] text-sm flex items-center gap-2 disabled:opacity-50 dark:border-white/20"
                style={{ backgroundColor: themeStyles.cardBg, color: themeStyles.textColor }}
              >
                <RotateCcw size={14} />
                Reîncarcă
              </button>
            </div>
          )}
        </div>
      </div>

      {source === SOURCE_CAMERA && labelsHidden && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Numele camerelor apar abia după ce acorzi permisiunea; până atunci sunt numerotate.
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: themeStyles.textColor }}>
          <span className="flex items-center gap-1">
            <Cpu size={14} />
            stare: <strong className={badgeClass}>{statusLabel}</strong>
          </span>
          <span>fps: <strong>{engine.fps || '—'}</strong></span>
          <span>persoane: <strong>{engine.persons}</strong></span>
          <span>fețe: <strong>{engine.faces}</strong></span>
          <span>cadru: <strong>{engine.ms ? `${engine.ms} ms` : '—'}</strong></span>
          <span className="text-slate-600 dark:text-slate-400">
            provider: {engine.providers.length ? engine.providers.join(' → ') : '—'}
          </span>
        </div>

        {/* Incidents come from the worker's rule engine, one panel row per event. */}
        <div
          className="rounded border px-4 py-2 text-sm min-w-[280px]"
          style={{
            borderColor: themeStyles.panelBorder,
            backgroundColor: themeStyles.cardBg,
            color: themeStyles.textColor,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="font-semibold flex items-center gap-2">
              <AlertTriangle size={14} />
              Incidente
            </span>
            <span>total: <strong>{engine.totalEvents}</strong></span>
          </div>

          {engine.events.length === 0 ? (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Niciun incident încă. Zona „cadru întreg” are nevoie de
              {' '}{DEFAULT_LAB_ZONE.debounce_s} s de prezență neîntreruptă.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {engine.events.slice(0, 5).map((event) => (
                <li
                  key={event.event_id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span
                    className={
                      event.severity === 'CRITICAL'
                        ? 'text-[#B91C1C] dark:text-[#FF5C5C]'
                        : 'text-amber-700 dark:text-[#FFEB33]'
                    }
                  >
                    {event.type}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">severitate: {event.severity}</span>
                  <span>track: {event.track_id}</span>
                  <span>durată: {Number(event.duration_s).toFixed(2)} s</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {source === SOURCE_CAMERA && cameraState === 'error' && cameraError && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ borderColor: '#FF5C5C', color: themeStyles.textColor, backgroundColor: themeStyles.cardBg }}
        >
          <div className="font-semibold flex items-center gap-2">
            <CameraOff size={14} />
            {cameraError.title}
          </div>
          <div className="text-slate-600 dark:text-slate-300">{cameraError.detail}</div>
          <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">
            {[cameraError.name, cameraError.message].filter(Boolean).join(': ')}
          </div>
        </div>
      )}

      {(engine.status === 'error' || engine.status === 'unsupported') && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ borderColor: '#FF5C5C', color: themeStyles.textColor, backgroundColor: themeStyles.cardBg }}
        >
          <div className="font-semibold">Motorul nu rulează</div>
          <div className="text-slate-600 dark:text-slate-300">{engine.message || 'Eroare necunoscută.'}</div>
          <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">
            Modelele sunt așteptate la {MODEL_HINT}. Sursa video continuă să ruleze mai jos;
            fără grafice canvasul nu are ce să deseneze.
          </div>
        </div>
      )}

      {engine.status === 'loading' && (
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {engine.message || 'Se încarcă modelele...'}
          {!engine.providers.length && ' (prima încărcare are câteva zeci de MB)'}
        </div>
      )}

      {/* Ground-plane prototype. Calibration only: it changes no detector, no rule and no
          event. The numbers appear for the operator to judge, not to trust. */}
      <section
        className="rounded border px-4 py-3 text-sm"
        style={{
          borderColor: themeStyles.panelBorder,
          backgroundColor: themeStyles.cardBg,
          color: themeStyles.textColor,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="space-y-2 max-w-[560px]">
            <div className="font-semibold flex items-center gap-2">
              <Ruler size={14} />
              Calibrare sol (prototip)
            </div>
            <p className="text-xs opacity-70">
              Patru puncte pe sol, în ordinea colțurilor dreptunghiului măsurat (sus-stânga,
              sus-dreapta, jos-dreapta, jos-stânga). Prototip: Live și regulile nu folosesc încă
              această calibrare, iar numerele nu sunt o referință de teren.
            </p>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                Lățime
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  aria-label="Lățimea dreptunghiului, în metri"
                  value={Number.isFinite(calibration.widthM) ? calibration.widthM : ''}
                  onChange={(event) => {
                    const widthM = event.target.valueAsNumber;
                    setCalibration((previous) => ({ ...previous, widthM }));
                  }}
                  className="w-20 px-2 py-1 rounded"
                  style={{
                    backgroundColor: themeStyles.inputBg,
                    color: themeStyles.textColor,
                    border: `1px solid ${themeStyles.panelBorder}`,
                  }}
                />
                m
              </label>
              <label className="flex items-center gap-1">
                Lungime
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  aria-label="Lungimea dreptunghiului, în metri"
                  value={Number.isFinite(calibration.heightM) ? calibration.heightM : ''}
                  onChange={(event) => {
                    const heightM = event.target.valueAsNumber;
                    setCalibration((previous) => ({ ...previous, heightM }));
                  }}
                  className="w-20 px-2 py-1 rounded"
                  style={{
                    backgroundColor: themeStyles.inputBg,
                    color: themeStyles.textColor,
                    border: `1px solid ${themeStyles.panelBorder}`,
                  }}
                />
                m
              </label>

              <button
                type="button"
                onClick={picking ? () => setPicking(false) : startCalibration}
                className="px-3 py-1 rounded flex items-center gap-2"
                style={{
                  backgroundColor: picking ? '#FFEB33' : themeStyles.inputBg,
                  color: picking ? '#1F1F1F' : themeStyles.textColor,
                  border: `1px solid ${picking ? '#FFEB33' : themeStyles.panelBorder}`,
                  fontWeight: picking ? 600 : 400,
                }}
              >
                <Crosshair size={14} />
                {picking
                  ? 'Anulează'
                  : calibration.points.length > 0
                    ? 'Calibrează din nou'
                    : 'Începe calibrarea'}
              </button>

              <button
                type="button"
                onClick={resetCalibration}
                disabled={calibration.points.length === 0 && !picking}
                className="px-3 py-1 rounded flex items-center gap-2 disabled:opacity-40"
                style={{ backgroundColor: themeStyles.inputBg, color: themeStyles.textColor }}
              >
                <RotateCcw size={14} />
                Resetează
              </button>
            </div>

            <div className="text-xs">
              stare:{' '}
              <strong style={{ color: calibrationStatus.colour, opacity: calibrationStatus.muted ? 0.7 : 1 }}>
                {calibrationStatus.text}
              </strong>
              {calibrationScale !== null && (
                <> · scară ~ {calibrationScale.toLocaleString('ro-RO', { maximumFractionDigits: 3 })} m/px la centru</>
              )}
              {picking && (
                <> · apasă colțul {calibration.points.length + 1} din 4 pe sol</>
              )}
            </div>
          </div>

          <div className="min-w-[280px] flex-1 max-w-[360px]">
            <div className="font-semibold text-xs mb-1">Persoane urmărite</div>
            {trackRows.length === 0 ? (
              <p className="text-xs opacity-60">
                Nicio pistă încă. Pornește motorul și așteaptă o persoană în cadru.
              </p>
            ) : (
              <ul className="font-mono text-xs space-y-1">
                {trackRows.slice(0, 6).map((row) => {
                  const speed = formatSpeed(row.speedMps);
                  const state = row.truncated
                    ? 'trunchiat'
                    : speed !== null
                      ? `${speed} m/s`
                      : groundH
                        ? 'fără eșantion'
                        : 'necalibrat';
                  return (
                    <li key={row.id} className="flex items-center justify-between gap-3">
                      <span className="opacity-70">#{row.id}</span>
                      <span style={{ color: speed !== null ? '#33E1FF' : themeStyles.textColor }}>
                        {state}
                      </span>
                      <span className="opacity-70">
                        {row.distanceM === null ? '—' : `+${formatMetres(row.distanceM)} m`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1 text-[11px] opacity-50">
              Viteza e media celor două cadre consecutive, netezită; distanța e față de poziția
              anterioară a piciorului.
            </p>
          </div>
        </div>
      </section>

      <div className="relative rounded overflow-hidden" style={{ backgroundColor: '#000' }}>
        <canvas
          ref={canvasRef}
          className="block w-full h-auto max-h-[70vh] object-contain"
        />

        {/* Calibration quad. Sits above the processed frame but never draws into it, and
            only takes pointer events while the operator is picking corners. */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full"
          style={{
            pointerEvents: picking ? 'auto' : 'none',
            cursor: picking ? 'crosshair' : 'default',
          }}
          onPointerDown={onCalibrationClick}
          aria-hidden="true"
        />

        {source === SOURCE_CLIP && !clipUrl && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-200"
          >
            <Video size={28} />
            <span>Alege un clip local pentru a porni motorul.</span>
            <span className="font-mono text-xs text-slate-400">
              VITE_DEMO_VIDEO nu este setat, deci nu există un clip implicit.
            </span>
          </div>
        )}

        {source === SOURCE_CAMERA && cameraState === 'requesting' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-200"
          >
            <Camera size={28} />
            <span>Se cere accesul la cameră...</span>
            <span className="text-xs text-slate-400">Confirmă permisiunea în browser.</span>
          </div>
        )}

        {source === SOURCE_CAMERA && cameraState === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-200"
          >
            <CameraOff size={28} />
            <span>Camera nu este pornită.</span>
            <span className="text-xs text-slate-400">Motivul este afișat mai sus.</span>
          </div>
        )}

        {source === SOURCE_CAMERA
          && cameraState === 'live'
          && engine.status !== 'running'
          && engine.status !== 'error'
          && engine.status !== 'unsupported' && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-200"
            >
              <Camera size={28} />
              <span>Camera este pornită, se așteaptă primul cadru procesat...</span>
            </div>
          )}
      </div>

      {/* The source video stays hidden: the canvas shows the processed frames, this element
          only feeds them. `src` is for the clip; a webcam stream is assigned as srcObject in
          the effect above. */}
      <video
        ref={videoRef}
        src={source === SOURCE_CLIP ? (clipUrl || undefined) : undefined}
        className="hidden"
        loop={source === SOURCE_CLIP}
        muted
        playsInline
        autoPlay
        preload="auto"
      />

      <p className="text-xs text-slate-600 dark:text-slate-400">
        Spike: cutii pe persoane, blur de față, fps și incidentele produse de zona „cadru
        întreg”. Snapshot-ul, raportul și escaladarea nu sunt conectate aici.
      </p>
    </div>
  );
}
