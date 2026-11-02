import { useMemo, useState } from 'react';
import { AlertOctagon, ChevronRight, Search, Settings } from 'lucide-react';

import { useSecurity } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import { USE_MOCK } from '../../services/api';
import { TYPE_LABELS } from '../../data/labels';
import { EVENT_SOURCE, eventSource, sourceLabel } from '../../utils/eventVisibility';
import { formatDateTime } from '../../utils/time';
import { STATUS_FILTERS, countByStatus, filterIncidents, summaryLine } from '../../utils/incidentList';
import SafeImage from '../common/SafeImage';
import { ProvenanceChip, StatusChip } from '../incidents/Chips';
import { Panel } from '../ui';

// Screen shell only. The filtering, the counters and the summary sentence are pure
// functions in utils/incidentList.js (node-tested); this file decides what to draw. Four
// local pieces — intro, filters, row, empty state — keep the list component itself small.
// Desktop shows a real table row, a phone shows the same fields stacked in one card.

const ROW_GRID =
  'w-full text-left grid grid-cols-[4.5rem_minmax(0,1fr)_1.25rem] md:grid-cols-[4.5rem_minmax(0,1fr)_12rem_8.5rem_1.25rem] items-center gap-3 px-3 py-2.5 border-l-[3px] transition-colors hover:bg-white/5';
const HEADER_GRID =
  'hidden md:grid grid-cols-[4.5rem_minmax(0,1fr)_12rem_8.5rem_1.25rem] gap-3 px-3 py-2 border-b border-white/10 text-[10px] font-bold uppercase tracking-wider';
const FILTER_BUTTON =
  'min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]';
const SEARCH_FIELD =
  'w-full pl-8 pr-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-[#FFEB33]';

// Tooltip text per provenance source; the readable label still comes from `sourceLabel`.
const SOURCE_HINTS = {
  simulated: 'Creat din meniul Simulare, la cerere; nu vine de la o cameră reală.',
  demo: 'Fixture demo din SafeSight; nu e o detecție a vreunei camere.',
};

// Filters are toggles over one table, not tabs: a labelled group of pressed buttons keeps
// every option in the tab order and needs no tabpanel (A10).
function StatusFilters({ counts, selected, onSelect, isDarkMode, themeStyles }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtru status">
      {STATUS_FILTERS.map((filter) => {
        const pressed = filter.id === selected;
        const pressedStyle = {
          backgroundColor: isDarkMode ? '#D73833' : '#7EDEED',
          color: isDarkMode ? '#FFFFFF' : '#1F1F1F',
        };
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(filter.id)}
            style={pressed ? pressedStyle : { borderColor: themeStyles.panelBorder }}
            className={`${FILTER_BUTTON} ${pressed ? 'border-transparent' : 'hover:bg-white/5'}`}
          >
            {filter.label}{' '}
            <span className="opacity-70 font-mono">{counts[filter.id] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// One row of the table. The right border colour is the severity, the chips are the rest.
function IncidentListRow({ event, describeCamera, onOpen, themeStyles }) {
  const source = eventSource(event);
  const badge = sourceLabel(source);
  const accent = event.severity === 'CRITICAL' ? 'border-l-[#D73833]' : 'border-l-[#FFEB33]';
  const camera = describeCamera(event.camera_id);

  return (
    <li>
      <button
        onClick={() => onOpen(event.event_id)}
        data-testid="incident-row"
        data-event-id={event.event_id}
        data-severity={event.severity}
        data-status={event.status}
        data-source={source}
        aria-label={`Deschide incidentul ${event.event_id}`}
        className={`${ROW_GRID} ${accent}`}
      >
        <span className="block w-[4.5rem] h-11 rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
          <SafeImage src={event.snapshot_url} className="w-full h-full object-cover text-[8px]" iconSize={14} />
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-sm">{TYPE_LABELS[event.type] || event.type}</span>
            <StatusChip value={event.severity} />
            <StatusChip value={event.status} />
            {event.local && (
              <ProvenanceChip tone="local" title="Produs de motorul din browser, nu din fixture-urile demo.">
                local
              </ProvenanceChip>
            )}
            {source !== EVENT_SOURCE.local && source !== EVENT_SOURCE.backend && (
              <span data-testid={`incident-row-${source}-chip`}>
                <ProvenanceChip tone="demo" title={SOURCE_HINTS[source]}>
                  {badge}
                </ProvenanceChip>
              </span>
            )}
          </span>
          {/* Wraps instead of clipping: at 320 px, with enlarged text spacing, the
              camera/zone/operator line must stay readable (A19). */}
          <span className="block text-xs break-words mt-0.5" style={{ color: themeStyles.textMuted }}>
            {summaryLine(event, describeCamera)}
          </span>
        </span>

        <span className="hidden md:block text-xs break-words" style={{ color: themeStyles.textMuted }}>
          {camera}
        </span>
        <time
          dateTime={event.detected_at || undefined}
          className="hidden md:block text-[11px] font-mono text-right"
          style={{ color: themeStyles.textMuted }}
        >
          {formatDateTime(event.detected_at)}
        </time>

        <ChevronRight size={16} className="text-slate-500 justify-self-end" aria-hidden="true" />
      </button>
    </li>
  );
}

// The provenance sentence under the title: one vocabulary, explained where it is used.
function ProvenanceNote({ showDemoData }) {
  if (!USE_MOCK) {
    return <span>Incidentele sunt încărcate din backend.</span>;
  }
  if (!showDemoData) {
    return (
      <span>
        Doar detecțiile motorului din browser. Fixture-urile demo sunt ascunse; le pornești din
        Setări → Date demo.
      </span>
    );
  }
  return (
    <>
      <ProvenanceChip tone="demo" title="Fixture-uri demo plus detecțiile motorului din browser; nimic nu vine din backend.">
        date demo
      </ProvenanceChip>
      <span>Fixture-uri demo plus detecțiile motorului din browser; nimic nu vine din backend.</span>
    </>
  );
}

// Title, provenance note and search field on one line (search wraps under on a phone).
function ListIntro({ searchQuery, onSearchChange, onClearSearch, showDemoData, muted, themeStyles }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
          <AlertOctagon size={20} className="text-[#D73833]" aria-hidden="true" />
          Incidente
        </h2>
        <p style={muted} className="text-xs">
          Toate incidentele, inclusiv cele rezolvate. Deschide unul pentru dovadă, cronologie și raport.
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={muted}>
          <ProvenanceNote showDemoData={showDemoData} />
        </p>
      </div>

      <label className="relative block w-full sm:w-72">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          value={searchQuery}
          onChange={(changeEvent) => onSearchChange(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== 'Escape') return;
            onClearSearch();
          }}
          placeholder="Caută tip, cameră, zonă, ID…"
          aria-label="Caută în incidente"
          style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.panelBorder }}
          className={SEARCH_FIELD}
        />
      </label>
    </div>
  );
}

