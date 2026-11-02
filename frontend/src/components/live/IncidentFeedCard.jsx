import { Check, Eye } from 'lucide-react';
import ConfidenceBadge from '../common/ConfidenceBadge';
import { canDo } from '../../constants/eventActions';
import { STATUS_TOKENS } from '../../constants/theme';

// One incident in the Live feed.
//
// The card used to be a `div[role=button]` that *contained* the acknowledge button: a
// nested interactive control (axe `nested-interactive` ×4) whose `aria-label` replaced the
// whole incident with a raw id. It is now a plain card with two sibling controls — one
// button that opens the incident and a separate acknowledge button — so Tab reaches both,
// the open button's name carries the human details, and each "Confirmă" is unique for a
// screen reader. The double-click guard still lives in the feed (`onAckPress`).
export default function IncidentFeedCard({ event, isDarkMode, onOpen, onAck, onAckPress }) {
  const critical = event.severity === 'CRITICAL';
  const escalated = event.status === 'escalated';
  const acknowledged = event.status === 'acknowledged';
  const shortId = event.event_id.slice(-6);
  const statusText = STATUS_TOKENS[event.status]?.label || event.status;

  // What an operator needs in order to decide, in one sentence. The visible text repeats
  // the same facts, so the label adds no information the card does not show.
  const openLabel = `Deschide incidentul: ${[
    event.report?.what,
    event.report?.where,
    event.camera_id,
    event.severity,
    statusText,
  ]
    .filter(Boolean)
    .join(' · ')}`;

  return (
    <div
      style={{ backgroundColor: isDarkMode ? '#2A2A2A' : '#FFFFFF' }}
      className={`rounded-xl border p-2.5 shadow-sm transition-all ${
        escalated
          ? 'border-[#D73833] ring-2 ring-[#D73833]/40'
          : critical
            ? 'border-[#D73833]/50 hover:border-[#D73833]'
            : 'border-[#FFEB33]/50 hover:border-[#FFEB33]'
      }`}
    >
      {/* The escalation cue is a static ring and border. It used to be a whole-card
          `animate-pulse`, which dropped the card's own text to 3.18:1 (light) for half of
          every cycle — the emphasis made the content unreadable. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="block w-full cursor-pointer space-y-1.5 text-left"
      >
        <span className="flex items-center justify-between gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                critical
                  ? 'border-red-200 bg-red-50 text-[#991B1B] dark:border-[#D73833]/40 dark:bg-[#D73833]/20 dark:text-[#FF8A80]'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-[#FFEB33]/40 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33]'
              }`}
            >
              {event.severity}
            </span>

            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${
                acknowledged
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : escalated
                    ? 'border-red-300 bg-red-100 font-black text-[#991B1B] dark:border-[#D73833]/30 dark:bg-[#D73833]/30 dark:text-[#FF8A80]'
                    : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {statusText}
            </span>

            {event.local && (
              <span
                className="rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-700 dark:text-[#33E1FF]"
                title="Produs de motorul din browser în această sesiune; nu e un fixture demo."
              >
                local
              </span>
            )}
          </span>

          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{shortId}</span>
        </span>

        <span className="block">
          <span className="block text-xs font-bold leading-tight text-slate-900 dark:text-slate-100">
            {event.report?.what}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {event.camera_id} • {event.report?.where}
          </span>
        </span>

        <span className="flex items-center justify-between pt-0.5 text-[11px]">
          <ConfidenceBadge confidence={event.confidence} />
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {new Date(event.detected_at).toLocaleTimeString('ro-RO')}
          </span>
        </span>
      </button>

      <div className="mt-1 flex items-center justify-between border-t border-slate-500/10 pt-1">
        <span
          aria-hidden="true"
          className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-[#FFEB33]"
        >
          <Eye size={12} /> Detalii Incident
        </span>

        {canDo('ack', event.status) && (
          <button
            type="button"
            onPointerDown={() => onAckPress(event.event_id)}
            onClick={(clickEvent) => onAck(clickEvent, event.event_id)}
            // A unique name per card: four buttons called "Confirmă" are indistinguishable
            // in a screen reader's element list.
            aria-label={`Confirmă incidentul ${shortId}`}
            className="flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-800"
            title="Confirmă incidentul și anulează timerul de escaladare"
          >
            <Check size={12} /> Confirmă
          </button>
        )}
      </div>
    </div>
  );
}
