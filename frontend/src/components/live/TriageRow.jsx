import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Hourglass, XCircle } from 'lucide-react';
import { canDo } from '../../constants/eventActions';
import { STATUS_TOKENS } from '../../constants/theme';
import { eventSource, sourceLabel } from '../../utils/eventVisibility';
import { canHold } from '../../utils/triage';
import { formatTime } from '../../utils/time';
import { countdownLabel, deadlineProgress, holdUntilLabel } from './triageRows';

// One row of the operator queue.
//
// Same shape as `IncidentFeedCard`: a plain card with sibling controls — one button that
// opens the incident and separate buttons for each action — so nothing is a control inside
// a control and Tab reaches every one of them. The row adds what a queue needs and a feed
// does not: the position, the deadline, the reason it stands where it stands, the hold chip
// and the episode it belongs to.
//
// The reason lists are fixed on purpose (`docs/product/innovation-operator.md` §4.1): a
// free-text hold is how a suppression goes unread, and a fixed false-positive list is the
// input the model feedback loop needs later.

/** Hold reasons, in the operator's words; the reason is mandatory and stored with the hold. */
export const HOLD_REASONS = Object.freeze([
  'Verific situația la fața locului',
  'Echipa de sol este pe drum',
  'Aștept confirmarea supraveghetorului',
  'Altă urgență în lucru',
]);

/** False-positive reasons, the fixed list from the product brief. */
export const FALSE_POSITIVE_REASONS = Object.freeze([
  'prea mic în cadru',
  'obiect',
  'umbră',
  'altă persoană în afara zonei',
  'alte',
]);

const ACTION_BUTTON =
  'flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]';

const KBD = 'hidden sm:inline rounded border border-current/30 px-1 font-mono text-[9px] font-bold opacity-70';

