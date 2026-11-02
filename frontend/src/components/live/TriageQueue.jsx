import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import {
  createTriageState,
  freezeWhileReading,
  holdWarning,
  nextAction,
  queueRows,
  releaseFreeze,
  releaseHold,
} from '../../utils/triage';
import { shouldAcceptAck } from './liveMedia';
import { episodeRows, holdUntilLabel, isTypingTarget } from './triageRows';
import TriageRow from './TriageRow';

// The operator queue, mounted inside the Live feed panel.
//
// It is a reading order over the rows the feed already shows, never a second record: the
// visible list comes in as `events`, the rule comes from `utils/triage.js`, and every
// action goes through the same store handler the cards use. Nothing is acknowledged,
// suppressed or dispatched here that a human did not ask for.
//
// Keyboard scope: `onKeyDown` sits on the queue container, so `A`/`F`/`H`/`Enter` work only
// while focus is inside the queue and never steal keys from search or a note field. The
// order is frozen while a row has focus (`freezeWhileReading`) and re-ranked after an
// action, so a row cannot slide under the operator's eyes.

/** Open or escalated: the queue's subset. The Flux tab keeps everything else. */
function isActive(event) {
  return event?.status === 'open' || event?.status === 'escalated';
}

/** The nearest row in DOM order, for focus after the current row leaves the queue. */
function focusFirstRow(container) {
  container?.querySelector('[data-testid="triage-open"]')?.focus();
}

