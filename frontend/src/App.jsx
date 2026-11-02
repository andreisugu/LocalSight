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

function MainAppLayout() {
  const { themeStyles } = useTheme();
  const { currentView } = useSecurity();
  const scrollRef = useRef(null);

  // The previous screen owned the scroll position; opening an incident from a scrolled
  // list must not start halfway down the detail. The key on the scroller also discards
  // any nested scroll state, and focusing it lets a keyboard user continue from the new
  // view instead of from the sidebar.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, [currentView]);

  const ActiveView = VIEW_COMPONENTS[currentView] || LiveView;

  return (
    <div
      style={{
        backgroundColor: themeStyles.appBg,
        color: themeStyles.textColor,
      }}
      className="h-screen w-screen flex flex-col overflow-hidden antialiased selection:bg-[#FFEB33] selection:text-[#1F1F1F]"
    >
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div
          key={currentView}
          ref={scrollRef}
          tabIndex={-1}
          aria-label="Conținutul paginii"
          className="flex-1 overflow-y-auto overflow-x-hidden relative min-h-0 outline-none"
        >
          <ActiveView />
        </div>
      </div>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SecurityProvider>
        <MainAppLayout />
      </SecurityProvider>
    </ThemeProvider>
  );
}
