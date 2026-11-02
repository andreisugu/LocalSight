import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Sun,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';

// Public assets are prefixed with the Vite base so the build also works from a repo
// subpath (GitHub Pages); same rule as the engine assets.
const BRAND_LOGO = `${import.meta.env.BASE_URL}logo.svg`;

// A name restored from localStorage has no length limit (F7: 10 000 characters broke the
// header). Only the visible copy is capped; the stored value is left alone.
const NAME_PREVIEW_LIMIT = 80;

// The mock build has no edge ingest. These entries fabricate the same envelopes the
// backend would push, with the labels mockData already uses for the incident types.
const SIMULATED_EVENTS = [
  {
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    label: 'Persoană în Zonă Motor',
    badge: 'CRITICAL',
    itemClass: 'text-[#D73833] hover:bg-[#D73833]/15',
    badgeClass: 'bg-[#D73833] text-white',
  },
  {
    type: 'NO_PPE',
    severity: 'WARNING',
    label: 'Lucrător fără Vestă EIP',
    badge: 'WARNING',
    itemClass: 'text-amber-500 hover:bg-[#FFEB33]/15',
    badgeClass: 'bg-[#FFEB33] text-[#1F1F1F]',
  },
  {
    type: 'SMOKING',
    severity: 'WARNING',
    label: 'Fumat în Zonă Alimentare',
    badge: 'WARNING',
    itemClass: 'text-amber-500 hover:bg-[#FFEB33]/15',
    badgeClass: 'bg-[#FFEB33] text-[#1F1F1F]',
  },
  {
    type: 'CAMERA_OFFLINE',
    severity: 'WARNING',
    label: 'Camera Rampa Sud Offline',
    badge: 'OFFLINE',
    itemClass: 'text-slate-400 hover:bg-slate-500/10',
    badgeClass: 'bg-slate-600 text-white',
  },
];

function isTextField(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function previewOperatorName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_PREVIEW_LIMIT);
}

/**
 * Owns one dropdown's open flag and closes it on Escape or on a pointer down outside its
 * wrapper. The toggle button is inside the wrapper, so its own onClick is the only thing
 * that opens the menu — the outside listener never fires for it.
 */
