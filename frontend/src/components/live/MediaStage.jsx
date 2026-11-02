import React from 'react';
import EngineOverlayBadges from './EngineOverlayBadges';
import ZoneOutline from './ZoneOutline';
import { NoDemoFeed, SignalLost, StreamPlaceholder } from './LiveEmptyStates';
import {
  CameraFooter,
  DemoClipSource,
  EdgeWarning,
  HudReadout,
  SourceBadge,
  WebcamErrorCard,
  WebcamRequestCard,
} from './StageOverlays';
import { STAGE_VIDEO_KEY } from './liveMedia';

const frameClass = (displayMode) =>
  `relative rounded-xl overflow-hidden bg-black border border-slate-700 shadow-md flex items-center justify-center w-full aspect-video ${
    displayMode === 'split'
      ? 'max-w-5xl mx-auto min-h-[320px] max-h-[500px]'
      : 'min-h-[260px] max-h-[580px]'
  }`;

// The 16:9 stage: one <video> node owns the decoder for the whole visit, the engine's
// canvas sits above it, and the raw feed is hidden from the click that turns detection on
// (not from the first processed frame). Everything drawn here is either a label or the
// processed frame; no box is ever invented.
export default function MediaStage({
  activeCamera,
  displayMode,
  plan,
  edgeActive,
  isWebcam,
  browserEngineOn,
  engine,
  engineSource,
  activeZone,
  engineReason,
  webcam,
  videoRef,
  canvasRef,
  onRetryWebcam,
  onStartEngine,
  onStreamError,
  onVideoError,
}) {
  const hasFeed = isWebcam || plan.showDemoVideo;

  return (
    <div className={frameClass(displayMode)}>
      {plan.isOffline ? (
        <SignalLost cameraId={activeCamera?.id} />
      ) : (
        <div
          className={`w-full h-full bg-gradient-to-br ${
            activeCamera?.previewBg || 'from-slate-900 to-black'
          } relative flex items-center justify-center overflow-hidden`}
        >
          {plan.noLiveForCamera ? (
            <NoDemoFeed camera={activeCamera} demoCameraLabel={plan.demoCameraLabel} />
          ) : plan.showStream ? (
            <img
              src={activeCamera?.stream_url}
              alt={`Flux live ${activeCamera?.id}`}
              className="w-full h-full object-cover"
              onError={onStreamError}
            />
          ) : hasFeed ? (
            <>
              <video
                // Stable node (see STAGE_VIDEO_KEY): useEngine keeps its listeners and frame
                // loop on this exact element, and both sources swap in place — `src` for a
                // clip, `srcObject` for the webcam.
                key={STAGE_VIDEO_KEY}
                ref={videoRef}
                // A MediaStream is not a URL: the webcam gets it through srcObject in the
                // hook, and must never load /media/webcam-live.mp4.
                src={isWebcam ? undefined : plan.demoVideoSrc}
                // Privacy: the raw clip is hidden from the click, not from the first
                // processed frame. The 2.5–3 s model warm-up must never show an unblurred
                // face; layout stays identical because only opacity changes.
                className={`w-full h-full object-cover${browserEngineOn ? ' opacity-0' : ''}`}
                autoPlay
                loop={!isWebcam}
                muted
                playsInline
                aria-label={isWebcam ? 'Flux cameră locală' : `Clip demo ${activeCamera?.id}`}
                onError={isWebcam ? undefined : onVideoError}
              />
              <EngineOverlayBadges
                browserEngineOn={browserEngineOn}
                engineSource={engineSource}
                engine={engine}
                canvasRef={canvasRef}
                engineReason={engineReason}
                isWebcam={isWebcam}
                onStartEngine={onStartEngine}
              />
              <SourceBadge isWebcam={isWebcam} />
              {isWebcam && webcam.state === 'requesting' && <WebcamRequestCard />}
              {isWebcam && webcam.state === 'error' && webcam.error && (
                <WebcamErrorCard error={webcam.error} onRetry={onRetryWebcam} />
              )}
            </>
          ) : (
            <StreamPlaceholder
              camera={activeCamera}
              videoFailed={plan.videoFailed}
              streamFailed={plan.streamFailed}
            />
          )}

          {/* The overlay is either the engine's real canvas, or absent. With the engine
              off no person box is drawn: only the configured zone and a note that says
              exactly what the visitor sees. */}
          {engineSource && !browserEngineOn && <ZoneOutline zone={activeZone} />}

          <HudReadout resolution={activeCamera?.resolution} />
          {!edgeActive && !plan.noLiveForCamera && !isWebcam && <EdgeWarning />}
          {plan.demoClip && !plan.noLiveForCamera && !isWebcam && (
            <DemoClipSource demoClip={plan.demoClip} />
          )}
          <CameraFooter camera={activeCamera} isWebcam={isWebcam} />
        </div>
      )}
    </div>
  );
}
