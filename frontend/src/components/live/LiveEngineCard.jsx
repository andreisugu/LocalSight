import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Gauge,
  Radio,
  Ruler,
  ScanFace,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import GroundCalibration, { useGroundCalibration } from './GroundCalibration';
import {
  advanceTrackSpeeds,
  createTrackSpeedState,
  formatGroundRect,
} from '../../utils/groundCalibration';

// The single card that describes the engine and the sensors together. It used to be two
// blocks: the browser-engine readout (only while the engine ran) and a four-cell telemetry
// strip under the feed. Both said overlapping things, so they are one card now: the four
// sensor metrics are always there, the engine metrics join the same grid only while the
// worker is really producing frames, and nothing renders a fake zero when it is off.

const TYPE_LABELS = {
  RESTRICTED_ZONE: 'zonă restricționată',
  NO_PPE: 'fără PPE',
  SMOKING: 'fumat',
  CAMERA_OFFLINE: 'cameră offline',
};

const SEVERITY_LABELS = {
  CRITICAL: 'critic',
  WARNING: 'avertisment',
};

const STATUS_LABELS = {
  idle: 'inactiv',
  loading: 'se încarcă',
  running: 'rulează',
  error: 'eroare',
  unsupported: 'browser neacceptat',
};

// The first frames are the model download and graph warm-up; a slow number before they
// settle says nothing. Ten seconds is long enough for a WASM run to show its real pace.
const LOW_FPS_AFTER_MS = 10_000;
const LOW_FPS_THRESHOLD = 2;

// The track feed arrives with every processed frame (~5/s). Re-rendering the speed list
// that often is clutter, and the EMA already folds the frames in between, so the list is
// refreshed at most once a second. The fold itself still sees every frame.
const TRACKS_RENDER_INTERVAL_MS = 1000;

/** One decimal, Romanian comma; `null` when there is no usable reading. */
function formatSpeed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// One definition-list group: `<div>` inside `<dl>` may only hold `dt`/`dd`, so the icon
// rides inside the term and is positioned against the group. The previous version nested
// a second `<div>` between the list and the term (`dl > div > div > dt`), which breaks the
// term/definition pairing in the accessibility tree (axe: definition-list + dlitem ×8).
function MetricCell({ icon: Icon, iconClass, label, valueClass = '', title, children }) {
  return (
    <div className="relative flex min-w-0 flex-col justify-center pl-9">
      <dt className="block truncate text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
        <span
          aria-hidden="true"
          className={`absolute left-0 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg ${iconClass}`}
        >
          <Icon size={14} />
        </span>
        {label}
      </dt>
      <dd
        title={title}
        className={`truncate font-mono text-[11px] font-bold leading-tight ${valueClass}`}
      >
        {children}
      </dd>
    </div>
  );
}

