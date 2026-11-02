import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  XCircle,
  RotateCcw,
  RefreshCw,
  FileDown,
  Clock,
  Info,
  MapPin,
  Calendar,
  AlertTriangle,
  Video,
  Link2,
  Download
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { STATUS_TOKENS } from '../../constants/theme';
import ConfidenceBadge from '../common/ConfidenceBadge';
import SafeImage from '../common/SafeImage';
import { printAsPdf } from '../../utils/print';
import { canDo } from '../../constants/eventActions';
import { USE_MOCK } from '../../services/api';

export default function IncidentDetailView() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    selectedEvent,
    setCurrentView,
    setSelectedCameraId,
    acknowledgeEvent,
    markFalsePositive,
    reopenEvent,
    regenerateReport,
    showToast
  } = useSecurity();

  const [falsePositiveNote, setFalsePositiveNote] = useState('');
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  if (!selectedEvent) {
    return (
      <div className="p-8 text-center">
        <p className="font-bold text-lg">Niciun incident selectat.</p>
        <button
          onClick={() => setCurrentView('incidents')}
          className="mt-4 px-4 py-2 bg-[#D73833] text-white rounded-lg text-sm font-bold"
        >
          Vezi lista de incidente
        </button>
      </div>
    );
  }

  const isAcked = selectedEvent.status === 'acknowledged';
  const isFalsePos = selectedEvent.status === 'false_positive';
  // A button is enabled only when the backend accepts that action from this status.
  const canAck = canDo('ack', selectedEvent.status);
  const canFalsePos = canDo('false_positive', selectedEvent.status);
  const canReopen = canDo('reopen', selectedEvent.status);
  // The report is written automatically at ingest; retry only when the AI was not used.
  const canRetryReport = !selectedEvent.report || selectedEvent.report.source !== 'llm';

  // Formatare ore în Europe/Bucharest (Regulă din PDF: API trimite UTC, conversie în UI)
  const formatTime = (isoString) => {
    if (!isoString) return 'În așteptare';
    try {
      return new Date(isoString).toLocaleTimeString('ro-RO', {
        timeZone: 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copiat. Îl poți trimite în Slack sau într-un tichet.');
    } catch {
      showToast('Copierea a eșuat; linkul este în bara de adrese.');
    }
  };

  // The real snapshot is downloadable (blurred JPEG); the pending placeholder is not.
  // Mock fixtures use same-origin stills, so the browser can download them too.
  const snapshotUrl = selectedEvent.snapshot_url || '';
  const canDownloadSnapshot = Boolean(snapshotUrl) && snapshotUrl !== 'blob:pending';

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    await regenerateReport(selectedEvent.event_id);
    setIsRegenerating(false);
  };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 h-full select-none max-w-6xl mx-auto">
      {/* Bară Superioară Navigare: pe ecrane mici acțiunile trec pe rândul următor,
          ca să rămână toate vizibile (F5). */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-white/10 pb-3">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            onClick={() => setCurrentView('incidents')}
            style={{ backgroundColor: themeStyles.cardBg }}
            className="no-print p-2 rounded-lg border hover:bg-white/10 flex items-center gap-1.5 text-xs font-bold shrink-0"
          >
            <ArrowLeft size={16} /> Incidente
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-black text-base md:text-lg uppercase tracking-tight break-words min-w-0">
                Incident: {selectedEvent.event_id}
              </h2>
              {/* Badge Severitate */}
              <span
                style={{
                  backgroundColor: STATUS_TOKENS[selectedEvent.severity].bg,
                  color: STATUS_TOKENS[selectedEvent.severity].text,
                  borderColor: STATUS_TOKENS[selectedEvent.severity].border
                }}
                className="text-[10px] font-black uppercase px-2 py-0.5 rounded border whitespace-nowrap shrink-0"
              >
                {selectedEvent.severity}
              </span>
              {/* Badge Stare */}
              <span
                style={{
                  backgroundColor: STATUS_TOKENS[selectedEvent.status]?.bg || '#EEEEEE',
                  color: STATUS_TOKENS[selectedEvent.status]?.text || '#222222',
                  borderColor: STATUS_TOKENS[selectedEvent.status]?.border || '#DDDDDD'
                }}
                className="text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap shrink-0"
              >
                {STATUS_TOKENS[selectedEvent.status]?.label || selectedEvent.status}
              </span>
              {/* The list already labels fixtures; the detail must not present them as a real detection. */}
              {selectedEvent.local && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF] whitespace-nowrap shrink-0"
                  title="Produs de motorul din browser în această sesiune; nu e un fixture demo."
                >
                  detecție locală
                </span>
              )}
              {USE_MOCK && !selectedEvent.local && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-[#FFEB33] whitespace-nowrap shrink-0"
                  title="Incident din fixture-urile demo, nu detecție a motorului din browser."
                >
                  date demo
                </span>
              )}
            </div>
            <p style={{ color: themeStyles.textMuted }} className="text-xs font-mono truncate">
              Model detecție: {selectedEvent.model} • Track ID: #{selectedEvent.track_id}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:ml-auto shrink-0">
          {/* The deep link is stable now (fixture ids no longer embed Date.now()), so the
              operator can share exactly this incident. */}
          <button
            onClick={handleCopyLink}
            className="no-print px-3 py-2 rounded-lg border border-slate-500/40 hover:bg-white/10 text-xs font-bold flex items-center gap-1.5 shrink-0"
            title="Copiază linkul acestui incident"
          >
            <Link2 size={14} /> Copiază link
          </button>
          {/* The snapshot is the moment of the incident; this shows the same camera now. */}
          <button
            onClick={() => {
              setSelectedCameraId(selectedEvent.camera_id);
              setCurrentView('live');
            }}
            className="no-print px-3 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
          >
            <Video size={15} /> Vezi camera acum
          </button>
          {/* Confidence Badge formatat 0.91 · 14/15 cadre */}
          <div className="shrink-0">
            <ConfidenceBadge confidence={selectedEvent.confidence} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* COLOANA STÂNGA: SNAPSHOT CU CADRUL INCIDENTULUI (HTTP, fețe blurate) */}
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="rounded-xl border p-4 shadow-lg space-y-3 flex flex-col"
        >
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={14} className="text-[#D73833]" />
              Camera: {selectedEvent.camera_id} ({selectedEvent.zone_id})
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-slate-400">Durată: {selectedEvent.duration_s}s</span>
              {canDownloadSnapshot && (
                <a
                  href={snapshotUrl}
                  download={`${selectedEvent.event_id}.jpg`}
                  className="no-print text-[#33E1FF] hover:underline flex items-center gap-1 font-bold"
                  title="Descarcă dovada (JPEG cu fețele blurate)"
                >
                  <Download size={13} /> Descarcă
                </a>
              )}
            </div>
          </div>

          <div className="flex-1 relative rounded-lg overflow-hidden bg-black border border-slate-700 min-h-[260px] flex items-center justify-center">
            <SafeImage
              src={selectedEvent.snapshot_url}
              alt="Cadru incident blurat"
              className="w-full h-full object-cover text-xs p-6"
              iconSize={36}
            />
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/80 text-white font-mono text-[10px] rounded border border-white/20">
              {selectedEvent.local
                ? 'Momentul incidentului • fețe blurate în browser'
                : 'Momentul incidentului • fețe blurate'}
            </div>
          </div>

          {/* CRONOLOGIE ÎN 5 PAȘI (Conform Brief-ului C) */}
          <div
            style={{ backgroundColor: themeStyles.cardBg }}
            className="p-3 rounded-lg border border-white/10 space-y-2"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-[#D73833] flex items-center gap-1">
              <Clock size={13} /> Cronologie Eveniment (5 Pași):
            </p>
            <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-[10px]">
              <div className="p-1 rounded bg-black/20">
                <span className="block opacity-60">1. Detecție</span>
                <span className="font-bold text-white">{formatTime(selectedEvent.detected_at)}</span>
              </div>
              <div className="p-1 rounded bg-black/20">
                <span className="block opacity-60">2. Primit</span>
                <span className="font-bold text-white">{formatTime(selectedEvent.received_at)}</span>
              </div>
              <div className="p-1 rounded bg-black/20">
                <span className="block opacity-60">3. Notificat</span>
                <span className="font-bold text-white">{formatTime(selectedEvent.notified_at)}</span>
              </div>
              <div className={`p-1 rounded ${selectedEvent.escalated_at ? 'bg-red-950 text-red-300' : 'bg-black/20'}`}>
                <span className="block opacity-60">4. Escaladat</span>
                <span className="font-bold">{formatTime(selectedEvent.escalated_at)}</span>
              </div>
              <div className={`p-1 rounded ${selectedEvent.acked_at ? 'bg-emerald-950 text-emerald-300' : 'bg-black/20'}`}>
                <span className="block opacity-60">5. Confirmat</span>
                <span className="font-bold">{formatTime(selectedEvent.acked_at)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* COLOANA DREAPTA: RAPORT STRUCTURAT & HUMAN-IN-THE-LOOP */}
        <div className="space-y-4 flex flex-col justify-between">
          {/* Raport Structurat în 5 Câmpuri */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="rounded-xl border p-4 shadow-lg space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                <Info size={16} className="text-[#D73833]" />
                Raport incident (
                {selectedEvent.report?.source === 'llm'
                  ? USE_MOCK
                    ? 'AI · demo'
                    : 'AI'
                  : 'șablon'}
                )
              </h3>
              {canRetryReport && !USE_MOCK && (
                <button
                  onClick={handleRegenerate}
                  className="no-print text-xs text-[#D73833] hover:underline flex items-center gap-1 font-semibold"
                  title="Raportul a fost scris din șablon (AI indisponibil); încearcă din nou cu AI"
                >
                  <RefreshCw size={12} className={isRegenerating ? 'animate-spin' : ''} />
                  Reîncearcă cu AI
                </button>
              )}
            </div>

            {isRegenerating ? (
              <div className="space-y-2 py-4 animate-pulse">
                <div className="h-4 bg-white/20 rounded w-3/4" />
                <div className="h-4 bg-white/20 rounded w-1/2" />
                <div className="h-10 bg-white/20 rounded w-full" />
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="font-bold text-slate-400 block text-[11px]">CE:</span>
                  <p className="font-semibold text-white">{selectedEvent.report?.what || 'necunoscut'}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 block text-[11px]">UNDE:</span>
                  <p className="font-semibold">{selectedEvent.report?.where || 'necunoscut'}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 block text-[11px]">CÂND:</span>
                  <p className="font-semibold font-mono">{selectedEvent.report?.when || 'necunoscut'}</p>
                </div>
                <div>
                  <span className="font-bold text-red-400 block text-[11px]">SEVERITATE & RISC:</span>
                  <p className="font-semibold text-red-200">{selectedEvent.report?.severity_reason || 'necunoscut'}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30">
                  <span className="font-bold text-amber-400 block text-[11px]">ACȚIUNE RECOMANDATĂ:</span>
                  <p className="font-bold text-amber-200 mt-0.5">{selectedEvent.report?.recommended_action || 'necunoscut'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Decizia operatorului (acțiuni; nu apar în PDF) */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="no-print rounded-xl border p-4 shadow-lg space-y-3"
          >
            <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Check size={15} /> Decizia operatorului
            </h4>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {/* Buton 1: Acknowledge */}
              <button
                disabled={!canAck}
                onClick={(e) => acknowledgeEvent(selectedEvent.event_id, e)}
                className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow transition-all ${
                  !canAck
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:scale-[1.02]'
                }`}
              >
                <Check size={16} />
                <span>{isAcked ? 'Confirmat' : 'Confirmă'}</span>
              </button>

              {/* Buton 2: Fals Pozitiv */}
              <button
                disabled={!canFalsePos}
                onClick={() => setShowNoteDialog(true)}
                className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 border border-slate-600 transition-all ${
                  !canFalsePos
                    ? 'bg-slate-900 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <XCircle size={16} />
                <span>{isFalsePos ? 'Marcat Fals Pozitiv' : 'Fals Pozitiv'}</span>
              </button>

              {/* Buton 3: Reopen */}
              <button
                disabled={!canReopen}
                onClick={() => reopenEvent(selectedEvent.event_id)}
                className={`py-2.5 px-3 rounded-lg font-bold border border-slate-600 flex items-center justify-center gap-2 ${
                  canReopen ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-900 text-slate-500 cursor-not-allowed'
                }`}
              >
                <RotateCcw size={15} />
                <span>Redeschide</span>
              </button>

              {/* Buton 4: Export PDF (dialogul de tipărire al browserului) */}
              <button
                onClick={() => printAsPdf(`LocalSight_incident_${selectedEvent.event_id}`)}
                className="py-2.5 px-3 rounded-lg font-bold bg-[#D73833]/20 hover:bg-[#D73833]/30 text-[#D73833] border border-[#D73833]/40 flex items-center justify-center gap-2"
              >
                <FileDown size={15} />
                <span>Export PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialog Notă Fals Pozitiv */}
      {showNoteDialog && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4"
          >
            <h3 className="font-bold text-sm uppercase">Feedback Fals Pozitiv pentru Echipa AI</h3>
            <p style={{ color: themeStyles.textMuted }} className="text-xs">
              Explică de ce detecția a fost eronată pentru antrenarea viitoare a modelului:
            </p>
            <textarea
              value={falsePositiveNote}
              onChange={(e) => setFalsePositiveNote(e.target.value)}
              placeholder="Ex: Tehnicanul purta dopuri interne de urechi, nu căști externe..."
              className="w-full p-2.5 rounded-lg bg-black/30 border border-white/20 text-xs focus:ring-2 focus:ring-[#FFEB33]"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNoteDialog(false)}
                className="px-3 py-1.5 rounded-lg border border-white/20 text-xs"
              >
                Anulează
              </button>
              <button
                onClick={() => {
                  markFalsePositive(selectedEvent.event_id, falsePositiveNote);
                  setShowNoteDialog(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs"
              >
                Trimite Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