// What an empty table means depends on why it is empty, so each case gets its own copy.
function EmptyTable({ hasEvents, showDemoData, themeStyles, onOpenSettings }) {
  const muted = { color: themeStyles.textMuted };

  if (hasEvents) {
    return (
      <div className="p-10 text-center text-sm space-y-2" style={muted} data-testid="incidents-empty">
        <p>Niciun incident pentru filtrul ales.</p>
      </div>
    );
  }

  if (showDemoData || !USE_MOCK) {
    return (
      <div className="p-10 text-center text-sm space-y-2" style={muted} data-testid="incidents-empty">
        <p>Niciun incident încă. Pornește motorul din Live sau folosește meniul Simulare.</p>
      </div>
    );
  }

  return (
    <div className="p-10 text-center text-sm space-y-2" style={muted} data-testid="incidents-empty">
      <p className="font-bold">Nicio detecție reală încă. Pornește motorul din browser sau activează datele demo.</p>
      <p className="text-xs">
        Lista arată doar incidentele produse de motorul din browser; fixture-urile demo nu sunt camere
        reale și rămân ascunse.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]"
        style={{ borderColor: themeStyles.panelBorder }}
      >
        <Settings size={13} aria-hidden="true" /> Deschide Setări → Date demo
      </button>
    </div>
  );
}

// The one-line receipt under the table: how many rows and where they came from.
function ListFootNote({ count, showDemoData, muted }) {
  let text;
  if (USE_MOCK) {
    text = showDemoData
      ? `Ultimele ${count} incidente: date demo plus detecțiile motorului din browser.`
      : `Ultimele ${count} detecții reale; fixture-urile demo sunt ascunse.`;
  } else {
    text = `Ultimele ${count} incidente încărcate din backend.`;
  }
  return (
    <p className="text-[11px]" style={muted}>
      {text}
    </p>
  );
}

export default function IncidentsListView() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    events,
    cameras,
    showDemoData,
    searchQuery,
    setSearchQuery,
    setSelectedEventId,
    setCurrentView,
  } = useSecurity();
  const [statusFilter, setStatusFilter] = useState('all');

  const describeCamera = useMemo(() => {
    const labels = Object.fromEntries(
      cameras.map((camera) => [camera.id, camera.code ? `${camera.code} • ${camera.id}` : camera.id])
    );
    return (cameraId) => labels[cameraId] || cameraId;
  }, [cameras]);

  const counts = useMemo(() => countByStatus(events), [events]);
  const rows = useMemo(
    () => filterIncidents(events, { status: statusFilter, query: searchQuery, typeLabels: TYPE_LABELS }),
    [events, statusFilter, searchQuery]
  );

  const muted = { color: themeStyles.textMuted };
  const openIncident = (eventId) => {
    setSelectedEventId(eventId);
    setCurrentView('incident_detail');
  };
  const openSettings = () => setCurrentView('settings');

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto h-full">
      <div className="max-w-6xl mx-auto space-y-4">
        <ListIntro
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClearSearch={() => setSearchQuery('')}
          showDemoData={showDemoData}
          muted={muted}
          themeStyles={themeStyles}
        />

        <StatusFilters
          counts={counts}
          selected={statusFilter}
          onSelect={setStatusFilter}
          isDarkMode={isDarkMode}
          themeStyles={themeStyles}
        />

        <Panel size="plain" className="overflow-hidden">
          <div className={HEADER_GRID} style={muted}>
            <span aria-hidden="true" />
            <span>Incident</span>
            <span>Cameră</span>
            <span className="text-right">Detectat</span>
            <span aria-hidden="true" />
          </div>

          {rows.length === 0 ? (
            <EmptyTable
              hasEvents={events.length > 0}
              showDemoData={showDemoData}
              themeStyles={themeStyles}
              onOpenSettings={openSettings}
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((event) => (
                <IncidentListRow
                  key={event.event_id}
                  event={event}
                  describeCamera={describeCamera}
                  onOpen={openIncident}
                  themeStyles={themeStyles}
                />
              ))}
            </ul>
          )}
        </Panel>

        <ListFootNote count={events.length} showDemoData={showDemoData} muted={muted} />
      </div>
    </div>
  );
}
