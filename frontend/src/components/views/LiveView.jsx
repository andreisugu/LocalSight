import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { useEngine } from '../../engine/useEngine';
import LiveEngineCard from '../live/LiveEngineCard';
import CameraToolbar from '../live/CameraToolbar';
import MediaStage from '../live/MediaStage';
import KpiStrip from '../live/KpiStrip';
import IncidentFeed from '../live/IncidentFeed';
import FullscreenStage from '../live/FullscreenStage';
import { NoCameraScreen } from '../live/LiveEmptyStates';
import {
  useEnginePreference,
  useWebcamFeed,
  useMediaFailures,
  useEngineIncidents,
} from '../live/useLiveMedia';
import {
  WEBCAM_CAMERA_ID,
  edgeIsActive,
  engineReadout,
  engineReason,
  mediaPlan,
  parseList,
  pickActiveZone,
  toEngineZones,
} from '../live/liveMedia';

// The Live screen is a composition: the rules live in liveMedia.js, the effects in
// useLiveMedia.js, and every block below is its own component. What remains here is the
// wiring the engine requires (one <video> and one <canvas> for the life of the view).
export default function LiveView() {
  const { isDarkMode, themeStyles } = useTheme();
  const {
    kpis,
    cameras,
    activeCamera,
    setSelectedCameraId,
    toggleEngine,
    filteredEvents,
    filterMode,
    setFilterMode,
    acknowledgeEvent,
    setSelectedEventId,
    setCurrentView,
    zones,
    addEngineEvents,
    health,
    searchQuery,
  } = useSecurity();

  // 'standard' | 'split' | 'fullscreen'
  const [displayMode, setDisplayMode] = useState('standard');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const isWebcam = activeCamera?.id === WEBCAM_CAMERA_ID;
  const enginePreference = useEnginePreference();
  const browserEngineOn = enginePreference.browserEngineOn;
  const webcam = useWebcamFeed({ isWebcam, videoRef, browserEngineOn });
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
  });

  // The two sources the browser engine can process. Everything the clip path shows keys
  // off this, so the webcam path is not a second UI.
  const engineSource = plan.showDemoVideo || webcam.live;

  const activeZone = useMemo(() => pickActiveZone(zones, activeCamera), [zones, activeCamera]);
  const engineZones = useMemo(
    () => toEngineZones(zones, activeCamera?.id),
    [zones, activeCamera?.id]
  );

  // The engine runs on the local clip fallback or on the live webcam stream, and only while
  // the viewer asked for it. Fullscreen renders the raw clip in a separate tree, so the
  // worker is stopped there instead of being left pointing at a <video> that no longer
  // exists.
  const engineEnabled = browserEngineOn && engineSource && displayMode !== 'fullscreen';
  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: engineEnabled,
    // Zonele camerei active, în forma din contract, plus comutatorul de motor al camerei.
    zones: engineZones,
    engineOn: Boolean(activeCamera?.engine_on),
    cameraId: activeCamera?.id,
    // Cap the processed frame at 1280 on the long side. The YOLO graph is fixed 640 and
    // faces/blur do not need 1920; the bench measures ~5 fps at 1280 versus ~3.7 at 1080p
    // on the same 4 threads. `/bench` still lets a visitor compare sizes explicitly.
    inputSize: 1280,
  });

  useEngineIncidents(engine.events, addEngineEvents);

  // Privacy: the immersive view renders the raw clip in its own React tree, so entering it
  // would stop the worker and show unblurred faces full-screen. It is never reachable while
  // the browser engine is on; this effect also catches a preference turned on while
  // fullscreen is open.
  useEffect(() => {
    if (browserEngineOn && displayMode === 'fullscreen') setDisplayMode('standard');
  }, [browserEngineOn, displayMode]);

  if (!activeCamera) {
    return <NoCameraScreen health={health} themeStyles={themeStyles} />;
  }

  if (displayMode === 'fullscreen') {
    return (
      <FullscreenStage
        activeCamera={activeCamera}
        isOffline={plan.isOffline}
        showStream={plan.showStream}
        showDemoVideo={plan.showDemoVideo}
        demoVideoSrc={plan.demoVideoSrc}
        noLiveForCamera={plan.noLiveForCamera}
        demoCameraLabel={plan.demoCameraLabel}
        onStreamError={failures.onStreamError}
        onVideoError={failures.onVideoError}
        onToggleEngine={toggleEngine}
        onExit={() => setDisplayMode('standard')}
      />
    );
  }

  const readout = engineReadout({
    engine,
    isWebcam,
    webcamLive: webcam.live,
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
    setCurrentView('incident_detail');
  };

  return (
    <div className="min-h-full w-full p-3 md:p-4 space-y-3 select-none">
      <KpiStrip kpis={kpis} themeStyles={themeStyles} />

      <div className={`flex ${displayMode === 'split' ? 'flex-col' : 'flex-col xl:flex-row'} gap-3`}>
        <div className="flex-1 flex flex-col space-y-2 min-w-0">
          <CameraToolbar
            cameras={cameras}
            activeCamera={activeCamera}
            demoCameraIds={demoConfig.cameraIds}
            isDarkMode={isDarkMode}
            themeStyles={themeStyles}
            displayMode={displayMode}
            onSelectCamera={setSelectedCameraId}
            onSelectMode={setDisplayMode}
            onToggleEngine={toggleEngine}
            browserEngineOn={browserEngineOn}
            engineSource={engineSource}
            onToggleBrowserEngine={enginePreference.toggle}
            isWebcam={isWebcam}
            onOpenFullscreen={() => setDisplayMode('fullscreen')}
          />

          <MediaStage
            activeCamera={activeCamera}
            displayMode={displayMode}
            plan={plan}
            edgeActive={edgeIsActive(health)}
            isWebcam={isWebcam}
            browserEngineOn={browserEngineOn}
            engine={engine}
            engineSource={engineSource}
            activeZone={activeZone}
            engineReason={engineReason(enginePreference.gpuAvailable, isWebcam)}
            webcam={webcam}
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
          />
        </div>

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
        />
      </div>
    </div>
  );
}
