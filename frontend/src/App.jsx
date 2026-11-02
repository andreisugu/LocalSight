import React, { useEffect, useRef } from 'react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { SecurityProvider, useSecurity } from './context/SecurityContext';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import LiveView from './components/views/LiveView';
import IncidentDetailView from './components/views/IncidentDetailView';
import IncidentsListView from './components/views/IncidentsListView';
import ZoneEditorView from './components/views/ZoneEditorView';
import ReportsView from './components/views/ReportsView';
import SettingsView from './components/views/SettingsView';
import LabView from './components/views/LabView';
import BenchView from './components/views/BenchView';
import Toast from './components/common/Toast';

// One map instead of a switch: adding a view is one line, and the fallback stays Live.
const VIEW_COMPONENTS = {
  incidents: IncidentsListView,
  incident_detail: IncidentDetailView,
  zones: ZoneEditorView,
  reports: ReportsView,
  settings: SettingsView,
  lab: LabView,
  bench: BenchView,
  live: LiveView,
};

/**
 * The scroll container owns the view's scroll position. The key discards nested scroll
 * state when the route changes; the focus moves a keyboard user to the new view instead of
 * leaving them in the sidebar. Keeping this in one component makes the reset contract
 * obvious next to the element it applies to.
 */
function ScreenOutlet({ view, contentRef }) {
  const Screen = VIEW_COMPONENTS[view] || LiveView;

  return (
    <main
      key={view}
      ref={contentRef}
      tabIndex={-1}
      aria-label="Conținutul paginii"
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
    >
      <Screen />
    </main>
  );
}

function AppShell() {
  const { themeStyles } = useTheme();
  const { currentView } = useSecurity();
  const contentRef = useRef(null);

  // The previous screen owned the scroll position; opening an incident from a scrolled
  // list must not start halfway down the detail.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.scrollTop = 0;
    content.focus({ preventScroll: true });
  }, [currentView]);

  return (
    <div
      style={{ backgroundColor: themeStyles.appBg, color: themeStyles.textColor }}
      className="flex h-screen w-screen flex-col overflow-hidden antialiased selection:bg-[#FFEB33] selection:text-[#1F1F1F]"
    >
      <Header />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <ScreenOutlet view={currentView} contentRef={contentRef} />
      </div>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SecurityProvider>
        <AppShell />
      </SecurityProvider>
    </ThemeProvider>
  );
}
