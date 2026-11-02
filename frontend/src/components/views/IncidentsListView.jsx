import React, { useMemo, useState } from 'react';
import { AlertOctagon, Search, ChevronRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { STATUS_TOKENS } from '../../constants/theme';
import { TYPE_LABELS, USE_MOCK } from '../../services/api';
import SafeImage from '../common/SafeImage';

// Status groups as an operator thinks about them; the values are the contract statuses.
const STATUS_FILTERS = [
  { id: 'all', label: 'Toate', match: () => true },
  { id: 'active', label: 'Active', match: (s) => s === 'open' || s === 'escalated' },
  { id: 'closed', label: 'Rezolvate', match: (s) => s === 'acknowledged' || s === 'resolved' },
  { id: 'false_positive', label: 'Fals pozitiv', match: (s) => s === 'false_positive' },
];

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

function Badge({ token, fallback, isDarkMode }) {
  const t = token || {};
  return (
    <span
      style={{
        backgroundColor: (isDarkMode ? t.bgDark : t.bg) || 'rgba(148,163,184,0.15)',
        color: (isDarkMode ? t.textDark : t.text) || '#94A3B8',
        borderColor: t.border || 'rgba(148,163,184,0.3)',
      }}
      className="text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap"
    >
      {t.label || fallback}
    </span>
  );
}

export default function IncidentsListView() {
  const { isDarkMode, themeStyles } = useTheme();
  const { events, cameras, setSelectedEventId, setCurrentView, searchQuery, setSearchQuery } = useSecurity();
  const [statusFilter, setStatusFilter] = useState('all');

  const cameraName = useMemo(() => {
    const names = Object.fromEntries(cameras.map((c) => [c.id, c.code ? `${c.code} • ${c.id}` : c.id]));
    return (id) => names[id] || id;
  }, [cameras]);

  const counts = useMemo(
    () => Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, events.filter((e) => f.match(e.status)).length])),
    [events]
  );

  const rows = useMemo(() => {
    const filter = STATUS_FILTERS.find((f) => f.id === statusFilter) || STATUS_FILTERS[0];
    const q = searchQuery.trim().toLowerCase();
    return events
      .filter((e) => filter.match(e.status))
      .filter(
        (e) =>
          !q ||
          [e.event_id, e.type, TYPE_LABELS[e.type], e.camera_id, e.zone_id, e.report?.what, e.acked_by]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
      )
      .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)));
  }, [events, statusFilter, searchQuery]);

  const open = (eventId) => {
    setSelectedEventId(eventId);
    setCurrentView('incident_detail');
  };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 h-full max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
            <AlertOctagon size={20} className="text-[#D73833]" />
            Incidente
          </h2>
          <p style={{ color: themeStyles.textMuted }} className="text-xs">
            Toate incidentele, inclusiv cele rezolvate. Deschide unul pentru dovadă, cronologie și raport.
          </p>
        </div>
        <label className="relative block w-full sm:w-72">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Caută tip, cameră, zonă, ID…"
            style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.panelBorder }}
            className="w-full pl-8 pr-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtru status">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.id;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={active}
              onClick={() => setStatusFilter(f.id)}
              style={active ? { backgroundColor: isDarkMode ? '#D73833' : '#7EDEED', color: isDarkMode ? '#FFFFFF' : '#1F1F1F' } : { borderColor: themeStyles.panelBorder }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${active ? 'border-transparent' : 'hover:bg-white/5'}`}
            >
              {f.label} <span className="opacity-70 font-mono">{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="rounded-xl border overflow-hidden"
      >
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm" style={{ color: themeStyles.textMuted }}>
            {events.length === 0 ? 'Niciun incident încă.' : 'Niciun incident pentru filtrul ales.'}
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((e) => (
              <li key={e.event_id}>
                <button
                  onClick={() => open(e.event_id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="w-24 h-14 shrink-0 rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
                    <SafeImage
                      src={e.snapshot_url}
                      className="w-full h-full object-cover text-[8px]"
                      iconSize={14}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">{TYPE_LABELS[e.type] || e.type}</span>
                      <Badge token={STATUS_TOKENS[e.severity]} fallback={e.severity} isDarkMode={isDarkMode} />
                      <Badge token={STATUS_TOKENS[e.status]} fallback={e.status} isDarkMode={isDarkMode} />
                      {e.local && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#33E1FF]/40 bg-[#33E1FF]/10 text-cyan-700 dark:text-[#33E1FF]"
                          title="Produs de motorul din browser, nu din fixture-urile demo."
                        >
                          local
                        </span>
                      )}
                    </div>
                    <p className="text-xs truncate mt-0.5" style={{ color: themeStyles.textMuted }}>
                      {cameraName(e.camera_id)} · zona {e.zone_id}
                      {e.acked_by ? ` · confirmat de ${e.acked_by}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-mono shrink-0 hidden sm:block" style={{ color: themeStyles.textMuted }}>
                    {formatDateTime(e.detected_at)}
                  </span>
                  <ChevronRight size={16} className="text-slate-500 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px]" style={{ color: themeStyles.textMuted }}>
        {USE_MOCK
          ? `Ultimele ${events.length} incidente: fixture-uri demo plus detecțiile motorului local.`
          : `Ultimele ${events.length} incidente încărcate din backend.`}
      </p>
    </div>
  );
}
