import React, { useEffect, useMemo, useState } from 'react';
import { Box, Cpu, Database, HardDrive, Layers, Lock, Server, Settings, ShieldCheck, Terminal, Trash2, Video } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { TYPE_LABELS } from '../../services/api';
import {
  readEngineSettings,
  resolveWasmThreads,
  storeSafetyBlur,
  storeWasmThreads,
} from '../../utils/engineSettings';
import { BACKGROUND_MAX_CAMERAS, BACKGROUND_MIN_CORES } from '../../context/useBackgroundCameras';
import { WEBCAM_CAMERA_ID } from '../live/liveMedia';
import {
  AUDIT_LIMIT,
  buildAuditRows,
  buildCameraRows,
  buildSystemTiles,
  formatAuditTime,
  latestDetectionModel,
  sourceSummary,
} from '../../utils/systemView';

// Rewritten screen. It answers one question — "what is actually running here?" — from the
// data the app already has: the health record (static vs backend), the camera list, the
// zones and the incident timestamps. Counts, table rows and audit rows live in
// utils/systemView.js and are tested there; this file only renders their result.
// Nothing on the page is hard-coded to a value it cannot verify.

const INCIDENT_VIEW = 'incident_detail';

const TILE_ICONS = {
  build: Server,
  engine: Cpu,
  model: Box,
  cameras: Video,
  backend: Database,
  edge: Cpu,
};

const TONE_TEXT = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-slate-700 dark:text-slate-300',
  demo: 'text-amber-700 dark:text-amber-400',
};

// Background cameras: one label per state the manager can report. `error` never reaches
// this map (the manager retries it as `backoff`), but a stale row must still say something.
const BACKGROUND_STATE = {
  running: { label: 'rulează', tone: 'ok' },
  starting: { label: 'pornește', tone: 'warn' },
  active: { label: 'preluată de Live', tone: 'neutral' },
  stopped: { label: 'oprită', tone: 'neutral' },
  backoff: { label: 'reîncearcă', tone: 'warn' },
  unsupported: { label: 'neacceptată', tone: 'bad' },
  skipped: { label: 'sărită', tone: 'warn' },
  error: { label: 'eroare', tone: 'bad' },
};

const BACKGROUND_REFUSAL = {
  'camera-limit': `Prea multe camere pentru limita de siguranță (max. ${BACKGROUND_MAX_CAMERAS}).`,
  'low-hardware': `Mașina are prea puține nuclee pentru încă o sesiune ONNX per cameră (minimum ${BACKGROUND_MIN_CORES}).`,
  'hardware-unknown': 'Browserul nu raportează numărul de nuclee; guarda refuză.',
};