export default function LiveEngineCard({
  engine,
  engineOn,
  hasSource,
  zoneLabel,
  pipelineLabel,
  pipelineActive,
  modelLabel,
  latencyLabel,
  cameraId,
  cameraLabel,
  referenceUrl,
}) {
  const { themeStyles } = useTheme();
  const [measured, setMeasured] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [trackRows, setTrackRows] = useState([]);
  const trackStateRef = useRef(createTrackSpeedState(null));
  const trackRenderRef = useRef(0);
  const ground = useGroundCalibration(cameraId);

  // Restart the low-fps measurement with every run: turning the engine off and on is a new
  // start, and the previous verdict must not stick to it. `running` flips with the worker's
  // first result, so the timer starts when frames really arrive.
  const running = engine.status === 'running';
  useEffect(() => {
    if (!running) {
      setMeasured(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setMeasured(true), LOW_FPS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [running]);

  const statusLabel = STATUS_LABELS[engine.status] || engine.status;
  const broken = engine.status === 'error' || engine.status === 'unsupported';
  const loading = engine.status === 'loading';
  const lowFps = measured && running && engine.fps < LOW_FPS_THRESHOLD;
  const recent = engine.events.slice(0, 3);
  // The worker measures these every frame (vest.js on the raw pixels). Unknown means the
  // track has not collected enough samples yet, so it is shown, not hidden.
  const vest = engine.vest || { vest: 0, noVest: 0, unknown: 0 };
  const fpsValue = engine.fps ? engine.fps.toFixed(1) : '—';

  // Ground speeds: the fold sees every tracker feed, the list re-renders at most once a
  // second. A new camera or a recalibration starts from an empty history, so an old speed
  // is never smoothed into a new map. With no calibration every row says „necalibrat”;
  // no number is invented and 0 is never printed.
  useEffect(() => {
    trackStateRef.current = createTrackSpeedState(ground.homography);
    setTrackRows([]);
    trackRenderRef.current = 0;
  }, [cameraId, ground.homography]);

  useEffect(() => {
    const feed = engine.tracks;
    if (!feed || !Array.isArray(feed.boxes)) return;
    const next = advanceTrackSpeeds(trackStateRef.current, feed, ground.homography);
    trackStateRef.current = next.state;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - trackRenderRef.current >= TRACKS_RENDER_INTERVAL_MS) {
      trackRenderRef.current = now;
      setTrackRows(next.rows);
    }
  }, [engine.tracks, ground.homography]);

  // One line instead of empty engine slots: the card keeps its shape when detection is off.
  const idleLine = !engineOn
    ? 'motorul în browser este oprit — pornește-l din butonul de pe flux'
    : !hasSource
      ? 'motorul în browser este pornit, dar camera nu are flux de procesat'
      : loading
        ? 'se încarcă modelul — primele cadre sosesc în câteva secunde'
        : broken
          ? engine.message || 'motorul nu a pornit.'
          : 'se așteaptă primele cadre procesate…';

  return (
    <section
      data-testid="engine-card"
      aria-label="Motor și senzori"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border shadow-sm p-3 space-y-2.5 shrink-0 min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
        <h2 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
          <Cpu size={13} className="text-cyan-700 dark:text-[#33E1FF]" />
          Motor &amp; senzori
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* `fps` already lives here: one chip, never a second copy inside the card. */}
          {running && (
            <span
              data-testid="engine-fps"
              data-fps={engine.fps}
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-cyan-700 dark:text-[#33E1FF] border-[#33E1FF]/40 bg-[#33E1FF]/10 whitespace-nowrap"
            >
              procesat local · {fpsValue} fps
            </span>
          )}
          <span
            data-testid="engine-status"
            data-engine-status={engine.status}
            className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${
              running
                ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                : broken
                  ? 'text-[#B91C1C] dark:text-[#FF8A80] border-[#D73833]/40 bg-[#D73833]/10'
                  : 'text-amber-700 dark:text-[#FFEB33] border-[#FFEB33]/40 bg-[#FFEB33]/10'
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-slate-800 dark:text-slate-100">
        <MetricCell
          icon={Radio}
          iconClass="bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15 text-amber-700 dark:text-[#FFEB33]"
          label="Zonă"
          title={zoneLabel}
        >
          {zoneLabel}
        </MetricCell>
        <MetricCell
          icon={Activity}
          iconClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          label="Stare pipeline"
          valueClass="text-emerald-700 dark:text-emerald-400 flex items-center gap-1"
          title={pipelineLabel}
        >
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              pipelineActive ? 'bg-emerald-500' : 'bg-slate-500'
            }`}
          />
          {pipelineLabel}
        </MetricCell>
        <MetricCell
          icon={Cpu}
          iconClass="bg-amber-500/10 text-amber-700 dark:text-[#FFEB33]"
          label="Model detecție"
          title={modelLabel}
        >
          {modelLabel}
        </MetricCell>
        <MetricCell
          icon={Clock}
          iconClass="bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15 text-amber-700 dark:text-[#FFEB33]"
          label="Detecție → Alertă"
          valueClass="text-amber-700 dark:text-[#FFEB33]"
          title={latencyLabel}
        >
          {latencyLabel}
        </MetricCell>

        {/* Engine metrics share the grid above; they exist only while the worker reports
            real frames, so an idle engine never paints invented zeros. */}
        {running && (
          <>
            <MetricCell
              icon={Gauge}
              iconClass="bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
              label="fps"
              valueClass="text-slate-800 dark:text-slate-100"
              title={`${fpsValue} fps procesate local`}
            >
              {fpsValue}
            </MetricCell>
            <MetricCell
              icon={Users}
              iconClass="bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
              label="persoane"
              valueClass="text-slate-800 dark:text-slate-100"
            >
              {engine.persons}
            </MetricCell>
            <MetricCell
              icon={ScanFace}
              iconClass="bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
              label="fețe"
              valueClass="text-slate-800 dark:text-slate-100"
            >
              {engine.faces}
            </MetricCell>
            <MetricCell
              icon={ShieldAlert}
              iconClass="bg-[#D73833]/10 text-[#D73833]"
              label="incidente"
              valueClass="text-slate-800 dark:text-slate-100"
              title={`${engine.totalEvents} incidente produse de motor`}
            >
              {engine.totalEvents}
            </MetricCell>
          </>
        )}
      </dl>

      {/* Ground calibration lives in this card, not on the stage: the operator keeps the
          engine readout and the alert feed while placing four corners on the reference
          still. The webcam has no reference frame, so it never shows the trigger. */}
      {engineOn && referenceUrl && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-500/15 pt-2">
          <Ruler
            size={12}
            className="shrink-0 text-cyan-700 dark:text-[#33E1FF]"
            aria-hidden="true"
          />
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Calibrare sol
          </span>
          <span
            data-testid="ground-calibration-label"
            data-calibrated={ground.calibrated ? 'true' : 'false'}
            className={`font-mono text-[10px] font-bold ${
              ground.calibrated
                ? 'text-cyan-700 dark:text-[#33E1FF]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {ground.calibrated ? ground.label : 'necalibrat'}
          </span>
          <button
            type="button"
            onClick={() => setCalibrationOpen((open) => !open)}
            aria-expanded={calibrationOpen}
            className="ml-auto inline-flex items-center gap-1 rounded border border-cyan-600/40 bg-cyan-600/5 px-2 py-1 text-[10px] font-bold text-cyan-800 hover:bg-cyan-600/15 dark:border-[#33E1FF]/40 dark:text-[#33E1FF] dark:hover:bg-[#33E1FF]/10"
          >
            <Ruler size={11} aria-hidden="true" />
            {calibrationOpen ? 'Închide calibrarea' : 'Calibrare sol'}
          </button>
        </div>
      )}

      {calibrationOpen && engineOn && referenceUrl && (
        <GroundCalibration
          cameraId={cameraId}
          cameraLabel={cameraLabel}
          referenceUrl={referenceUrl}
          savedCalibration={ground.calibration}
          onSave={ground.save}
          onReset={ground.reset}
          onClose={() => setCalibrationOpen(false)}
        />
      )}

      {/* Speeds come from the tracker's own foot points through the calibration map. No
          calibration means every row says „necalibrat”; a truncated box or a missing
          previous sample says why there is no number instead of printing 0. */}
      {running && (
        <div
          data-testid="ground-speeds"
          className="space-y-1 border-t border-slate-500/15 pt-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Viteză la sol
            </p>
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {ground.homography ? formatGroundRect(ground.calibration) : 'necalibrat'}
            </span>
          </div>
          {trackRows.length === 0 ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              nicio pistă urmărită acum
            </p>
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
              {trackRows.slice(0, 6).map((row) => {
                const speed = formatSpeed(row.speedMps);
                const state = row.truncated
                  ? 'trunchiat'
                  : speed !== null
                    ? `${speed} m/s`
                    : ground.homography
                      ? 'fără eșantion'
                      : 'necalibrat';
                return (
                  <li
                    key={row.id}
                    data-track-id={row.id}
                    data-speed-mps={row.speedMps ?? ''}
                    className="inline-flex items-baseline gap-1"
                  >
                    <span className="text-slate-500 dark:text-slate-400">track {row.id}</span>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span
                      className={
                        speed !== null
                          ? 'font-bold text-cyan-700 dark:text-[#33E1FF]'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {state}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {trackRows.length > 6 && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              +{trackRows.length - 6} piste
            </p>
          )}
          {ground.homography && engine.aligned === true && (
            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
              calibrarea e pe cadrul de referință; alinierea urmărește o cameră care se
              mișcă, deci viteza e orientativă.
            </p>
          )}
        </div>
      )}

      {running && (
        <p
          className="text-[10px] font-mono text-slate-500 dark:text-slate-400"
          title="PPE are nevoie de 5–10 cadre pe aceeași urmărie; până atunci starea rămâne necunoscută."
        >
          <span className="font-semibold uppercase tracking-wide">PPE</span>{' '}
          <span className="font-bold text-emerald-700 dark:text-emerald-400">
            {vest.vest} cu vestă
          </span>
          {' · '}
          <span className="font-bold text-[#B91C1C] dark:text-[#FF8A80]">{vest.noVest} fără vestă</span>
          {' · '}
          <span className="text-slate-500 dark:text-slate-400">{vest.unknown} necunoscut</span>
        </p>
      )}

      {running ? (
        <div className="pt-2 border-t border-slate-500/15 space-y-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Ultimele incidente
          </p>
          {recent.length === 0 ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Niciun incident încă; zona are nevoie de prezență continuă.
            </p>
          ) : (
            <ul className="space-y-1">
              {recent.map((event) => (
                <li
                  key={event.event_id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300"
                >
                  <span
                    className={`font-bold ${
                      event.severity === 'CRITICAL'
                        ? 'text-[#B91C1C] dark:text-[#FF8A80]'
                        : 'text-amber-700 dark:text-[#FFEB33]'
                    }`}
                  >
                    {TYPE_LABELS[event.type] || event.type}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {SEVERITY_LABELS[event.severity] || event.severity}
                  </span>
                  <span>track {event.track_id}</span>
                  <span>{Number(event.duration_s).toFixed(2)} s</span>
                </li>
              ))}
            </ul>
          )}
          {lowFps && (
            <p
              role="status"
              className="text-[10px] font-semibold text-amber-700 dark:text-[#FFEB33] flex items-start gap-1"
            >
              <AlertTriangle size={12} className="shrink-0 mt-px" />
              rulează pe WASM cu un singur fir (service worker-ul COOP/COEP nu e activ);
              reîncarcă pagina pentru cele 4 fire, sau folosește Chrome/Edge (vezi /bench)
            </p>
          )}
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            canvasul arată cadrul procesat local (blur + detecții), nu clipul brut.
          </p>
        </div>
      ) : (
        <p
          role="status"
          className={`text-[10px] leading-snug ${
            broken
              ? 'text-[#B91C1C] dark:text-[#FF8A80]'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {idleLine}
        </p>
      )}
    </section>
  );
}
