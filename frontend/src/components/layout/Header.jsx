import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Menu, Moon, RefreshCw, Search, Sun, WifiOff, X, Zap } from 'lucide-react';
import { IconButton, Panel, Pill } from '../ui';
import { useSecurity as useSecurityContext } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import { USE_MOCK } from '../../services/api';
// The logo comes from the Vite base, so the header also works when the app is deployed
// under a repo subpath (GitHub Pages) rather than the domain root.

const BRAND_LOGO = `${import.meta.env.BASE_URL}logo.svg`;

// localStorage has no length cap: a restored 10 000-character name used to break the bar
// (F7). Only the visible copy is clipped; the stored value stays as the operator left it.
const NAME_PREVIEW_LIMIT = 80;

// Control surfaces. On the #181818 dark bar the alpha-white utilities read as real
// controls; on the white light bar they composite to 1.0:1 and disappear (WCAG 1.4.11).
// The light palette is therefore explicit: a #64748B border (4.76:1 on white) over a
// #F1F5F9 fill.
const CONTROL_SKIN =
  'border-[#64748B] bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20';

// One quiet ink token for operational metadata: 4.76:1 on the light bar and 5.75:1 on the
// dark one. `text-slate-400` on white was only 2.56:1.
const META_INK = 'text-slate-500 dark:text-slate-400';

// Mock build only: the same envelopes the backend would push, carrying the labels
// mockData already uses for the incident types. `tone` feeds the shared Pill and
// `itemClass` keeps each row's own hover colour.
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
// items without competing with them. `flex-1` lets the divider span the whole menu.
const MENU_HEADING = `mb-1 flex-1 border-b px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${META_INK}`;

function isTextField(node) {
  if (!node) return false;
  const { tagName } = node;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || node.isContentEditable;
}

function clipOperatorName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, NAME_PREVIEW_LIMIT);
}

/**
 * One dropdown's open flag, closed on Escape or on a pointer down outside its wrapper.
 * The toggle lives inside the wrapper, so only its own onClick opens the menu and the
 * outside listener never fires for it.
 *
 * The panel declares `role="menu"`, which promises arrow-key navigation, so this hook
 * moves focus between the items (APG menu-button pattern). Tab keeps its normal
 * behaviour and a text field inside the menu keeps its own cursor keys.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnPointer = (event) => {
      if (!anchorRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      // APG: Escape from inside the menu returns focus to the trigger; otherwise the
      // focused item unmounts and focus falls back to <body>.
      const trigger = anchorRef.current?.querySelector('button[aria-haspopup="menu"]');
      if (trigger && anchorRef.current?.contains(document.activeElement)) trigger.focus();
      setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const handleKeyDown = (event) => {
    if (!open || isTextField(event.target)) return;
    const items = Array.from(
      anchorRef.current?.querySelectorAll('[role="menuitem"], [role="menuitemradio"]') || []
    ).filter((entry) => !entry.disabled);
    if (items.length === 0) return;

    const at = items.indexOf(document.activeElement);
    const moveTo = (index) => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };

    if (event.key === 'ArrowDown') moveTo(at + 1);
    else if (event.key === 'ArrowUp') moveTo(at < 0 ? items.length - 1 : at - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(items.length - 1);
  };

  return { open, setOpen, anchorRef, handleKeyDown };
}

/**
 * Both dropdown triggers share one button contract: the menu ARIA attributes, the
 * chevron and the control skin. `label` is the text that collapses under `md`; `icon`
 * and children carry the rest of the row.
 */
function MenuTrigger({ expanded, title, skin, onClick, icon = null, label = null, children = null }) {
  const attrs = {
    type: 'button',
    onClick,
    'aria-haspopup': 'menu',
    'aria-expanded': expanded,
    title,
    className: skin,
  };
  const text = label ? <span className="hidden md:inline">{label}</span> : null;
  return <button {...attrs}>{icon}{text}{children}</button>;
}

