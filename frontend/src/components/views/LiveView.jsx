import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ShieldAlert,
  HardHat,
  Clock,
  AlertTriangle,
  Power,
  Eye,
  Check,
  Video,
  WifiOff,
  Maximize2,
  Minimize2,
  Columns,
  LayoutDashboard,
  Cpu,
  Camera,
  CameraOff,
  RotateCcw
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { STATUS_TOKENS } from '../../constants/theme';
import ConfidenceBadge from '../common/ConfidenceBadge';
import { canDo } from '../../constants/eventActions';
import { USE_MOCK } from '../../services/api';
import { useEngine } from '../../engine/useEngine';
import { webgpuAvailable } from '../../engine/webgpu';
import LiveEngineCard from '../live/LiveEngineCard';

// A double-click is two clicks at the same spot within this window (Chromium uses 500 ms).
// The guard below only cares about the `detail` the browser reports and about a press that
// belongs to a different incident; the window is the upper bound for the latter.
const ACK_POINTER_WINDOW_MS = 1500;

// The browser engine is opt-in per viewer, not per camera: a presenter enables it once and
// the static site keeps the cheap clip-only path for everyone else.
const LIVE_ENGINE_STORAGE_KEY = 'localsight.liveEngine';

// The one camera in the mock list whose frames come from this machine instead of the
// network. It ships only with the static (mock) build, so the id is the whole contract:
// no stream_url, no demo clip, and a getUserMedia request when it becomes active.
const WEBCAM_CAMERA_ID = 'webcam-live';

// Same table as /lab, copied instead of imported so this change never touches the spike
// page. One block per failure the browser can report; the raw error name is appended under
// the Romanian copy so the message stays specific instead of generic.
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

