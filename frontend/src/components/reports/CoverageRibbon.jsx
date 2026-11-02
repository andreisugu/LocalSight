import { useMemo } from 'react';
import { STATUS_TOKENS } from '../../theme/status';
import { COVERAGE_STATE, GAP_REASON, incidentTicks } from '../../utils/coverage';
import { formatTime } from '../../utils/time';

// Coverage receipt — "were we actually watching?" — drawn as a ribbon, not a canvas.
//
// One row per camera: green while frames were processed, amber when the engine reported
// degraded frames, red where the tab was hidden, grey where the engine was paused or where
// frames simply stopped. Incident ticks sit above the bar at their real offset, so a gap can
// be read next to what happened inside it. With no samples the row prints "fără date" and a
// hatched grey track, never a full green bar.
//
// Not mounted yet. Usage, once the engine provider emits one sample per cadence:
//
//   const coverage = coverageFor(samples, incidents, window, { expectedFrameMs: 10000 });
//   <CoverageRibbon coverage={coverage} incidents={incidents} cameraLabel={labelForCamera} />
//
// Every position is relative to the session window, so segments and ticks line up even when
// one camera was the active source for only part of the session.

const STATE_STYLE = {
  [COVERAGE_STATE.LIVE]: {
    label: 'live',
    className: 'bg-emerald-500/85 dark:bg-emerald-400/80',
  },
  [COVERAGE_STATE.DEGRADED]: {
    label: 'degradat',
    className: 'bg-[#FFEB33]/90',
  },
  [COVERAGE_STATE.PAUSED]: {
    label: 'motor în pauză',
    className: 'bg-slate-500/70 dark:bg-slate-400/45',
  },
  [COVERAGE_STATE.HIDDEN]: {
    label: 'tab ascuns',
    className: 'bg-[#D73833]/85',
  },
  [GAP_REASON.NO_FRAMES]: {
    label: 'fără cadre',
    // Frames stopped arriving: grey with a hatch, distinct from a deliberate pause.
    className: 'bg-slate-400/45 dark:bg-slate-500/40',
    striped: true,
  },
};

// The bands the legend may show, in severity order. Only the ones present are rendered.
const LEGEND_ORDER = [
  COVERAGE_STATE.LIVE,
  COVERAGE_STATE.DEGRADED,
  GAP_REASON.NO_FRAMES,
  COVERAGE_STATE.PAUSED,
  COVERAGE_STATE.HIDDEN,
];

const HATCH = 'repeating-linear-gradient(135deg, rgba(100,116,139,0.55) 0 3px, transparent 3px 7px)';

/** `45 s`, `12 min 30 s`, `47 min` — the operator reads minutes, not milliseconds. */
function spanText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  // A shift is read in whole minutes; seconds only matter below the minute mark.
  if (totalSeconds >= 600) return `${Math.round(totalSeconds / 60)} min`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

