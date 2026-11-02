import React from 'react';
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

function MainAppLayout() {
  const { themeStyles } = useTheme();
  const { currentView } = useSecurity();

  const renderActiveView = () => {
    switch (currentView) {
      case 'incidents':
        return <IncidentsListView />;
      case 'incident_detail':
        return <IncidentDetailView />;
      case 'zones':
        return <ZoneEditorView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      case 'lab':
        return <LabView />;
      case 'bench':
        return <BenchView />;
      case 'live':
      default:
        return <LiveView />;
    }
  };

  return (
    <div
      style={{
        backgroundColor: themeStyles.appBg,
        color: themeStyles.textColor
      }}
      className="h-screen w-screen flex flex-col overflow-hidden antialiased selection:bg-[#FFEB33] selection:text-[#1F1F1F]"
    >
      {/* 1. Header (Bara de Sus cu Brand LocalSight AI) */}
      <Header />

      {/* 2. Corp Principal (Sidebar Stânga + Conținut Activ din cele 6 Ecrane) */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative min-h-0">
          {renderActiveView()}
        </div>
      </div>

      {/* 3. Notificări Toast */}
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
