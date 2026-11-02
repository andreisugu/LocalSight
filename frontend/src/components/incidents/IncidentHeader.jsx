import { ArrowLeft, Link2, Video } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import ConfidenceBadge from '../common/ConfidenceBadge';
import { detectionSummary, severityToken, sourceChips, statusToken } from '../../utils/incidentDetail';

// A chip is text first: the colour is a hint, the label is the fact. Both provenance chips
// carry a title so a screenshot of the screen cannot be mistaken for a real detection.
function ProvenanceChip({ children, tone, title }) {
  const toneClass = tone === 'local'
    ? 'border-[#33E1FF]/40 bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]'
    : 'border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-[#FFEB33]';
  return (
    <span
      title={title}
      className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap shrink-0 ${toneClass}`}
    >
      {children}
    </span>
  );
}

function TokenBadge({ token, bold }) {
  return (
    <span
      style={{ backgroundColor: token.bg, color: token.text, borderColor: token.border }}
      className={`text-[10px] ${bold ? 'font-black uppercase' : 'font-bold'} px-2 py-0.5 rounded border whitespace-nowrap shrink-0`}
    >
      {token.label}
    </span>
  );
}

export default function IncidentHeader({ event, mock, onBack, onCopyLink, onViewCamera }) {
  const { themeStyles } = useTheme();
  const severity = severityToken(event.severity);
  const status = statusToken(event.status);
  const chips = sourceChips(event, { mock });

  return (
    <header className="border-b border-white/10 pb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex items-start gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onBack}
          style={{ backgroundColor: themeStyles.cardBg }}
          className="no-print shrink-0 p-2 rounded-lg border hover:bg-white/10 flex items-center gap-1.5 text-xs font-bold"
        >
          <ArrowLeft size={16} /> Incidente
        </button>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-black text-base md:text-lg uppercase tracking-tight break-words min-w-0">
              Incident: {event.event_id}
            </h2>
            <TokenBadge token={severity} bold />
            <TokenBadge token={status} />
            {chips.local && (
              <ProvenanceChip
                tone="local"
                title="Produs de motorul din browser în această sesiune; nu e un fixture demo."
              >
                detecție locală
              </ProvenanceChip>
            )}
            {chips.demo && (
              <ProvenanceChip
                tone="demo"
                title="Incident din fixture-urile demo, nu detecție a motorului din browser."
              >
                date demo
              </ProvenanceChip>
            )}
          </div>
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-mono truncate">
            {detectionSummary(event)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto xl:justify-end shrink-0">
        {/* The deep link is stable (fixture ids no longer embed Date.now()), so the
            operator can share exactly this incident. */}
        <button
          type="button"
          onClick={onCopyLink}
          title="Copiază linkul acestui incident"
          className="no-print px-3 py-2 rounded-lg border border-slate-500/40 hover:bg-white/10 text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          <Link2 size={14} /> Copiază link
        </button>
        {/* The evidence is the moment of the incident; this opens the same camera now. */}
        <button
          type="button"
          onClick={onViewCamera}
          className="no-print px-3 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          <Video size={15} /> Vezi camera acum
        </button>
        <div className="shrink-0">
          <ConfidenceBadge confidence={event.confidence} />
        </div>
      </div>
    </header>
  );
}
