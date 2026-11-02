import React, { useEffect, useState } from 'react';
import { AlertTriangle, Cpu } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Compact readout for the browser engine attached to the Live clip. It owns no engine
// state: `useEngine` hands it the same numbers the /lab overlay prints, plus the events
// the worker's zone rules produced.

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

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400 leading-tight">
        {label}
      </span>
      <span className="block font-mono font-bold text-[13px] leading-tight truncate">
        {value}
      </span>
    </div>
  );
}

export default function EnginePanel({ engine }) {
  const { themeStyles } = useTheme();
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    // Restart the measurement when the panel mounts: turning the engine off and on is a
    // new run, and the previous low-fps verdict must not stick to it.
    const timer = window.setTimeout(() => setMeasured(true), LOW_FPS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const statusLabel = STATUS_LABELS[engine.status] || engine.status;
  const broken = engine.status === 'error' || engine.status === 'unsupported';
  const lowFps = measured && engine.status === 'running' && engine.fps < LOW_FPS_THRESHOLD;
  const recent = engine.events.slice(0, 3);

  return (
    <section
      aria-label="Motor în browser"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border shadow-sm p-2.5 space-y-2 shrink-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
          <Cpu size={13} className="text-[#33E1FF]" />
          Motor în browser
        </h2>
        <div className="flex items-center gap-1.5">
          {/* The canvas above is the worker's output, never the raw clip: say it here so the
              panel and the badge on the canvas tell the same story. */}
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-[#33E1FF] border-[#33E1FF]/40 bg-[#33E1FF]/10">
            procesat local · {engine.fps ? engine.fps.toFixed(1) : '—'} fps
          </span>
          <span
            className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
              engine.status === 'running'
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

      <div className="grid grid-cols-4 gap-2 text-slate-800 dark:text-slate-100">
        <Metric label="fps" value={engine.fps ? engine.fps.toFixed(1) : '—'} />
        <Metric label="persoane" value={engine.persons} />
        <Metric label="fețe" value={engine.faces} />
        <Metric label="incidente" value={engine.totalEvents} />
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        canvasul arată cadrul procesat local (blur + detecții), nu clipul brut.
      </p>

      <div className="pt-1.5 border-t border-slate-500/15">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          Ultimele incidente
        </p>
        {recent.length === 0 ? (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Niciun incident încă; zona are nevoie de prezență continuă.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {recent.map((event) => (
              <li
                key={event.event_id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300"
              >
                <span
                  className={`font-bold ${
                    event.severity === 'CRITICAL' ? 'text-[#D73833]' : 'text-amber-600 dark:text-[#FFEB33]'
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
      </div>

      {lowFps && (
        <p role="status" className="text-[10px] font-semibold text-amber-600 dark:text-[#FFEB33] flex items-start gap-1">
          <AlertTriangle size={12} className="shrink-0 mt-px" />
          rulează pe WASM single-thread; sub 2 fps — încercați Chrome cu WebGPU
        </p>
      )}

      {broken && (
        <p className="text-[10px] text-[#D73833]">
          {engine.message || 'Motorul nu a pornit.'}
        </p>
      )}
    </section>
  );
}
