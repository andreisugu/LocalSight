import { useEffect, useRef, useState } from 'react';
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
import { IconButton, Panel, Pill } from '../ui';

// Public assets are prefixed with the Vite base so the build also works from a repo
// subpath (GitHub Pages); same rule as the engine assets.
const BRAND_LOGO = `${import.meta.env.BASE_URL}logo.svg`;

// A name restored from localStorage has no length limit (F7: 10 000 characters broke the
// header). Only the visible copy is capped; the stored value is left alone.
const NAME_PREVIEW_LIMIT = 80;

// Header control surfaces. The dark theme sits on a #181818 bar, so alpha-white
// utilities read as real controls there; on the white light bar they composite to
// 1.0:1 and disappear (WCAG 1.4.11). The light half is therefore an explicit slate
// border (#64748B = 4.76:1 on white) over a #F1F5F9 fill.
const CONTROL_SURFACE =
  'border-[#64748B] bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20';

// One quiet text token for operational metadata: 4.76:1 on the white bar and 5.75:1 on
// the dark one. `text-slate-400` on white was 2.56:1.
const META_TEXT = 'text-slate-500 dark:text-slate-400';

// The mock build has no edge ingest. These entries fabricate the same envelopes the
// backend would push, with the labels mockData already uses for the incident types.
// `tone` feeds the shared Pill; `itemClass` keeps the menu row's own hover colour.
const SIMULATED_EVENTS = [
  {
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    label: 'Persoană în Zonă Motor',
    badge: 'CRITICAL',
    tone: 'danger',
    itemClass: 'text-[#D73833] hover:bg-[#D73833]/15',
  },
  {
    type: 'NO_PPE',
    severity: 'WARNING',
    label: 'Lucrător fără Vestă EIP',
    badge: 'WARNING',
    tone: 'warning',
    itemClass: 'text-amber-700 hover:bg-[#FFEB33]/15 dark:text-amber-500',
  },
  {
    type: 'SMOKING',
    severity: 'WARNING',
    label: 'Fumat în Zonă Alimentare',
    badge: 'WARNING',
    tone: 'warning',
    itemClass: 'text-amber-700 hover:bg-[#FFEB33]/15 dark:text-amber-500',
  },
  {
    type: 'CAMERA_OFFLINE',
    severity: 'WARNING',
    label: 'Camera Rampa Sud Offline',
    badge: 'OFFLINE',
    tone: 'neutral',
    itemClass: 'text-slate-500 hover:bg-slate-500/10 dark:text-slate-400',
  },
];

// The menu heading is smaller than a panel title: it separates the menu label from the
// items without competing with them. `flex-1` makes the divider span the menu width.
const MENU_TITLE = `mb-1 flex-1 border-b px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${META_TEXT}`;

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
 *
 * The panel declares `role="menu"`, which promises arrow-key navigation. The wrapper
 * therefore moves focus between the items (APG menu button pattern) while Tab keeps its
 * normal behaviour; a text field inside the menu keeps its own cursor keys.
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
      if (event.key !== 'Escape') return;
      // APG: Escape from inside the menu returns focus to the trigger. Without this the
      // focused item unmounts and focus falls back to <body>.
      const trigger = containerRef.current?.querySelector('button[aria-haspopup="menu"]');
      if (trigger && containerRef.current?.contains(document.activeElement)) trigger.focus();
      setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const onKeyDown = (event) => {
    if (!isOpen || isTextField(event.target)) return;
    const items = Array.from(
      containerRef.current?.querySelectorAll('[role="menuitem"], [role="menuitemradio"]') || []
    ).filter((item) => !item.disabled);
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement);
    const focusAt = (index) => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };

    if (event.key === 'ArrowDown') focusAt(current + 1);
    else if (event.key === 'ArrowUp') focusAt(current < 0 ? items.length - 1 : current - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
  };

  return { isOpen, setOpen, containerRef, onKeyDown };
}

