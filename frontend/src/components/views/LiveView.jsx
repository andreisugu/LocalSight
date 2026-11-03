import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { useEngine } from '../../engine/useEngine';
import { DEMO_REFERENCE_FRAMES } from '../../constants/mockData';
import CameraToolbar from '../live/CameraToolbar';
import FullscreenStage from '../live/FullscreenStage';
import IncidentFeed from '../live/IncidentFeed';
import KpiStrip from '../live/KpiStrip';
import LiveEngineCard from '../live/LiveEngineCard';
import MediaStage from '../live/MediaStage';
import { NoCameraScreen } from '../live/LiveEmptyStates';
import {
  useEngineIncidents,
  useEnginePreference,
  useMediaFailures,
  useWebcamFeed,
  useWhepFeed,
} from '../live/useLiveMedia';
import {
  NETWORK_CAMERA_ID,
  WEBCAM_CAMERA_ID,
  edgeIsActive,
  engineReadout,
  engineReason,
  isNetworkCamera,
  mediaPlan,
  networkCamera,
  parseList,
  pickActiveZone,
  toEngineZones,
} from '../live/liveMedia';
import { resolveWhepUrl } from '../live/whepClient';
// The Live screen is a composition: the rules live in liveMedia.js, the effects in
// useLiveMedia.js, and every block below is its own component. What remains here is the
// wiring the engine requires (one <video> and one <canvas> for the life of the view).
const INCIDENT_DETAIL = 'incident_detail';
const MODE_STANDARD = 'standard';
const MODE_SPLIT = 'split';
const MODE_FULLSCREEN = 'fullscreen';
/** Left column of the split layout: toolbar, media stage and the engine/sensor card. */
function StageColumn({ children }) {
  return <section className="flex-1 flex flex-col space-y-2 min-w-0">{children}</section>;
}
/** Immersive view: the raw clip rendered in its own tree, never with the engine running. */
function FullscreenLive({ camera, plan, failures, onToggleEngine, onExit }) {
  return (
    <FullscreenStage
      activeCamera={camera}
      isOffline={plan.isOffline}
      showStream={plan.showStream}
      showDemoVideo={plan.showDemoVideo}
      demoVideoSrc={plan.demoVideoSrc}
      noLiveForCamera={plan.noLiveForCamera}
      demoCameraLabel={plan.demoCameraLabel}
      onStreamError={failures.onStreamError}
      onVideoError={failures.onVideoError}
      onToggleEngine={onToggleEngine}
      onExit={onExit}
    />
  );
}
const LiveView = () => {
  const { themeStyles, isDarkMode } = useTheme();
  const security = useSecurity();
  const {
    // `cameras`/`activeCamera` are the store's; the view merges the optional network camera
    // on top without writing it back, so no other screen can inherit a source it cannot play.
    cameras: storeCameras,
    activeCamera: storeCamera,
    kpis, health, zones,
    // incident feed and routing
    filteredEvents, filterMode, setFilterMode, searchQuery,
    acknowledgeEvent, setSelectedEventId, setCurrentView,
    // engine plumbing
    toggleEngine, setSelectedCameraId, addEngineEvents,
    reportActiveCamera, recordCoverageSample, showToast,
  } = security;
  // MODE_STANDARD | MODE_SPLIT | MODE_FULLSCREEN
  const [displayMode, setDisplayMode] = useState(MODE_STANDARD);
  // A network camera is not a fixture: it exists only when the operator named a WHEP
  // gateway (`?whep=…` or `localsight.whepUrl`). Read once: the address bar is the
  // configuration, and a re-render must not renegotiate a session.
  const [whepUrl] = useState(() => resolveWhepUrl());
  const network = useMemo(() => networkCamera(whepUrl), [whepUrl]);
  const cameras = useMemo(
    () => (network ? [...storeCameras, network] : storeCameras),
    [storeCameras, network]
  );
  // Landing with `?whep=` is an explicit request to watch that camera, so it starts
  // selected. Without it the store's selection is untouched.
  const [networkSelected, setNetworkSelected] = useState(Boolean(whepUrl));
  const activeCamera = network && networkSelected ? network : storeCamera;
  const isNetwork = isNetworkCamera(activeCamera) && Boolean(network);
  const selectCamera = (cameraId) => {
    if (network && cameraId === NETWORK_CAMERA_ID) {
      setNetworkSelected(true);
      return;
    }
    setNetworkSelected(false);
    setSelectedCameraId(cameraId);
  };
  // The MOTOR switch belongs to the aircraft on a stand; the gateway source has no stand,
  // so it must not write a fabricated engine state (or call the API with an unknown id).
  // Saying so beats a dead button that looks broken.
  const onToggleEngine = (cameraId) => {
    if (isNetwork) {
      showToast('CAM-NET nu are motor de stand — pornește detecția în browser.');
      return;
    }
    toggleEngine(cameraId);
  };
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const isWebcam = activeCamera?.id === WEBCAM_CAMERA_ID;
  const enginePreference = useEnginePreference();
  const browserEngineOn = enginePreference.browserEngineOn;
  const webcam = useWebcamFeed({ isWebcam, videoRef, browserEngineOn });
  const whep = useWhepFeed({ isNetwork, videoRef, url: network?.whep_url || null });
  const failures = useMediaFailures(activeCamera?.id);
  const demoConfig = useMemo(
    () => ({
      cameraIds: parseList(import.meta.env.VITE_DEMO_CAMERA),
      clipEntries: parseList(import.meta.env.VITE_DEMO_CLIP),
    }),
    []
  );
  const plan = mediaPlan({
    camera: activeCamera,
    cameras,
    demoCameraIds: demoConfig.cameraIds,
    demoClipEntries: demoConfig.clipEntries,
    baseUrl: import.meta.env.BASE_URL || '/',
    videoOverride: import.meta.env.VITE_MEDIA_VIDEO,
    streamFailed: failures.streamFailed,
    videoFailed: failures.videoFailed,
    isWebcam,
    isNetwork,
  });
  // The two sources the browser engine can process. Everything the clip path shows keys
  // off this, so the webcam path is not a second UI. The network camera joins them only
  // once its WebRTC session is really up: a configured URL is not a source.
  const engineSource = plan.showDemoVideo || webcam.live || whep.live;
  const activeZone = useMemo(() => pickActiveZone(zones, activeCamera), [zones, activeCamera]);
  const engineZones = useMemo(
    () => toEngineZones(zones, activeCamera?.id),
    [zones, activeCamera?.id]
  );
  // The frame the polygons were drawn on. The zone editor paints its canvas on exactly this
  // image (an uploaded `reference_frame_url` wins, otherwise the demo still), so the engine
  // maps zones from the geometry the operator actually drew on. The webcam has no such
  // frame — the room moves and the frame no longer exists — so alignment stays off and the
  // configured polygons are used unchanged.
  const referenceFrameUrl = useMemo(() => {
    if (isWebcam || isNetwork || !activeCamera?.id) return null;
    const cameraZones = (zones || []).filter((zone) => zone.camera_id === activeCamera.id);
    // Two references cannot describe the same camera: the active zone first, then the first
    // zone of this camera that has one.
    const uploaded =
      activeZone?.reference_frame_url ||
      cameraZones.find((zone) => zone.reference_frame_url)?.reference_frame_url;
    return uploaded || DEMO_REFERENCE_FRAMES[activeCamera.id] || null;
  }, [activeZone, activeCamera?.id, isWebcam, isNetwork, zones]);
  // The engine runs on the local clip fallback or on the live webcam stream, and only while
  // the viewer asked for it. Fullscreen renders the raw clip in a separate tree, so the
  // worker is stopped there instead of being left pointing at a <video> that no longer
  // exists.
  const engineEnabled = browserEngineOn && engineSource && displayMode !== MODE_FULLSCREEN;
  // The background manager must skip exactly the camera whose frames this view feeds to
  // its worker. A selected-but-stopped camera is not owned: turning the engine off, leaving
  // Live or entering fullscreen releases it, and the background run may process it.
  // A layout effect, not a passive one: the ownership update must land before the provider's
  // passive effect creates the manager, otherwise the manager could start a worker for the
  // camera Live is about to claim.
  useLayoutEffect(() => {
    reportActiveCamera(engineEnabled ? activeCamera?.id ?? null : null);
    return () => reportActiveCamera(null);
  }, [engineEnabled, activeCamera?.id, reportActiveCamera]);
  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: engineEnabled,
    // Zonele camerei active, în forma din contract, plus comutatorul de motor al camerei.
    zones: engineZones,
    engineOn: Boolean(activeCamera?.engine_on),
    cameraId: activeCamera?.id,
    // The reference frame the zones were drawn on; the worker fetches it once per camera.
    referenceUrl: referenceFrameUrl,
    // The ground calibration and the speed readout need the tracker's boxes with every
    // result, not just the 250 ms-throttled counts. This is the same opt-in `/lab` uses;
    // the worker attaches `{ time, boxes }` and nothing else changes.
    trackFeed: true,
    // Cap the processed frame at 1280 on the long side. The person graph has its own input
    // (320 for Lite0, 448 for Lite2) and faces/blur do not need 1920; the bench measures
    // ~5 fps at 1280 versus ~3.7 at 1080p on the same 4 threads. `/bench` still lets a
    // visitor compare sizes explicitly.
    inputSize: 1280,
    // The person detector is read from Settings inside `useEngine`, so a model change
    // restarts the worker without anything Live-specific to pass.
  });
  useEngineIncidents(engine.events, addEngineEvents);
  // Coverage receipt: one sample per second while the engine runs in this tab, plus one on
  // every visibility change and engine-status change. `hidden` is the browser throttling
  // the tab, `paused` is an enabled engine that is not producing frames yet (model load,
  // error), and `live` is only written while the worker is really running. Session-only:
  // the provider keeps the list in React state and never persists it, so the Reports panel
  // can only claim what this tab actually watched.
  const coverageCameraId = activeCamera?.id;
  const engineStatus = engine.status;
  useEffect(() => {
    if (!engineEnabled || !coverageCameraId) return undefined;
    const record = () => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      recordCoverageSample({
        cameraId: coverageCameraId,
        at: Date.now(),
        status: hidden ? 'hidden' : engineStatus === 'running' ? 'live' : 'paused',
      });
    };
    record();
    const timer = window.setInterval(record, 1000);
    document.addEventListener('visibilitychange', record);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', record);
    };
  }, [engineEnabled, coverageCameraId, engineStatus, recordCoverageSample]);
  // Privacy: the immersive view renders the raw clip in its own React tree, so entering it
  // would stop the worker and show unblurred faces full-screen. It is never reachable while
  // the browser engine is on; this effect also catches a preference turned on while
  // fullscreen is open.
  useEffect(() => {
    if (browserEngineOn && displayMode === MODE_FULLSCREEN) setDisplayMode(MODE_STANDARD);
  }, [browserEngineOn, displayMode]);
  if (!activeCamera) {
    return <NoCameraScreen health={health} themeStyles={themeStyles} />;
  }
  if (displayMode === MODE_FULLSCREEN) return <FullscreenLive
    camera={activeCamera}
    plan={plan}
    failures={failures}
    onToggleEngine={toggleEngine}
    onExit={() => setDisplayMode(MODE_STANDARD)}
  ></FullscreenLive>;
  const readout = engineReadout({
    engine,
    isWebcam,
    isNetwork,
    webcamLive: webcam.live,
    whepLive: whep.live,
    activeZone,
    activeCamera,
    showStream: plan.showStream,
    browserEngineOn,
    engineSource,
    health,
    kpis,
  });
  const openIncident = (eventId) => {
    setSelectedEventId(eventId);
    setCurrentView(INCIDENT_DETAIL);
  };
  // Two columns from `lg` (1024px), not `xl` (1280px): at the required 1024×768 viewport
  // the incident feed — the alert surface with every "Confirmă" — started at y=824 inside a
  // 704px scroller, i.e. completely below the fold. The stage keeps `flex-1 min-w-0`, so it
  // simply narrows.
  const columnFlow = displayMode === MODE_SPLIT ? 'flex-col' : 'flex-col lg:flex-row';
  return <main className="min-h-full w-full p-3 md:p-4 space-y-3 select-none">
      <KpiStrip kpis={kpis} themeStyles={themeStyles} />
      <section className={`flex ${columnFlow} gap-3`}>
        <StageColumn>
          <CameraToolbar
            cameras={cameras}
            activeCamera={activeCamera}
            demoCameraIds={demoConfig.cameraIds}
            isDarkMode={isDarkMode}
            themeStyles={themeStyles}
            displayMode={displayMode}
            onSelectCamera={selectCamera}
            onSelectMode={setDisplayMode}
            onToggleEngine={onToggleEngine}
            browserEngineOn={browserEngineOn}
            engineSource={engineSource}
            onToggleBrowserEngine={enginePreference.toggle}
            // The toolbar uses this flag for one thing: "no fullscreen button for a
            // source that lives in a React-owned element". The network camera is that
            // too (its track is on the same <video>), and fullscreen would render
            // another tree without srcObject.
            isWebcam={isWebcam || isNetwork}
            onOpenFullscreen={() => setDisplayMode(MODE_FULLSCREEN)}
          ></CameraToolbar>
          <MediaStage
            activeCamera={activeCamera}
            displayMode={displayMode}
            plan={plan}
            edgeActive={edgeIsActive(health)}
            isWebcam={isWebcam}
            isNetwork={isNetwork}
            browserEngineOn={browserEngineOn}
            engine={engine}
            engineSource={engineSource}
            activeZone={activeZone}
            engineReason={engineReason(enginePreference.gpuAvailable, isWebcam, isNetwork)}
            webcam={webcam}
            whep={whep}
            videoRef={videoRef}
            canvasRef={canvasRef}
            onRetryWebcam={webcam.retry}
            onStartEngine={enginePreference.toggle}
            onStreamError={failures.onStreamError}
            onVideoError={failures.onVideoError}
          />
          {/* One card for the engine and the sensors: always present, one title, one grid.
              Engine metrics join the same grid only while the worker produces frames, so an
              idle engine never paints invented zeros. */}
          <LiveEngineCard
            engine={engine}
            engineOn={browserEngineOn}
            hasSource={Boolean(engineSource)}
            zoneLabel={readout.zoneLabel}
            pipelineLabel={readout.pipelineLabel}
            pipelineActive={readout.pipelineActive}
            modelLabel={readout.modelLabel}
            latencyLabel={readout.latencyLabel}
            cameraId={activeCamera.id}
            cameraLabel={activeCamera.name || activeCamera.code || activeCamera.id}
            referenceUrl={referenceFrameUrl}
          />
        </StageColumn>
        <IncidentFeed
          events={filteredEvents}
          filterMode={filterMode}
          onFilterChange={setFilterMode}
          displayMode={displayMode}
          isDarkMode={isDarkMode}
          themeStyles={themeStyles}
          searchQuery={searchQuery}
          onOpenIncident={openIncident}
          onAcknowledge={acknowledgeEvent}
        ></IncidentFeed>
      </section>
    </main>;
};
export default LiveView;