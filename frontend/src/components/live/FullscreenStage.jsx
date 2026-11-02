import React from 'react';
import { Minimize2, Power, Video } from 'lucide-react';
import { SignalLost } from './LiveEmptyStates';

// Immersive mode renders the raw source in its own React tree, exactly like the inherited
// screen did. It is never reachable while the browser engine is on (the toolbar disables
// the button and LiveView drops out of this mode if the preference flips), because this
// tree has no canvas and would show unblurred faces full-screen.
export default function FullscreenStage({
  activeCamera,
  isOffline,
  showStream,
  showDemoVideo,
  demoVideoSrc,
  noLiveForCamera,
  demoCameraLabel,
  onStreamError,
  onVideoError,
  onToggleEngine,
  onExit,
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none">
      <div className="h-14 bg-[#141414]/90 backdrop-blur px-6 flex items-center justify-between border-b border-white/10 z-10">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[#D73833] animate-ping" />
          <div>
            <h2 className="text-white font-bold text-sm tracking-wide">{activeCamera?.name}</h2>
            <p className="text-[11px] text-slate-400">
              {activeCamera?.subtitle} • {activeCamera?.resolution}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggleEngine(activeCamera?.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
              activeCamera?.engine_on
                ? 'bg-[#FFEB33] text-[#1F1F1F] font-bold font-black'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Power size={13} />
            MOTOR: {activeCamera?.engine_on ? 'PORNIT' : 'OPRIT'}
          </button>

          <button
            onClick={onExit}
            className="px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center gap-1.5 transition-all"
          >
            <Minimize2 size={14} />
            <span>Ieșire ecran complet</span>
          </button>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black p-4">
        {isOffline ? (
          <SignalLost cameraId={activeCamera?.id} fullscreen />
        ) : (
          <div className="w-full max-w-6xl aspect-video bg-gradient-to-br from-slate-950 to-black relative flex items-center justify-center rounded-2xl overflow-hidden shadow-2xl border border-white/10">
            {showStream ? (
              <img
                src={activeCamera?.stream_url}
                alt={`Flux ${activeCamera?.id}`}
                className="w-full h-full object-cover"
                onError={onStreamError}
              />
            ) : showDemoVideo ? (
              <>
                <video
                  key={demoVideoSrc}
                  src={demoVideoSrc}
                  className="w-full h-full object-cover"
                  autoPlay
                  loop
                  muted
                  playsInline
                  aria-label={`Clip demo ${activeCamera?.id}`}
                  onError={onVideoError}
                />
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
                  ÎNREGISTRARE • DEMO STATIC
                </div>
              </>
            ) : (
              <div className="text-center opacity-25 select-none">
                <Video size={100} className="mx-auto mb-3 text-slate-300" />
                <p className="font-mono font-bold text-white text-xl">
                  {activeCamera?.name?.toUpperCase()}
                </p>
                <p className="font-mono text-sm text-slate-300">
                  {noLiveForCamera
                    ? `Fără feed live pe ${activeCamera?.code || activeCamera?.id}; demo rulează pe ${demoCameraLabel}.`
                    : `LIVE FEED${activeCamera?.fps ? ` • ${activeCamera.fps} FPS` : ''}`}
                </p>
              </div>
            )}

            {/* Fullscreen renders the raw clip and no engine overlay: say so instead of
                leaving the visitor to guess whether the boxes are real. */}
            {showDemoVideo && (
              <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-black/75 text-[#FFEB33] text-[10px] font-mono border border-[#FFEB33]/40">
                detecția este oprită — cutiile nu urmăresc video
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