export default function TriageQueue({
  events,
  displayMode,
  isDarkMode,
  themeStyles,
  operatorName,
  onOpen,
  onAcknowledge,
  onFalsePositive,
  onShowFlux,
}) {
  // Only the queue subset reaches the read model, so the reading freeze snapshots exactly
  // the rows on screen and a hold can only ever be written for a row that is visible.
  const queue = useMemo(
    () => (Array.isArray(events) ? events.filter(isActive) : []),
    [events]
  );

  const [triage, setTriage] = useState(() =>
    createTriageState(queue, { operator: operatorName })
  );
  const [focusedId, setFocusedId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState({});
  // `{ kind: 'hold'|'fp', eventId, error }` — one prompt at a time, inside the row.
  const [prompt, setPrompt] = useState(null);
  const [hint, setHint] = useState('');

  const pressRef = useRef(null);
  const focusNextRef = useRef(false);
  const containerRef = useRef(null);

  // One tick, countdowns only: the ranking is time-invariant, so a second never reorders a
  // row. Holds expire through the same tick, which is why it also runs with no deadline on
  // screen.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(
    () => queueRows({ ...triage, events: queue }, now),
    [triage, queue, now]
  );
  const entries = useMemo(() => episodeRows(rows, queue), [rows, queue]);
  // A stable signature: the effect below must run on a set change, not on every tick.
  const rowIds = rows.map((row) => row.eventId).join('|');
  const escalatedCount = rows.filter((row) => row.event.status === 'escalated').length;
  const heldCount = rows.filter((row) => row.hold).length;

  // After an acknowledge or a false positive the row leaves; focus must land on the next
  // one without the operator reaching for the mouse.
  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    focusFirstRow(containerRef.current);
  }, [rowIds]);

  const rowFor = useCallback(
    (node) => {
      const holder = node?.closest?.('[data-triage-event-id]');
      const id = holder?.dataset?.triageEventId || null;
      if (!id) return null;
      return rows.find((row) => row.eventId === id) ?? null;
    },
    [rows]
  );

  const handleFocus = (focusEvent) => {
    const id = rowFor(focusEvent.target)?.eventId;
    if (!id) return;
    setFocusedId(id);
    setTriage((previous) => freezeWhileReading({ ...previous, events: queue }, id, Date.now()));
  };

  const handleBlur = (blurEvent) => {
    if (containerRef.current?.contains(blurEvent.relatedTarget)) return;
    setFocusedId(null);
    setPrompt(null);
    setTriage((previous) => releaseFreeze({ ...previous, events: queue }));
  };

  const acknowledge = useCallback(
    (eventId, clickEvent) => {
      // The same guard as the feed cards: the second click of a double-click reports
      // `detail > 1`, and a click that did not press this row is not its ack. Keyboard
      // activation has detail 0 and therefore always passes.
      const accepted = shouldAcceptAck({
        detail: clickEvent?.detail ?? 0,
        eventId,
        press: pressRef.current,
        now: Date.now(),
      });
      if (!accepted) return;
      pressRef.current = null;
      focusNextRef.current = true;
      setPrompt(null);
      setHint('');
      setTriage((previous) => releaseFreeze(previous));
      onAcknowledge?.(eventId, clickEvent);
    },
    [onAcknowledge]
  );

  const beginPress = useCallback((eventId) => {
    pressRef.current = { eventId, at: Date.now() };
  }, []);

  const openPrompt = (kind, eventId) => {
    setHint('');
    setPrompt({ kind, eventId, error: null });
  };

  const submitPrompt = (kind, eventId, reason) => {
    if (kind === 'hold') {
      const result = holdWarning({ ...triage, events: queue }, eventId, reason, Date.now());
      if (!result.ok) {
        // The refusal is the tested rule's own message: `Criticele nu pot fi amânate.`
        setPrompt((previous) => (previous ? { ...previous, error: result.message } : previous));
        return;
      }
      setTriage(result.state);
      setPrompt(null);
      const until = result.state.holds[String(eventId)]?.until;
      setHint(`Ținut până la ${holdUntilLabel(until)}: ${reason}. Rândul rămâne în coadă.`);
      return;
    }

    setPrompt(null);
    setHint('');
    focusNextRef.current = true;
    setTriage((previous) => releaseFreeze(previous));
    onFalsePositive?.(eventId, reason);
  };

  const release = (eventId) => {
    setTriage((previous) => releaseHold(previous, eventId));
    setHint('Amânarea a fost ridicată; rândul revine în ordinea lui.');
  };

  const handleKeyDown = (keyEvent) => {
    if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;

    // Escape closes the prompt first, so the key never releases a hold behind a form.
    if (keyEvent.key === 'Escape' && prompt) {
      keyEvent.preventDefault();
      setPrompt(null);
      return;
    }

    const typing = isTypingTarget(keyEvent.target);
    // No row focused yet: the first row is "the next thing to do".
    const current =
      (focusedId ? rows.find((row) => row.eventId === focusedId) : null) ?? rows[0] ?? null;
    const decision = nextAction(keyEvent.key, {
      event: current?.event ?? null,
      held: Boolean(current?.hold),
      typing,
    });

    if (typing) return;
    if (decision.hint) {
      keyEvent.preventDefault();
      setHint(decision.hint);
      return;
    }
    if (decision.type === 'none') return;

    // A focused action button owns Enter itself; the queue only maps Enter on the row.
    const testId = keyEvent.target?.dataset?.testid || '';
    if (decision.type === 'open' && testId.startsWith('triage-') && testId !== 'triage-open') {
      return;
    }

    keyEvent.preventDefault();
    setHint('');

    switch (decision.type) {
      case 'ack':
        acknowledge(decision.eventId, null);
        break;
      case 'false-positive':
        if (decision.allowed && current) openPrompt('fp', current.eventId);
        break;
      case 'hold':
        if (decision.allowed && current) openPrompt('hold', current.eventId);
        break;
      case 'release-hold':
        release(decision.eventId);
        break;
      case 'open':
        if (decision.eventId) onOpen?.(decision.eventId);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 text-[10px] font-semibold">
        <p
          data-testid="triage-summary"
          aria-live="polite"
          style={{ color: themeStyles.textMuted }}
        >
          {rows.length} în coadă
          {escalatedCount > 0 ? ` · ${escalatedCount} escaladate` : ''}
          {heldCount > 0 ? ` · ${heldCount} ținute` : ''}
        </p>
        <p
          className="font-mono text-[9px] uppercase tracking-wide"
          title="Regula de ordonare, lexicografică: escaladat, apoi severitatea, apoi termenul cel mai apropiat, apoi vechimea."
          style={{ color: themeStyles.textMuted }}
        >
          escaladat → severitate → termen → vechime
        </p>
      </div>

      <p
        data-testid="triage-hint"
        role="status"
        aria-live="polite"
        className={`pb-1.5 text-[10px] font-bold ${hint ? '' : 'sr-only'}`}
        style={hint ? undefined : { color: themeStyles.textMuted }}
      >
        {hint || 'Scurtături: A confirmă, F fals pozitiv, H ține un avertisment, Enter deschide, Esc eliberează.'}
      </p>

      <div
        ref={containerRef}
        role="group"
        tabIndex={-1}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Coada de incidente, ordonată după regulă"
        className={`overflow-y-auto pr-1 scrollbar-thin ${
          displayMode === 'split' ? 'max-h-96' : 'max-h-[580px]'
        }`}
      >
        {entries.length === 0 ? (
          <div
            data-testid="triage-empty"
            style={{ backgroundColor: isDarkMode ? '#2D2D2D' : '#F8FAFC' }}
            className="mt-4 space-y-1 rounded-xl p-5 text-center text-xs"
          >
            <p className="font-bold text-slate-700 dark:text-slate-300">Nimic deschis în coadă.</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Toate incidentele au fost confirmate sau marcate. Istoricul complet rămâne în Flux.
            </p>
            {onShowFlux && (
              <button
                type="button"
                data-testid="triage-empty-flux"
                onClick={onShowFlux}
                className="mt-1 rounded-lg border border-slate-400 px-2.5 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100 dark:border-white/25 dark:text-slate-200 dark:hover:bg-white/10"
              >
                Vezi Flux
              </button>
            )}
          </div>
        ) : (
          <ul role="list" className="space-y-2">
            {entries.map((entry, index) => (
              <TriageRow
                key={entry.row.eventId}
                entry={entry}
                position={index + 1}
                isDarkMode={isDarkMode}
                expanded={Boolean(expanded[entry.row.eventId])}
                onToggleExpand={(eventId) =>
                  setExpanded((previous) => ({ ...previous, [eventId]: !previous[eventId] }))
                }
                onOpen={() => onOpen?.(entry.row.eventId)}
                onAck={(clickEvent, eventId) => acknowledge(eventId, clickEvent)}
                onAckPress={beginPress}
                onFalsePositive={(eventId) => openPrompt('fp', eventId)}
                onHold={(eventId) => openPrompt('hold', eventId)}
                onRelease={release}
                prompt={prompt && prompt.eventId === entry.row.eventId ? prompt : null}
                promptError={prompt?.error ?? null}
                onSubmitPrompt={submitPrompt}
                onCancelPrompt={() => setPrompt(null)}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1 pt-1.5 text-[9px]" style={{ color: themeStyles.textMuted }}>
        <ListOrdered size={10} aria-hidden="true" /> Ordonează atenția, nu decide. Flux rămâne la un click.
      </p>
    </div>
  );
}
