import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Camera, CameraOff, Cpu, RotateCcw, Upload, Video } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useEngine } from '../../engine/useEngine';
import { DEFAULT_LAB_ZONE } from '../../engine/zones.default';

const MODEL_HINT = `${import.meta.env.BASE_URL}models/yolo26n.onnx + ${import.meta.env.BASE_URL}models/yunet.onnx`;

const SOURCE_CLIP = 'clip';
const SOURCE_CAMERA = 'camera';

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

// Spike page: proves YOLO + YuNet + the zone rule engine run in the browser on a looping
// clip or on the laptop webcam. No backend: the zone is the full-frame lab fixture, and
// the incidents live in memory for as long as the tab is open.
export default function LabView() {
  const { themeStyles } = useTheme();
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
  });

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

  const badgeColour = engine.status === 'running'
    ? '#33E1FF'
    : engine.status === 'error' || engine.status === 'unsupported'
      ? '#FF5C5C'
      : '#FFEB33';

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
          border: `1px solid ${active ? '#FFEB33' : themeStyles.panelBorder}`,
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: themeStyles.textColor }}>
            <Activity size={18} />
            Lab - motor în browser
          </h1>
          <p className="text-sm opacity-60" style={{ color: themeStyles.textColor }}>
            Detecție de persoane YOLO, blur de față YuNet și incidente din zona cadrului
            întreg, ONNX Runtime Web, fără backend.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded p-1" style={{ backgroundColor: themeStyles.cardBg }}>
            {switchButton(SOURCE_CLIP, 'Clip', Video)}
            {switchButton(SOURCE_CAMERA, 'Cameră', Camera)}
          </div>

          {source === SOURCE_CLIP && (
            <label
              className="px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2"
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
                  border: `1px solid ${themeStyles.panelBorder}`,
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
                className="px-3 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
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
        <p className="text-xs opacity-60" style={{ color: themeStyles.textColor }}>
          Numele camerelor apar abia după ce acorzi permisiunea; până atunci sunt numerotate.
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: themeStyles.textColor }}>
          <span className="flex items-center gap-1">
            <Cpu size={14} />
            stare: <strong style={{ color: badgeColour }}>{statusLabel}</strong>
          </span>
          <span>fps: <strong>{engine.fps || '—'}</strong></span>
          <span>persoane: <strong>{engine.persons}</strong></span>
          <span>fețe: <strong>{engine.faces}</strong></span>
          <span>cadru: <strong>{engine.ms ? `${engine.ms} ms` : '—'}</strong></span>
          <span className="opacity-60">
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
            <p className="mt-1 text-xs opacity-60">
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
                    style={{ color: event.severity === 'CRITICAL' ? '#FF5C5C' : '#FFEB33' }}
                  >
                    {event.type}
                  </span>
                  <span className="opacity-80">severitate: {event.severity}</span>
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
          <div className="opacity-70">{cameraError.detail}</div>
          <div className="opacity-50 mt-1 font-mono text-xs">
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
          <div className="opacity-70">{engine.message || 'Eroare necunoscută.'}</div>
          <div className="opacity-50 mt-1 font-mono text-xs">
            Modelele sunt așteptate la {MODEL_HINT}. Sursa video continuă să ruleze mai jos;
            fără grafice canvasul nu are ce să deseneze.
          </div>
        </div>
      )}

      {engine.status === 'loading' && (
        <div className="text-sm opacity-60" style={{ color: themeStyles.textColor }}>
          {engine.message || 'Se încarcă modelele...'}
          {!engine.providers.length && ' (prima încărcare are câteva zeci de MB)'}
        </div>
      )}

      <div className="relative rounded overflow-hidden" style={{ backgroundColor: '#000' }}>
        <canvas
          ref={canvasRef}
          className="block w-full h-auto max-h-[70vh] object-contain"
        />

        {source === SOURCE_CLIP && !clipUrl && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
            style={{ color: themeStyles.textColor }}
          >
            <Video size={28} />
            <span>Alege un clip local pentru a porni motorul.</span>
            <span className="opacity-50 font-mono text-xs">
              VITE_DEMO_VIDEO nu este setat, deci nu există un clip implicit.
            </span>
          </div>
        )}

        {source === SOURCE_CAMERA && cameraState === 'requesting' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
            style={{ color: themeStyles.textColor }}
          >
            <Camera size={28} />
            <span>Se cere accesul la cameră...</span>
            <span className="opacity-60 text-xs">Confirmă permisiunea în browser.</span>
          </div>
        )}

        {source === SOURCE_CAMERA && cameraState === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
            style={{ color: themeStyles.textColor }}
          >
            <CameraOff size={28} />
            <span>Camera nu este pornită.</span>
            <span className="opacity-60 text-xs">Motivul este afișat mai sus.</span>
          </div>
        )}

        {source === SOURCE_CAMERA
          && cameraState === 'live'
          && engine.status !== 'running'
          && engine.status !== 'error'
          && engine.status !== 'unsupported' && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
              style={{ color: themeStyles.textColor }}
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

      <p className="text-xs opacity-50" style={{ color: themeStyles.textColor }}>
        Spike: cutii pe persoane, blur de față, fps și incidentele produse de zona „cadru
        întreg”. Snapshot-ul, raportul și escaladarea nu sunt conectate aici.
      </p>
    </div>
  );
}
