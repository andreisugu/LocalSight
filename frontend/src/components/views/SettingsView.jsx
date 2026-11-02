import React, { useMemo } from 'react';
import { Settings, ShieldCheck, Server, Cpu, Box, Lock, MessageSquare, Terminal, Video, Database } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { TYPE_LABELS } from '../../services/api';

// Everything on this page comes from the app's data layer (/health, /cameras, /zones, /events).
// In the static build that layer is fixtures (health.mock), so the page states the local
// truth instead of claiming a backend and an edge box that are not there.
// Nothing is hard-coded: a value we do not have is shown as "—".

const AUDIT_LIMIT = 60;

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ro-RO', {
      timeZone: 'Europe/Bucharest',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// One incident -> the steps it actually went through, each with its own timestamp.
function auditEntries(event) {
  const what = `${TYPE_LABELS[event.type] || event.type} · ${event.camera_id}/${event.zone_id}`;
  const rows = [
    { at: event.detected_at, actor: 'Edge', action: `Detecție ${what} (track #${event.track_id})` },
    event.notified_at && { at: event.notified_at, actor: 'Notificare', action: `Alertă Slack trimisă: ${what}` },
    event.escalated_at && { at: event.escalated_at, actor: 'Escaladare', action: `Neconfirmat la timp: ${what}` },
  ];
  if (event.acked_at) {
    const verb =
      event.status === 'false_positive' ? 'Marcat fals pozitiv' : event.status === 'resolved' ? 'Rezolvat' : 'Confirmat';
    rows.push({ at: event.acked_at, actor: 'Operator', action: `${verb}${event.acked_by ? ` de ${event.acked_by}` : ''}: ${what}` });
  }
  return rows.filter(Boolean).map((row) => ({ ...row, eventId: event.event_id }));
}