function SeverityChip({ event }) {
  const critical = event.severity === 'CRITICAL';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${
        critical
          ? 'border-red-200 bg-red-50 text-[#991B1B] dark:border-[#D73833]/40 dark:bg-[#D73833]/20 dark:text-[#FF8A80]'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-[#FFEB33]/40 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33]'
      }`}
      title={critical ? 'Critic: nu poate fi amânat.' : 'Avertisment: poate fi ținut până la 15 minute.'}
    >
      {event.severity}
    </span>
  );
}

function StatusChip({ event }) {
  const acknowledged = event.status === 'acknowledged';
  const escalated = event.status === 'escalated';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${
        acknowledged
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
          : escalated
            ? 'border-red-300 bg-red-100 font-black text-[#991B1B] dark:border-[#D73833]/30 dark:bg-[#D73833]/30 dark:text-[#FF8A80]'
            : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {STATUS_TOKENS[event.status]?.label || event.status}
    </span>
  );
}

function SourceChip({ event }) {
  const label = sourceLabel(eventSource(event));
  if (!label) return null;
  return (
    <span
      data-testid="triage-source"
      title={
        label === 'local'
          ? 'Produs de motorul din browser în această sesiune; nu e un fixture demo.'
          : label === 'simulat'
            ? 'Creat din meniul Simulare, la cerere; nu e o detecție a unei camere reale.'
            : 'Fixture demo din SafeSight; nu e o detecție reală.'
      }
      className="rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-700 dark:text-[#33E1FF]"
    >
      {label}
    </span>
  );
}

/** The small inline prompt: one fixed reason list, one confirm, one cancel. No modal. */
function ReasonPrompt({ kind, shortId, error, onSubmit, onCancel }) {
  const options = kind === 'hold' ? HOLD_REASONS : FALSE_POSITIVE_REASONS;
  const [reason, setReason] = useState(options[0]);
  const hold = kind === 'hold';
  const selectId = `triage-${kind}-reason-${shortId}`;

  return (
    <div
      data-testid={hold ? 'triage-hold-prompt' : 'triage-fp-prompt'}
      role="group"
      aria-label={hold ? 'Motivul amânării' : 'Motivul falsului pozitiv'}
      className="mt-1 space-y-1.5 rounded-lg border border-slate-500/20 bg-slate-50 p-2 dark:bg-black/20"
    >
      <p className="text-[10px] text-slate-600 dark:text-slate-300">
        {hold
          ? 'Amâni avertismentul cel mult 15 minute. Motivul este obligatoriu; rândul rămâne în coadă.'
          : 'Spune de ce detecția a fost eronată; feedback-ul merge la echipa de model.'}
      </p>
      <label htmlFor={selectId} className="block text-[10px] font-bold text-slate-700 dark:text-slate-200">
        {hold ? 'Motivul amânării' : 'Motivul falsului pozitiv'}
      </label>
      <select
        id={selectId}
        data-testid="triage-reason-picker"
        value={reason}
        onChange={(changeEvent) => setReason(changeEvent.target.value)}
        className="w-full rounded-lg border border-slate-400 bg-white px-2 py-1 text-[11px] text-[#1F1F1F] dark:border-white/20 dark:bg-black/30 dark:text-slate-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && (
        <p data-testid="triage-prompt-error" role="alert" className="text-[10px] font-bold text-[#991B1B] dark:text-[#FF8A80]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-400 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-white/25 dark:text-slate-200 dark:hover:bg-white/10"
        >
          Anulează
        </button>
        <button
          type="button"
          data-testid={hold ? 'triage-hold-confirm' : 'triage-fp-confirm'}
          onClick={() => onSubmit(reason)}
          className={`rounded-lg px-2.5 py-1 text-[10px] font-bold text-white ${
            hold ? 'bg-amber-700 hover:bg-amber-800' : 'bg-slate-700 hover:bg-slate-800'
          }`}
        >
          {hold ? 'Ține 15 minute' : 'Trimite feedback'}
        </button>
      </div>
    </div>
  );
}

export default function TriageRow({
  entry,
  position,
  isDarkMode,
  expanded,
  onToggleExpand,
  onOpen,
  onAck,
  onAckPress,
  onFalsePositive,
  onHold,
  onRelease,
  prompt,
  promptError,
  onSubmitPrompt,
  onCancelPrompt,
}) {
  const { row, episode, raws } = entry;
  const event = row.event;
  const critical = event.severity === 'CRITICAL';
  const escalated = event.status === 'escalated';
  const shortId = String(event.event_id).slice(-6);
  const held = Boolean(row.hold);
  const countdown = countdownLabel(row.remainingS);
  const progress = deadlineProgress(event, row.remainingS);
  const episodeCount = episode?.count ?? 0;
  const grouped = episodeCount > 1;
  const where = [event.camera_id, event.zone_id].filter(Boolean).join(' · ') || '—';
  const title = event.report?.what || event.type || 'Incident';

  // The label is made of facts that do not tick: the countdown and the reason line change
  // every second and would rewrite a focused button's name. They stay visible text.
  const openLabel = `Deschide incidentul: ${[title, where, event.severity, `poziția ${position}`]
    .filter(Boolean)
    .join(' · ')}`;

  return (
    <li
      data-testid="triage-row"
      data-event-id={event.event_id}
      data-triage-event-id={event.event_id}
      data-severity={event.severity}
      data-status={event.status}
      data-held={held ? 'true' : undefined}
      data-position={position}
      data-local={event.local ? 'true' : undefined}
      data-simulated={event.simulated ? 'true' : undefined}
      style={{ backgroundColor: isDarkMode ? '#2A2A2A' : '#FFFFFF' }}
      className={`rounded-xl border p-2.5 shadow-sm transition-all ${
        escalated
          ? 'border-[#D73833] ring-2 ring-[#D73833]/40'
          : critical
            ? 'border-[#D73833]/50 hover:border-[#D73833]'
            : 'border-[#FFEB33]/50 hover:border-[#FFEB33]'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 w-5 shrink-0 text-center font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400"
        >
          {position}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityChip event={event} />
            <StatusChip event={event} />
            <SourceChip event={event} />
            {held && (
              <span
                data-testid="triage-held-chip"
                title={row.hold.reason}
                className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 dark:border-[#FFEB33]/40 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33]"
              >
                <Hourglass size={9} className="mr-0.5 inline" aria-hidden="true" />
                ținut până la {holdUntilLabel(row.hold.until)} ({row.hold.reason})
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {shortId}
            </span>
          </div>

          {/* The open control stops here: the reason and the countdown are plain text, so
              the button's name does not change every second while it has focus. */}
          <button
            type="button"
            data-testid="triage-open"
            onClick={onOpen}
            aria-label={openLabel}
            className="block w-full cursor-pointer space-y-1 text-left"
          >
            <span className="block text-xs font-bold leading-tight text-slate-900 dark:text-slate-100">
              {title}
            </span>
            <span className="block font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {where} • {event.type}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-[#FFEB33]">
              <Eye size={11} aria-hidden="true" /> Detalii incident
              <kbd aria-hidden="true" className={KBD}>↵</kbd>
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              data-testid="triage-reason"
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              title="Primul criteriu care așază rândul aici: escaladat → severitate → termen → vechime."
            >
              {row.reason}
            </span>

            <span
              data-testid="triage-deadline"
              data-remaining={row.remainingS == null ? '' : Math.round(row.remainingS)}
              className={`font-mono text-[11px] font-bold tabular-nums ${
                row.remainingS != null && row.remainingS <= 0
                  ? 'text-[#991B1B] dark:text-[#FF8A80]'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {countdown}
            </span>

            {progress != null && (
              <span
                aria-hidden="true"
                className="h-1.5 min-w-[2.5rem] flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
              >
                <span
                  className={`block h-full rounded-full ${
                    row.remainingS != null && row.remainingS <= 0 ? 'bg-[#D73833]' : 'bg-[#FFEB33]'
                  }`}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </span>
            )}
          </div>

          {episode && grouped && (
            <span
              title="Un episod: aceeași cameră, zonă și persoană, la cel mult 120 s de prima detecție. Se deschide la toate detecțiile."
              className="block text-[10px] font-semibold text-slate-600 dark:text-slate-300"
            >
              {`1 episod · ${episodeCount} detecții`}
              {episode.maxSeverity === 'CRITICAL' ? ' · maxim CRITICAL' : ''}
            </span>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-slate-500/10 pt-1">
            {canDo('ack', event.status) && (
              <button
                type="button"
                data-testid="triage-ack"
                onPointerDown={() => onAckPress(event.event_id)}
                onClick={(clickEvent) => onAck(clickEvent, event.event_id)}
                aria-label={`Confirmă incidentul ${shortId}`}
                title="Confirmă incidentul și anulează timerul de escaladare"
                className={`${ACTION_BUTTON} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}
              >
                <Check size={12} aria-hidden="true" /> Confirmă
                <kbd aria-hidden="true" className={KBD}>A</kbd>
              </button>
            )}

            {canDo('false_positive', event.status) && (
              <button
                type="button"
                data-testid="triage-fp"
                onClick={() => onFalsePositive(event.event_id)}
                aria-label={`Marchează fals pozitiv incidentul ${shortId}`}
                className={`${ACTION_BUTTON} border-slate-400 text-slate-700 hover:bg-slate-100 dark:border-white/25 dark:text-slate-200 dark:hover:bg-white/10`}
              >
                <XCircle size={12} aria-hidden="true" /> Fals pozitiv
                <kbd aria-hidden="true" className={KBD}>F</kbd>
              </button>
            )}

            {canHold(event) && !held && (
              <button
                type="button"
                data-testid="triage-hold"
                onClick={() => onHold(event.event_id)}
                aria-label={`Ține avertismentul ${shortId} cel mult 15 minute`}
                className={`${ACTION_BUTTON} border-amber-500 text-amber-800 hover:bg-amber-50 dark:border-[#FFEB33]/50 dark:text-[#FFEB33] dark:hover:bg-[#FFEB33]/10`}
              >
                <Hourglass size={12} aria-hidden="true" /> Ține
                <kbd aria-hidden="true" className={KBD}>H</kbd>
              </button>
            )}

            {held && (
              <button
                type="button"
                data-testid="triage-release"
                onClick={() => onRelease(event.event_id)}
                aria-label={`Eliberează amânarea incidentului ${shortId}`}
                className={`${ACTION_BUTTON} border-amber-500 text-amber-800 hover:bg-amber-50 dark:border-[#FFEB33]/50 dark:text-[#FFEB33] dark:hover:bg-[#FFEB33]/10`}
              >
                Eliberează
                <kbd aria-hidden="true" className={KBD}>Esc</kbd>
              </button>
            )}

            {grouped && (
              <button
                type="button"
                data-testid="triage-expand"
                aria-expanded={expanded}
                aria-controls={`triage-episode-${event.event_id}`}
                onClick={() => onToggleExpand(event.event_id)}
                className={`${ACTION_BUTTON} ml-auto border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10`}
              >
                {expanded ? (
                  <ChevronDown size={12} aria-hidden="true" />
                ) : (
                  <ChevronRight size={12} aria-hidden="true" />
                )}
                {expanded ? 'Ascunde detecțiile' : 'Vezi detecțiile'}
              </button>
            )}
          </div>

          {prompt && (
            <ReasonPrompt
              kind={prompt.kind}
              shortId={shortId}
              error={promptError}
              onSubmit={(reason) => onSubmitPrompt(prompt.kind, event.event_id, reason)}
              onCancel={onCancelPrompt}
            />
          )}

          {grouped && expanded && (
            <ul
              id={`triage-episode-${event.event_id}`}
              aria-label={`Detecțiile episodului, ${episodeCount}`}
              className="mt-1 space-y-1 rounded-lg border border-slate-500/15 p-1.5"
            >
              {raws.map((raw) => (
                <li
                  key={raw.event_id}
                  data-testid="triage-raw-row"
                  data-event-id={raw.event_id}
                  data-severity={raw.severity}
                  data-status={raw.status}
                  className="flex flex-wrap items-center gap-1.5 text-[10px]"
                >
                  <SeverityChip event={raw} />
                  <span className="text-slate-600 dark:text-slate-300">
                    {formatTime(raw.detected_at, { placeholder: 'fără oră' })}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    {raw.type} · {String(raw.event_id).slice(-6)}
                  </span>
                  {canDo('ack', raw.status) && (
                    <button
                      type="button"
                      data-testid="triage-raw-ack"
                      onPointerDown={() => onAckPress(raw.event_id)}
                      onClick={(clickEvent) => onAck(clickEvent, raw.event_id)}
                      aria-label={`Confirmă detecția ${String(raw.event_id).slice(-6)}`}
                      className="ml-auto rounded border border-emerald-700 bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-800"
                    >
                      Confirmă
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