/** Approximate storage size; the number comes from the stored blobs plus the records. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Chip({ tone = 'neutral', children }) {
  const tones = {
    demo: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    neutral: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold tracking-wide ${tones[tone] || tones.neutral}`}
    >
      {children}
    </span>
  );
}

function SummaryCell({ tile, themeStyles }) {
  const Icon = TILE_ICONS[tile.id] || Cpu;
  return (
    <div
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="min-w-0 rounded-xl border p-3"
    >
      <dt
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: themeStyles.textMuted }}
      >
        <Icon size={13} aria-hidden="true" />
        {tile.label}
      </dt>
      <dd className="mt-1">
        <span className={`block font-mono text-sm font-bold ${TONE_TEXT[tile.tone] || TONE_TEXT.neutral}`}>{tile.value}</span>
        <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: themeStyles.textMuted }}>
          {tile.detail}
        </span>
      </dd>
    </div>
  );
}

export default function SettingsView() {
  const { themeStyles } = useTheme();
  const {
    cameras,
    zones,
    events,
    health,
    setSelectedEventId,
    setCurrentView,
    localEvidence,
    showToast,
    showDemoData,
    setShowDemoData,
    backgroundEnabled,
    setBackgroundEnabled,
    getBackgroundStatus,
  } = useSecurity();

  // The stored-count panel is a read of IndexedDB, so it is refreshed when the screen
  // opens (and by the provider after every write) instead of once at boot.
  const { refreshStats } = localEvidence;
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const removeLocalData = async () => {
    setClearing(true);
    const cleared = await localEvidence.clearLocalData();
    setClearing(false);
    setConfirmingClear(false);
    showToast(
      cleared
        ? 'Datele locale au fost șterse. Incidentele demo rămân.'
        : 'Ștergerea datelor locale a eșuat.'
    );
  };

  // Persisted engine settings. The panel writes and reads the same localStorage key the
  // engine reads on its next start, so what is shown here is what the worker will do.
  const [engineSettings, setEngineSettings] = useState(() => readEngineSettings());
  const isolation = useMemo(
    () => ({
      crossOriginIsolated: typeof globalThis !== 'undefined' && Boolean(globalThis.crossOriginIsolated),
      hardwareConcurrency: typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
    }),
    []
  );
  const resolvedThreads = resolveWasmThreads(engineSettings.wasmThreads, isolation);
  const cores = Number.isFinite(isolation.hardwareConcurrency)
    ? Math.floor(isolation.hardwareConcurrency)
    : null;
  const isolated = isolation.crossOriginIsolated;
  const storedThreads = engineSettings.wasmThreads === 'auto'
    ? 'automat'
    : String(engineSettings.wasmThreads);
  // F6: without cross-origin isolation ORT cannot start a second thread. The select must
  // show the 1 that actually runs, not the 6 that is only stored, and it says both.
  const threadReason = !isolated
    ? `stocat ${storedThreads} · rulează 1 fără izolare`
    : engineSettings.wasmThreads === 'auto'
      ? `${resolvedThreads} — izolat, ${cores ?? '?'} nuclee; automat (max. 4)`
      : `${resolvedThreads} — izolat, ${cores ?? '?'} nuclee; ales ${engineSettings.wasmThreads}${
          resolvedThreads < engineSettings.wasmThreads ? ', limitat de nuclee' : ''
        }`;

  const changeThreads = (event) => {
    const value = event.target.value;
    setEngineSettings(storeWasmThreads(value === 'auto' ? 'auto' : Number(value)));
  };
  const changeSafetyBlur = (event) => {
    setEngineSettings(storeSafetyBlur(event.target.checked));
  };

  // The manager lives in the provider; Settings only samples its status once a second
  // while the option is on. When it is off there is nothing to poll: the section renders
  // the preference and no worker exists.
  const [backgroundStatus, setBackgroundStatus] = useState(() => getBackgroundStatus());
  useEffect(() => {
    setBackgroundStatus(getBackgroundStatus());
    if (!backgroundEnabled) return undefined;
    const timer = setInterval(() => setBackgroundStatus(getBackgroundStatus()), 1000);
    return () => clearInterval(timer);
  }, [backgroundEnabled, getBackgroundStatus]);

  const backgroundRows = useMemo(() => {
    const reported = new Map(((backgroundStatus?.cameras) || []).map((camera) => [camera.id, camera]));
    return (cameras || []).map((camera) => {
      const row = reported.get(camera.id);
      let state = row?.state || 'stopped';
      let detail = '';
      if (!row) {
        if (camera.id === WEBCAM_CAMERA_ID) {
          state = 'local';
          detail = 'cameră locală — permisiunea se cere în Live; nu rulează în fundal';
        } else if (camera.status === 'offline') {
          state = 'offline';
          detail = 'offline — fără sursă de decodat';
        } else {
          detail = 'fără clip demo redabil';
        }
      } else if (state === 'skipped') {
        detail = BACKGROUND_REFUSAL[backgroundStatus?.refusedReason] || 'sărită de guarda de resurse';
      } else if (state === 'active') {
        detail = 'procesată de motorul Live; nu se dublează';
      } else if (state === 'running' || state === 'starting') {
        detail = '~1 cadru / 2 s (0,5 fps), nu 30 fps';
      } else if (state === 'backoff') {
        detail = row.lastError || 'reîncearcă după o eroare';
      } else if (state === 'unsupported') {
        detail = row.lastError || row.engineStatus?.message || 'sursă neacceptată';
      } else if (state === 'stopped') {
        detail = backgroundEnabled ? 'se așteaptă pornirea' : 'niciun worker pornit';
      }
      const stateStyle = BACKGROUND_STATE[state] || { label: state, tone: 'neutral' };
      return {
        id: camera.id,
        code: camera.code || camera.id,
        state,
        label: state === 'local' ? 'locală' : state === 'offline' ? 'offline' : stateStyle.label,
        tone: state === 'local' || state === 'offline' ? 'neutral' : stateStyle.tone,
        detail,
        events: row?.events ?? 0,
      };
    });
  }, [cameras, backgroundStatus, backgroundEnabled]);

  const runningBackground = (backgroundStatus?.cameras || [])
    .filter((camera) => camera.state === 'running' || camera.state === 'starting').length;

  const isMock = Boolean(health?.mock);
  const latestModel = useMemo(() => latestDetectionModel(events), [events]);
  const tiles = useMemo(
    () => buildSystemTiles({ isMock, health, cameras, zones, latestModel }),
    [isMock, health, cameras, zones, latestModel]
  );
  const cameraRows = useMemo(() => buildCameraRows(cameras, { isMock, zones }), [cameras, isMock, zones]);
  const sources = useMemo(() => sourceSummary(cameras, { isMock }), [cameras, isMock]);
  const auditRows = useMemo(
    () => buildAuditRows(events, { typeLabels: TYPE_LABELS, isMock, limit: AUDIT_LIMIT }),
    [events, isMock]
  );

  const muted = { color: themeStyles.textMuted };
  const surface = { backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder };
  const clipPhrase = `${sources.clips} ${sources.clips === 1 ? 'clip demo' : 'clipuri demo'}`;

  const showIncident = (id) => {
    if (!id) return;
    setSelectedEventId(id);
    setCurrentView(INCIDENT_VIEW);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <header className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Settings size={20} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
            <h2 className="text-lg font-black uppercase tracking-tight">Sistem &amp; Audit</h2>
            <Chip tone={isMock && showDemoData ? 'demo' : 'neutral'}>
              {isMock
                ? showDemoData
                  ? 'BUILD STATIC · DATE DEMO'
                  : 'BUILD STATIC · FĂRĂ FIXTURES'
                : 'BACKEND + EDGE'}
            </Chip>
          </div>
          <p className="max-w-3xl text-xs" style={muted}>
            {isMock && showDemoData
              ? 'Build static: fără backend, fără edge. Starea de mai jos vine din fixture-urile demo și din motorul local, când rulează; jurnalul e tot demo.'
              : isMock
                ? 'Build static: fără backend, fără edge. Fixture-urile demo sunt ascunse; starea de mai jos vine din motorul local, când rulează.'
                : 'Starea backend-ului și a edge-ului, plus jurnalul acțiunilor din datele primite.'}
          </p>
        </header>

        <section aria-label="Sumar sistem">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <SummaryCell key={tile.id} tile={tile} themeStyles={themeStyles} />
            ))}
          </dl>
        </section>

        {/* The toggle governs the fixture build's demo incidents. A real backend has no
            fixtures, so the control would be inert there and is not rendered. */}
        {isMock && (
          <section
            aria-labelledby="demo-data-heading"
            style={surface}
            className="space-y-2 rounded-xl border p-4"
            data-testid="demo-data"
          >
            <h3 id="demo-data-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
              <Database size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
              Date demo
              <Chip tone={showDemoData ? 'demo' : 'neutral'}>
                {showDemoData ? 'FIXTURES VIZIBILE' : 'ASCUNSE'}
              </Chip>
            </h3>
            <label className="flex items-start gap-2 text-xs font-bold">
              <input
                type="checkbox"
                data-testid="demo-toggle"
                checked={showDemoData}
                onChange={(event) => setShowDemoData(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#0284C7] focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
              />
              <span>Arată incidentele demo (fixtures)</span>
            </label>
            <p className="text-[11px] leading-snug" style={muted}>
              Implicit vezi doar detecțiile motorului din browser; fixtures sunt date de demo, nu camere
              reale. Alegerea se păstrează în acest browser. Cu ele pornite, cardurile și cifrele demo
              poartă eticheta <strong className="font-bold">date demo</strong>.
            </p>
          </section>
        )}

        <section aria-labelledby="cameras-heading" style={surface} className="overflow-hidden rounded-xl border">
          <div className="space-y-1 px-4 pb-3 pt-4">
            <h3 id="cameras-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
              <Video size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
              Camere
              <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-normal" style={{ ...muted, borderColor: themeStyles.panelBorder }}>
                {cameraRows.length}
              </span>
            </h3>
            <p className="text-xs" style={muted}>
              {isMock
                ? `${clipPhrase}${sources.local > 0 ? ' plus camera locală din browser' : ''}; niciun feed de rețea nu e conectat. Camera locală cere permisiunea browserului când o deschizi în Live.`
                : `${cameraRows.length} camere configurate; motorul fiecăreia se pornește din Live.`}
            </p>
          </div>

          {cameraRows.length === 0 ? (
            <p className="px-4 pb-4 text-xs" style={muted}>
              Nicio cameră înregistrată.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <caption className="sr-only">Sursele video, starea lor din build și numărul de zone configurate</caption>
                  <thead>
                    <tr className="border-y" style={{ borderColor: themeStyles.panelBorder, ...muted }}>
                      <th scope="col" className="py-2 pl-4 pr-3 font-semibold">
                        Cameră
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Sursă
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Stare
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Motor
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">
                        Zone
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cameraRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-b-0" style={{ borderColor: themeStyles.panelBorder }}>
                        <td className="py-2 pl-4 pr-3">
                          <span className="font-bold">{row.code}</span>
                          <span className="block text-[10px]" style={muted}>
                            {row.id}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">{row.sourceLabel}</td>
                        <td className={`whitespace-nowrap py-2 pr-3 font-bold ${TONE_TEXT[row.statusTone]}`}>
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                            {row.statusLabel}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{row.engineLabel}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{row.zoneCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2 text-[11px]" style={{ ...muted, borderColor: themeStyles.panelBorder }}>
                {isMock
                  ? 'Motorul arată starea din fixture-ul demo, nu o rulare reală: îl pornești din Live.'
                  : 'Motorul fiecărei camere se pornește din Live; starea de aici vine din backend.'}
              </p>
            </>
          )}
        </section>

        <section
          aria-labelledby="engine-settings-heading"
          style={surface}
          className="space-y-3 rounded-xl border p-4"
        >
          <h3 id="engine-settings-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
            <Cpu size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
            Motor &amp; performanță
          </h3>
          <p className="text-xs" style={muted}>
            Firele WASM și blurul de siguranță se citesc la pornirea worker-ului: se aplică la următoarea pornire a
            motorului.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="wasm-threads" className="block text-xs font-bold">
                Fire WASM
              </label>
              <select
                id="wasm-threads"
                data-testid="wasm-threads"
                value={isolated ? String(engineSettings.wasmThreads) : '1'}
                onChange={changeThreads}
                disabled={!isolated}
                aria-describedby="wasm-threads-note"
                style={{
                  backgroundColor: themeStyles.cardBg,
                  borderColor: themeStyles.panelBorder,
                  color: themeStyles.text,
                }}
                className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#FFEB33] disabled:opacity-70 sm:max-w-[10rem]"
              >
                {/* F6: the value shown is the one that runs. Without isolation the stored
                    choice is preserved but cannot apply, so the select shows 1 instead of
                    a 6 that would be a lie. */}
                <option value="auto">Automat</option>
                {isolated ? <option value="1">1</option> : <option value="1">1 — efectiv (fără izolare)</option>}
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8">8</option>
              </select>
              <p
                id="wasm-threads-note"
                data-testid="wasm-threads-effective"
                data-effective={resolvedThreads}
                data-stored={String(engineSettings.wasmThreads)}
                className="font-mono text-[11px] leading-snug"
                style={muted}
              >
                {threadReason}
              </p>
              <p className="text-[11px] leading-snug" style={muted}>
                Automat înseamnă maximum 4 fire; un număr ales este limitat de nucleele mașinii. Fără izolare
                (COOP/COEP) browserul nu poate porni fire suplimentare.
              </p>
              {!isolated && (
                <p data-testid="wasm-threads-note" className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                  Selectul arată 1, cât rulează acum. Alegerea stocată ({storedThreads}) rămâne salvată și se
                  aplică automat când izolarea (COOP/COEP) revine.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={engineSettings.safetyBlur}
                  onChange={changeSafetyBlur}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#0284C7] focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
                />
                <span>Blur de siguranță pe cap</span>
              </label>
              <p className="text-[11px] leading-snug" style={muted}>
                OFF = doar fețele găsite de YuNet sunt blurate; o față ratată (profil) poate rămâne vizibilă.
                Recomandat ON pentru demo-uri publice.
              </p>
              <p className="text-[11px] leading-snug" style={muted}>
                Cu ON, banda superioară a fiecărei persoane (35%) este blurată; cu OFF rămâne clară, iar blurul
                de față și oprirea pe eroare (fail-closed) nu se schimbă.
              </p>
            </div>
          </div>
        </section>

        <section
          data-testid="background-panel"
          aria-labelledby="background-heading"
          style={surface}
          className="space-y-3 rounded-xl border p-4"
        >
          <h3 id="background-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
            <Layers size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
            Camere în fundal
            <Chip tone={backgroundEnabled ? 'demo' : 'neutral'}>
              {backgroundEnabled ? 'PORNIT' : 'OPRIT'}
            </Chip>
            {backgroundEnabled && backgroundStatus?.refusedReason && (
              <Chip tone="demo">REFUZAT</Chip>
            )}
          </h3>

          <label className="flex items-start gap-2 text-xs font-bold">
            <input
              type="checkbox"
              data-testid="background-toggle"
              checked={backgroundEnabled}
              onChange={(event) => setBackgroundEnabled(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#0284C7] focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
            />
            <span>Toate camerele rulează în fundal (implicit OPRIT)</span>
          </label>

          <p className="text-xs" style={muted}>
            Pornește un worker de inferență separat pentru fiecare cameră, nu doar pentru cea din Live.
            {' '}
            {BACKGROUND_MAX_CAMERAS} camere înseamnă aproximativ {BACKGROUND_MAX_CAMERAS}× memoria și CPU-ul
            unei singure camere: fiecare worker are propria sesiune ONNX, deci un laptop mic va deveni lent.
            Ritmul este redus intenționat, ~1 cadru la 2 s (0,5 fps) per cameră — nu 30 fps și nu o
            înregistrare 24/7. Într-un tab ascuns browserul suspendă redarea și temporizează timer-ele, deci
            evenimentele pot întârzia sau lipsi; opțiunea acoperă aplicația deschisă, nu un NVR. Incidentele
            din toate camerele apar în listă și în raportul de tură.
          </p>

          <p
            data-testid="background-status"
            data-enabled={backgroundEnabled ? 'true' : 'false'}
            data-refused={backgroundStatus?.refusedReason || ''}
            data-running={String(runningBackground)}
            className="font-mono text-[11px] font-bold leading-snug"
            style={muted}
          >
            {!backgroundEnabled
              ? 'OPRIT — niciun worker de fundal nu rulează.'
              : backgroundStatus?.refusedReason
                ? `REFUZAT: ${BACKGROUND_REFUSAL[backgroundStatus.refusedReason] || backgroundStatus.refusedReason}`
                : !backgroundStatus || backgroundStatus.cameras.length === 0
                  ? 'PORNIT — nicio cameră cu clip redabil.'
                  : `PORNIT — ${runningBackground} ${runningBackground === 1 ? 'cameră' : 'camere'} · ~1 cadru / 2 s`}
          </p>

          {backgroundEnabled && backgroundStatus?.refusedReason && (
            <p role="alert" className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              {BACKGROUND_REFUSAL[backgroundStatus.refusedReason] || backgroundStatus.refusedReason}
              {' '}Guarda refuză toată rularea, ca nicio cameră să nu rămână descoperită în tăcere.
            </p>
          )}

          <ul className="space-y-1 text-[11px]">
            {backgroundRows.map((row) => (
              <li
                key={row.id}
                data-testid={`background-camera-${row.id}`}
                data-state={row.state}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
              >
                <span className="w-16 shrink-0 font-bold">{row.code}</span>
                <span className={`font-mono font-bold ${TONE_TEXT[row.tone] || TONE_TEXT.neutral}`}>
                  <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 basis-full font-mono sm:basis-0" style={muted}>
                  {row.detail}
                </span>
                <span className="font-mono tabular-nums" style={muted}>
                  {row.events} {row.events === 1 ? 'incident' : 'incidente'}
                </span>
              </li>
            ))}
          </ul>

          <p data-testid="background-guard" className="border-t pt-2 text-[11px] leading-snug" style={{ ...muted, borderColor: themeStyles.panelBorder }}>
            Limită de siguranță: maximum {BACKGROUND_MAX_CAMERAS} camere, minimum {BACKGROUND_MIN_CORES} nuclee
            (această mașină raportează {cores ?? 'necunoscut'}).
            {cores === null && ' Numărul de nuclee e necunoscut, deci guarda refuză orice rulare.'}
            {cores !== null && cores < BACKGROUND_MIN_CORES && ' Sub limită: guarda refuză orice rulare.'}
            {' '}Camera locală (webcam) nu rulează niciodată în fundal: o singură permisiune, cerută de Live.
          </p>

          {backgroundEnabled && (
            <button
              type="button"
              data-testid="background-stop"
              onClick={() => setBackgroundEnabled(false)}
              className="rounded-lg border border-[#D73833]/50 bg-[#D73833]/15 px-3 py-1.5 text-xs font-bold text-[#D73833] transition-colors hover:bg-[#D73833]/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]"
            >
              Oprește toate camerele din fundal
            </button>
          )}
        </section>

        <section aria-labelledby="privacy-heading" style={surface} className="space-y-2 rounded-xl border p-4">
          <h3 id="privacy-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
            <Lock size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
            {isMock ? 'Ce rămâne în browser' : 'Ce pleacă de pe edge'}
            {isMock && <Chip tone="demo">NIMIC NU URCĂ</Chip>}
          </h3>
          <ul className="space-y-1.5 text-xs" style={muted}>
            {isMock ? (
              <>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>Cadrele video trăiesc în memoria tabului: sunt desenate pe canvas și nu se încarcă nicăieri.</span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>
                    Cu motorul pornit, fețele sunt{' '}
                    <strong className="font-bold text-amber-700 dark:text-amber-400">blurate cu YuNet în browser</strong> înainte
                    de desenare; fluxul brut e ascuns cât timp motorul rulează.
                  </span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>
                    Prin rețea trec doar fișierele aplicației (JS, yolo26n.onnx, yunet.onnx, clipul demo), în jos; nimic nu se
                    încarcă în sus. Un tab închis nu lasă nimic pe server.
                  </span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>
                    Evenimentele sunt metadate: tip, cameră, zonă, oră, încredere. Fără recunoaștere facială, fără nume, fără
                    analiză de emoții.
                  </span>
                </li>
              </>
            ) : (
              <>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>Video brut rămâne pe edge; nu se trimite nicăieri.</span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>
                    Snapshot-urile și imaginea live au{' '}
                    <strong className="font-bold text-amber-700 dark:text-amber-400">fețele blurate pe edge</strong> înainte de
                    salvare sau trimitere.
                  </span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>Evenimentul conține doar metadate: tip, cameră, zonă, oră, încredere.</span>
                </li>
                <li className="flex gap-2">
                  <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#0284C7] dark:text-[#FFEB33]" />
                  <span>Fără recunoaștere facială, fără nume, fără analiză de emoții.</span>
                </li>
              </>
            )}
          </ul>
        </section>

        <section
          data-testid="local-data"
          data-supported={localEvidence.supported ? 'true' : 'false'}
          aria-labelledby="local-data-heading"
          style={surface}
          className="space-y-3 rounded-xl border p-4"
        >
          <h3 id="local-data-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
            <HardDrive size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
            Date locale
            {localEvidence.supported ? (
              <Chip tone="neutral">INDEXEDDB</Chip>
            ) : (
              <Chip tone="demo">INDISPONIBIL</Chip>
            )}
          </h3>
          <p className="text-xs" style={muted}>
            Incidentele produse de motor, confirmările și snapshot-urile lor sunt păstrate doar în acest
            browser, în IndexedDB. Nimic nu se încarcă în rețea; după o reîncărcare, incidentele și
            dovada lor revin din acest tab.
          </p>

          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="space-y-0.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider" style={muted}>
                Stocare
              </dt>
              <dd
                data-testid="local-storage"
                className={`font-semibold ${
                  localEvidence.supported ? TONE_TEXT.ok : TONE_TEXT.warn
                }`}
              >
                {localEvidence.supported
                  ? 'IndexedDB disponibil'
                  : 'IndexedDB indisponibil'}
              </dd>
              <p data-testid="local-storage-note" className="text-[11px] leading-snug" style={muted}>
                {localEvidence.supported
                  ? 'Incidentele supraviețuiesc reîncărcării paginii.'
                  : 'Mod privat, stocare blocată sau alt tab ține baza deschisă: incidentele nu supraviețuiesc reîncărcării.'}
              </p>
            </div>

            <div className="space-y-0.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider" style={muted}>
                Incidente salvate
              </dt>
              <dd data-testid="local-incidents" className="font-mono font-bold tabular-nums">
                {localEvidence.hydrated
                  ? `${localEvidence.stats.count} / ${localEvidence.retention.maxEvents}`
                  : 'se citește…'}
              </dd>
              <p data-testid="local-snapshots" className="text-[11px] leading-snug" style={muted}>
                {localEvidence.stats.evidenceCount}{' '}
                {localEvidence.stats.evidenceCount === 1 ? 'snapshot' : 'snapshot-uri'} ·{' '}
                {formatBytes(localEvidence.stats.bytes)} aproximativ
              </p>
            </div>

            <div className="space-y-0.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider" style={muted}>
                Confirmări salvate
              </dt>
              <dd data-testid="local-acks" className="font-mono font-bold tabular-nums">
                {localEvidence.hydrated ? localEvidence.stats.ackCount : 'se citește…'}
              </dd>
              <p className="text-[11px] leading-snug" style={muted}>
                Confirmările, marcarile ca fals pozitiv și redeschiderile se aplică din nou la pornire.
              </p>
            </div>

            <div className="space-y-0.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider" style={muted}>
                Retenție
              </dt>
              <dd className="font-semibold">
                ultimele {localEvidence.retention.maxEvents} incidente, maximum{' '}
                {localEvidence.retention.maxAgeDays} zile
              </dd>
              <p className="text-[11px] leading-snug" style={muted}>
                Ce depășește regula se șterge automat, împreună cu snapshot-ul și confirmarea lui;
                URL-urile vechi sunt revocate, ca tabul să nu crească nelimitat.
              </p>
            </div>
          </dl>

          <div className="border-t pt-3" style={{ borderColor: themeStyles.panelBorder }}>
            {confirmingClear ? (
              <div role="group" aria-label="Confirmare ștergere date locale" className="space-y-2">
                <p data-testid="local-clear-warning" role="alert" className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Ștergi {localEvidence.stats.count}{' '}
                  {localEvidence.stats.count === 1 ? 'incident salvat' : 'incidente salvate'} și
                  snapshot-urile lor? Fixture-urile demo rămân.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="local-clear-confirm"
                    onClick={removeLocalData}
                    disabled={clearing}
                    className="rounded-lg border border-[#D73833]/50 bg-[#D73833]/15 px-3 py-1.5 text-xs font-bold text-[#D73833] transition-colors hover:bg-[#D73833]/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33] disabled:opacity-60"
                  >
                    <Trash2 size={12} aria-hidden="true" className="mr-1 inline" />
                    {clearing ? 'Se șterge…' : 'Da, șterge'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    disabled={clearing}
                    className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33] disabled:opacity-60"
                    style={{ borderColor: themeStyles.panelBorder, color: themeStyles.text }}
                  >
                    Anulează
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="local-clear"
                onClick={() => setConfirmingClear(true)}
                className="rounded-lg border border-[#D73833]/50 bg-[#D73833]/15 px-3 py-1.5 text-xs font-bold text-[#D73833] transition-colors hover:bg-[#D73833]/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]"
              >
                <Trash2 size={12} aria-hidden="true" className="mr-1 inline" />
                Șterge datele locale
              </button>
            )}
            <p className="mt-2 text-[11px] leading-snug" style={muted}>
              Ștergerea golește IndexedDB și scoate din listă incidentele motorului; nu atinge
              fixture-urile demo și nici configurarea zonelor.
            </p>
          </div>
        </section>

        <section aria-labelledby="audit-heading" style={surface} className="overflow-hidden rounded-xl border">
          <div className="space-y-1 px-4 pb-3 pt-4">
            <h3 id="audit-heading" className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase">
              <Terminal size={16} aria-hidden="true" className="text-[#0284C7] dark:text-[#FFEB33]" />
              {isMock && showDemoData ? 'Jurnal demo' : 'Jurnal de audit'}
              {isMock && showDemoData && <Chip tone="demo">DEMO</Chip>}
            </h3>
            <p className="text-xs" style={muted}>
              {isMock && showDemoData
                ? 'Pașii din fixture-urile demo (detecție, notificare, escaladare, confirmare), cei mai recenți primii. Orele și trimiterile sunt istoric demo, nu un jurnal real.'
                : 'Pașii prin care au trecut incidentele vizibile acum (detecție, notificare, escaladare, confirmare), cei mai recenți primii.'}
            </p>
          </div>

          {auditRows.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs" style={muted}>
              Niciun eveniment încă.
            </p>
          ) : (
            <ul className="text-[11px]">
              {auditRows.map((row, index) => (
                <li key={`${row.eventId}-${row.at}-${row.actor}`} style={{ borderTop: index === 0 ? 'none' : `1px solid ${themeStyles.panelBorder}` }}>
                  <button
                    type="button"
                    onClick={() => showIncident(row.eventId)}
                    aria-label={`Deschide incidentul: ${row.action}`}
                    className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-left hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]"
                  >
                    <time dateTime={row.at} className="shrink-0 font-mono text-[10px] tabular-nums" style={muted}>
                      [{formatAuditTime(row.at)}]
                    </time>
                    <span className="w-20 shrink-0 font-bold text-[#0369A1] dark:text-[#FFEB33]">{row.actor}</span>
                    <span className="min-w-0 flex-1 basis-full truncate font-mono sm:basis-0">{row.action}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2 text-[11px]"
            style={{ ...muted, borderColor: themeStyles.panelBorder }}
          >
            <ShieldCheck size={12} aria-hidden="true" />
            <span>
              {isMock && showDemoData
                ? `Din cele ${events.length} incidente demo; doar citire.`
                : `Din ultimele ${events.length} incidente vizibile; doar citire.`}
            </span>
            <span className="text-slate-500 dark:text-slate-400">Deschide un rând pentru incident.</span>
          </p>
        </section>
      </div>
    </div>
  );
}
