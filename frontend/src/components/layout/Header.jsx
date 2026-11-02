import React, { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Search,
  Moon,
  Sun,
  WifiOff,
  RefreshCw,
  Zap,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';

// Public assets are prefixed with the Vite base so the build also works from a
// repo subpath (GitHub Pages); same pattern as src/engine/detectors.js.
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;

// A name from localStorage can be any length (F7: 10 000 characters broke the header).
// Cap it for display only; the stored value is untouched.
const MAX_OPERATOR_NAME_CHARS = 80;

function displayOperatorName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_OPERATOR_NAME_CHARS);
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * A dropdown that closes on Escape and on a click outside its wrapper. The toggle button
 * lives inside the wrapper, so clicking it is "inside" and is handled by its own onClick.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, ref };
}

export default function Header() {
  const { isDarkMode, toggleTheme, themeStyles } = useTheme();
  const {
    searchQuery,
    setSearchQuery,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isWsConnected,
    isReconnecting,
    activeOperator,
    availableOperators,
    switchOperator,
    operatorName,
    setOperatorName,
    simulateIncomingWsEvent,
    toggleWsSimulation,
  } = useSecurity();

  const demoMenu = useMenu();
  const userMenu = useMenu();
  const searchRef = useRef(null);
  const [operatorDraft, setOperatorDraft] = useState(operatorName);
  const shownOperatorName = displayOperatorName(operatorName);

  useEffect(() => {
    setOperatorDraft(operatorName);
  }, [operatorName]);

  // `/` focuses the search from anywhere except a field; Escape clears it. Both are the
  // shortcuts an operator expects on a dashboard, and neither needs a new dependency.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === '/' && !isTypingTarget(event.target) && searchRef.current) {
        event.preventDefault();
        searchRef.current.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const commitOperator = () => {
    setOperatorName(operatorDraft);
  };

  const toggleDemoMenu = () => {
    demoMenu.setOpen((current) => !current);
    userMenu.setOpen(false);
  };

  const toggleUserMenu = () => {
    userMenu.setOpen((current) => !current);
    demoMenu.setOpen(false);
  };

  const menuSurface = {
    backgroundColor: isDarkMode ? '#282828' : '#FFFFFF',
    borderColor: isDarkMode ? 'rgba(255,255,255,0.15)' : '#E5E7EB',
    color: isDarkMode ? '#F5F5F5' : '#1F1F1F',
  };

  return (
    <header
      style={{
        backgroundColor: themeStyles.navBg || (isDarkMode ? '#181818' : '#FFFFFF'),
        borderColor: themeStyles.navBorder || (isDarkMode ? 'rgba(255, 255, 255, 0.10)' : '#E5E7EB'),
        color: isDarkMode ? '#F5F5F5' : '#1F1F1F',
      }}
      className="no-print h-16 px-2 sm:px-4 md:px-6 flex items-center justify-between gap-2 border-b shadow-md z-30 sticky top-0 shrink-0 select-none transition-colors"
    >
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center shrink-0"
          title={isSidebarCollapsed ? 'Deschide meniu navigare' : 'Restrânge meniu navigare'}
          aria-label="Comută meniu navigare"
          aria-expanded={!isSidebarCollapsed}
        >
          <Menu size={18} />
        </button>
        <img
          src={LOGO_SRC}
          alt="LocalSight"
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover shadow-md border border-white/20 shrink-0"
        />
        <div className="min-w-0">
          <h1 className="font-black text-base sm:text-xl tracking-tight leading-none uppercase drop-shadow-sm truncate">
            LocalSight
          </h1>
          <p className="hidden sm:block text-xs font-medium text-slate-400 tracking-wide mt-0.5 truncate">
            Management condiții siguranță
          </p>
        </div>
      </div>

      {/* C-10: only a real loss of signal is announced; mock builds stay quiet. */}
      {!isWsConnected && (
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[#D73833] text-white rounded-lg text-xs font-bold shadow-md animate-pulse">
          <WifiOff size={14} />
          <span>Semnal Edge Pierdut (Polling activat)</span>
          <button
            onClick={toggleWsSimulation}
            disabled={isReconnecting}
            className="ml-2 px-2.5 py-1 bg-black/40 hover:bg-black/60 rounded text-[10px] flex items-center gap-1.5 font-mono transition-colors"
          >
            <RefreshCw size={11} className={isReconnecting ? 'animate-spin' : ''} />
            {isReconnecting ? 'Se reconectează…' : 'Reconectează'}
          </button>
        </div>
      )}

      <div className="flex-1 max-w-xs md:max-w-sm mx-4 hidden sm:block">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (searchQuery) setSearchQuery('');
                else event.currentTarget.blur();
              }
            }}
            placeholder="Caută incidente"
            aria-label="Caută incidente"
            title="Caută în incidente (/)"
            className="w-full pl-10 pr-9 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 focus:bg-white/15 border border-white/10 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFEB33] transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
              title="Șterge căutarea"
              aria-label="Șterge căutarea"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 shrink-0">
        {/* Mock-only triggers; the real build uses the backend/edge ingest instead. */}
        {USE_MOCK && (
          <div className="relative" ref={demoMenu.ref}>
            <button
              onClick={toggleDemoMenu}
              aria-haspopup="menu"
              aria-expanded={demoMenu.open}
              className="px-2 sm:px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
              title="Generează evenimente de test (doar în modul mock)"
            >
              <Zap size={14} className="text-[#FFEB33] fill-[#FFEB33]" />
              <span className="hidden md:inline">Simulare</span>
              <ChevronDown size={12} className="opacity-80" />
            </button>

            {demoMenu.open && (
              <div
                role="menu"
                style={menuSurface}
                className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-xl border p-2 shadow-2xl space-y-1 text-xs z-50 font-sans"
              >
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b pb-1 mb-1">
                  Evenimente de test (mod mock)
                </div>
                {[
                  { type: 'RESTRICTED_ZONE', severity: 'CRITICAL', label: 'Persoană în Zonă Motor', tone: 'text-[#D73833] hover:bg-[#D73833]/15', chip: 'bg-[#D73833] text-white' },
                  { type: 'NO_PPE', severity: 'WARNING', label: 'Lucrător fără Vestă EIP', tone: 'text-amber-500 hover:bg-[#FFEB33]/15', chip: 'bg-[#FFEB33] text-[#1F1F1F]' },
                  { type: 'SMOKING', severity: 'WARNING', label: 'Fumat în Zonă Alimentare', tone: 'text-amber-500 hover:bg-[#FFEB33]/15', chip: 'bg-[#FFEB33] text-[#1F1F1F]' },
                  { type: 'CAMERA_OFFLINE', severity: 'WARNING', label: 'Camera Rampa Sud Offline', tone: 'text-slate-400 hover:bg-slate-500/10', chip: 'bg-slate-600 text-white' },
                ].map((item) => (
                  <button
                    key={item.type}
                    role="menuitem"
                    onClick={() => {
                      simulateIncomingWsEvent(item.type, item.severity);
                      demoMenu.setOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg font-bold flex items-center justify-between ${item.tone}`}
                  >
                    <span>{item.label}</span>
                    <span className={`text-[10px] font-mono px-1.5 rounded ${item.chip}`}>
                      {item.type === 'CAMERA_OFFLINE' ? 'OFFLINE' : item.severity}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={toggleTheme}
          style={{
            backgroundColor: isDarkMode ? '#282828' : '#F5F5F5',
            borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : '#E5E7EB',
          }}
          className="p-2 rounded-xl border transition-all text-xs flex items-center justify-center shadow-sm"
          title={isDarkMode ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată'}
          aria-label="Comută tema interfeței"
        >
          {isDarkMode ? <Sun size={16} className="text-[#FFEB33]" /> : <Moon size={16} className="text-[#1F1F1F]" />}
        </button>

        <div className="relative min-w-0" ref={userMenu.ref}>
          <button
            onClick={toggleUserMenu}
            aria-haspopup="menu"
            aria-expanded={userMenu.open}
            className="flex items-center gap-2 pl-1.5 sm:pl-2 pr-2 sm:pr-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition-all shadow-sm max-w-[calc(100vw-1rem)]"
            title="Schimbă operatorul activ"
          >
            <div
              style={{
                backgroundColor: isDarkMode ? '#D73833' : '#7EDEED',
                color: isDarkMode ? '#FFFFFF' : '#1F1F1F',
              }}
              className="w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shadow-inner shrink-0"
            >
              {operatorName?.[0]?.toUpperCase() || 'O'}
            </div>
            <div className="hidden lg:block text-left text-xs leading-tight min-w-0">
              <p className="font-bold flex items-center gap-1 min-w-0">
                <span className="truncate max-w-[10rem]" title={shownOperatorName}>
                  {shownOperatorName || 'Operator'}
                </span>
                <ChevronDown size={11} className="opacity-70 shrink-0" />
              </p>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                {activeOperator ? activeOperator.badge : 'OPERATOR'}
              </p>
            </div>
          </button>

          {userMenu.open && availableOperators && (
            <div
              role="menu"
              style={menuSurface}
              className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-xl border p-2 shadow-2xl space-y-1 text-xs z-50 font-sans"
            >
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b pb-1 mb-1">
                Rol
              </div>
              {availableOperators.map((op) => {
                const isSelected = activeOperator && op.id === activeOperator.id;
                return (
                  <button
                    key={op.id}
                    role="menuitemradio"
                    aria-checked={Boolean(isSelected)}
                    onClick={() => {
                      switchOperator(op.id);
                      userMenu.setOpen(false);
                    }}
                    style={{
                      backgroundColor: isSelected ? (isDarkMode ? '#D73833' : '#7EDEED') : 'transparent',
                      color: isSelected
                        ? (isDarkMode ? '#FFFFFF' : '#1F1F1F')
                        : (isDarkMode ? '#F5F5F5' : '#1F1F1F'),
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      isSelected ? 'font-bold shadow-sm' : isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100'
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-xs leading-none">{op.name}</p>
                      <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                        {op.role}
                      </p>
                    </div>
                    {isSelected && (
                      <Check size={14} className={isDarkMode ? 'text-white shrink-0' : 'text-[#1F1F1F] shrink-0'} />
                    )}
                  </button>
                );
              })}

              <div className="pt-2 border-t border-white/10 mt-1 space-y-1.5">
                <label
                  htmlFor="operator-name"
                  className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block px-1"
                >
                  Numele tău (apare în jurnal)
                </label>
                <input
                  id="operator-name"
                  type="text"
                  value={operatorDraft}
                  onChange={(event) => setOperatorDraft(event.target.value)}
                  onBlur={commitOperator}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitOperator();
                      userMenu.setOpen(false);
                    }
                  }}
                  className="w-full px-2.5 py-1 rounded text-xs bg-black/20 border border-white/20 focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                  placeholder="Ex: I. Popescu"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