function percentText(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value}%`;
}

/** A camera label can be one string, a `{ id: label }` map, or a resolver. */
function labelFor(cameraLabel, cameraId) {
  if (typeof cameraLabel === 'function') return cameraLabel(cameraId) || cameraId;
  if (cameraLabel && typeof cameraLabel === 'object') return cameraLabel[cameraId] || cameraId;
  if (typeof cameraLabel === 'string' && cameraLabel.trim() !== '') return cameraLabel;
  return cameraId;
}

function resolveWindow(window, coverage) {
  const from = window?.from ?? coverage?.window?.from;
  const to = window?.to ?? coverage?.window?.to;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to, durationMs: to - from };
}

/** Severity per event id, when the caller has incidents at hand; unknown stays neutral. */
function severityByEvent(incidents) {
  const map = new Map();
  for (const incident of Array.isArray(incidents) ? incidents : []) {
    const eventId = incident?.eventId ?? incident?.event_id;
    const severity = incident?.severity;
    if (typeof eventId === 'string' && (severity === 'CRITICAL' || severity === 'WARNING')) {
      map.set(eventId, severity);
    }
  }
  return map;
}

function tickColor(severity) {
  if (severity === 'CRITICAL') return STATUS_TOKENS.CRITICAL.color;
  if (severity === 'WARNING') return STATUS_TOKENS.WARNING.color;
  return '#64748B';
}

/** The visible sentence under the bar: only the buckets that actually happened. */
function blindSummary(camera) {
  const parts = [
    [GAP_REASON.NO_FRAMES, camera.noFramesMs],
    [COVERAGE_STATE.PAUSED, camera.pausedMs],
    [COVERAGE_STATE.HIDDEN, camera.hiddenMs],
    [COVERAGE_STATE.DEGRADED, camera.degradedMs],
  ]
    .filter(([, ms]) => ms > 0)
    .map(([state, ms]) => `${STATE_STYLE[state].label} ${spanText(ms)}`);
  return parts.length ? parts.join(' · ') : 'fără întreruperi';
}

function countText(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function ariaSummary(label, camera) {
  if (camera.noData) return `${label}: fără date, niciun cadru procesat în fereastră`;
  const blind = camera.gapMs > 0 ? `întreruperi ${spanText(camera.gapMs)}` : 'fără întreruperi';
  return `${label}: ${percentText(camera.coveragePct)} acoperit, ${spanText(
    camera.liveMs + camera.degradedMs
  )} din ${spanText(camera.watchedMs)}, ${blind}, ${countText(
    camera.ticks.length,
    'incident',
    'incidente'
  )}`;
}

function CameraRow({ camera, window, ticks, label, severity }) {
  const noData = camera.noData || camera.segments.length === 0;

  return (
    <li data-camera={camera.cameraId} className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="min-w-0 truncate font-mono text-[11px] font-bold" title={label}>
          {label}
        </span>
        {noData ? (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:bg-white/10 dark:text-slate-200">
            fără date
          </span>
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums">
            <span className="font-bold">{percentText(camera.coveragePct)}</span>
            <span className="ml-1 text-slate-500 dark:text-slate-400">
              {spanText(camera.liveMs + camera.degradedMs)} din {spanText(camera.watchedMs)}
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {/* Ticks above the bar, at their real offset in the session window. */}
        <div className="relative h-1.5" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.eventId}
              className="absolute bottom-0 w-[2px] -translate-x-1/2 rounded-full"
              style={{
                left: `${tick.offsetPct}%`,
                height: '6px',
                backgroundColor: tickColor(severity.get(tick.eventId)),
              }}
            />
          ))}
        </div>

        <div
          role="img"
          aria-label={ariaSummary(label, camera)}
          className="relative h-3 w-full overflow-hidden rounded border border-slate-300/80 bg-slate-100 dark:border-white/15 dark:bg-white/5"
        >
          {noData ? (
            <span
              className="absolute inset-0"
              style={{ backgroundImage: HATCH }}
              aria-hidden="true"
            />
          ) : (
            camera.segments.map((segment) => {
              const style = STATE_STYLE[segment.state] ?? STATE_STYLE[GAP_REASON.NO_FRAMES];
              return (
                <span
                  key={`${segment.from}-${segment.to}-${segment.state}`}
                  aria-hidden="true"
                  title={`${style.label} · ${formatTime(segment.from)} – ${formatTime(
                    segment.to
                  )} (${spanText(segment.to - segment.from)})`}
                  className={`absolute inset-y-0 ${style.className}`}
                  style={{
                    left: `${((segment.from - window.from) / window.durationMs) * 100}%`,
                    width: `${((segment.to - segment.from) / window.durationMs) * 100}%`,
                    backgroundImage: style.striped ? HATCH : undefined,
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      <p className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
        {noData
          ? 'niciun cadru procesat în fereastră'
          : [
              blindSummary(camera),
              // A camera that was not the active source for the whole window must say so,
              // otherwise its short bar looks like a gap.
              window.durationMs - camera.watchedMs > window.durationMs * 0.02
                ? `sursă activă ${spanText(camera.watchedMs)} din ${spanText(window.durationMs)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </p>

      {/* The same information as text, for a screen reader and for copy/paste. */}
      <ul className="sr-only">
        {camera.segments.map((segment) => (
          <li key={`sr-${segment.from}-${segment.to}-${segment.state}`}>
            {(STATE_STYLE[segment.state] ?? STATE_STYLE[GAP_REASON.NO_FRAMES]).label}{' '}
            {formatTime(segment.from)} – {formatTime(segment.to)}, {spanText(segment.to - segment.from)}
          </li>
        ))}
        {camera.gaps.map((gap) => (
          <li key={`sr-gap-${gap.from}-${gap.to}-${gap.reason}`}>
            întrerupere {(STATE_STYLE[gap.reason] ?? STATE_STYLE[GAP_REASON.NO_FRAMES]).label},{' '}
            {spanText(gap.durationMs)}
          </li>
        ))}
        {noData && <li>fără date</li>}
      </ul>
    </li>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<import('../../utils/coverage').coverageFor>} props.coverage
 * @param {{from: number, to: number}} [props.window] overrides `coverage.window`
 * @param {Array<object>} [props.incidents] used to place ticks and colour them by severity
 * @param {string|Record<string, string>|((cameraId: string) => string)} [props.cameraLabel]
 * @param {string} [props.className]
 */
