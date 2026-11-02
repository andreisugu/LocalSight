import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Gauge,
  Radio,
  ScanFace,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

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

function MetricCell({ icon: Icon, iconClass, label, valueClass = '', title, children }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${iconClass}`}>
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <dt className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wide leading-tight truncate">
          {label}
        </dt>
        <dd
          title={title}
          className={`font-mono font-bold text-[11px] leading-tight truncate ${valueClass}`}
        >
          {children}
        </dd>
      </div>
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
}) {
  const { themeStyles } = useTheme();
  const [measured, setMeasured] = useState(false);

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
      aria-label="Motor și senzori"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border shadow-sm p-3 space-y-2.5 shrink-0 min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
        <h2 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
          <Cpu size={13} className="text-[#33E1FF]" />
          Motor &amp; senzori
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* `fps` already lives here: one chip, never a second copy inside the card. */}
          {running && (
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-[#33E1FF] border-[#33E1FF]/40 bg-[#33E1FF]/10 whitespace-nowrap">
              procesat local · {fpsValue} fps
            </span>
          )}
          <span
            className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${
              running
                ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                : broken
                  ? 'text-[#D73833] border-[#D73833]/40 bg-[#D73833]/10'
                  : 'text-amber-600 dark:text-[#FFEB33] border-[#FFEB33]/40 bg-[#FFEB33]/10'
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-slate-800 dark:text-slate-100">
        <MetricCell
          icon={Radio}
          iconClass="bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15 text-amber-600 dark:text-[#FFEB33]"
          label="Zonă activă"
          title={zoneLabel}
        >
          {zoneLabel}
        </MetricCell>
        <MetricCell
          icon={Activity}
          iconClass="bg-emerald-500/10 text-emerald-500"
          label="Stare pipeline"
          valueClass="text-emerald-500 flex items-center gap-1"
          title={pipelineLabel}
        >
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ${
              pipelineActive ? 'bg-emerald-500' : 'bg-slate-500'
            }`}
          />
          {pipelineLabel}
        </MetricCell>
        <MetricCell
          icon={Cpu}
          iconClass="bg-amber-500/10 text-amber-500"
          label="Model detecție"
          title={modelLabel}
        >
          {modelLabel}
        </MetricCell>
        <MetricCell
          icon={Clock}
          iconClass="bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15 text-amber-600 dark:text-[#FFEB33]"
          label="Detecție → Alertă"
          valueClass="text-amber-600 dark:text-[#FFEB33]"
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

      {running && (
        <p
          className="text-[10px] font-mono text-slate-500 dark:text-slate-400"
          title="PPE are nevoie de 5–10 cadre pe aceeași urmărie; până atunci starea rămâne necunoscută."
        >
          <span className="font-semibold uppercase tracking-wide">PPE</span>{' '}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">
            {vest.vest} cu vestă
          </span>
          {' · '}
          <span className="font-bold text-[#D73833]">{vest.noVest} fără vestă</span>
          {' · '}
          <span className="text-slate-400">{vest.unknown} necunoscut</span>
        </p>
      )}

      {running ? (
        <div className="pt-2 border-t border-slate-500/15 space-y-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
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
                        ? 'text-[#D73833]'
                        : 'text-amber-600 dark:text-[#FFEB33]'
                    }`}
                  >
                    {TYPE_LABELS[event.type] || event.type}
                  </span>
                  <span className="text-slate-400">
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
              className="text-[10px] font-semibold text-amber-600 dark:text-[#FFEB33] flex items-start gap-1"
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
              ? 'text-[#D73833]'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {idleLine}
        </p>
      )}
    </section>
  );
}
