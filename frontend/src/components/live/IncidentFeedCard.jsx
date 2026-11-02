import { Check, Eye } from 'lucide-react';
import ConfidenceBadge from '../common/ConfidenceBadge';
import { STATUS_TOKENS } from '../../constants/theme';
import { canDo } from '../../constants/eventActions';

// One incident in the Live feed. The whole card is the "open" control, so Tab reaches it
// and Enter/Space open it; the acknowledgement button stops propagation so confirming
// never also navigates. The guard itself lives in the feed, next to the press reference.
export default function IncidentFeedCard({ event, isDarkMode, onOpen, onAck, onAckPress }) {
  const critical = event.severity === 'CRITICAL';
  const escalated = event.status === 'escalated';
  const acknowledged = event.status === 'acknowledged';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Deschide incidentul ${event.event_id}`}
      onClick={onOpen}
      onKeyDown={(keyEvent) => {
        // Key events from the inner ack button bubble here; only the card itself may open
        // the incident.
        if (keyEvent.target !== keyEvent.currentTarget) return;
        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
          keyEvent.preventDefault();
          onOpen();
        }
      }}
      style={{ backgroundColor: isDarkMode ? '#2A2A2A' : '#FFFFFF' }}
      className={`p-2.5 rounded-xl border transition-all hover:scale-[1.01] cursor-pointer space-y-1.5 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#33E1FF] ${
        escalated
          ? 'border-[#D73833] ring-2 ring-[#D73833]/40 animate-pulse'
          : critical
            ? 'border-[#D73833]/50 hover:border-[#D73833]'
            : 'border-[#FFEB33]/50 hover:border-[#FFEB33]'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
              critical
                ? 'bg-red-50 text-[#D73833] border-red-200 dark:bg-[#D73833]/20 dark:text-[#FF8A80] dark:border-[#D73833]/40'
                : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33] dark:border-[#FFEB33]/40'
            }`}
          >
            {event.severity}
          </span>

          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
              acknowledged
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : escalated
                  ? 'bg-red-100 text-[#D73833] border-red-300 dark:bg-[#D73833]/30 dark:text-[#FF8A80] font-black animate-bounce'
                  : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {STATUS_TOKENS[event.status]?.label || event.status}
          </span>

          {event.local && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
              title="Produs de motorul din browser în această sesiune; nu e un fixture demo."
            >
              local
            </span>
          )}
        </div>

        <span className="font-mono text-[10px] text-slate-400">{event.event_id.slice(-6)}</span>
      </div>

      <div>
        <p className="font-bold text-xs leading-tight text-slate-900 dark:text-slate-100">
          {event.report?.what}
        </p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
          {event.camera_id} • {event.report?.where}
        </p>
      </div>

      <div className="flex items-center justify-between text-[11px] pt-0.5">
        <ConfidenceBadge confidence={event.confidence} />
        <span className="font-mono text-[10px] text-slate-400">
          {new Date(event.detected_at).toLocaleTimeString('ro-RO')}
        </span>
      </div>

      <div className="pt-1 flex items-center justify-between border-t border-slate-500/10">
        <span className="text-[10px] text-amber-600 dark:text-[#FFEB33] font-semibold hover:underline flex items-center gap-1">
          <Eye size={12} /> Detalii Incident
        </span>

        {canDo('ack', event.status) && (
          <button
            type="button"
            onPointerDown={() => onAckPress(event.event_id)}
            onClick={(clickEvent) => onAck(clickEvent, event.event_id)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1 shadow-sm transition-colors"
            title="Confirmă incidentul și anulează timerul de escaladare"
          >
            <Check size={12} /> Confirmă
          </button>
        )}
      </div>
    </div>
  );
}
