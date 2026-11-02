// The app store. Every screen reads it through `useSecurity()`.
//
// The provider is now a composition root and nothing else: state and behaviour live in
// focused hooks (`useRouting`, `useIncidentStore`, `useZoneStore`, `useOperator`, …), and
// everything that can be pure lives in `utils/` with node tests. This file only wires the
// hooks together, because they depend on each other: the incident list needs the camera and
// zone names to label an engine report, the socket needs the incident and KPI setters, and
// the bootstrap needs every setter at once.
//
// The public shape is frozen: the views destructure these keys, so a new module must not
// rename or remove one without changing every consumer.

import { createContext, useContext, useState } from 'react';
import { useBackendBootstrap } from './useBackendBootstrap.js';
import { useCameraStore } from './useCameraStore.js';
import { useConnectionHealth } from './useConnectionHealth.js';
import { useIncidentStore } from './useIncidentStore.js';
import { useKpis } from './useKpis.js';
import { useOperator } from './useOperator.js';
import { useRouting } from './useRouting.js';
import { useShiftReport } from './useShiftReport.js';
import { useSimulation } from './useSimulation.js';
import { useToast } from './useToast.js';
import { useZoneStore } from './useZoneStore.js';

// The default is null on purpose: `useSecurity` turns a missing provider into an error
// instead of handing components an empty object that fails later and further away.
const Store = createContext(null);

export const SecurityProvider = ({ children }) => {
  const { toastMessage, showToast } = useToast();
  const operator = useOperator({ showToast });

  const cameraStore = useCameraStore({ showToast });
  const zoneStore = useZoneStore({ showToast });
  const routing = useRouting();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // The incident list reads the camera and zone names when it decorates an engine event,
  // so it is created after both stores.
  const incidents = useIncidentStore({
    showToast,
    operatorName: operator.operatorName,
    cameras: cameraStore.cameras,
    zones: zoneStore.zones,
    selectedEventId: routing.selectedEventId,
    linkedIncidentId: routing.linkedIncidentId,
  });

  const { kpis, setKpis } = useKpis(incidents.events);

  const connection = useConnectionHealth({
    showToast,
    setEvents: incidents.setEvents,
    setKpis,
    setCameras: cameraStore.setCameras,
  });

  useBackendBootstrap({
    showToast,
    setCameras: cameraStore.setCameras,
    setSelectedCameraId: cameraStore.setSelectedCameraId,
    setEvents: incidents.setEvents,
    setSelectedEventId: routing.setSelectedEventId,
    setZones: zoneStore.setZones,
    setKpis,
    setHealth: connection.setHealth,
  });

  const report = useShiftReport({ showToast });

  const { simulateIncomingWsEvent } = useSimulation({
    showToast,
    setEvents: incidents.setEvents,
    setSelectedEventId: routing.setSelectedEventId,
  });

  // Which screens read which keys. Grouped so the frozen surface stays scannable.
  const navigation = {
    currentView: routing.currentView,
    setCurrentView: routing.setCurrentView,
    selectedEventId: routing.selectedEventId,
    setSelectedEventId: routing.setSelectedEventId,
  };
  const sidebar = {
    isSidebarCollapsed: sidebarCollapsed,
    setIsSidebarCollapsed: setSidebarCollapsed,
  };
  const operatorKeys = {
    operatorId: operator.operatorId,
    operatorName: operator.operatorName,
    setOperatorName: operator.setOperatorName,
    activeOperator: operator.activeOperator,
    availableOperators: operator.availableOperators,
    switchOperator: operator.switchOperator,
  };
  const cameraKeys = {
    cameras: cameraStore.cameras,
    selectedCameraId: cameraStore.selectedCameraId,
    setSelectedCameraId: cameraStore.setSelectedCameraId,
    activeCamera: cameraStore.activeCamera,
    toggleEngine: cameraStore.toggleEngine,
  };
  const incidentKeys = {
    events: incidents.events,
    filteredEvents: incidents.filteredEvents,
    selectedEvent: incidents.selectedEvent,
    filterMode: incidents.filterMode,
    setFilterMode: incidents.setFilterMode,
    searchQuery: incidents.searchQuery,
    setSearchQuery: incidents.setSearchQuery,
    acknowledgeEvent: incidents.acknowledgeEvent,
    markFalsePositive: incidents.markFalsePositive,
    reopenEvent: incidents.reopenEvent,
    regenerateReport: incidents.regenerateReport,
    addEngineEvents: incidents.addEngineEvents,
    // Additive key: the Settings panel is the only consumer. The frozen keys above are
    // untouched, so no existing screen changes.
    localEvidence: incidents.localEvidence,
  };
  const zoneKeys = {
    zones: zoneStore.zones,
    saveZone: zoneStore.saveZone,
    deleteZone: zoneStore.deleteZone,
    captureReferenceFrame: zoneStore.captureReferenceFrame,
    captureReferenceFromLive: zoneStore.captureReferenceFromLive,
    clearReferenceFrame: zoneStore.clearReferenceFrame,
  };
  const metricKeys = {
    kpis,
    shiftReport: report.shiftReport,
    selectedShift: report.selectedShift,
    setSelectedShift: report.setSelectedShift,
    selectedDate: report.selectedDate,
    setSelectedDate: report.setSelectedDate,
    regenerateShiftSummary: report.regenerateShiftSummary,
  };
  const connectionKeys = {
    health: connection.health,
    isWsConnected: connection.isWsConnected,
    setIsWsConnected: connection.setIsWsConnected,
    isReconnecting: connection.isReconnecting,
    toggleWsSimulation: connection.toggleWsSimulation,
    toastMessage,
    showToast,
    simulateIncomingWsEvent,
  };

  const value = {
    ...navigation,
    ...sidebar,
    ...operatorKeys,
    ...cameraKeys,
    ...incidentKeys,
    ...zoneKeys,
    ...metricKeys,
    ...connectionKeys,
  };

  return <Store.Provider value={value}>{children}</Store.Provider>;
};

export const useSecurity = () => {
  const store = useContext(Store);
  if (!store) throw new Error('useSecurity must be used within a SecurityProvider');
  return store;
};
