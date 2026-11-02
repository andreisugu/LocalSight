import React, { useCallback, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { USE_MOCK } from '../../services/api';
import DemoDataChip from './DemoDataChip';
import IncidentFeedCard from './IncidentFeedCard';
import { shouldAcceptAck } from './liveMedia';

const FILTERS = [
  { key: 'open', label: 'Deschise' },
  { key: 'critical', label: 'Doar critice' },
  { key: 'all', label: 'Toate azi' },
];

// The incident feed. It renders the context-filtered list, so the global search and the
// status tabs are already applied; this component adds the count, the filters and the
// double-click guard on "Confirmă".
export default function IncidentFeed({
  events,
  filterMode,
  onFilterChange,
  displayMode,
  isDarkMode,
  themeStyles,
  searchQuery,
  onOpenIncident,
  onAcknowledge,
}) {
  // F1: the press that belongs to the click that is about to acknowledge. A double-click
  // reuses the same screen point, and the first click removes its card, so without this
  // the second click acknowledges whatever card slid under the cursor.
  const pressRef = useRef(null);

  const beginPress = useCallback((eventId) => {
    pressRef.current = { eventId, at: Date.now() };
  }, []);

  const handleAcknowledge = useCallback(
    (clickEvent, eventId) => {
      // The button lives inside a clickable card: the ack must never also open the
      // incident. The rest of the decision is the tested pure rule.
      clickEvent.stopPropagation();
      const accepted = shouldAcceptAck({
        detail: clickEvent.detail,
        eventId,
        press: pressRef.current,
        now: Date.now(),
      });
      if (!accepted) return;
      pressRef.current = null;
      onAcknowledge(eventId, clickEvent);
    },
    [onAcknowledge]
  );

  const query = (searchQuery || '').trim();

  return (
    <div
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className={`rounded-xl border p-3 flex flex-col shadow-sm shrink-0 ${
        displayMode === 'split' ? 'w-full' : 'w-full xl:w-96 min-h-[460px]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-500/15 shrink-0">
        <h2 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
          <ShieldAlert size={15} className="text-[#D73833] shrink-0" />
          <span>Incidente Detectate</span>
          {USE_MOCK && (
            <>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <DemoDataChip title="Cardurile fără eticheta „local” sunt date demo din fixtures. Cele cu „local” sunt produse de motorul din browser, când îl pornești." />
            </>
          )}
        </h2>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#FFEB33] text-[#1F1F1F] font-bold">
          {events.length}
        </span>
      </div>

      <div className="flex gap-1 my-2 shrink-0">
        {FILTERS.map((filter) => {
          const selected = filterMode === filter.key;
          return (
            <button
              key={filter.key}
              onClick={() => onFilterChange(filter.key)}
              style={{
                backgroundColor: selected
                  ? isDarkMode
                    ? '#D73833'
                    : '#7EDEED'
                  : isDarkMode
                    ? '#282828'
                    : '#F1F5F9',
                color: selected
                  ? isDarkMode
                    ? '#FFFFFF'
                    : '#1F1F1F'
                  : isDarkMode
                    ? '#F5F5F5'
                    : '#1F1F1F',
              }}
              className="flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center"
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <div
        className={`overflow-y-auto pr-1 scrollbar-thin ${
          displayMode === 'split'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96'
            : 'space-y-2 flex-1 max-h-[580px]'
        }`}
      >
        {events.length === 0 ? (
          <div
            style={{ backgroundColor: isDarkMode ? '#2D2D2D' : '#F8FAFC' }}
            className={`p-5 rounded-xl text-center space-y-1 mt-4 text-xs ${
              displayMode === 'split' ? 'col-span-full' : ''
            }`}
          >
            <p className="font-bold text-slate-700 dark:text-slate-300">
              {query ? `Niciun incident pentru „${query}”.` : 'Niciun incident în această categorie.'}
            </p>
            <p className="text-[10px] text-slate-400">
              {query
                ? 'Șterge căutarea din bara de sus pentru a vedea toate incidentele.'
                : 'Zona este conformă cu normele de siguranță.'}
            </p>
          </div>
        ) : (
          events.map((event) => (
            <IncidentFeedCard
              key={event.event_id}
              event={event}
              isDarkMode={isDarkMode}
              onOpen={() => onOpenIncident(event.event_id)}
              onAck={handleAcknowledge}
              onAckPress={beginPress}
            />
          ))
        )}
      </div>
    </div>
  );
}
