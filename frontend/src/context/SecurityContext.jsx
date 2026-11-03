// The app store. Every screen reads it through `useSecurity()`.
//
// The provider is a composition root and nothing else: state and behaviour live in
// focused hooks (`useRouting`, `useIncidentStore`, `useZoneStore`, `useOperator`, …), and
// everything that can be pure lives in `utils/` with node tests. This file only wires the
// hooks together, because they depend on each other: the incident list needs the camera and
// zone names to label an engine report, the socket needs the incident and KPI setters, and
// the bootstrap needs every setter at once.
//
// The public shape is frozen: the views destructure these keys, so a new module must not
// rename or remove one without changing every consumer.
import { createContext, useCallback, useContext, useState } from 'react';
import { useBackgroundCameras } from './useBackgroundCameras.js';
import { useBackendBootstrap } from './useBackendBootstrap.js';
import { useCameraStore } from './useCameraStore.js';
import { useConnectionHealth } from './useConnectionHealth.js';
import useCoverageSamples from './useCoverageSamples.js';
import { useIncidentStore } from './useIncidentStore.js';
import { useKpis } from './useKpis.js';
import { useOperator } from './useOperator.js';
import { useRouting } from './useRouting.js';
import { useShiftReport } from './useShiftReport.js';
import { useSimulation } from './useSimulation.js';
import { useToast } from './useToast.js';
import useWebhookNotifications from './useWebhookNotifications.js';
import { useZoneStore } from './useZoneStore.js';
import { initialShowDemoData, storeShowDemoData } from '../utils/demoPreference.js';
import { readWebhookSettings, storeWebhookSettings } from '../utils/webhook.js';
// The base the webhook message points at. `BASE_URL` ends with a slash, and the message
// appends `incidents`; the origin makes the text usable outside this tab.
const APP_BASE = import.meta.env.BASE_URL || '/';
const WEBHOOK_APP_URL = typeof window === 'undefined'
  ? APP_BASE
  : `${window.location.origin}${APP_BASE}`;
// The default is null on purpose: `useSecurity` turns a missing provider into an error
// instead of handing components an empty object that fails later and further away.
const Store = createContext(null);
/** Flattens the named key groups into the one object the provider hands out. */
function flattenGroups(groups) {
  return groups.reduce((flat, group) => Object.assign(flat, group), {});
}
/**
 * Every input the incident store takes, named once. The store reads camera and zone names
 * to label an engine report, so it has to be created after both of them.
 */
function incidentStoreInput({ showToast, operator, cameraStore, zoneStore, routing, showDemoData }) {
  return {
    showToast,
    operatorName: operator.operatorName,
    cameras: cameraStore.cameras,
    zones: zoneStore.zones,
    selectedEventId: routing.selectedEventId,
    linkedIncidentId: routing.linkedIncidentId,
    showDemoData,
  };
}
/**
 * Builds the store value from the focused hooks. Kept out of the provider component so the
 * render below is one line and the wiring reads top to bottom: stores first, then the
 * derived hooks that consume them, then the key groups.
 */
function useStoreValue() {
  const { toastMessage, showToast } = useToast();
  const operator = useOperator({ showToast });
  const cameraStore = useCameraStore({ showToast });
  const zoneStore = useZoneStore({ showToast });
  const routing = useRouting();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Which camera the Live view is really feeding to its browser engine, not just which one
  // is selected. `null` means "Live owns nothing right now" (another screen, engine off,
  // fullscreen), so the background manager may process every camera.
  const [liveEngineCameraId, setLiveEngineCameraId] = useState(null);
  const reportActiveCamera = useCallback((cameraId) => {
    setLiveEngineCameraId(typeof cameraId === 'string' && cameraId ? cameraId : null);
  }, []);
  // Real detections by default; the eight demo fixtures are one explicit choice away and
  // that choice survives a reload. The setter is the only writer, so the stored value and
  // the rendered one cannot drift.
  const [showDemoData, setShowDemoDataState] = useState(() => initialShowDemoData());
  const setShowDemoData = useCallback((next) => {
    const value = Boolean(next);
    storeShowDemoData(value);
    setShowDemoDataState(value);
  }, []);
  const incidents = useIncidentStore(
    incidentStoreInput({ showToast, operator, cameraStore, zoneStore, routing, showDemoData })
  );
  // Opt-in webhook notifications. The setting lives in localStorage, the notifier only
  // looks at real engine incidents and is idle while the option is off. Additive: no
  // existing key changes and no screen is required to read these.
  const [webhookSettings, setWebhookSettingsState] = useState(() => readWebhookSettings());
  const setWebhookSettings = useCallback((patch) => {
    setWebhookSettingsState(storeWebhookSettings(patch));
  }, []);
  const webhook = useWebhookNotifications({
    events: incidents.events,
    settings: webhookSettings,
    appUrl: WEBHOOK_APP_URL,
  });
  const { kpis, setKpis } = useKpis(incidents.events, { showDemoData });
  // All cameras, optionally in the background. The hook sits here so a route change never
  // tears down its workers; it starts them only when the operator enabled the option and
  // the resource guard allows it, and it never processes the camera Live owns.
  const background = useBackgroundCameras({
    cameras: cameraStore.cameras,
    zones: zoneStore.zones,
    addEngineEvents: incidents.addEngineEvents,
    liveEngineCameraId,
  });
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
  // The coverage receipt's raw samples. Additive and session-only: no key below changes,
  // and the list is never persisted (the Reports panel says "doar cât a rulat motorul").
  const coverage = useCoverageSamples();
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
  // Additive on purpose: no existing screen changes, and every surface that lists events
  // (feed, list, report, KPI strip) already reads the same visible list.
  const demoKeys = { showDemoData, setShowDemoData };
  // Additive: only Live writes the ownership key and only Settings reads the status.
  const backgroundKeys = {
    backgroundEnabled: background.enabled,
    setBackgroundEnabled: background.setEnabled,
    getBackgroundStatus: background.getStatus,
    liveEngineCameraId,
    reportActiveCamera,
  };
  // Additive: Live records the samples, Reports reads them. No existing key changes.
  const coverageKeys = {
    coverageSamples: coverage.coverageSamples,
    recordCoverageSample: coverage.recordCoverageSample,
    clearCoverageSamples: coverage.clearCoverageSamples,
  };
  // Additive: only the Settings panel reads and writes these. Persisting happens in the
  // setter, so the stored value and the rendered one cannot drift.
  const webhookKeys = {
    webhookSettings,
    setWebhookSettings,
    webhookStatus: webhook.status,
    sendTestWebhook: webhook.sendTest,
  };
  return flattenGroups([
    navigation,
    sidebar,
    operatorKeys,
    cameraKeys,
    incidentKeys,
    zoneKeys,
    metricKeys,
    connectionKeys,
    demoKeys,
    backgroundKeys,
    coverageKeys,
    webhookKeys,
  ]);
}
export function SecurityProvider({ children }) {
  const value = useStoreValue();
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
export function useSecurity() {
  const store = useContext(Store);
  if (!store) throw new Error('useSecurity must be used within a SecurityProvider');
  return store;
}
