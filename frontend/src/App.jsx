import { useEffect, useRef } from 'react';
import { ThemeProvider as ThemeRoot, useTheme as useThemeContext } from './context/ThemeContext';
import { SecurityProvider, useSecurity as useSecurityContext } from './context/SecurityContext';
import StatusToast from './components/common/Toast';
import AppHeader from './components/layout/Header';
import AppSidebar from './components/layout/Sidebar';
import BenchScreen from './components/views/BenchView';
import IncidentDetailScreen from './components/views/IncidentDetailView';
import IncidentsListScreen from './components/views/IncidentsListView';
import LabScreen from './components/views/LabView';
import LiveScreen from './components/views/LiveView';
import ReportsScreen from './components/views/ReportsView';
import SettingsScreen from './components/views/SettingsView';
import ZoneEditorScreen from './components/views/ZoneEditorView';
// Route name -> screen. This map is the whole router: adding a view is one entry, and an
// unknown route falls back to Live instead of rendering a blank screen.
const SCREENS = new Map([
  ['incidents', IncidentsListScreen],
  ['incident_detail', IncidentDetailScreen],
  ['zones', ZoneEditorScreen],
  ['reports', ReportsScreen],
  ['settings', SettingsScreen],
  ['lab', LabScreen],
  ['bench', BenchScreen],
  ['live', LiveScreen],
]);
const FALLBACK_SCREEN = LiveScreen;
const SHELL_CLASSES =
  'flex h-screen w-screen flex-col overflow-hidden antialiased selection:bg-[#FFEB33] selection:text-[#1F1F1F]';
// Scroll position and focus belong to the route, not to each screen: the outlet is the one
// scroller, and the `key` discards a stale scroll offset the moment the route changes. The
// focus call hands a keyboard user the new screen instead of the rail they left.
const ScreenOutlet = ({ view, outletRef }) => {
  const Screen = SCREENS.get(view) ?? FALLBACK_SCREEN;
  return (
    <main
      id="main-content"
      key={view}
      ref={outletRef}
      tabIndex={-1}
      aria-label="Conținutul paginii"
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none">
      <Screen />
    </main>
  );
};
// Every route starts at the top. The very first paint keeps the natural focus order (skip
// link, header, rail, content), so only a later change moves focus into the outlet.
const useRouteReset = (view, outletRef) => {
  const firstPaint = useRef(true);
  useEffect(() => {
    const outlet = outletRef.current;
    if (!outlet) return;
    outlet.scrollTop = 0;
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    outlet.focus({ preventScroll: true });
  }, [view, outletRef]);
};
const AppLayout = () => {
  const { themeStyles } = useThemeContext();
  const { currentView } = useSecurityContext();
  const outletRef = useRef(null);
  useRouteReset(currentView, outletRef);
  const shellStyle = { backgroundColor: themeStyles.appBg, color: themeStyles.textColor };
  return <div style={shellStyle} className={SHELL_CLASSES}>
    {/* WCAG 2.4.1: the first Tab stop on every route, ahead of the header and the rail. */}
    <a href="#main-content" className="skip-link no-print">
      Sari la conținut
    </a>
    <AppHeader />
    <section aria-label="Zona de lucru" className="relative flex min-h-0 flex-1 overflow-hidden">
      <AppSidebar />
      <ScreenOutlet view={currentView} outletRef={outletRef} />
    </section>
    <StatusToast />
  </div>;
};
// Theme first, then security: the shell below reads both.
const Providers = ({ children }) => <ThemeRoot>
  <SecurityProvider>{children}</SecurityProvider>
</ThemeRoot>;
const App = () => <Providers><AppLayout /></Providers>;
export default App;