// `null` means "no choice stored yet": the view probes WebGPU and decides ON only when an
// adapter exists. A stored '0' or '1' always wins, so a reload keeps the operator's choice.
function readLiveEnginePreference() {
  try {
    const stored = window.localStorage.getItem(LIVE_ENGINE_STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Private mode or blocked storage: fall through to the WebGPU probe.
  }
  return null;
}

// The static Pages build ships fixture KPIs and fixture incidents; the clip is a
// recording and only the opt-in browser engine produces real detections. One quiet chip
// marks the blocks a visitor could otherwise read as live telemetry, so the numbers never
// pass for telemetry. It is rendered only in the mock build: with a real API the data is
// genuine and needs no label.
function DemoDataChip({ title }) {
  return (
    <span
      title={title}
      className="shrink-0 text-[10px] font-mono font-bold normal-case px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33] dark:border-[#FFEB33]/40"
    >
      date demo
    </span>
  );
}

// The zone outline is configuration, not a detection: it is drawn from the zone editor's
// polygon and stays visible when the engine is off so the visitor still sees where the
// rule applies. It is never derived from an incident track.
function ZoneOutline({ zone }) {
  const points = (zone?.polygon || []).filter(
    (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (points.length < 3) return null;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <polygon
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="rgba(255,235,51,0.10)"
          stroke="#FFEB33"
          strokeWidth="2"
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The label belongs to the polygon's own corner: keeping it away from the bottom
          centre leaves the honest note and its button unobstructed. */}
      <div
        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
        className="absolute -translate-y-full pl-1 pb-0.5 pointer-events-none"
      >
        <span className="inline-block px-2 py-1 rounded bg-black/75 text-[#FFEB33] text-[10px] font-mono border border-[#FFEB33]/40 whitespace-nowrap">
          zonă configurată: {zone.zone_id} · nu este detecție
        </span>
      </div>
    </>
  );
}

export default function LiveView() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    kpis,
    cameras,
    activeCamera,
    setSelectedCameraId,
    toggleEngine,
    filteredEvents,
    filterMode,
    setFilterMode,
    acknowledgeEvent,
    setSelectedEventId,
    setCurrentView,
    zones,
    addEngineEvents,
    health
  } = useSecurity();

  // Moduri interactive de afișare: 'standard' | 'split' | 'fullscreen'
  const [displayMode, setDisplayMode] = useState('standard');
  const [streamFailed, setStreamFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  // null = no stored choice; the default follows the WebGPU probe below.
  const [enginePreference, setEnginePreference] = useState(readLiveEnginePreference);
  // Derived early because the webcam attach effect depends on it: when the engine is on,
  // the <video> element stays mounted across a source swap so the worker keeps its node.
  const browserEngineOn = enginePreference === true;
  // null while probing; true/false once requestAdapter() answered.
  const [gpuAvailable, setGpuAvailable] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // F1: the press that belongs to the click that is about to acknowledge. A double-click
  // reuses the same screen point, and the first click removes its card, so without this the
  // second click acknowledges whatever card slid under the cursor.
  const ackPressRef = useRef(null);

  const beginAckPress = (eventId) => {
    ackPressRef.current = { eventId, at: Date.now() };
  };

  const acknowledgeWithGuard = (event, eventId) => {
    // The button lives inside a clickable card: the ack must never also open the incident.
    event.stopPropagation();
    // Second click of a double-click: the browser reports `detail > 1` because the two
    // clicks share the same coordinates and timing, even though this element is a
    // different card. Ignore it; it is not a new decision by the operator.
    if (event.detail > 1) return;
    // Keyboard activation has no pointerdown (`detail === 0`). For a real click, the press
    // must name the same incident: a card that appeared under the pointer mid-press is not
    // something the operator aimed at.
    const press = ackPressRef.current;
    const samePress = press
      && press.eventId === eventId
      && Date.now() - press.at <= ACK_POINTER_WINDOW_MS;
    if (event.detail > 0 && !samePress) return;
    ackPressRef.current = null;
    acknowledgeEvent(eventId, event);
  };

  // The browser webcam is the only source whose lifecycle Live owns: getUserMedia, the
  // attach to <video> and the track teardown. The stream lives in a ref as well, so the
  // unmount hook and the request-race guard stop tracks without waiting for a render.
  const isWebcamCamera = activeCamera?.id === WEBCAM_CAMERA_ID;
  const [webcamState, setWebcamState] = useState('idle'); // idle | requesting | live | error
  const [webcamError, setWebcamError] = useState(null);
  const [webcamStream, setWebcamStream] = useState(null);
  const webcamStreamRef = useRef(null);
  const webcamRequestRef = useRef(0);
  const webcamMountedRef = useRef(true);

  const stopWebcam = useCallback(() => {
    const current = webcamStreamRef.current;
    webcamStreamRef.current = null;
    if (current) current.getTracks().forEach((track) => track.stop());
    setWebcamStream(null);
  }, []);

  const startWebcam = useCallback(async () => {
    // getUserMedia exists only in a secure context (https or localhost). Saying so beats a
    // black rectangle on a LAN IP over plain http.
    if (!navigator.mediaDevices?.getUserMedia) {
      setWebcamState('error');
      setWebcamError({ code: 'insecure', name: 'getUserMedia undefined', message: '', ...CAMERA_ERRORS.insecure });
      return;
    }

    // A second request (double click, camera switch) invalidates the one still in flight.
    const request = webcamRequestRef.current + 1;
    webcamRequestRef.current = request;
    setWebcamState('requesting');
    setWebcamError(null);

    // Close what is open before asking again: some drivers refuse a second open of the
    // same device with NotReadableError.
    const previous = webcamStreamRef.current;
    webcamStreamRef.current = null;
    if (previous) previous.getTracks().forEach((track) => track.stop());
    setWebcamStream(null);

    try {
      // Same 720p shape as the demo clips, so the engine sees comparable frames.
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // A newer request (or an unmount) won the race: this stream is already stale.
      if (!webcamMountedRef.current || request !== webcamRequestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      webcamStreamRef.current = next;
      setWebcamStream(next);
      setWebcamState('live');
    } catch (error) {
      if (!webcamMountedRef.current || request !== webcamRequestRef.current) return;
      setWebcamState('error');
      setWebcamError(cameraErrorFor(error));
    }
  }, []);

  useEffect(() => {
    setStreamFailed(false);
    setVideoFailed(false);
  }, [activeCamera?.id]);

  // Stream lifecycle: opening on selection, releasing on any other camera and on unmount.
  // The engine toggle is deliberately not part of this: turning detection off stops the
  // worker, never the camera, and the raw feed keeps playing.
  useEffect(() => {
    webcamMountedRef.current = true;
    return () => {
      webcamMountedRef.current = false;
      webcamRequestRef.current += 1; // invalidate any getUserMedia still pending
      stopWebcam();
    };
  }, [stopWebcam]);

  useEffect(() => {
    if (!isWebcamCamera) {
      // Leaving the local camera must release the device: the LED goes off, and the next
      // clip does not inherit a stream nobody is watching.
      stopWebcam();
      setWebcamState('idle');
      setWebcamError(null);
      return;
    }
    startWebcam();
  }, [isWebcamCamera, startWebcam, stopWebcam]);

  // A MediaStream cannot go through `src` (React never writes srcObject) and Chromium does
  // not re-arm autoplay for a new resource, so this effect owns "attach the current stream
  // and start it", exactly like /lab. The element keeps the same key while the engine is
  // toggled, so switching detection off does not re-request the camera.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isWebcamCamera || !webcamStream) {
      // Back on a clip the same DOM node may be reused (engine on keeps one element):
      // detach the stream explicitly, otherwise the <video> keeps playing the camera.
      if (video.srcObject) video.srcObject = null;
      if (!isWebcamCamera && video.src) {
        const played = video.play();
        if (played?.catch) played.catch(() => {});
      }
      return;
    }
    if (video.srcObject !== webcamStream) video.srcObject = webcamStream;
    const played = video.play();
    if (played?.catch) {
      // Muted playback is allowed by the autoplay policy, so a rejection here is real.
      played.catch((error) => console.warn('Redarea camerei locale a fost refuzată', error));
    }
  }, [isWebcamCamera, webcamStream, browserEngineOn]);

  // WebGPU is a question, not an assumption: one probe decides the default and the copy.
  // It uses the engine's own rule (`webgpuAvailable`), so a browser that exposes WebGPU but
  // is kept on wasm by the engine (Firefox today) does not auto-start the slow path.
  useEffect(() => {
    let cancelled = false;
    webgpuAvailable().then((usable) => {
      if (!cancelled) setGpuAvailable(usable);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Default ON only on the fast path. Without an adapter the engine runs on WASM at
  // ~2 fps, so it stays OFF until the visitor explicitly asks for it.
  useEffect(() => {
    if (enginePreference !== null || gpuAvailable === null) return;
    setEnginePreference(gpuAvailable);
  }, [enginePreference, gpuAvailable]);

  // Privacy: the immersive view renders the raw clip in its own React tree, so it cannot
  // share the worker's <video>/<canvas>, and entering it would stop the worker and show
  // unblurred faces full-screen. It is therefore never reachable while the browser engine
  // is on; this effect also catches a preference turned on while fullscreen is open.
  useEffect(() => {
    if (browserEngineOn && displayMode === 'fullscreen') setDisplayMode('standard');
  }, [browserEngineOn, displayMode]);

  const isOffline = activeCamera?.status === 'offline';
  // dev.py demo: VITE_DEMO_CAMERA = "stand12,taxiway-b", VITE_DEMO_CLIP = "stand12=clip.mp4,taxiway-b=..."
  // (a single plain value from older launchers still works).
  const demoCameras = (import.meta.env.VITE_DEMO_CAMERA || '').split(',').map((id) => id.trim()).filter(Boolean);
  const demoClipEntries = (import.meta.env.VITE_DEMO_CLIP || '').split(',').map((item) => item.trim()).filter(Boolean);
  const demoClipFor = (cameraId) => {
    const match = demoClipEntries.find((item) => item.startsWith(`${cameraId}=`));
    if (match) return match.slice(cameraId.length + 1);
    return demoClipEntries.length === 1 && !demoClipEntries[0].includes('=') ? demoClipEntries[0] : null;
  };
  const demoClip = activeCamera?.id ? demoClipFor(activeCamera.id) : null;
  const demoCameraLabel = demoCameras
    .map((id) => cameras.find((camera) => camera.id === id)?.code || id)
    .join(', ');
  const noLiveForCamera = Boolean(demoCameras.length && activeCamera?.id && !demoCameras.includes(activeCamera.id));
  // The local camera has neither a stream URL nor a demo clip: both paths would show a
  // feed that is not the operator's camera, so they are disabled by id.
  const showStream = Boolean(activeCamera?.stream_url && !streamFailed && !isOffline && !noLiveForCamera && !isWebcamCamera);
  // Fallback static: fără backend nu există MJPEG, deci rulăm un clip local în buclă.
  // Ordine: VITE_MEDIA_VIDEO (override global) → {BASE_URL}media/{camera.id}.mp4 → gradient.
  // Clipurile sunt produse de scripts/prepare-demo-media.sh și rămân în afara git-ului.
  const mediaVideoOverride = String(import.meta.env.VITE_MEDIA_VIDEO || '').trim();
  const mediaBaseUrl = import.meta.env.BASE_URL || '/';
  const demoVideoSrc = mediaVideoOverride
    || (activeCamera?.id ? `${mediaBaseUrl}media/${activeCamera.id}.mp4` : null);
  const showDemoVideo = Boolean(demoVideoSrc && !videoFailed && !isOffline && !noLiveForCamera && !isWebcamCamera);
  // FPS măsurat de backend din cadența cadrului live; absent = nu se poate măsura,
  // nu 0. Vezi backend/app/services/live_rate.py.
  const liveFps = activeCamera?.id ? health?.live_fps?.[activeCamera.id] : null;
  const edgeSeen = health?.edge_last_seen_s;
  const edgeActive = Boolean(health?.db && edgeSeen != null && edgeSeen < 60);

  // "live" means the browser really holds a track. Permission errors, a pending request and
  // the moment after a switch all fall outside it, so nothing claims a feed that is not there.
  const webcamLive = isWebcamCamera && webcamState === 'live' && Boolean(webcamStream);
  // The two sources the browser engine can process. Everything the clip path shows (toggle,
  // fps badge, honest note, panel) keys off this, so the webcam path is not a second UI.
  const engineSource = showDemoVideo || webcamLive;
  // One <video> node for the life of the view: it owns the decoder and the media pipeline,
  // and the worker reads frames from that exact element. Rekeying it per engine state threw
  // a fresh element (and a fresh decoder, and a clip restart) at Chromium on every toggle;
  // rekeying it per source would hand the worker a detached node when the camera changes
  // while the engine runs. So the node never changes and a source swap is an attribute
  // update: `src` for a clip, `srcObject` for the webcam (see the effect above).
  const videoKey = 'live-source';

  // Configuration, not detection: the zone the active camera is watched against.
  const cameraZones = (zones || []).filter((zone) => zone.camera_id === activeCamera?.id);
  const activeZone = cameraZones.find((zone) => zone.zone_id === activeCamera?.zone_id) || cameraZones[0] || null;

  // Conversia UI -> contract se face într-un singur loc: editorul ține poligonul ca
  // `[{ x, y }, ...]`, iar pipeline-ul și contractul cer `[[x, y], ...]`. Tot aici
  // `zone_id` devine `id`, singurul nume pe care îl citește `zones.js`. Memoizat ca
  // efectul din `useEngine` să nu trimită configurări identice la fiecare randare.
  const engineZones = useMemo(
    () =>
      (zones || [])
        .filter((zone) => zone.camera_id === activeCamera?.id)
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
              Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.x), Number(point?.y)]
            )
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
        })),
    // `zones` and the camera id are the real inputs; `cameraZones` is rebuilt every render.
    [zones, activeCamera?.id]
  );
  // Why the engine starts on or off: the visitor must be able to tell a fast path from the
  // WASM fallback before they press the button.
  const engineReason = gpuAvailable === null
    ? 'se verifică WebGPU…'
    : gpuAvailable
      ? isWebcamCamera
        ? 'WebGPU disponibil — detecția reală rulează pe fluxul camerei locale.'
        : 'WebGPU disponibil — detecția reală rulează pe acest clip.'
      : 'rulează pe WASM cu 4 fire când izolarea e activă; ~5–6 fps';

  // The engine runs on the local clip fallback or on the live webcam stream, and only while
  // the viewer asked for it. Fullscreen renders the raw clip in a separate tree, so the
  // worker is stopped there instead of being left pointing at a <video> that no longer exists.
  const engineEnabled = browserEngineOn && engineSource && displayMode !== 'fullscreen';
  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: engineEnabled,
    // Zonele camerei active, în forma din contract, plus comutatorul de motor al camerei.
    zones: engineZones,
    engineOn: Boolean(activeCamera?.engine_on),
    cameraId: activeCamera?.id,
    // Cap the processed frame at 1280 on the long side. The YOLO graph is fixed 640 and
    // faces/blur do not need 1920; the bench measures ~5 fps at 1280 versus ~3.7 at 1080p
    // on the same 4 threads. `/bench` still lets a visitor compare sizes explicitly.
    inputSize: 1280,
  });

  // Incidentele motorului sunt incidente reale pentru aplicație: intră în lista comună,
  // nu doar în panoul de mai jos. Magazinul deduplică după `event_id`, deci o randare în
  // plus (sau StrictMode) nu le adaugă de două ori.
  useEffect(() => {
    if (!engine.events.length) return;
    addEngineEvents(engine.events);
  }, [engine.events, addEngineEvents]);

  // Readouts for the single "Motor & senzori" card. Nothing here invents a number: the
  // browser fps exists only while the worker is running, and the clip fps only when the
  // backend measured it.
  const browserEngineFps = engine.status === 'running' && engine.fps ? engine.fps : null;
  const broken = engine.status === 'error' || engine.status === 'unsupported';
  const pipelineActive = Boolean(liveFps) || Boolean(browserEngineFps);
  const pipelineLabel = isWebcamCamera
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
  const zoneLabel = activeZone?.name || activeCamera?.subtitle || activeCamera?.name || '—';
  // The provider is the one ORT actually created, not the one we asked for: on a machine
  // where WebGPU is refused, saying "browser" would hide which path is running.
  const modelLabel = browserEngineOn && engineSource
    ? `YOLO26n · ${engine.actualProviders?.length ? engine.actualProviders.join('+') : 'browser'}`
    : showStream
      ? 'edge · YOLO26'
      : 'oprit';
  const latencyLabel =
    kpis.detection_to_alert_latency_s === '—'
      ? '—'
      : `${kpis.detection_to_alert_latency_s}s`;

  const toggleBrowserEngine = () => {
    setEnginePreference((previous) => {
      const next = previous !== true;
      try {
        window.localStorage.setItem(LIVE_ENGINE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage can be unavailable; the choice still applies to this tab.
      }
      return next;
    });
  };

  if (!activeCamera) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 select-none">
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="max-w-lg w-full rounded-2xl border p-6 shadow-lg space-y-3 text-center"
        >
          <Video size={42} className="mx-auto text-[#D73833]" />
          <h2 className="font-black text-lg uppercase tracking-tight">Nu există feed încă</h2>
          <p style={{ color: themeStyles.textMuted }} className="text-sm">
            {health?.db
              ? 'Backend-ul e online, dar nu a returnat camere. Verifică seed-ul sau reîncarcă.'
              : 'Backend-ul încă pornește sau nu răspunde. Frontend-ul reîncearcă automat la 2 secunde.'}
          </p>
          <div className="p-3 rounded-lg bg-black/20 text-left font-mono text-xs space-y-1">
            <p className="text-white font-bold">Pornește tot stack-ul:</p>
            <p>./run.sh demo</p>
            <p className="text-slate-400">sau: python scripts/dev.py demo</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold"
          >
            Reîncarcă
          </button>
        </div>
      </div>
    );
  }

  // Mod Full-Screen Imersiv
  if (displayMode === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col select-none">
        <div className="h-14 bg-[#141414]/90 backdrop-blur px-6 flex items-center justify-between border-b border-white/10 z-10">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D73833] animate-ping" />
            <div>
              <h2 className="text-white font-bold text-sm tracking-wide">
                {activeCamera?.name}
              </h2>
              <p className="text-[11px] text-slate-400">
                {activeCamera?.subtitle} • {activeCamera?.resolution}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => toggleEngine(activeCamera?.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
                activeCamera?.engine_on
                  ? 'bg-[#FFEB33] text-[#1F1F1F] font-bold font-black'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              <Power size={13} />
              MOTOR: {activeCamera?.engine_on ? 'PORNIT' : 'OPRIT'}
            </button>

            <button
              onClick={() => setDisplayMode('standard')}
              className="px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <Minimize2 size={14} />
              <span>Ieșire ecran complet</span>
            </button>
          </div>
        </div>

        <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black p-4">
          {isOffline ? (
            <div className="text-center p-8 text-[#D73833] font-mono">
              <WifiOff size={60} className="mx-auto mb-3 animate-bounce" />
              <h3 className="text-3xl font-black tracking-widest">SEMNAL PIERDUT</h3>
              <p className="text-sm text-slate-400 mt-1">CAMERA {activeCamera?.id} ESTE MOMENTAN OFFLINE</p>
            </div>
          ) : (
            <div className="w-full max-w-6xl aspect-video bg-gradient-to-br from-slate-950 to-black relative flex items-center justify-center rounded-2xl overflow-hidden shadow-2xl border border-white/10">
              {showStream ? (
                <img
                  src={activeCamera?.stream_url}
                  alt={`Flux ${activeCamera?.id}`}
                  className="w-full h-full object-cover"
                  onError={() => setStreamFailed(true)}
                />
              ) : showDemoVideo ? (
                <>
                  <video
                    key={demoVideoSrc}
                    src={demoVideoSrc}
                    className="w-full h-full object-cover"
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-label={`Clip demo ${activeCamera?.id}`}
                    onError={() => setVideoFailed(true)}
                  />
                  <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
                    ÎNREGISTRARE • DEMO STATIC
                  </div>
                </>
              ) : (
                <div className="text-center opacity-25 select-none">
                  <Video size={100} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-mono font-bold text-white text-xl">{activeCamera?.name?.toUpperCase()}</p>
                  <p className="font-mono text-sm text-slate-300">
                    {noLiveForCamera
                      ? `Fără feed live pe ${activeCamera?.code || activeCamera?.id}; demo rulează pe ${demoCameraLabel}.`
                      : `LIVE FEED${activeCamera?.fps ? ` • ${activeCamera.fps} FPS` : ''}`}
                  </p>
                </div>
              )}

              {/* Fullscreen renders the raw clip and no engine overlay: say so instead of
                  leaving the visitor to guess whether the boxes are real. */}
              {showDemoVideo && (
                <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-black/75 text-[#FFEB33] text-[10px] font-mono border border-[#FFEB33]/40">
                  detecția este oprită — cutiile nu urmăresc video
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full p-3 md:p-4 space-y-3 select-none">
      {/* 1. Cele 4 KPI din Live */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
        {/* Rândul e static în build-ul mock, deci nu produce shift: doar spune că cifrele
            de dedesubt vin din fixtures, nu din detecție. */}
        {USE_MOCK && (
          <div className="col-span-full flex justify-end">
            <DemoDataChip title="Cifrele KPI vin din fixtures (date demo), nu din detecția live." />
          </div>
        )}
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
        >
          <div>
            <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
              Conformitate PPE Sol
            </p>
            <p className="text-xl md:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {kpis.ppe_compliance_pct === '—' ? '—' : `${kpis.ppe_compliance_pct}%`}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <HardHat size={22} className="text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
        >
          <div>
            <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
              Incidente Deschise
            </p>
            <p className="text-xl md:text-2xl font-black font-mono text-[#FFEB33] dark:text-[#FFEB33] text-amber-500">
              {kpis.open_incidents_count}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle size={22} className="text-amber-500" />
          </div>
        </div>

        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
        >
          <div>
            <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
              Detecție → Alertă
            </p>
            <p className="text-xl md:text-2xl font-black font-mono text-amber-500 dark:text-[#FFEB33]">
              {kpis.detection_to_alert_latency_s === '—' ? '—' : `${kpis.detection_to_alert_latency_s}s`}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15 flex items-center justify-center">
            <Clock size={22} className="text-amber-500 dark:text-[#FFEB33]" />
          </div>
        </div>

        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
        >
          <div>
            <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
              Escaladate la Turn
            </p>
            <p className="text-xl md:text-2xl font-black font-mono text-[#D73833]">
              {kpis.escalated_incidents_count}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <ShieldAlert size={22} className="text-[#D73833] animate-pulse" />
          </div>
        </div>
      </div>

      {/* 2. Corp Principal: Mod Standard (video stânga + incidente dreapta) sau Mod Split (video mare sus + incidente multi-coloană jos) */}
      <div className={`flex ${displayMode === 'split' ? 'flex-col' : 'flex-col xl:flex-row'} gap-3`}>
        {/* ZONA VIDEO & CONTROALE CAMERA */}
        <div className="flex-1 flex flex-col space-y-2 min-w-0">
          {/* Bară Selector Camere & Mod Afișare */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-2 rounded-xl border shadow-sm flex items-center justify-between gap-2 shrink-0 flex-wrap"
          >
            {/* Selector cameră */}
            <label className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  activeCamera?.status === 'offline' ? 'bg-[#D73833]' : 'bg-emerald-500'
                }`}
              />
              <span
                id="live-camera-label"
                style={{ color: themeStyles.textMuted }}
                className="text-[11px] font-semibold shrink-0"
              >
                Cameră
              </span>
              <select
                id="live-camera-select"
                value={activeCamera?.id || ''}
                onChange={(event) => setSelectedCameraId(event.target.value)}
                style={{
                  backgroundColor: themeStyles.panelBg,
                  borderColor: themeStyles.panelBorder,
                  color: isDarkMode ? '#F5F5F5' : '#1F1F1F'
                }}
                className="min-w-0 max-w-[16rem] px-2 py-1.5 rounded-lg text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
                aria-labelledby="live-camera-label"
              >
                {(cameras || []).map((c) => {
                  const offline = c.status === 'offline';
                  const local = c.id === WEBCAM_CAMERA_ID;
                  const live = !demoCameras.length || demoCameras.includes(c.id);
                  const suffix = offline ? ' • offline' : local ? ' • cameră locală' : live ? '' : ' • fără feed în demo';
                  return (
                    <option key={c.id} value={c.id}>
                      {(c.code || c.id) + (c.name && c.name !== (c.code || c.id) ? ` — ${c.name}` : '') + suffix}
                    </option>
                  );
                })}
              </select>
            </label>

            {/* Butoane Mod Vizualizare */}
            <div className="flex items-center gap-1.5">
              <div className="flex items-center bg-slate-500/10 rounded-lg p-0.5 border border-slate-500/20">
                <button
                  onClick={() => setDisplayMode('standard')}
                  className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    displayMode === 'standard' ? (isDarkMode ? 'bg-[#D73833] text-white font-bold shadow-sm' : 'bg-[#7EDEED] text-[#1F1F1F] font-bold shadow-sm') : (isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
                  }`}
                  title="Mod Standard: Feed Video 16:9 + Incidente laterale"
                >
                  <LayoutDashboard size={12} />
                  <span className="hidden sm:inline">Standard</span>
                </button>
                <button
                  onClick={() => setDisplayMode('split')}
                  className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    displayMode === 'split' ? (isDarkMode ? 'bg-[#D73833] text-white font-bold shadow-sm' : 'bg-[#7EDEED] text-[#1F1F1F] font-bold shadow-sm') : (isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
                  }`}
                  title="Mod Split: Feed Video Extins 16:9 sus, Grilă incidente dedesubt"
                >
                  <Columns size={12} />
                  <span className="hidden sm:inline">Split</span>
                </button>
              </div>

              {/* Buton Engine ON / OFF */}
              <button
                onClick={() => toggleEngine(activeCamera?.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 shadow transition-all ${
                  activeCamera?.engine_on
                    ? 'bg-[#FFEB33] text-[#1F1F1F] font-bold animate-pulse font-black'
                    : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                }`}
                title="Comută starea motorului aeronavei pentru acest stand"
              >
                <Power size={13} />
                <span>MOTOR: {activeCamera?.engine_on ? 'ON' : 'OFF'}</span>
              </button>

              {/* Motorul din browser ține minte alegerea local. Cât timp e oprit, pornirea
                  e acțiunea principală din overlay, nu un switch mic în toolbar. */}
              {engineSource && browserEngineOn && (
                <button
                  type="button"
                  onClick={toggleBrowserEngine}
                  aria-pressed={browserEngineOn}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 shadow transition-all bg-[#33E1FF] text-[#1F1F1F] hover:bg-[#7EEBFF]"
                  title="Oprește detecția în browser și revino la fluxul brut"
                >
                  <Cpu size={13} />
                  <span>Oprește motorul în browser</span>
                </button>
              )}

              {/* Buton Full-Screen direct pe feed. Camera locală nu îl are: modul imersiv
                  desenează alt arbore React, iar acolo <video> ar pierde srcObject.
                  Cu motorul din browser pornit este dezactivat: modul imersiv randează
                  clipul brut, fără canvas și fără blur, deci ar arăta fețe neblurate. */}
              {!isWebcamCamera && (
                <span
                  className="inline-flex"
                  title={
                    browserEngineOn
                      ? 'Ecran complet este dezactivat cât timp detecția din browser este pornită: modul imersiv ar afișa clipul brut, fără blur. Oprește motorul în browser pentru ecran complet.'
                      : 'Deschide în modul Full-Screen Imersiv'
                  }
                >
                  <button
                    type="button"
                    onClick={() => setDisplayMode('fullscreen')}
                    disabled={browserEngineOn}
                    aria-label="Ecran complet"
                    className="p-1.5 rounded-lg bg-slate-500/10 hover:bg-slate-500/20 text-slate-300 border border-slate-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-500/10"
                    title={
                      browserEngineOn
                        ? 'Ecran complet este dezactivat cât timp detecția din browser este pornită: modul imersiv ar afișa clipul brut, fără blur. Oprește motorul în browser pentru ecran complet.'
                        : 'Deschide în modul Full-Screen Imersiv'
                    }
                  >
                    <Maximize2 size={14} />
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Player-ul Video Adnotat (Raport fix 16:9 proporțional pentru CCTV, fără deformări de bounding box) */}
          <div
            className={`relative rounded-xl overflow-hidden bg-black border border-slate-700 shadow-md flex items-center justify-center w-full aspect-video ${
              displayMode === 'split' ? 'max-w-5xl mx-auto min-h-[320px] max-h-[500px]' : 'min-h-[260px] max-h-[580px]'
            }`}
          >
            {isOffline ? (
              <div className="text-center p-6 text-[#D73833] font-mono">
                <WifiOff size={44} className="mx-auto mb-2 animate-bounce" />
                <h3 className="text-xl font-black tracking-widest">SEMNAL PIERDUT</h3>
                <p className="text-xs text-slate-400 mt-1">CAMERA {activeCamera?.id?.toUpperCase()} ESTE MOMENTAN OFFLINE</p>
              </div>
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${activeCamera?.previewBg || 'from-slate-900 to-black'} relative flex items-center justify-center overflow-hidden`}>
                {noLiveForCamera ? (
                  <div className="text-center p-6 max-w-md select-none">
                    <WifiOff size={44} className="mx-auto mb-2 text-amber-400" />
                    <p className="font-bold text-white text-sm">
                      {activeCamera?.code || activeCamera?.id} nu are feed live în demo
                    </p>
                    <p className="text-slate-300 text-xs mt-1">
                      Edge-ul rulează pe {demoCameraLabel}. Alege una dintre ele din meniul Cameră.
                    </p>
                  </div>
                ) : showStream ? (
                  <img
                    src={activeCamera?.stream_url}
                    alt={`Flux live ${activeCamera?.id}`}
                    className="w-full h-full object-cover"
                    onError={() => setStreamFailed(true)}
                  />
                ) : (isWebcamCamera || showDemoVideo) ? (
                  <>
                    <video
                      // Stable node (see `videoKey`): useEngine keeps its listeners and frame
                      // loop on this exact element, and both sources swap in place — `src`
                      // for a clip, `srcObject` for the webcam.
                      key={videoKey}
                      ref={videoRef}
                      // A MediaStream is not a URL: the webcam gets it through srcObject in
                      // the effect above, and must never load /media/webcam-live.mp4.
                      src={isWebcamCamera ? undefined : demoVideoSrc}
                      // Privacy: the raw clip is hidden from the click, not from the first
                      // processed frame. The 2.5–3 s model warm-up must never show an
                      // unblurred face; layout stays identical because only opacity changes.
                      className={`w-full h-full object-cover${browserEngineOn ? ' opacity-0' : ''}`}
                      autoPlay
                      loop={!isWebcamCamera}
                      muted
                      playsInline
                      aria-label={isWebcamCamera ? 'Flux cameră locală' : `Clip demo ${activeCamera?.id}`}
                      onError={isWebcamCamera ? undefined : () => setVideoFailed(true)}
                    />
                    {/* Opaque surface between the hidden video and the canvas. Before the
                        first processed frame the canvas is still empty and transparent, so
                        this is what the operator sees: black plus a status line, never the
                        raw feed. It also covers the fail-open path where the worker posts an
                        unblurred passthrough frame: the canvas is hidden below when the
                        engine reports an error. */}
                    {browserEngineOn && engineSource && (
                      <div className="absolute inset-0 bg-black flex items-center justify-center pointer-events-none">
                        {engine.status !== 'running' && (
                          <p className="px-4 text-center font-mono text-[10px] leading-snug text-slate-400 max-w-sm">
                            {engine.status === 'error' || engine.status === 'unsupported'
                              ? 'motorul nu a produs cadre procesate — fluxul brut rămâne ascuns'
                              : 'se pregătește — fluxul brut rămâne ascuns până la primul cadru procesat'}
                          </p>
                        )}
                      </div>
                    )}
                    {/* The worker's frames are drawn into a 2d context created with
                        alpha:false, so every processed frame is fully opaque: the raw,
                        unblurred clip can never show through a blurred face. The canvas
                        shares object-cover with the video, so the crop is identical. The
                        same is true for the webcam: with the engine on, the raw camera
                        frame is never visible behind the processed one. */}
                    {browserEngineOn && engineSource && (
                      <canvas
                        ref={canvasRef}
                        aria-hidden="true"
                        // Fail-closed at the display: a broken engine must never leave the
                        // worker's unblurred passthrough frame on screen.
                        className={`absolute inset-0 w-full h-full object-cover pointer-events-none${
                          broken ? ' opacity-0' : ''
                        }`}
                      />
                    )}
                    {isWebcamCamera ? (
                      <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded bg-black/75 text-[#33E1FF] text-[10px] font-mono border border-[#33E1FF]/40">
                        CAMERĂ LOCALĂ • getUserMedia
                      </div>
                    ) : (
                      <div className="absolute top-11 left-2.5 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
                        ÎNREGISTRARE • DEMO STATIC
                      </div>
                    )}

                    {/* Permission lifecycle, same copy as /lab: a pending grant says what
                        it waits for, a failure says what the browser answered. */}
                    {isWebcamCamera && webcamState === 'requesting' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/80">
                        <Camera size={34} className="text-[#33E1FF]" />
                        <p className="text-white text-sm font-bold">Se cere accesul la cameră…</p>
                        <p className="text-slate-300 text-xs">Confirmă permisiunea în browser.</p>
                      </div>
                    )}

                    {isWebcamCamera && webcamState === 'error' && webcamError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/85">
                        <CameraOff size={34} className="text-[#D73833]" />
                        <p className="text-white text-sm font-bold">{webcamError.title}</p>
                        <p className="text-slate-300 text-xs max-w-sm">{webcamError.detail}</p>
                        <p className="font-mono text-[10px] text-slate-500">
                          {[webcamError.name, webcamError.message].filter(Boolean).join(': ')}
                        </p>
                        <button
                          type="button"
                          onClick={startWebcam}
                          className="mt-1 px-3 py-1.5 rounded-lg bg-[#33E1FF] hover:bg-[#7EEBFF] text-[#1F1F1F] text-[11px] font-bold inline-flex items-center gap-1.5 shadow"
                        >
                          <RotateCcw size={13} />
                          Încearcă din nou
                        </button>
                        <p className="text-[10px] text-slate-400">
                          sau alege altă cameră din meniul Cameră
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center opacity-30 select-none">
                    <Video size={56} className="mx-auto mb-1 text-slate-300" />
                    <p className="font-mono font-bold text-white text-sm">{activeCamera?.name?.toUpperCase()}</p>
                    <p className="font-mono text-[11px] text-slate-300">
                      {videoFailed
                        ? 'CLIP DEMO INDISPONIBIL • FALLBACK GRAFIC'
                        : streamFailed
                        ? 'STREAM INDISPONIBIL • FALLBACK'
                        : `LIVE ANNOTATED STREAM${activeCamera?.fps ? ` • ${activeCamera?.fps} FPS` : ''}`}
                    </p>
                  </div>
                )}

                {/* Overlay-ul e fie real (canvasul motorului), fie absent. Când sursa
                    rulează fără motor nu se desenează nicio cutie de persoană: doar zona
                    configurată și o notă care spune exact ce vede vizitatorul. */}
                {engineSource && !browserEngineOn && <ZoneOutline zone={activeZone} />}

                {browserEngineOn && engineSource && (
                  <div
                    className={`absolute bottom-12 right-2.5 px-2 py-1 rounded bg-black/80 text-[10px] font-mono border ${
                      broken
                        ? 'text-[#D73833] border-[#D73833]/40'
                        : 'text-[#33E1FF] border-[#33E1FF]/40'
                    }`}
                  >
                    {engine.status === 'running'
                      ? `${USE_MOCK ? 'detecție reală · ' : ''}procesat local · ${engine.fps ? engine.fps.toFixed(1) : '—'} fps`
                      : broken
                        ? 'motor indisponibil · flux brut ascuns'
                        : 'se pregătește · flux brut ascuns'}
                  </div>
                )}

                {engineSource && !browserEngineOn && (
                  <div className="absolute z-10 bottom-14 left-1/2 -translate-x-1/2 w-[min(27rem,calc(100%-1.5rem))] px-3 py-2 rounded-xl bg-black/85 border border-[#FFEB33]/60 shadow-lg text-center">
                    <p className="text-[11px] font-bold text-[#FFEB33]">
                      detecția este oprită — cutiile nu urmăresc video
                    </p>
                    <p className="text-[10px] text-slate-300 mt-0.5">{engineReason}</p>
                    {/* Privacy differs by source. The demo clip is footage SafeSight ships;
                        the webcam is the visitor's own camera on their own machine, so the
                        raw view is acceptable ONLY with this note visible and only because
                        nothing leaves the browser. The engine, when started, blurs faces
                        before the frame is drawn. */}
                    {isWebcamCamera && (
                      <p className="text-[10px] text-slate-300 mt-0.5">
                        Vezi fluxul brut al camerei tale locale. Blurul de față apare doar când
                        pornești motorul; nimic nu părăsește browserul.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={toggleBrowserEngine}
                      className="mt-1.5 px-3 py-1.5 rounded-lg bg-[#33E1FF] hover:bg-[#7EEBFF] text-[#1F1F1F] text-[11px] font-bold inline-flex items-center gap-1.5 shadow"
                    >
                      <Cpu size={13} />
                      Pornește motorul în browser
                    </button>
                  </div>
                )}

                {/* HUD Overlay cu semnal LIVE exclusiv lângă fluxul camerei */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-black/80 px-2.5 py-1 rounded-lg text-[10px] font-mono text-white border border-white/10 shadow">
                  <span className="w-2 h-2 rounded-full bg-[#D73833] animate-ping" />
                  <span className="font-bold text-red-400">LIVE REC</span>
                  <span className="text-slate-400">|</span>
                  <span>{activeCamera?.resolution || '4K (3840x2160)'}</span>
                </div>

                {!edgeActive && !noLiveForCamera && !isWebcamCamera && (
                  <div className="absolute top-2.5 right-2.5 max-w-xs px-2.5 py-1.5 rounded-lg bg-amber-500/95 text-slate-950 text-[10px] font-bold shadow border border-amber-300">
                    Edge fără cadre live. Pornește: ./run.sh demo
                  </div>
                )}
                {demoClip && !noLiveForCamera && !isWebcamCamera && (
                  <div className="absolute bottom-12 left-2.5 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
                    Sursă demo: {demoClip}
                  </div>
                )}

                {/* Banner jos cu detalii cameră afișate sub denumire conform cerinței */}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-black/75 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-white text-xs leading-none">{activeCamera?.name}</p>
                    <p className="text-[10px] text-slate-300 font-normal mt-0.5 leading-none">{activeCamera?.subtitle}</p>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {isWebcamCamera
                      ? 'SURSĂ: camera acestui dispozitiv'
                      : `RTSP: ${activeCamera?.rtsp_url ? activeCamera?.rtsp_url.split('/').pop() : activeCamera?.id}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* O singură carte pentru motor și senzori: e mereu prezentă, are un singur titlu
              și o singură grilă. Metricele motorului intră în aceeași grilă doar cât timp
              worker-ul produce cadre, ca oprit să nu apară zerouri inventate. */}
          <LiveEngineCard
            engine={engine}
            engineOn={browserEngineOn}
            hasSource={Boolean(engineSource)}
            zoneLabel={zoneLabel}
            pipelineLabel={pipelineLabel}
            pipelineActive={pipelineActive}
            modelLabel={modelLabel}
            latencyLabel={latencyLabel}
          />
        </div>

        {/* FEED EVENIMENTE (DREAPTA în Standard sau GRILĂ MULTI-COLOANĂ dedesubt în Split) */}
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className={`rounded-xl border p-3 flex flex-col shadow-sm shrink-0 ${
            displayMode === 'split' ? 'w-full' : 'w-full xl:w-96 min-h-[460px]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-500/15 shrink-0">
            <h2 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
              <ShieldAlert size={15} className="text-[#D73833] shrink-0" />
              <span>Incidente Detectate</span>
              {USE_MOCK && (
                <>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <DemoDataChip title="Cardurile fără eticheta „local” sunt date demo din fixtures. Cele cu „local” sunt produse de motorul din browser, când îl pornești." />
                </>
              )}
            </h2>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#FFEB33] text-[#1F1F1F] font-bold">
              {filteredEvents.length}
            </span>
          </div>

          {/* Filtre: Deschise, Doar critice, Toate azi */}
          <div className="flex gap-1 my-2 shrink-0">
            {[
              { key: 'open', label: 'Deschise' },
              { key: 'critical', label: 'Doar critice' },
              { key: 'all', label: 'Toate azi' }
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterMode(f.key)}
                style={{
                  backgroundColor: filterMode === f.key
                    ? (isDarkMode ? '#D73833' : '#7EDEED')
                    : (isDarkMode ? '#282828' : '#F1F5F9'),
                  color: filterMode === f.key
                    ? (isDarkMode ? (f.key === 'standard' ? '#FFFFFF' : '#FFFFFF') : '#1F1F1F')
                    : (isDarkMode ? '#F5F5F5' : '#1F1F1F')
                }}
                className="flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center"
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Listă Carduri Evenimente (Multi-coloană în Split, vertical scroll în Standard) */}
          <div
            className={`overflow-y-auto pr-1 scrollbar-thin ${
              displayMode === 'split'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96'
                : 'space-y-2 flex-1 max-h-[580px]'
            }`}
          >
            {filteredEvents.length === 0 ? (
              <div
                style={{ backgroundColor: isDarkMode ? '#2D2D2D' : '#F8FAFC' }}
                className={`p-5 rounded-xl text-center space-y-1 mt-4 text-xs ${displayMode === 'split' ? 'col-span-full' : ''}`}
              >
                <p className="font-bold text-slate-700 dark:text-slate-300">Niciun incident în această categorie.</p>
                <p className="text-[10px] text-slate-400">Zona este conformă cu normele de siguranță.</p>
              </div>
            ) : (
              filteredEvents.map((ev) => {
                const isCrit = ev.severity === 'CRITICAL';
                const isEscalated = ev.status === 'escalated';
                const isAcked = ev.status === 'acknowledged';
                const openIncident = () => {
                  setSelectedEventId(ev.event_id);
                  setCurrentView('incident_detail');
                };

                return (
                  <div
                    key={ev.event_id}
                    // The whole card is the "open" control, so it must be reachable and
                    // operable without a mouse: Tab reaches it, Enter and Space open it.
                    role="button"
                    tabIndex={0}
                    aria-label={`Deschide incidentul ${ev.event_id}`}
                    onClick={openIncident}
                    onKeyDown={(event) => {
                      // Key events from the inner ack button bubble here; only the card
                      // itself may open the incident.
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openIncident();
                      }
                    }}
                    style={{ backgroundColor: isDarkMode ? '#2A2A2A' : '#FFFFFF' }}
                    className={`p-2.5 rounded-xl border transition-all hover:scale-[1.01] cursor-pointer space-y-1.5 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#33E1FF] ${
                      isEscalated
                        ? 'border-[#D73833] ring-2 ring-[#D73833]/40 animate-pulse'
                        : isCrit
                        ? 'border-[#D73833]/50 hover:border-[#D73833]'
                        : 'border-[#FFEB33]/50 hover:border-[#FFEB33]'
                    }`}
                  >
                    {/* Header Card */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Severitate: CRITICAL (#D73833) sau WARNING (#FFEB33) */}
                        <span
                          className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
                            isCrit
                              ? 'bg-red-50 text-[#D73833] border-red-200 dark:bg-[#D73833]/20 dark:text-[#FF8A80] dark:border-[#D73833]/40'
                              : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33] dark:border-[#FFEB33]/40'
                          }`}
                        >
                          {ev.severity}
                        </span>

                        {/* Status Human-in-the-loop */}
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                            isAcked
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                              : isEscalated
                              ? 'bg-red-100 text-[#D73833] border-red-300 dark:bg-[#D73833]/30 dark:text-[#FF8A80] font-black animate-bounce'
                              : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {STATUS_TOKENS[ev.status]?.label || ev.status}
                        </span>
                        {ev.local && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
                            title="Produs de motorul din browser în această sesiune; nu e un fixture demo."
                          >
                            local
                          </span>
                        )}
                      </div>

                      <span className="font-mono text-[10px] text-slate-400">
                        {ev.event_id.slice(-6)}
                      </span>
                    </div>

                    {/* Descriere Incident */}
                    <div>
                      <p className="font-bold text-xs leading-tight text-slate-900 dark:text-slate-100">
                        {ev.report?.what}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        {ev.camera_id} • {ev.report?.where}
                      </p>
                    </div>

                    {/* Confidence Score cu format strict: 0.91 · 14/15 cadre */}
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <ConfidenceBadge confidence={ev.confidence} />
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date(ev.detected_at).toLocaleTimeString('ro-RO')}
                      </span>
                    </div>

                    {/* Buton Acțiune Acknowledge (Verde pentru confirmare sigură) */}
                    <div className="pt-1 flex items-center justify-between border-t border-slate-500/10">
                      <span className="text-[10px] text-amber-600 dark:text-[#FFEB33] font-semibold hover:underline flex items-center gap-1">
                        <Eye size={12} /> Detalii Incident
                      </span>

                      {canDo('ack', ev.status) && (
                        <button
                          type="button"
                          onPointerDown={() => beginAckPress(ev.event_id)}
                          onClick={(e) => acknowledgeWithGuard(e, ev.event_id)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1 shadow-sm transition-colors"
                          title="Confirmă incidentul și anulează timerul de escaladare"
                        >
                          <Check size={12} /> Confirmă
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
