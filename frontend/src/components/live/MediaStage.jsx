import { Radio, RotateCcw } from 'lucide-react';
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
import { describeWhepUrl } from './whepClient';

const frameClass = (displayMode) =>
  `relative rounded-xl overflow-hidden bg-black border border-slate-700 shadow-md flex items-center justify-center w-full aspect-video ${
    displayMode === 'split'
      ? 'max-w-5xl mx-auto min-h-[320px] max-h-[500px]'
      : 'min-h-[260px] max-h-[580px]'
  }`;

// The network camera is not a clip and not the visitor's device: it is a WebRTC track the
// gateway negotiated, carrying an RTSP stream the browser could never open directly. These
// three pieces say so on the stage. They live here (not in StageOverlays) because they are
// only true of a WHEP source.

function NetworkHud() {
  return (
    <div
      data-testid="whep-hud"
      className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-black/80 px-2.5 py-1 rounded-lg text-[10px] font-mono text-white border border-white/10 shadow"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#D73833] animate-ping" />
      <span className="font-bold text-red-400">LIVE RTSP</span>
      <span className="text-slate-400">|</span>
      <span>WebRTC / WHEP</span>
    </div>
  );
}

function NetworkSourceBadge() {
  return (
    <div
      data-testid="whep-badge"
      className="absolute top-2.5 right-2.5 px-2 py-1 rounded bg-black/75 text-[#33E1FF] text-[10px] font-mono border border-[#33E1FF]/40"
    >
      CAMERĂ DE REȚEA • WHEP
    </div>
  );
}

function NetworkFooter({ camera }) {
  return (
    <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-black/75 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10 flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0">
        <p className="font-bold text-white text-xs leading-none truncate">{camera?.name}</p>
        <p className="text-[10px] text-slate-300 font-normal mt-0.5 leading-none truncate">
          {camera?.subtitle}
        </p>
      </div>
      <span className="text-[10px] font-mono text-slate-400 truncate">
        {describeWhepUrl(camera?.whep_url) || 'WHEP'}
      </span>
    </div>
  );
}

// Connection lifecycle of the WebRTC session. "connecting" is not an error: MediaMTX has to
// pull the first keyframe before the browser gets a track. The failure card names exactly
// what failed and offers one retry — the gateway is a process a human starts.
function NetworkConnectingCard({ url }) {
  return (
    <div
      data-testid="whep-connecting"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/85"
    >
      <Radio size={34} className="text-[#33E1FF] animate-pulse" />
      <p className="text-white text-sm font-bold">Se conectează la camera de rețea…</p>
      <p className="text-slate-300 text-xs max-w-sm">
        Gateway-ul WHEP negociază fluxul RTSP. Durează până la primul keyframe.
      </p>
      <p className="font-mono text-[10px] text-slate-500">{describeWhepUrl(url) || url || ''}</p>
    </div>
  );
}