function Tile({ icon: Icon, label, value, detail, tone, themeStyles }) {
  const color = { ok: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-red-400', neutral: 'text-slate-300' }[tone];
  return (
    <div
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="p-3 rounded-xl border space-y-1"
    >
      <p className="text-[11px] uppercase tracking-wider font-bold flex items-center gap-1.5" style={{ color: themeStyles.textMuted }}>
        <Icon size={13} /> {label}
      </p>
      <p className={`font-mono font-bold text-sm ${color}`}>{value}</p>
      {detail && (
        <p className="text-[11px]" style={{ color: themeStyles.textMuted }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function Panel({ icon: Icon, title, children, themeStyles }) {
  return (
    <section
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="p-4 rounded-xl border space-y-3 text-xs"
    >
      <h3 className="font-bold text-sm uppercase flex items-center gap-1.5">
        <Icon size={16} className="text-[#7EDEED] dark:text-[#FFEB33]" /> {title}
      </h3>
      {children}
    </section>
  );
}

export default function SettingsView() {
  const { themeStyles } = useTheme();
  const { cameras, zones, events, health, setSelectedEventId, setCurrentView } = useSecurity();

  const edgeSeen = health?.edge_last_seen_s;
  const edgeTone = edgeSeen == null ? 'warn' : edgeSeen < 60 ? 'ok' : 'warn';
  const edgeValue = edgeSeen == null ? 'FĂRĂ DATE' : edgeSeen < 60 ? 'ACTIV' : 'ÎNTÂRZIAT';
  // The static build has no backend and no edge box: `health.mock` is what the data layer
  // reports there. Every claim below is gated on it so the page never invents a system.
  const isMock = Boolean(health?.mock);
  // Camera sources, derived from the array we actually have: demo clips carry an RTSP URL,
  // the browser camera does not.
  const demoCameras = cameras.filter((camera) => camera.rtsp_url);
  const localCameras = cameras.filter((camera) => !camera.rtsp_url);
  const sourceValue = `${cameras.length} ${cameras.length === 1 ? 'sursă' : 'surse'}`;
  const sourceParts = [
    `${demoCameras.length} ${demoCameras.length === 1 ? 'clip demo' : 'clipuri demo'}`,
    localCameras.length > 0 &&
      (localCameras.length === 1 ? 'camera locală' : `${localCameras.length} camere locale`),
  ].filter(Boolean);
  const sourceDetail = `${sourceParts.length > 0 ? `${sourceParts.join(' + ')}; ` : ''}date demo`;
  // The model is whatever the edge put on its latest event; the backend has no other source.
  const latestModel = useMemo(
    () => [...events].sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))[0]?.model,
    [events]
  );

  const audit = useMemo(
    () =>
      events
        .flatMap(auditEntries)
        .filter((row) => row.at)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, AUDIT_LIMIT),
    [events]
  );

  const openIncident = (eventId) => {
    setSelectedEventId(eventId);
    setCurrentView('incident_detail');
  };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-5 h-full max-w-5xl mx-auto">
      <div>
        <h2 className="font-black text-lg uppercase tracking-tight flex flex-wrap items-center gap-2">
          <Settings size={20} className="text-[#7EDEED] dark:text-[#FFEB33]" />
          {isMock ? 'Sistem & Audit' : 'Edge & Audit'}
          {isMock && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
              MOD MOCK: evenimente simulate
            </span>
          )}
        </h2>
        <p style={{ color: themeStyles.textMuted }} className="text-xs">
          {isMock
            ? 'Starea locală a build-ului static și jurnalul acțiunilor din fixture-urile demo; fără backend.'
            : 'Starea sistemului și istoricul acțiunilor, din datele backend-ului.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {isMock ? (
          // Static build: there is no backend and no edge box to report on, so the tiles
          // describe what actually runs — this tab.
          <>
            <Tile
              icon={Server}
              label="Build"
              value="STATIC"
              detail="fără backend, fără edge; totul rulează în tab"
              tone="neutral"
              themeStyles={themeStyles}
            />
            <Tile
              icon={Cpu}
              label="Motor browser"
              value="OPȚIONAL"
              detail="pornit din Live sau /lab; YOLO26n + YuNet"
              tone="neutral"
              themeStyles={themeStyles}
            />
            <Tile
              icon={Box}
              label="Model detecție"
              value="YOLO26n"
              detail="ONNX servit din aplicație, rulat local"
              tone="neutral"
              themeStyles={themeStyles}
            />
            <Tile
              icon={Video}
              label="Camere"
              value={sourceValue}
              detail={sourceDetail}
              tone="neutral"
              themeStyles={themeStyles}
            />
          </>
        ) : (
          <>
            <Tile
              icon={Database}
              label="Backend"
              value={health?.db ? 'ONLINE' : 'OFFLINE'}
              detail={health?.db ? 'Baza de date răspunde' : 'Backend-ul sau baza de date nu răspund'}
              tone={health?.db ? 'ok' : 'bad'}
              themeStyles={themeStyles}
            />
            <Tile
              icon={Cpu}
              label="Edge AI"
              value={edgeValue}
              detail={edgeSeen == null ? 'Niciun semnal de la edge' : `Ultimul semnal acum ${Math.round(edgeSeen)} s`}
              tone={edgeTone}
              themeStyles={themeStyles}
            />
            <Tile
              icon={Server}
              label="Model detecție"
              value={latestModel || '—'}
              detail="Din ultimul eveniment primit"
              tone="neutral"
              themeStyles={themeStyles}
            />
            <Tile
              icon={Video}
              label="Camere"
              value={`${cameras.filter((c) => c.status === 'online').length} / ${cameras.length} online`}
              detail={`${zones.length} zone configurate`}
              tone={cameras.length && cameras.every((c) => c.status === 'online') ? 'ok' : 'warn'}
              themeStyles={themeStyles}
            />
          </>
        )}
      </div>

      <Panel icon={Video} title="Camere" themeStyles={themeStyles}>
        {isMock && (
          <p style={{ color: themeStyles.textMuted }}>
            Lista e din fixture-urile demo: {demoCameras.length} clipuri demo
            {localCameras.length > 0 ? ' plus camera locală din browser' : ''}; nicio cameră de rețea nu e conectată.
          </p>
        )}
        {cameras.length === 0 ? (
          <p style={{ color: themeStyles.textMuted }}>Nicio cameră înregistrată.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead style={{ color: themeStyles.textMuted }}>
                <tr className="border-b border-white/10">
                  <th className="py-1.5 pr-3 font-semibold">Cameră</th>
                  <th className="py-1.5 pr-3 font-semibold">Stare</th>
                  <th className="py-1.5 pr-3 font-semibold">Motor</th>
                  <th className="py-1.5 pr-3 font-semibold">Zone</th>
                  <th className="py-1.5 font-semibold">Live</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map((camera) => {
                  const fps = health?.live_fps?.[camera.id];
                  // A fixture camera is not "online": say DEMO, same colour as before.
                  const statusLabel = isMock ? 'DEMO' : camera.status === 'online' ? 'ONLINE' : 'OFFLINE';
                  return (
                    <tr key={camera.id} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-bold">{camera.code || camera.id}</span>{' '}
                        <span style={{ color: themeStyles.textMuted }}>{camera.id}</span>
                      </td>
                      <td className={`py-1.5 pr-3 font-bold ${camera.status === 'online' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {statusLabel}
                      </td>
                      <td className="py-1.5 pr-3">{camera.engine_on ? 'pornit' : 'oprit'}</td>
                      <td className="py-1.5 pr-3">{zones.filter((z) => z.camera_id === camera.id).length}</td>
                      <td className="py-1.5">{fps != null ? `${fps} fps` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel icon={Lock} title="Ce pleacă de pe edge" themeStyles={themeStyles}>
          <ul className="space-y-1.5" style={{ color: themeStyles.textMuted }}>
            <li>• Video brut rămâne pe edge; nu se trimite nicăieri.</li>
            <li>
              • Snapshot-urile și imaginea live au <span className="font-bold text-amber-400">fețele blurate pe edge</span>, înainte
              de salvare sau trimitere.
            </li>
            <li>• Evenimentul conține doar metadate: tip, cameră, zonă, oră, încredere.</li>
            <li>• Fără recunoaștere facială, fără nume, fără analiză de emoții.</li>
          </ul>
        </Panel>

        <Panel icon={MessageSquare} title="Notificări" themeStyles={themeStyles}>
          <ul className="space-y-1.5" style={{ color: themeStyles.textMuted }}>
            <li>
              • <span className="font-bold text-[#0284C7] dark:text-[#FFEB33]">Slack</span>: mesaj text + link la incident, fără imagini.
            </li>
            <li>• Escaladare dacă incidentul nu e confirmat în timpul setat pe zonă.</li>
            <li>• Confirmarea operatorului oprește escaladarea.</li>
          </ul>
        </Panel>
      </div>

      <Panel icon={Terminal} title={isMock ? 'Jurnal demo' : 'Jurnal de audit'} themeStyles={themeStyles}>
        <p style={{ color: themeStyles.textMuted }}>
          {isMock
            ? 'Pașii din fixture-urile demo (detecție, notificare, escaladare, confirmare), cei mai recenți primii; orele vin din datele demo, nu dintr-un jurnal real.'
            : 'Pașii prin care a trecut fiecare incident (detecție, notificare, escaladare, confirmare), cei mai recenți primii.'}
        </p>
        {audit.length === 0 ? (
          <p className="py-4 text-center" style={{ color: themeStyles.textMuted }}>
            Niciun eveniment încă.
          </p>
        ) : (
          <ul className="space-y-1 font-mono text-[11px]">
            {audit.map((row, index) => (
              <li key={`${row.eventId}-${index}`}>
                <button
                  onClick={() => openIncident(row.eventId)}
                  className="w-full p-2 rounded bg-black/20 hover:bg-white/5 flex items-center gap-2 border border-white/5 text-left"
                  title="Deschide incidentul"
                >
                  <span className="shrink-0" style={{ color: themeStyles.textMuted }}>
                    [{formatDateTime(row.at)}]
                  </span>
                  <span className="text-[#0284C7] dark:text-[#FFEB33] font-bold shrink-0 w-20">{row.actor}</span>
                  <span className="truncate">{row.action}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] flex items-center gap-1.5" style={{ color: themeStyles.textMuted }}>
          <ShieldCheck size={12} />{' '}
          {isMock ? `Din cele ${events.length} incidente demo; doar citire.` : `Din ultimele ${events.length} incidente; doar citire.`}
        </p>
      </Panel>
    </div>
  );
}
