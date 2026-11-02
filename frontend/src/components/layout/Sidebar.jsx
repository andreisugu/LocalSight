import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ChevronLeft,
  ChevronRight,
  FileText,
  PenTool,
  Settings,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';

// Below Tailwind's `sm` (640px) a 240px rail would leave ~135px of content on a 375px
// phone, so the rail starts collapsed there and opens as an overlay.
const PHONE_QUERY = '(max-width: 639px)';
// An explicit user choice beats the viewport. We never write this key ourselves, so a
// resize cannot get stuck on a choice the user made weeks ago.
const COLLAPSE_PREFERENCE_KEY = 'localsight.sidebarCollapsed';

const NAV_ITEMS = [
  {
    id: 'live',
    label: 'Live',
    subtitle: 'Monitorizare & Stream',
    icon: Video,
  },
  {
    id: 'incidents',
    label: 'Incidente',
    subtitle: 'Istoric, dovadă & raport',
    icon: AlertOctagon,
    // The detail screen is an incident, so it keeps this entry active.
    also: ['incident_detail'],
  },
  {
    id: 'zones',
    label: 'Configurare Zone',
    subtitle: 'Poligoane & Cadru de referință',
    icon: PenTool,
  },
  {
    id: 'reports',
    label: 'Rapoarte Tură',
    subtitle: 'Statistici & Export PDF',
    icon: FileText,
  },
  {
    id: 'settings',
    // No "edge" box: in the static build everything runs in the tab.
    label: 'Sistem & Audit',
    subtitle: USE_MOCK ? 'Stare locală & jurnal demo' : 'Stare sistem & jurnal',
    icon: Settings,
  },
];

function readCollapsePreference() {
  try {
    const stored = localStorage.getItem(COLLAPSE_PREFERENCE_KEY);
    if (stored === 'collapsed') return true;
    if (stored === 'expanded') return false;
  } catch {
    // No storage: the viewport decides.
  }
  return null;
}

function isPhoneViewport() {
  return window.matchMedia(PHONE_QUERY).matches;
}

/** A route belongs to one nav entry; the incident detail also lights up "Incidente". */
function navItemMatches(item, view) {
  if (item.id === view) return true;
  return Boolean(item.also?.includes(view));
}

