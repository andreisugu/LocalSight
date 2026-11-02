import { Cpu } from 'lucide-react';
import { USE_MOCK } from '../../services/api';
import { engineBadgeCopy, hiddenRawCopy } from './liveMedia';

// The engine overlay is the privacy boundary of the screen. While the browser engine is
// requested, the raw <video> is hidden by the caller and this component supplies the only
// pixels the visitor may see: the worker's canvas, or an opaque placeholder until the
// first processed frame arrives. With an error or an unsupported browser the canvas is
// hidden too, so a broken engine can never leave an unblurred passthrough frame on screen.
export default function EngineOverlayBadges({
  browserEngineOn,
  engineSource,
  engine,
  canvasRef,
  engineReason,
  isWebcam,
  onStartEngine,
}) {
  if (!engineSource) return null;

  if (!browserEngineOn) {
    return (
      <div className="absolute z-10 bottom-14 left-1/2 -translate-x-1/2 w-[min(27rem,calc(100%-1.5rem))] px-3 py-2 rounded-xl bg-black/85 border border-[#FFEB33]/60 shadow-lg text-center">
        <p className="text-[11px] font-bold text-[#FFEB33]">
          detecția este oprită — cutiile nu urmăresc video
        </p>
        <p className="text-[10px] text-slate-300 mt-0.5">{engineReason}</p>
        {/* Privacy differs by source. The demo clip is footage the project ships; the
            webcam is the visitor's own camera on their own machine, so the raw view is
            acceptable ONLY with this note visible and only because nothing leaves the
            browser. The engine, when started, blurs faces before the frame is drawn. */}
        {isWebcam && (
          <p className="text-[10px] text-slate-300 mt-0.5">
            Vezi fluxul brut al camerei tale locale. Blurul de față apare doar când
            pornești motorul; nimic nu părăsește browserul.
          </p>
        )}
        <button
          type="button"
          data-testid="engine-start"
          onClick={onStartEngine}
          className="mt-1.5 px-3 py-1.5 rounded-lg bg-[#33E1FF] hover:bg-[#7EEBFF] text-[#1F1F1F] text-[11px] font-bold inline-flex items-center gap-1.5 shadow"
        >
          <Cpu size={13} />
          Pornește motorul în browser
        </button>
      </div>
    );
  }

  const broken = engine.status === 'error' || engine.status === 'unsupported';

  return (
    <>
      {/* Opaque surface between the hidden video and the canvas. Before the first processed
          frame the canvas is still empty and transparent, so this is what the operator
          sees: black plus a status line, never the raw feed. It also covers the fail-open
          path where the worker posts an unblurred passthrough frame; the canvas is hidden
          below when the engine reports an error. */}
      <div className="absolute inset-0 bg-black flex items-center justify-center pointer-events-none">
        {engine.status !== 'running' && (
          <p className="px-4 text-center font-mono text-[10px] leading-snug text-slate-400 max-w-sm">
            {hiddenRawCopy(engine.status)}
          </p>
        )}
      </div>
      {/* The worker's frames are drawn into a 2d context created with alpha:false, so every
          processed frame is fully opaque: the raw, unblurred clip can never show through a
          blurred face. The canvas shares object-cover with the video, so the crop is
          identical. With the engine on, the raw camera frame is never visible behind the
          processed one either. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-testid="engine-canvas"
        // Fail-closed at the display: a broken engine must never leave the worker's
        // unblurred passthrough frame on screen.
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none${
          broken ? ' opacity-0' : ''
        }`}
      />
      {/* `fps` already lives in the engine card; this badge is the on-feed truth about
          what produced the pixels currently visible. */}
      <div
        className={`absolute bottom-12 right-2.5 px-2 py-1 rounded bg-black/80 text-[10px] font-mono border ${
          broken ? 'text-[#D73833] border-[#D73833]/40' : 'text-[#33E1FF] border-[#33E1FF]/40'
        }`}
      >
        {engineBadgeCopy({ status: engine.status, fps: engine.fps, useMock: USE_MOCK })}
      </div>
    </>
  );
}