/** Search field plus its clear button; the `/` and Escape habits stay in Header. */
function SearchField({ inputRef, value, onChange, onClear }) {
  return (
    <div className="relative">
      <Search
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (value) onClear();
          else event.currentTarget.blur();
        }}
        placeholder="Caută incidente"
        aria-label="Caută incidente"
        title="Caută în incidente (/)"
        className={`w-full rounded-xl border py-2 pl-10 pr-9 text-xs shadow-inner transition-colors placeholder-slate-600 dark:placeholder-slate-400 ${CONTROL_SURFACE}`}
      />
      {value && (
        <IconButton
          icon={X}
          size="sm"
          label="Șterge căutarea"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-500 transition-colors hover:text-[#1F1F1F] dark:text-slate-400 dark:hover:text-white"
        />
      )}
    </div>
  );
}

/** Brand block: logo + product name + subtitle. */
function Brand() {
  return (
    <>
      <img
        src={BRAND_LOGO}
        alt="LocalSight"
        className="h-8 w-8 shrink-0 rounded-full border border-slate-400 object-cover shadow-md dark:border-white/20 sm:h-10 sm:w-10"
      />
      <div className="min-w-0">
        <h1 className="truncate text-base font-black uppercase leading-none tracking-tight drop-shadow-sm sm:text-xl">
          LocalSight
        </h1>
        <p className={`mt-0.5 hidden truncate text-xs font-medium tracking-wide sm:block ${META_TEXT}`}>
          Management condiții siguranță
        </p>
      </div>
    </>
  );
}

/** C-10: a real loss of signal only; the mock build never mounts this. */
function EdgeSignalBanner({ isReconnecting, onReconnect }) {
  return (
    <div className="hidden animate-pulse items-center gap-2 rounded-lg bg-[#D73833] px-3 py-1 text-xs font-bold text-white shadow-md lg:flex">
      <WifiOff size={14} className="shrink-0" />
      <span className="whitespace-nowrap">Semnal Edge Pierdut (Polling activat)</span>
      <button
        type="button"
        onClick={onReconnect}
        disabled={isReconnecting}
        className="ml-2 flex items-center gap-1.5 rounded bg-black/40 px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-black/60 disabled:opacity-70"
      >
        <RefreshCw size={11} className={isReconnecting ? 'animate-spin' : ''} />
        {isReconnecting ? 'Se reconectează…' : 'Reconectează'}
      </button>
    </div>
  );
}

/** One selectable role in the operator menu, including its selected surface. */
function RoleOption({ operator, selected, isDarkMode, themeStyles, onSelect }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        backgroundColor: selected ? (isDarkMode ? '#D73833' : '#7EDEED') : 'transparent',
        color: selected && isDarkMode ? '#FFFFFF' : themeStyles.textColor,
      }}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
        selected ? 'font-bold shadow-sm' : isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100'
      }`}
    >
      <span>
        <span className="block text-xs font-semibold leading-none">{operator.name}</span>
        <span
          className={`mt-0.5 block text-[10px] ${
            selected
              ? isDarkMode
                ? 'text-white/80'
                : 'text-[#1F1F1F]/70'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {operator.role}
        </span>
      </span>
      {selected && (
        <Check
          size={14}
          className={`shrink-0 ${isDarkMode ? 'text-white' : 'text-[#1F1F1F]'}`}
        />
      )}
    </button>
  );
}