/** Short age for the badge: "acum", "12m", "3h". */
function formatAge(minutes) {
  if (minutes === null) return '';
  if (minutes < 1) return 'acum';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/**
 * The attention signal: how many cases wait and how long the oldest one has waited.
 * A bare count cannot tell a fresh incident from a forgotten one; the age can.
 */
function AttentionBadge({ open, escalated, oldestMinutes }) {
  if (open === 0 && escalated === 0) return null;

  // Before the first escalation the signal must appear with the incident, not 30 s later.
  // Yellow = waiting; red = waiting for too long.
  if (escalated === 0) {
    const label = `${open} ${open === 1 ? 'incident deschis' : 'incidente deschise'}`;
    return (
      <span
        title={label}
        aria-label={label}
        className="flex shrink-0 items-center rounded-full bg-[#FFEB33] px-1.5 py-0.5 text-[10px] font-bold text-[#1F1F1F] shadow"
      >
        {open}
      </span>
    );
  }

  const age = formatAge(oldestMinutes);
  const total = open + escalated;
  const label = `${escalated} ${
    escalated === 1 ? 'incident escaladat' : 'incidente escaladate'
  }${age ? `, cel mai vechi ${age === 'acum' ? 'chiar acum' : `acum ${age}`}` : ''} · ${total} în total`;

  return (
    <span
      title={label}
      aria-label={label}
      className="flex shrink-0 items-stretch overflow-hidden rounded-full shadow ring-1 ring-[#D73833]/60"
    >
      <span className="flex items-center gap-1 bg-[#D73833] px-1.5 py-0.5 text-[10px] font-bold text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        {escalated}
      </span>
      {age && (
        <span className="flex items-center bg-[#1F1F1F] px-1.5 py-0.5 font-mono text-[9px] text-[#FF8A80]">
          {age}
        </span>
      )}
    </span>
  );
}

/** Footer card: says what is running, with the tag that qualifies it. */
function StatusCard({ title, tag, tagClass, children }) {
  return (
    <div className="space-y-1.5 rounded-xl border-2 border-[#7EDEED] bg-white p-2.5 text-[11px] shadow-sm dark:border-white/10 dark:bg-black/35">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <ShieldCheck size={16} className="text-amber-500 dark:text-[#FFEB33]" />
          <span className="font-black uppercase tracking-tight text-[#1F1F1F] dark:text-[#F5F5F5]">
            {title}
          </span>
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-sm ${tagClass}`}>
          {tag}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function Sidebar() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    currentView,
    setCurrentView,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    events,
    health,
  } = useSecurity();

  const edgeSeen = health?.edge_last_seen_s;
  const edgeActive = Boolean(health?.db && edgeSeen != null && edgeSeen < 60);
  const edgeLabel = edgeActive ? 'ACTIV' : edgeSeen == null ? 'FĂRĂ DATE' : 'ÎNTÂRZIAT';
  const edgeTagClass = edgeActive
    ? 'bg-emerald-600 text-white'
    : 'bg-[#FFEB33] font-black text-[#1F1F1F]';

  // Re-render every 30 s so the age of the oldest escalated case keeps moving.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const attention = useMemo(() => {
    const list = events || [];
    const open = list.filter((event) => event.status === 'open').length;
    const escalated = list.filter((event) => event.status === 'escalated');
    // Measured from detection, not escalation: how long the case waits, not how long the
    // alarm has been ringing.
    const oldest = escalated.reduce((earliest, event) => {
      const stamp = new Date(event.detected_at || event.escalated_at || 0).getTime();
      return Number.isFinite(stamp) && stamp > 0 ? Math.min(earliest, stamp) : earliest;
    }, Number.POSITIVE_INFINITY);
    return {
      open,
      escalated: escalated.length,
      oldestMinutes: Number.isFinite(oldest) ? Math.max(0, Math.round((now - oldest) / 60000)) : null,
    };
  }, [events, now]);

  // The state we imposed from the viewport. When the user toggles the rail, state no
  // longer matches it and we stop overriding their choice.
  const autoCollapsedRef = useRef(null);

  useEffect(() => {
    const stored = readCollapsePreference();
    if (stored !== null) {
      autoCollapsedRef.current = stored;
      setIsSidebarCollapsed(stored);
      return undefined;
    }

    const phone = window.matchMedia(PHONE_QUERY);
    const applyViewport = () => {
      if (autoCollapsedRef.current !== null && isSidebarCollapsed !== autoCollapsedRef.current) return;
      autoCollapsedRef.current = phone.matches;
      setIsSidebarCollapsed(phone.matches);
    };
    applyViewport();
    phone.addEventListener('change', applyViewport);
    return () => phone.removeEventListener('change', applyViewport);
  }, [isSidebarCollapsed, setIsSidebarCollapsed]);

  const edgeSuffix = edgeSeen == null ? 'edge fără date' : `edge acum ${Math.round(edgeSeen)}s`;

  const goToView = (viewId) => {
    setCurrentView(viewId);
    // The rail covers the screen on a phone: close it after choosing.
    if (isPhoneViewport()) setIsSidebarCollapsed(true);
  };

  const collapseRail = () => setIsSidebarCollapsed(true);

  return (
    <>
      {/* On a phone the rail covers the content, so a backdrop closes it by click: no
          need to hunt for the collapse button. */}
      {!isSidebarCollapsed && (
        <div
          aria-hidden="true"
          onClick={collapseRail}
          className="no-print fixed inset-x-0 bottom-0 top-16 z-30 bg-black/60 sm:hidden"
        />
      )}

      <aside
        aria-label="Navigare"
        style={{
          backgroundColor: isDarkMode ? themeStyles.navBg : '#FFFFFF',
          borderColor: themeStyles.navBorder,
          width: isSidebarCollapsed ? '0px' : '15rem',
        }}
        className={`no-print z-20 flex h-full shrink-0 select-none flex-col justify-between overflow-hidden border-r shadow-md transition-all duration-300 max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:top-16 max-sm:z-40 max-sm:h-auto ${
          isSidebarCollapsed ? 'border-r-0' : ''
        }`}
      >
        <nav aria-label="Module" className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2 py-3">
          <div className="space-y-1">
            {!isSidebarCollapsed && (
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Module Operaționale
              </p>
            )}

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = navItemMatches(item, currentView);
              const isWaiting = attention.open > 0 || attention.escalated > 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToView(item.id)}
                  style={{
                    backgroundColor: isActive ? (isDarkMode ? '#D73833' : '#7EDEED') : 'transparent',
                    color: isActive && isDarkMode ? '#FFFFFF' : themeStyles.textColor,
                  }}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all md:text-sm ${
                    isActive
                      ? 'font-bold shadow-md'
                      : isDarkMode
                        ? 'hover:bg-white/5'
                        : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title={item.label}
                >
                  <Icon size={19} className="shrink-0" />
                  {!isSidebarCollapsed && (
                    <span className="flex-1 truncate">
                      <span className="block truncate leading-tight">{item.label}</span>
                      <span
                        className={`mt-0.5 block truncate text-[10px] font-normal ${
                          isActive
                            ? isDarkMode
                              ? 'text-white/80'
                              : 'text-[#1F1F1F]/80'
                            : isDarkMode
                              ? 'text-slate-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {item.subtitle}
                      </span>
                    </span>
                  )}

                  {item.id === 'incidents' && isWaiting && (
                    <AttentionBadge
                      open={attention.open}
                      escalated={attention.escalated}
                      oldestMinutes={attention.oldestMinutes}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div
          style={{ borderColor: themeStyles.navBorder }}
          className="shrink-0 space-y-2 border-t bg-slate-50/90 p-2.5 dark:bg-black/15"
        >
          {!isSidebarCollapsed &&
            (USE_MOCK ? (
              // The static build has no backend, edge or ByteTrack. State exactly what
              // runs in the tab, so the footer cannot look like a live connection.
              <StatusCard
                title="Motor local"
                tag="STATIC"
                tagClass="bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200"
              >
                <p className="text-[10px] font-medium leading-tight text-slate-700 dark:text-slate-400">
                  YOLO26n + tracker local (IoU + distanță centru)
                </p>
                <p className="text-[10px] font-medium leading-tight text-slate-700 dark:text-slate-400">
                  Blur YuNet în tab · fără backend sau edge
                </p>
                <p className="font-mono text-[10px] leading-tight text-slate-600 dark:text-slate-400">
                  Capturile rămân în memorie, nu se încarcă
                </p>
              </StatusCard>
            ) : (
              <StatusCard title="Edge AI" tag={edgeLabel} tagClass={edgeTagClass}>
                <p className="text-[10px] font-medium leading-tight text-slate-700 dark:text-slate-400">
                  {health?.db ? 'Backend online' : 'Backend offline'} · {edgeSuffix}
                </p>
                <p className="font-mono text-[10px] leading-tight text-slate-600 dark:text-slate-400">
                  YOLO26 + ByteTrack • snapshot automat
                </p>
              </StatusCard>
            ))}

          <button
            type="button"
            onClick={collapseRail}
            title="Restrânge Meniul"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            {isSidebarCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <>
                <ChevronLeft size={16} />
                <span>Restrânge meniu</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
