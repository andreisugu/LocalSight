import React, { useEffect, useMemo, useState } from 'react';
import {
  Video,
  AlertOctagon,
  PenTool,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';

function formatAge(minutes) {
  if (minutes === null) return '';
  if (minutes < 1) return 'acum';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/**
 * Semnalul de atenție: câte cazuri așteaptă și de cât timp așteaptă cel mai vechi.
 * Un număr singur nu spune dacă e proaspăt sau uitat; vârsta o spune.
 */
function AttentionBadge({ open, escalated, oldestMinutes }) {
  if (open === 0 && escalated === 0) return null;

  // Fără escaladare încă: semnalul trebuie să apară când apare și incidentul, nu 30 s
  // mai târziu. Galben = așteaptă; roșu = așteaptă de prea mult.
  if (escalated === 0) {
    const tooltip = `${open} ${open === 1 ? 'incident deschis' : 'incidente deschise'}`;
    return (
      <span
        title={tooltip}
        aria-label={tooltip}
        className="shrink-0 flex items-center rounded-full bg-[#FFEB33] text-[#1F1F1F] text-[10px] font-bold px-1.5 py-0.5 shadow"
      >
        {open}
      </span>
    );
  }

  const age = formatAge(oldestMinutes);
  const total = open + escalated;
  const tooltip = `${escalated} ${escalated === 1 ? 'incident escaladat' : 'incidente escaladate'}${
    age ? `, cel mai vechi ${age === 'acum' ? 'chiar acum' : `acum ${age}`}` : ''
  } · ${total} ${total === 1 ? 'în total' : 'în total'}`;
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="flex items-stretch shrink-0 rounded-full overflow-hidden shadow ring-1 ring-[#D73833]/60"
    >
      <span className="flex items-center gap-1 bg-[#D73833] text-white text-[10px] font-bold px-1.5 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        {escalated}
      </span>
      {age && (
        <span className="flex items-center bg-[#1F1F1F] text-[#FF8A80] text-[9px] font-mono px-1.5 py-0.5">
          {age}
        </span>
      )}
    </span>
  );
}

export default function Sidebar() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    currentView,
    setCurrentView,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    kpis,
    events,
    health
  } = useSecurity();

  const edgeSeen = health?.edge_last_seen_s;
  const edgeActive = Boolean(health?.db && edgeSeen != null && edgeSeen < 60);
  const edgeLabel = edgeActive ? 'ACTIV' : edgeSeen == null ? 'FĂRĂ DATE' : 'ÎNTÂRZIAT';
  const edgeColor = edgeActive ? 'bg-emerald-600 text-white' : 'bg-[#FFEB33] text-[#1F1F1F] font-black';

  // Vârsta celui mai vechi incident escaladat, recalculată la 30 s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const attention = useMemo(() => {
    const list = events || [];
    const open = list.filter((event) => event.status === 'open').length;
    const escalated = list.filter((event) => event.status === 'escalated');
    const oldest = escalated.reduce((minimum, event) => {
      // De la detectare, nu de la escaladare: cât așteaptă cazul, nu de când sună alarma.
      const stamp = new Date(event.detected_at || event.escalated_at || 0).getTime();
      return Number.isFinite(stamp) && stamp > 0 ? Math.min(minimum, stamp) : minimum;
    }, Number.POSITIVE_INFINITY);
    return {
      open,
      escalated: escalated.length,
      oldestMinutes: Number.isFinite(oldest) ? Math.max(0, Math.round((Date.now() - oldest) / 60000)) : null,
    };
  }, [events]);

  // Ecranele principale ale aplicației LocalSight
  const menuItems = [
    {
      id: 'live',
      label: 'Live',
      subtitle: 'Monitorizare & Stream',
      icon: Video,
      // Numărul de incidente deschise stă pe „Incidente", unde se și acționează.
    },
    {
      id: 'incidents',
      label: 'Incidente',
      subtitle: 'Istoric, dovadă & raport',
      // The detail page belongs to this entry.
      also: ['incident_detail'],
      icon: AlertOctagon,
      // Cazurile care așteaptă, cu vârsta celui mai vechi: un număr singur nu spune
      // dacă e proaspăt sau uitat.
      attention: attention.open > 0 || attention.escalated > 0,
      attentionOpen: attention.open,
      attentionEscalated: attention.escalated,
      attentionAge: attention.oldestMinutes
    },
    {
      id: 'zones',
      label: 'Configurare Zone',
      subtitle: 'Poligoane & Cadru de referință',
      icon: PenTool
    },
    {
      id: 'reports',
      label: 'Rapoarte Tură',
      subtitle: 'Statistici & Export PDF',
      icon: FileText
    },
    {
      id: 'settings',
      label: 'Edge & Audit',
      subtitle: 'Stare sistem & jurnal',
      icon: Settings
    }
  ];

  return (
    <aside
      style={{
        backgroundColor: isDarkMode ? (themeStyles.navBg || '#181818') : '#FFFFFF',
        borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB',
        width: isSidebarCollapsed ? '0px' : '15rem'
      }}
      className={`no-print flex flex-col justify-between border-r transition-all duration-300 z-20 select-none shadow-md shrink-0 h-full overflow-hidden ${isSidebarCollapsed ? "border-r-0" : ""}`}
    >
      {/* Zona de Sus: Meniu Principal & Lista Categorisită de Feed-uri */}
      <div className="flex-1 py-3 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
        {/* Rubrici Principale */}
        <div className="space-y-1">
          {!isSidebarCollapsed && (
            <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Module Operaționale
            </div>
          )}

          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id || Boolean(item.also?.includes(currentView));

            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                style={{
                  backgroundColor: isActive
                    ? (isDarkMode ? '#D73833' : '#7EDEED')
                    : 'transparent',
                  color: isActive
                    ? (isDarkMode ? '#FFFFFF' : '#1F1F1F')
                    : (isDarkMode ? '#F5F5F5' : '#1F1F1F')
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all group text-left relative ${
                  isActive ? 'shadow-md font-bold' : (isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100 text-slate-700')
                }`}
                title={item.label}
              >
                <Icon size={19} className="shrink-0" />
                {!isSidebarCollapsed && (
                  <div className="flex-1 truncate">
                    <span className="block leading-tight truncate">{item.label}</span>
                    <p className={`text-[10px] font-normal truncate mt-0.5 ${isActive ? (isDarkMode ? 'text-white/80' : 'text-[#1F1F1F]/80') : (isDarkMode ? 'text-slate-400' : 'text-slate-500')}`}>
                      {item.subtitle}
                    </p>
                  </div>
                )}

                {item.attention && (
                  <AttentionBadge
                    open={item.attentionOpen}
                    escalated={item.attentionEscalated}
                    oldestMinutes={item.attentionAge}
                  />
                )}

                {/* Badge alerte deschise / escaladate */}
                {item.badge && (
                  <span
                    title={item.badgeTitle || undefined}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow shrink-0 ${
                      item.badgeCritical
                        ? 'bg-[#D73833] text-white animate-pulse'
                        : 'bg-[#FFEB33] text-[#1F1F1F] font-black'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

      </div>

      {/* Zona de Jos: Status Edge & Buton Minimizare (Fără textul "NAV") */}
      <div
        style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB' }}
        className="p-2.5 border-t space-y-2 shrink-0 bg-slate-50/90 dark:bg-black/15"
      >
        {!isSidebarCollapsed && (
          <div className="p-2.5 rounded-xl bg-white dark:bg-black/35 border-2 border-[#7EDEED] dark:border-white/10 text-[11px] space-y-1.5 shadow-sm">
            <div className="flex items-center justify-between font-black text-[#1F1F1F] dark:text-[#F5F5F5]">
              <span className="flex items-center gap-1.5 tracking-tight">
                <ShieldCheck size={16} className="text-amber-500 dark:text-[#FFEB33]" />
                <span className="font-black uppercase tracking-tight text-[#1F1F1F] dark:text-[#F5F5F5]">Edge AI</span>
              </span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow-sm ${edgeColor}`}>{edgeLabel}</span>
            </div>
            <p className="text-[10px] text-slate-700 dark:text-slate-400 leading-tight font-medium">
              {health?.db ? 'Backend online' : 'Backend offline'} · {edgeSeen == null ? 'edge fără date' : `edge acum ${Math.round(edgeSeen)}s`}
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight font-mono">
              YOLO26 + ByteTrack • snapshot automat
            </p>
          </div>
        )}

        <button
          onClick={() => setIsSidebarCollapsed(true)}
          className="w-full flex items-center justify-center gap-2 py-2 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 transition-all font-semibold text-xs shadow-sm"
          title="Restrânge Meniul"
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
  );
}