function NetworkErrorCard({ error, onRetry }) {
  return (
    <div
      data-testid="whep-error"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/90"
    >
      <Radio size={34} className="text-[#D73833]" />
      <p className="text-white text-sm font-bold">{error.title}</p>
      <p className="text-slate-300 text-xs max-w-sm">{error.detail}</p>
      <p className="font-mono text-[10px] text-slate-500">
        {[error.code, error.message].filter(Boolean).join(': ')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 px-3 py-1.5 rounded-lg bg-[#33E1FF] hover:bg-[#7EEBFF] text-[#1F1F1F] text-[11px] font-bold inline-flex items-center gap-1.5 shadow"
      >
        <RotateCcw size={13} />
        Reconectează
      </button>
      <p className="text-[10px] text-slate-400">
        sau alege altă cameră din meniul Cameră
      </p>
    </div>
  );
}

// The 16:9 stage: one <video> node owns the decoder for the whole visit, the engine's
// canvas sits above it, and the raw feed is hidden from the click that turns detection on
// (not from the first processed frame). Everything drawn here is either a label or the
// processed frame; no box is ever invented.
//
// Three kinds of source share this element: a looping demo clip (`src`), the visitor's
// camera (`srcObject` from getUserMedia) and a network camera (`srcObject` from WHEP). The
// element is never rekeyed, so the engine keeps reading frames across a swap.
export default function MediaStage({
  activeCamera,
  displayMode,
  plan,
  edgeActive,
  isWebcam,
  isNetwork,
  browserEngineOn,
  engine,
  engineSource,
  activeZone,
  engineReason,
  webcam,
  whep,
  videoRef,
  canvasRef,
  onRetryWebcam,
  onStartEngine,
  onStreamError,
  onVideoError,
}) {
  const network = Boolean(isNetwork || plan?.isNetwork);
  const hasFeed = isWebcam || Boolean(plan.showNetworkVideo) || plan.showDemoVideo;
  // With CAM-LOCAL selected and getUserMedia failing there is no picture, so the stage
  // must not keep the last frame, a "LIVE REC" badge or a "SURSĂ: camera acestui
  // dispozitiv" footer. One error state, on an opaque surface, alone.
  const webcamError = isWebcam && webcam?.state === 'error' && Boolean(webcam?.error);
  // The WHEP session is either up, still negotiating, or failed. `idle` only happens for
  // the frame between selection and the first effect, so it reads as "connecting".
  const networkError = network && whep?.state === 'error' ? whep.error : null;
  const networkLive = network && whep?.state === 'live';
  const surfaceClass = webcamError
    ? 'w-full h-full bg-black relative flex items-center justify-center overflow-hidden'
    : `w-full h-full bg-gradient-to-br ${
        activeCamera?.previewBg || 'from-slate-900 to-black'
      } relative flex items-center justify-center overflow-hidden`;

  return (
    <div className={frameClass(displayMode)}>
      {plan.isOffline ? (
        <SignalLost cameraId={activeCamera?.id} />
      ) : (
        <div className={surfaceClass}>
          {webcamError ? (
            <WebcamErrorCard error={webcam.error} onRetry={onRetryWebcam} />
          ) : plan.noLiveForCamera ? (
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
                // hook, and must never load /media/webcam-live.mp4. The network camera is
                // the same deal: its track arrives from the WHEP client, and there is no
                // demo clip with its id.
                src={isWebcam || network ? undefined : plan.demoVideoSrc}
                // Privacy: the raw clip is hidden from the click, not from the first
                // processed frame. The 2.5–3 s model warm-up must never show an unblurred
                // face; layout stays identical because only opacity changes.
                className={`w-full h-full object-cover${browserEngineOn ? ' opacity-0' : ''}`}
                // Muted on every source: the WHEP offer asks for video only, so a network
                // camera can never autoplay sound the operator did not ask for.
                autoPlay
                loop={!isWebcam && !network}
                muted
                playsInline
                aria-label={
                  network
                    ? 'Flux cameră de rețea (WHEP)'
                    : isWebcam
                      ? 'Flux cameră locală'
                      : `Clip demo ${activeCamera?.id}`
                }
                onError={isWebcam || network ? undefined : onVideoError}
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
              {/* Zone alignment, only while there is a reference frame: `null` means the
                  camera has no fixed frame (webcam) and the configured polygons are used
                  as-is, which is not a state the operator has to read. When the view is
                  lost the worker fires no zone rule, and this says so instead of leaving
                  an outline that looks armed. */}
              {browserEngineOn && typeof engine?.aligned === 'boolean' && (
                <div
                  data-testid="engine-alignment"
                  data-aligned={engine.aligned ? 'true' : 'false'}
                  title={
                    engine.aligned
                      ? 'Poligoanele sunt proiectate pe cadrul curent, urmărind mișcarea camerei.'
                      : 'Cadrul curent nu a putut fi aliniat la referință: zonele sunt necunoscute și nicio regulă de zonă nu rulează.'
                  }
                  className={`absolute bottom-12 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded bg-black/80 text-[10px] font-mono border whitespace-nowrap ${
                    engine.aligned
                      ? 'text-emerald-300 border-emerald-400/40'
                      : 'text-[#FF8A80] border-[#D73833]/50'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                      engine.aligned ? 'bg-emerald-400' : 'bg-[#D73833]'
                    }`}
                  />
                  {engine.aligned ? 'aliniere: activă' : 'aliniere pierdută'}
                </div>
              )}
              {network ? (
                <>
                  <NetworkSourceBadge />
                  {networkLive && <NetworkHud />}
                  {whep?.state === 'connecting' && (
                    <NetworkConnectingCard url={activeCamera?.whep_url} />
                  )}
                  {networkError && (
                    <NetworkErrorCard error={networkError} onRetry={whep?.retry} />
                  )}
                </>
              ) : (
                <SourceBadge isWebcam={isWebcam} />
              )}
              {isWebcam && webcam.state === 'requesting' && <WebcamRequestCard />}
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
              exactly what the visitor sees. A network camera has no seeded zone, so the
              outline is absent there by construction. */}
          {!webcamError && engineSource && !browserEngineOn && <ZoneOutline zone={activeZone} />}

          {!webcamError && (
            <>
              {network ? (
                <NetworkFooter camera={activeCamera} />
              ) : (
                <>
                  <HudReadout resolution={activeCamera?.resolution} isWebcam={isWebcam} />
                  {!edgeActive && !plan.noLiveForCamera && !isWebcam && <EdgeWarning />}
                  {plan.demoClip && !plan.noLiveForCamera && !isWebcam && (
                    <DemoClipSource demoClip={plan.demoClip} />
                  )}
                  <CameraFooter camera={activeCamera} isWebcam={isWebcam} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