/** Search input plus its clear button; the `/` habit and Escape stay in Header. */
function HeaderSearch({ fieldRef, query, onQueryChange, onReset }) {
  return (
    <div className="relative">
      <Search
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
      />
      <input
        ref={fieldRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (query) onReset();
          else event.currentTarget.blur();
        }}
        placeholder="Caută incidente"
        aria-label="Caută incidente"
        title="Caută în incidente (/)"
        className={`w-full rounded-xl border py-2 pl-10 pr-9 text-xs shadow-inner transition-colors placeholder-slate-600 dark:placeholder-slate-400 ${CONTROL_SKIN}`}
      />
      {query ? (
        <IconButton
          icon={X}
          size="sm"
          label="Șterge căutarea"
          onClick={onReset}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-500 transition-colors hover:text-[#1F1F1F] dark:text-slate-400 dark:hover:text-white"
        />
      ) : null}
    </div>
  );
}

/** Brand block: logo, product name and subtitle. */
function BrandMark() {
  return (
    <>
      <img
        src={BRAND_LOGO}
        alt="LocalSight"
        className="h-8 w-8 shrink-0 rounded-full border border-slate-400 object-cover shadow-md dark:border-white/20 sm:h-10 sm:w-10"
      />
      <div className="min-w-0">
        <h1 data-testid="app-title" className="truncate text-base font-black uppercase leading-none tracking-tight drop-shadow-sm sm:text-xl">
          LocalSight
        </h1>
        <p className={`mt-0.5 hidden truncate text-xs font-medium tracking-wide sm:block ${META_INK}`}>
          Management condiții siguranță
        </p>
      </div>
    </>
  );
}

/** C-10: only a real loss of signal; the mock build never mounts this. */
function EdgeLostBanner({ retrying, onRetry }) {
  return (
    <div className="hidden animate-pulse items-center gap-2 rounded-lg bg-[#D73833] px-3 py-1 text-xs font-bold text-white shadow-md lg:flex">
      <WifiOff size={14} className="shrink-0" />
      <span className="whitespace-nowrap">Semnal Edge Pierdut (Polling activat)</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="ml-2 flex items-center gap-1.5 rounded bg-black/40 px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-black/60 disabled:opacity-70"
      >
        <RefreshCw size={11} className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Se reconectează…' : 'Reconectează'}
      </button>
    </div>
  );
}

/** One selectable role in the operator menu, including its selected surface. */
function RoleChoice({ person, active, dark, palette, onPick }) {
  const surface = {
    backgroundColor: active ? (dark ? '#D73833' : '#7EDEED') : 'transparent',
    color: active && dark ? '#FFFFFF' : palette.textColor,
  };
  const roleInk = active
    ? dark
      ? 'text-white/80'
      : 'text-[#1F1F1F]/70'
    : 'text-slate-500 dark:text-slate-400';

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onPick}
      style={surface}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
        active ? 'font-bold shadow-sm' : dark ? 'hover:bg-white/5' : 'hover:bg-slate-100'
      }`}
    >
      <span>
        <span className="block text-xs font-semibold leading-none">{person.name}</span>
        <span className={`mt-0.5 block text-[10px] ${roleInk}`}>{person.role}</span>
      </span>
      {active && (
        <Check size={14} className={`shrink-0 ${dark ? 'text-white' : 'text-[#1F1F1F]'}`} />
      )}
    </button>
  );
}

/** The free-text name that lands in the audit log; Enter commits and closes the menu. */
function NameEntry({ ruleColor, draft, onDraftChange, onCommit, onDismiss }) {
  return (
    <div style={{ borderTopColor: ruleColor }} className="mt-1 space-y-1.5 border-t pt-2">
      <label
        htmlFor="operator-name"
        className={`block px-1 text-[10px] font-bold uppercase tracking-wider ${META_INK}`}
      >
        Numele tău (apare în jurnal)
      </label>
      <input
        id="operator-name"
        type="text"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          onCommit();
          onDismiss();
        }}
        placeholder="Ex: I. Popescu"
        className="w-full rounded border border-[#64748B] bg-white px-2.5 py-1 text-xs text-[#1F1F1F] placeholder-slate-600 dark:border-white/20 dark:bg-black/20 dark:text-slate-100 dark:placeholder-slate-400"
      />
    </div>
  );
}

/** One mock-event row: label on the left, severity badge on the right. */
function SimulatedEvent({ entry, onPick }) {
  return <button type="button" role="menuitem" onClick={() => onPick(entry.type, entry.severity)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold ${entry.itemClass}`}>
    <span>{entry.label}</span>
    <Pill tone={entry.tone} shape="tag">
      {entry.badge}
    </Pill>
  </button>;
}