export default function CoverageRibbon({
  coverage,
  window: windowProp,
  incidents = [],
  cameraLabel,
  className = '',
}) {
  const sessionWindow = useMemo(() => resolveWindow(windowProp, coverage), [windowProp, coverage]);
  const severity = useMemo(() => severityByEvent(incidents), [incidents]);

  const rows = useMemo(() => {
    if (!coverage || !sessionWindow) return [];
    return coverage.cameras.map((camera) => ({
      camera,
      ticks:
        Array.isArray(incidents) && incidents.length
          ? incidentTicks(incidents, sessionWindow, camera.cameraId)
          : camera.ticks ?? [],
    }));
  }, [coverage, incidents, sessionWindow]);

  if (!coverage) {
    return (
      <section
        aria-label="Acoperire camere"
        className={`rounded-xl border border-slate-300 bg-white/70 p-3 text-[11px] dark:border-white/15 dark:bg-white/5 ${className}`.trim()}
      >
        <p className="font-bold uppercase tracking-wide">Acoperire</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">
          fără date — nu există eșantioane de cadre pentru această fereastră
        </p>
      </section>
    );
  }

  const totals = coverage.totals ?? {};
  const noData = Boolean(coverage.noData) || Boolean(totals.noData);
  const present = new Set();
  for (const camera of coverage.cameras) {
    for (const segment of camera.segments ?? []) present.add(segment.state);
  }

  return (
    <section
      aria-label="Acoperire camere"
      className={`rounded-xl border border-slate-300 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wider">Acoperire</h3>
        <p
          className="text-[11px] tabular-nums text-slate-600 dark:text-slate-300"
          title="Timp în care cadrele au fost procesate, raportat la intervalul în care camera a fost sursa activă."
        >
          {noData ? (
            <span className="font-bold uppercase tracking-wide">fără date</span>
          ) : (
            <>
              <span className="font-bold text-[#1F1F1F] dark:text-[#F5F5F5]">
                {percentText(totals.coveragePct)}
              </span>{' '}
              · {spanText((totals.liveMs ?? 0) + (totals.degradedMs ?? 0))} din{' '}
              {spanText(totals.watchedMs ?? 0)}
              {typeof totals.cameras === 'number' && totals.cameras > 1
                ? ` · ${totals.cameras} camere`
                : ''}
            </>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
          fără date — nu există eșantioane de cadre pentru această fereastră
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map(({ camera, ticks }) => (
            <CameraRow
              key={camera.cameraId}
              camera={camera}
              window={sessionWindow}
              ticks={ticks}
              label={labelFor(cameraLabel, camera.cameraId)}
              severity={severity}
            />
          ))}
        </ul>
      )}

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600 dark:text-slate-300">
        {LEGEND_ORDER.filter((state) => present.has(state)).map(
          (state) => {
            const style = STATE_STYLE[state];
            return (
              <li key={state} className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-3 rounded-sm ${style.className}`}
                  style={{ backgroundImage: style.striped ? HATCH : undefined }}
                />
                {style.label}
              </li>
            );
          }
        )}        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-[2px] rounded-sm bg-slate-500" />
          incident
        </li>
      </ul>

      {noData && (
        <p className="mt-1 text-[10px] leading-tight text-slate-500 dark:text-slate-400">
          Nicio acoperire nu este inventată: fără eșantioane de cadre, raportul spune „fără date”.
        </p>
      )}
    </section>
  );
}
