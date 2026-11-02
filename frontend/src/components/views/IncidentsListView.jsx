import { useMemo, useState } from 'react';
import { AlertOctagon, ChevronRight, Search, Settings } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { TYPE_LABELS } from '../../data/labels';
import { EVENT_SOURCE, eventSource, sourceLabel } from '../../utils/eventVisibility';
import SafeImage from '../common/SafeImage';
import { Panel } from '../ui';
import { ProvenanceChip, StatusChip } from '../incidents/Chips';
import { formatDateTime } from '../../utils/time';
import { STATUS_FILTERS, countByStatus, filterIncidents, summaryLine } from '../../utils/incidentList';

// Rewritten screen: the table logic lives in utils/incidentList.js (tested without a
// browser), this file only renders it. The layout is a real table on desktop and a
// stacked card on a phone, with the same information in both.

// The filters are filters, not tabs: each button toggles a view of the same table, so they
// are a labelled button group with `aria-pressed` instead of a tablist without tabpanels
// (A10). Every button stays in the tab order, which is what a filter set should do.
function FilterGroup({ counts, active, onChange, isDarkMode, themeStyles }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtru status">
      {STATUS_FILTERS.map((filter) => {
        const selected = filter.id === active;
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(filter.id)}
            style={
              selected
                ? { backgroundColor: isDarkMode ? '#D73833' : '#7EDEED', color: isDarkMode ? '#FFFFFF' : '#1F1F1F' }
                : { borderColor: themeStyles.panelBorder }
            }
            className={`min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33] ${
              selected ? 'border-transparent' : 'hover:bg-white/5'
            }`}
          >
            {filter.label}{' '}
            <span className="opacity-70 font-mono">{counts[filter.id] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// The provenance title per source; the visible text comes from `sourceLabel`.
const SOURCE_TITLE = {
  simulated: 'Creat din meniul Simulare, la cerere; nu vine de la o cameră reală.',
  demo: 'Fixture demo din SafeSight; nu e o detecție a vreunei camere.',
};

function IncidentRow({ event, cameraName, onOpen, themeStyles }) {
  const critical = event.severity === 'CRITICAL';
  const source = eventSource(event);
  const sourceTag = sourceLabel(source);
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
        className={`w-full text-left grid grid-cols-[4.5rem_minmax(0,1fr)_1.25rem] md:grid-cols-[4.5rem_minmax(0,1fr)_12rem_8.5rem_1.25rem] items-center gap-3 px-3 py-2.5 border-l-[3px] transition-colors hover:bg-white/5 ${
          critical ? 'border-l-[#D73833]' : 'border-l-[#FFEB33]'
        }`}
      >
        <span className="block w-[4.5rem] h-11 rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
          <SafeImage
            src={event.snapshot_url}
            className="w-full h-full object-cover text-[8px]"
            iconSize={14}
          />
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-sm">{TYPE_LABELS[event.type] || event.type}</span>
            <StatusChip value={event.severity} />
            <StatusChip value={event.status} />
            {event.local && (
              <ProvenanceChip
                tone="local"
                title="Produs de motorul din browser, nu din fixture-urile demo."
              >
                local
              </ProvenanceChip>
            )}
            {source !== EVENT_SOURCE.local && source !== EVENT_SOURCE.backend && (
              <span data-testid={`incident-row-${source}-chip`}>
                <ProvenanceChip tone="demo" title={SOURCE_TITLE[source]}>
                  {sourceTag}
                </ProvenanceChip>
              </span>
            )}
          </span>
          {/* Wraps instead of clipping: at 320 px and with enlarged text spacing the
              camera/zone/operator line must stay readable (A19). */}
          <span className="block text-xs break-words mt-0.5" style={{ color: themeStyles.textMuted }}>
            {summaryLine(event, cameraName)}
          </span>
        </span>

        <span className="hidden md:block text-xs break-words" style={{ color: themeStyles.textMuted }}>
          {cameraName(event.camera_id)}
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

export default function IncidentsListView() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    events,
    cameras,
    searchQuery,
    setSearchQuery,
    setSelectedEventId,
    setCurrentView,
    showDemoData,
  } = useSecurity();
  const [statusFilter, setStatusFilter] = useState('all');

  const cameraName = useMemo(() => {
    const names = Object.fromEntries(cameras.map((camera) => [camera.id, camera.code ? `${camera.code} • ${camera.id}` : camera.id]));
    return (id) => names[id] || id;
  }, [cameras]);

  const counts = useMemo(() => countByStatus(events), [events]);
  const rows = useMemo(
    () => filterIncidents(events, { status: statusFilter, query: searchQuery, typeLabels: TYPE_LABELS }),
    [events, statusFilter, searchQuery]
  );

  const open = (eventId) => {
    setSelectedEventId(eventId);
    setCurrentView('incident_detail');
  };

  const muted = { color: themeStyles.textMuted };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto h-full">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
              <AlertOctagon size={20} className="text-[#D73833]" aria-hidden="true" />
              Incidente
            </h2>
            <p style={muted} className="text-xs">
              Toate incidentele, inclusiv cele rezolvate. Deschide unul pentru dovadă, cronologie și raport.
            </p>
            {/* One provenance vocabulary, explained in place instead of only in a tooltip. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={muted}>
              {showDemoData && USE_MOCK ? (
                <>
                  <ProvenanceChip tone="demo" title="Fixture-uri demo plus detecțiile motorului din browser; nimic nu vine din backend.">
                    date demo
                  </ProvenanceChip>
                  <span>Fixture-uri demo plus detecțiile motorului din browser; nimic nu vine din backend.</span>
                </>
              ) : USE_MOCK ? (
                <span>
                  Doar detecțiile motorului din browser. Fixture-urile demo sunt ascunse; le pornești
                  din Setări → Date demo.
                </span>
              ) : (
                <span>Incidentele sunt încărcate din backend.</span>
              )}
            </p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearchQuery('');
              }}
              placeholder="Caută tip, cameră, zonă, ID…"
              aria-label="Caută în incidente"
              style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.panelBorder }}
              className="w-full pl-8 pr-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
            />
          </label>
        </div>

        <FilterGroup
          counts={counts}
          active={statusFilter}
          onChange={setStatusFilter}
          isDarkMode={isDarkMode}
          themeStyles={themeStyles}
        />

        <Panel size="plain" className="overflow-hidden">
          <div
            className="hidden md:grid grid-cols-[4.5rem_minmax(0,1fr)_12rem_8.5rem_1.25rem] gap-3 px-3 py-2 border-b border-white/10 text-[10px] font-bold uppercase tracking-wider"
            style={muted}
          >
            <span aria-hidden="true" />
            <span>Incident</span>
            <span>Cameră</span>
            <span className="text-right">Detectat</span>
            <span aria-hidden="true" />
          </div>

          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm space-y-2" style={muted} data-testid="incidents-empty">
              {events.length > 0 ? (
                <p>Niciun incident pentru filtrul ales.</p>
              ) : showDemoData || !USE_MOCK ? (
                <p>Niciun incident încă. Pornește motorul din Live sau folosește meniul Simulare.</p>
              ) : (
                <>
                  <p className="font-bold">
                    Nicio detecție reală încă. Pornește motorul din browser sau activează datele demo.
                  </p>
                  <p className="text-xs">
                    Lista arată doar incidentele produse de motorul din browser; fixture-urile demo
                    nu sunt camere reale și rămân ascunse.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCurrentView('settings')}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33]"
                    style={{ borderColor: themeStyles.panelBorder }}
                  >
                    <Settings size={13} aria-hidden="true" /> Deschide Setări → Date demo
                  </button>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((event) => (
                <IncidentRow
                  key={event.event_id}
                  event={event}
                  cameraName={cameraName}
                  onOpen={open}
                  themeStyles={themeStyles}
                />
              ))}
            </ul>
          )}
        </Panel>

        <p className="text-[11px]" style={muted}>
          {showDemoData && USE_MOCK
            ? `Ultimele ${events.length} incidente: date demo plus detecțiile motorului din browser.`
            : USE_MOCK
              ? `Ultimele ${events.length} detecții reale; fixture-urile demo sunt ascunse.`
              : `Ultimele ${events.length} incidente încărcate din backend.`}
        </p>
      </div>
    </div>
  );
}