/** Mock-only event list and its menu; the static build has no ingest path. */
function SimulationMenu({ menu, surface, onToggle, onPick }) {
  const items = SIMULATED_EVENTS.map((entry) => (
    <SimulatedEvent key={entry.type} entry={entry} onPick={onPick} />
  ));
  const panel = menu.open ? (
    <Panel
      role="menu"
      aria-label="Evenimente de test"
      title="Evenimente de test (mod mock)"
      size="menu"
      titleClassName={MENU_HEADING}
      style={surface}
      className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] shadow-2xl">
      {items}
    </Panel>
  ) : null;
  return <div className="relative" ref={menu.anchorRef} onKeyDown={menu.handleKeyDown}>
    <MenuTrigger
      expanded={menu.open}
      title="Generează evenimente de test (doar în modul mock)"
      skin={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-bold shadow-sm transition-colors sm:px-3 ${CONTROL_SKIN}`}
      onClick={onToggle}
      icon={<Zap size={14} className="fill-[#FFEB33] text-[#1F1F1F] dark:text-[#FFEB33]" />}
      label="Simulare"
    >
      <ChevronDown size={12} aria-hidden="true" className="opacity-80" />
    </MenuTrigger>
    {panel}
  </div>;
}
/** Theme switch: the icon and the pressed state both reflect the current theme. */
function ThemeSwitch({ dark, palette, onToggle }) {
  const skin = {
    backgroundColor: dark ? palette.panelBg : '#F1F5F9',
    borderColor: dark ? 'rgba(255, 255, 255, 0.15)' : '#64748B',
  };
  return <IconButton
    icon={dark ? Sun : Moon}
    size="md"
    label="Comută tema interfeței"
    title={dark ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată'}
    onClick={onToggle}
    // WCAG 4.1.2: expose whether the dark theme is on, instead of leaving the state
    // only in a tooltip that touch users cannot open.
    aria-pressed={dark}
    iconClassName={dark ? 'text-[#FFEB33]' : 'text-[#1F1F1F]'}
    style={skin}
    className="rounded-xl border text-xs shadow-sm transition-all"
  />;
}

/** Operator trigger, role list and the audit-log name field. */
function OperatorMenu({
  menu,
  roster,
  current,
  operatorLabel,
  dark,
  palette,
  surface,
  draft,
  onToggle,
  onDraftChange,
  onCommit,
  onPick,
}) {
  const preview = clipOperatorName(operatorLabel);
  const initial = (operatorLabel || 'O').charAt(0).toUpperCase() || 'O';
  const badge = current ? current.badge : 'OPERATOR';
  const avatarSkin = {
    backgroundColor: dark ? '#D73833' : '#7EDEED',
    color: dark ? '#FFFFFF' : '#1F1F1F',
  };
  const roles = roster.map((person) => (
    <RoleChoice
      key={person.id}
      person={person}
      active={current?.id === person.id}
      dark={dark}
      palette={palette}
      onPick={() => onPick(person.id)}
    />
  ));
  const nameField = {
    ruleColor: surface.borderColor,
    draft,
    onDraftChange,
    onCommit,
    onDismiss: () => menu.setOpen(false),
  };
  const panel = menu.open && roster ? (
    <Panel
      role="menu"
      aria-label="Operator activ"
      title="Rol"
      size="menu"
      titleClassName={MENU_HEADING}
      style={surface}
      className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] shadow-2xl"
    >
      {roles}
      <NameEntry {...nameField} />
    </Panel>
  ) : null;

  const avatar = (
    <span style={avatarSkin} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold shadow-inner">
      {initial}
    </span>
  );

  return (
    <div className="relative min-w-0" ref={menu.anchorRef} onKeyDown={menu.handleKeyDown}>
      <MenuTrigger
        expanded={menu.open}
        title="Schimbă operatorul activ"
        skin={`flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2 shadow-sm transition-colors sm:pl-2 sm:pr-3 ${CONTROL_SKIN}`}
        onClick={onToggle}
        icon={avatar}
      >
        <span className="hidden min-w-0 text-left text-xs leading-tight lg:block">
          <span className="flex items-center gap-1 font-bold">
            <span className="max-w-[10rem] truncate" title={preview}>
              {preview || 'Operator'}
            </span>
            <ChevronDown size={11} className="shrink-0 opacity-70" />
          </span>
          <span className="block truncate text-[10px] font-medium text-slate-600 dark:text-slate-400">
            {badge}
          </span>
        </span>
      </MenuTrigger>
      {panel}
    </div>
  );
}

/** The right-hand cluster: mock trigger, theme switch and operator picker. */
function HeaderActions({ children }) {
  return <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">{children}</div>;
}

const Header = () => {
  const { isDarkMode: dark, toggleTheme, themeStyles: palette } = useTheme();
  const {
    activeOperator: currentOperator,
    availableOperators: roster,
    isReconnecting: edgeRetrying,
    isSidebarCollapsed: railCollapsed,
    isWsConnected: edgeConnected,
    operatorName: operatorLabel,
    searchQuery: query,
    setOperatorName: saveOperatorName,
    setSearchQuery: updateQuery,
    setIsSidebarCollapsed: setRailCollapsed,
    simulateIncomingWsEvent: pushMockEvent,
    switchOperator: activateOperator,
    toggleWsSimulation: retryEdge,
  } = useSecurityContext();

  const simulation = useMenu();
  const operator = useMenu();
  const searchRef = useRef(null);
  const [draftName, setDraftName] = useState(operatorLabel);

  // Switching the role resets the custom name in the provider; keep the draft in step.
  useEffect(() => {
    setDraftName(operatorLabel);
  }, [operatorLabel]);

  // `/` focuses the search from anywhere but a text field. A dashboard habit with no
  // dependency behind it.
  useEffect(() => {
    const focusOnSlash = (event) => {
      if (event.key !== '/' || isTextField(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', focusOnSlash);
    return () => document.removeEventListener('keydown', focusOnSlash);
  }, []);

  // The dark bar sits on #181818, so its menus need the panel surface explicitly.
  const menuSurface = {
    backgroundColor: dark ? palette.panelBg : '#FFFFFF',
    borderColor: dark ? 'rgba(255, 255, 255, 0.15)' : palette.panelBorder,
    color: palette.textColor,
  };

  const showSimulation = () => {
    simulation.setOpen(!simulation.open);
    operator.setOpen(false);
  };

  const showOperators = () => {
    operator.setOpen(!operator.open);
    simulation.setOpen(false);
  };

  const pickSimulatedEvent = (type, severity) => {
    pushMockEvent(type, severity);
    simulation.setOpen(false);
  };

  const pickOperator = (operatorId) => {
    activateOperator(operatorId);
    operator.setOpen(false);
  };

  return <header
      style={{
        backgroundColor: palette.navBg,
        borderColor: palette.navBorder,
        color: palette.textColor,
      }}
      className="no-print sticky top-0 z-30 flex h-16 shrink-0 select-none items-center gap-2 border-b px-2 shadow-md transition-colors sm:px-4 md:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <IconButton
          icon={Menu}
          size="lg"
          label="Comută meniu navigare"
          title={railCollapsed ? 'Deschide meniu navigare' : 'Restrânge meniu navigare'}
          onClick={() => setRailCollapsed(!railCollapsed)}
          aria-expanded={!railCollapsed}
          className="rounded-xl border border-[#64748B] bg-slate-100 transition-colors hover:bg-slate-200 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20"
        />

        <BrandMark />
      </div>

      {!edgeConnected && <EdgeLostBanner retrying={edgeRetrying} onRetry={retryEdge} />}

      <div className="mx-4 hidden max-w-xs flex-1 sm:block md:max-w-sm">
        <HeaderSearch
          fieldRef={searchRef}
          query={query}
          onQueryChange={updateQuery}
          onReset={() => updateQuery('')}
        />
      </div>

      <HeaderActions>
        {USE_MOCK && (
          <SimulationMenu
            menu={simulation}
            surface={menuSurface}
            onToggle={showSimulation}
            onPick={pickSimulatedEvent}
          />
        )}

        <ThemeSwitch dark={dark} palette={palette} onToggle={toggleTheme} />

        <OperatorMenu
          menu={operator}
          roster={roster}
          current={currentOperator}
          operatorLabel={operatorLabel}
          dark={dark}
          palette={palette}
          surface={menuSurface}
          draft={draftName}
          onToggle={showOperators}
          onDraftChange={setDraftName}
          onCommit={() => saveOperatorName(draftName)}
          onPick={pickOperator}
        />
      </HeaderActions>
    </header>;
};

export default Header;