/** The free-text name that lands in the audit log; Enter commits and closes the menu. */
function OperatorNameField({ borderColor, value, onChange, onCommit, onClose }) {
  return (
    <div style={{ borderTopColor: borderColor }} className="mt-1 space-y-1.5 border-t pt-2">
      <label
        htmlFor="operator-name"
        className={`block px-1 text-[10px] font-bold uppercase tracking-wider ${META_TEXT}`}
      >
        Numele tău (apare în jurnal)
      </label>
      <input
        id="operator-name"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          onCommit();
          onClose();
        }}
        placeholder="Ex: I. Popescu"
        className="w-full rounded border border-[#64748B] bg-white px-2.5 py-1 text-xs text-[#1F1F1F] placeholder-slate-600 dark:border-white/20 dark:bg-black/20 dark:text-slate-100 dark:placeholder-slate-400"
      />
    </div>
  );
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
        <IconButton
          icon={Menu}
          size="lg"
          label="Comută meniu navigare"
          title={isSidebarCollapsed ? 'Deschide meniu navigare' : 'Restrânge meniu navigare'}
          onClick={toggleRail}
          aria-expanded={!isSidebarCollapsed}
          className="rounded-xl border border-[#64748B] bg-slate-100 transition-colors hover:bg-slate-200 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20"
        />

        <Brand />
      </div>

      {!isWsConnected && (
        <EdgeSignalBanner isReconnecting={isReconnecting} onReconnect={toggleWsSimulation} />
      )}

      <div className="mx-4 hidden max-w-xs flex-1 sm:block md:max-w-sm">
        <SearchField
          inputRef={searchRef}
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={clearSearch}
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">
        {/* Mock-only triggers; the static build has no ingest path. */}
        {USE_MOCK && (
          <div className="relative" ref={simulationMenu.containerRef} onKeyDown={simulationMenu.onKeyDown}>
            <button
              type="button"
              onClick={toggleSimulationMenu}
              aria-haspopup="menu"
              aria-expanded={simulationMenu.isOpen}
              title="Generează evenimente de test (doar în modul mock)"
              className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-bold shadow-sm transition-colors sm:px-3 ${CONTROL_SURFACE}`}
            >
              <Zap size={14} className="fill-[#FFEB33] text-[#1F1F1F] dark:text-[#FFEB33]" />
              <span className="hidden md:inline">Simulare</span>
              <ChevronDown size={12} className="opacity-80" />
            </button>

            {simulationMenu.isOpen && (
              <Panel
                role="menu"
                aria-label="Evenimente de test"
                title="Evenimente de test (mod mock)"
                size="menu"
                titleClassName={MENU_TITLE}
                style={menuSurface}
                className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] shadow-2xl"
              >
                {SIMULATED_EVENTS.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    role="menuitem"
                    onClick={() => chooseSimulatedEvent(item.type, item.severity)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold ${item.itemClass}`}
                  >
                    <span>{item.label}</span>
                    <Pill tone={item.tone} shape="tag">
                      {item.badge}
                    </Pill>
                  </button>
                ))}
              </Panel>
            )}
          </div>
        )}

        <IconButton
          icon={isDarkMode ? Sun : Moon}
          size="md"
          label="Comută tema interfeței"
          title={isDarkMode ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată'}
          onClick={toggleTheme}
          // WCAG 4.1.2: the toggle exposes whether the dark theme is currently on,
          // instead of leaving the state only in a tooltip that touch users cannot open.
          aria-pressed={isDarkMode}
          iconClassName={isDarkMode ? 'text-[#FFEB33]' : 'text-[#1F1F1F]'}
          style={{
            backgroundColor: isDarkMode ? themeStyles.panelBg : '#F1F5F9',
            borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : '#64748B',
          }}
          className="rounded-xl border text-xs shadow-sm transition-all"
        />

        <div
          className="relative min-w-0"
          ref={operatorMenu.containerRef}
          onKeyDown={operatorMenu.onKeyDown}
        >
          <button
            type="button"
            onClick={toggleOperatorMenu}
            aria-haspopup="menu"
            aria-expanded={operatorMenu.isOpen}
            title="Schimbă operatorul activ"
            className={`flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2 shadow-sm transition-colors sm:pl-2 sm:pr-3 ${CONTROL_SURFACE}`}
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
              <span className="block truncate text-[10px] font-medium text-slate-600 dark:text-slate-400">
                {operatorBadge}
              </span>
            </span>
          </button>

          {operatorMenu.isOpen && availableOperators && (
            <Panel
              role="menu"
              aria-label="Operator activ"
              title="Rol"
              size="menu"
              titleClassName={MENU_TITLE}
              style={menuSurface}
              className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] shadow-2xl"
            >
              {availableOperators.map((operator) => (
                <RoleOption
                  key={operator.id}
                  operator={operator}
                  selected={activeOperator?.id === operator.id}
                  isDarkMode={isDarkMode}
                  themeStyles={themeStyles}
                  onSelect={() => chooseOperator(operator.id)}
                />
              ))}

              <OperatorNameField
                borderColor={menuSurface.borderColor}
                value={nameDraft}
                onChange={setNameDraft}
                onCommit={commitOperatorName}
                onClose={() => operatorMenu.setOpen(false)}
              />
            </Panel>
          )}
        </div>
      </div>
    </header>
  );
}