function useDismissableMenu() {
  const [isOpen, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return { isOpen, setOpen, containerRef };
}

export default function Header() {
  const { isDarkMode, toggleTheme, themeStyles } = useTheme();
  const {
    activeOperator,
    availableOperators,
    isReconnecting,
    isSidebarCollapsed,
    isWsConnected,
    operatorName,
    searchQuery,
    setOperatorName,
    setSearchQuery,
    setIsSidebarCollapsed,
    simulateIncomingWsEvent,
    switchOperator,
    toggleWsSimulation,
  } = useSecurity();

  const simulationMenu = useDismissableMenu();
  const operatorMenu = useDismissableMenu();
  const searchRef = useRef(null);
  const [nameDraft, setNameDraft] = useState(operatorName);
  const shownOperatorName = previewOperatorName(operatorName);
  const avatarInitial = (operatorName || 'O').charAt(0).toUpperCase() || 'O';
  const operatorBadge = activeOperator ? activeOperator.badge : 'OPERATOR';

  // Switching the role resets the custom name in the provider; keep the draft in step.
  useEffect(() => {
    setNameDraft(operatorName);
  }, [operatorName]);

  // `/` focuses the search from anywhere but a text field; Escape inside the field clears
  // it. Both are dashboard habits and neither needs a dependency.
  useEffect(() => {
    const focusSearchOnSlash = (event) => {
      if (event.key !== '/' || isTextField(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', focusSearchOnSlash);
    return () => document.removeEventListener('keydown', focusSearchOnSlash);
  }, []);

  const commitOperatorName = () => setOperatorName(nameDraft);

  const toggleRail = () => setIsSidebarCollapsed(!isSidebarCollapsed);
  const clearSearch = () => setSearchQuery('');

  const chooseOperator = (operatorId) => {
    switchOperator(operatorId);
    operatorMenu.setOpen(false);
  };

  const chooseSimulatedEvent = (type, severity) => {
    simulateIncomingWsEvent(type, severity);
    simulationMenu.setOpen(false);
  };

  const toggleSimulationMenu = () => {
    simulationMenu.setOpen(!simulationMenu.isOpen);
    operatorMenu.setOpen(false);
  };

  const toggleOperatorMenu = () => {
    operatorMenu.setOpen(!operatorMenu.isOpen);
    simulationMenu.setOpen(false);
  };

  const menuSurface = {
    backgroundColor: isDarkMode ? themeStyles.panelBg : '#FFFFFF',
    borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : themeStyles.panelBorder,
    color: themeStyles.textColor,
  };

  return (
    <header
      style={{
        backgroundColor: themeStyles.navBg,
        borderColor: themeStyles.navBorder,
        color: themeStyles.textColor,
      }}
      className="no-print sticky top-0 z-30 flex h-16 shrink-0 select-none items-center gap-2 border-b px-2 shadow-md transition-colors sm:px-4 md:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <button
          type="button"
          onClick={toggleRail}
          title={isSidebarCollapsed ? 'Deschide meniu navigare' : 'Restrânge meniu navigare'}
          aria-label="Comută meniu navigare"
          aria-expanded={!isSidebarCollapsed}
          className="flex shrink-0 items-center justify-center rounded-xl bg-white/10 p-2 transition-colors hover:bg-white/20"
        >
          <Menu size={18} />
        </button>

        <img
          src={BRAND_LOGO}
          alt="LocalSight"
          className="h-8 w-8 shrink-0 rounded-full border border-white/20 object-cover shadow-md sm:h-10 sm:w-10"
        />

        <div className="min-w-0">
          <h1 className="truncate text-base font-black uppercase leading-none tracking-tight drop-shadow-sm sm:text-xl">
            LocalSight
          </h1>
          <p className="mt-0.5 hidden truncate text-xs font-medium tracking-wide text-slate-400 sm:block">
            Management condiții siguranță
          </p>
        </div>
      </div>

      {/* C-10: announce a real loss of signal only; the mock build is always connected. */}
      {!isWsConnected && (
        <div className="hidden animate-pulse items-center gap-2 rounded-lg bg-[#D73833] px-3 py-1 text-xs font-bold text-white shadow-md lg:flex">
          <WifiOff size={14} className="shrink-0" />
          <span className="whitespace-nowrap">Semnal Edge Pierdut (Polling activat)</span>
          <button
            type="button"
            onClick={toggleWsSimulation}
            disabled={isReconnecting}
            className="ml-2 flex items-center gap-1.5 rounded bg-black/40 px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-black/60 disabled:opacity-70"
          >
            <RefreshCw size={11} className={isReconnecting ? 'animate-spin' : ''} />
            {isReconnecting ? 'Se reconectează…' : 'Reconectează'}
          </button>
        </div>
      )}

      <div className="mx-4 hidden max-w-xs flex-1 sm:block md:max-w-sm">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              if (searchQuery) setSearchQuery('');
              else event.currentTarget.blur();
            }}
            placeholder="Caută incidente"
            aria-label="Caută incidente"
            title="Caută în incidente (/)"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-10 pr-9 text-xs shadow-inner transition-all placeholder-slate-400 hover:bg-white/10 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              title="Șterge căutarea"
              aria-label="Șterge căutarea"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition-colors hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">
        {/* Mock-only triggers; the real build gets its events from the backend ingest. */}
        {USE_MOCK && (
          <div className="relative" ref={simulationMenu.containerRef}>
            <button
              type="button"
              onClick={toggleSimulationMenu}
              aria-haspopup="menu"
              aria-expanded={simulationMenu.isOpen}
              title="Generează evenimente de test (doar în modul mock)"
              className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-2 py-1.5 text-xs font-bold shadow-sm transition-colors hover:bg-white/20 sm:px-3"
            >
              <Zap size={14} className="fill-[#FFEB33] text-[#FFEB33]" />
              <span className="hidden md:inline">Simulare</span>
              <ChevronDown size={12} className="opacity-80" />
            </button>

            {simulationMenu.isOpen && (
              <div
                role="menu"
                aria-label="Evenimente de test"
                style={menuSurface}
                className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] space-y-1 rounded-xl border p-2 font-sans text-xs shadow-2xl"
              >
                <p className="mb-1 border-b px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Evenimente de test (mod mock)
                </p>
                {SIMULATED_EVENTS.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    role="menuitem"
                    onClick={() => chooseSimulatedEvent(item.type, item.severity)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold ${item.itemClass}`}
                  >
                    <span>{item.label}</span>
                    <span className={`rounded px-1.5 font-mono text-[10px] ${item.badgeClass}`}>
                      {item.badge}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          style={{
            backgroundColor: isDarkMode ? themeStyles.panelBg : '#F5F5F5',
            borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : themeStyles.panelBorder,
          }}
          className="flex items-center justify-center rounded-xl border p-2 text-xs shadow-sm transition-all"
          title={isDarkMode ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată'}
          aria-label="Comută tema interfeței"
        >
          {isDarkMode ? (
            <Sun size={16} className="text-[#FFEB33]" />
          ) : (
            <Moon size={16} className="text-[#1F1F1F]" />
          )}
        </button>

        <div className="relative min-w-0" ref={operatorMenu.containerRef}>
          <button
            type="button"
            onClick={toggleOperatorMenu}
            aria-haspopup="menu"
            aria-expanded={operatorMenu.isOpen}
            title="Schimbă operatorul activ"
            className="flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-xl border border-white/20 bg-white/10 py-1.5 pl-1.5 pr-2 shadow-sm transition-all hover:bg-white/20 sm:pl-2 sm:pr-3"
          >
            <span
              style={{
                backgroundColor: isDarkMode ? '#D73833' : '#7EDEED',
                color: isDarkMode ? '#FFFFFF' : '#1F1F1F',
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold shadow-inner"
            >
              {avatarInitial}
            </span>
            <span className="hidden min-w-0 text-left text-xs leading-tight lg:block">
              <span className="flex items-center gap-1 font-bold">
                <span className="max-w-[10rem] truncate" title={shownOperatorName}>
                  {shownOperatorName || 'Operator'}
                </span>
                <ChevronDown size={11} className="shrink-0 opacity-70" />
              </span>
              <span className="block truncate text-[10px] font-medium text-slate-400">
                {operatorBadge}
              </span>
            </span>
          </button>

          {operatorMenu.isOpen && availableOperators && (
            <div
              role="menu"
              aria-label="Operator activ"
              style={menuSurface}
              className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] space-y-1 rounded-xl border p-2 font-sans text-xs shadow-2xl"
            >
              <p className="mb-1 border-b px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Rol
              </p>
              {availableOperators.map((operator) => {
                const isSelected = activeOperator?.id === operator.id;
                return (
                  <button
                    key={operator.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => chooseOperator(operator.id)}
                    style={{
                      backgroundColor: isSelected ? (isDarkMode ? '#D73833' : '#7EDEED') : 'transparent',
                      color: isSelected && isDarkMode ? '#FFFFFF' : themeStyles.textColor,
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isSelected
                        ? 'font-bold shadow-sm'
                        : isDarkMode
                          ? 'hover:bg-white/5'
                          : 'hover:bg-slate-100'
                    }`}
                  >
                    <span>
                      <span className="block text-xs font-semibold leading-none">{operator.name}</span>
                      <span
                        className={`mt-0.5 block text-[10px] ${
                          isSelected
                            ? isDarkMode
                              ? 'text-white/80'
                              : 'text-[#1F1F1F]/70'
                            : 'text-slate-400'
                        }`}
                      >
                        {operator.role}
                      </span>
                    </span>
                    {isSelected && (
                      <Check
                        size={14}
                        className={`shrink-0 ${isDarkMode ? 'text-white' : 'text-[#1F1F1F]'}`}
                      />
                    )}
                  </button>
                );
              })}

              <div
                style={{ borderTopColor: menuSurface.borderColor }}
                className="mt-1 space-y-1.5 border-t pt-2"
              >
                <label
                  htmlFor="operator-name"
                  className="block px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"
                >
                  Numele tău (apare în jurnal)
                </label>
                <input
                  id="operator-name"
                  type="text"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitOperatorName}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    commitOperatorName();
                    operatorMenu.setOpen(false);
                  }}
                  placeholder="Ex: I. Popescu"
                  className="w-full rounded border border-white/20 bg-black/20 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
