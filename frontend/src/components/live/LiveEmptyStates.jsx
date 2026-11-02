import { Video, WifiOff } from 'lucide-react';

// The screen's non-feed states. Each one says exactly what is missing instead of leaving
// a gradient or a black rectangle that could pass for a running camera.

export function NoCameraScreen({ health, themeStyles }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 select-none">
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="max-w-lg w-full rounded-2xl border p-6 shadow-lg space-y-3 text-center"
      >
        <Video size={42} className="mx-auto text-[#D73833]" />
        <h2 className="font-black text-lg uppercase tracking-tight">Nu există feed încă</h2>
        <p style={{ color: themeStyles.textMuted }} className="text-sm">
          Build-ul static nu are camere încărcate. Camerele demo vin din fixture-uri;
          reîncarcă pagina dacă lista a rămas goală.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold"
        >
          Reîncarcă
        </button>
      </div>
    </div>
  );
}

export function SignalLost({ cameraId, fullscreen = false }) {
  if (fullscreen) {
    return (
      <div className="text-center p-8 text-[#D73833] font-mono">
        <WifiOff size={60} className="mx-auto mb-3" />
        <h3 className="text-3xl font-black tracking-widest">SEMNAL PIERDUT</h3>
        <p className="text-sm text-slate-400 mt-1">
          CAMERA {cameraId} ESTE MOMENTAN OFFLINE
        </p>
      </div>
    );
  }
  return (
    <div className="text-center p-6 text-[#D73833] font-mono">
      <WifiOff size={44} className="mx-auto mb-2" />
      <h3 className="text-xl font-black tracking-widest">SEMNAL PIERDUT</h3>
      <p className="text-xs text-slate-400 mt-1">
        CAMERA {cameraId?.toUpperCase()} ESTE MOMENTAN OFFLINE
      </p>
    </div>
  );
}

export function NoDemoFeed({ camera, demoCameraLabel }) {
  return (
    <div className="text-center p-6 max-w-md select-none">
      <WifiOff size={44} className="mx-auto mb-2 text-amber-400" />
      <p className="font-bold text-white text-sm">
        {camera?.code || camera?.id} nu are feed live în demo
      </p>
      <p className="text-slate-300 text-xs mt-1">
        Edge-ul rulează pe {demoCameraLabel}. Alege una dintre ele din meniul Cameră.
      </p>
    </div>
  );
}

// The last resort when neither a stream nor a clip loaded. The copy names which failure
// happened instead of pretending the rectangle is a feed.
export function StreamPlaceholder({ camera, videoFailed, streamFailed }) {
  return (
    <div className="text-center opacity-30 select-none">
      <Video size={56} className="mx-auto mb-1 text-slate-300" />
      <p className="font-mono font-bold text-white text-sm">{camera?.name?.toUpperCase()}</p>
      <p className="font-mono text-[11px] text-slate-300">
        {videoFailed
          ? 'CLIP DEMO INDISPONIBIL • FALLBACK GRAFIC'
          : streamFailed
            ? 'STREAM INDISPONIBIL • FALLBACK'
            : `LIVE ANNOTATED STREAM${camera?.fps ? ` • ${camera?.fps} FPS` : ''}`}
      </p>
    </div>
  );
}
