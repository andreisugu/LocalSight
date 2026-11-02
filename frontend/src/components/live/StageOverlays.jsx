import React from 'react';
import { Camera, CameraOff, RotateCcw } from 'lucide-react';

// Small pieces of chrome drawn over the feed. They only report what the page already
// knows: the label of the source, the HUD resolution, the edge warning and the permission
// lifecycle of the local camera.

export function HudReadout({ resolution }) {
  return (
    <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-black/80 px-2.5 py-1 rounded-lg text-[10px] font-mono text-white border border-white/10 shadow">
      <span className="w-2 h-2 rounded-full bg-[#D73833] animate-ping" />
      <span className="font-bold text-red-400">LIVE REC</span>
      <span className="text-slate-400">|</span>
      <span>{resolution || '4K (3840x2160)'}</span>
    </div>
  );
}

// The demo clip is a recording; the local camera is a live track. Both badges say which
// one is on screen so nobody reads the loop as a real feed.
export function SourceBadge({ isWebcam }) {
  if (isWebcam) {
    return (
      <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded bg-black/75 text-[#33E1FF] text-[10px] font-mono border border-[#33E1FF]/40">
        CAMERĂ LOCALĂ • getUserMedia
      </div>
    );
  }
  return (
    <div className="absolute top-11 left-2.5 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
      ÎNREGISTRARE • DEMO STATIC
    </div>
  );
}

export function EdgeWarning() {
  return (
    <div className="absolute top-2.5 right-2.5 max-w-xs px-2.5 py-1.5 rounded-lg bg-amber-500/95 text-slate-950 text-[10px] font-bold shadow border border-amber-300">
      Fără telemetrie edge în build-ul static. Detecția rulează în browser când o pornești.
    </div>
  );
}

export function DemoClipSource({ demoClip }) {
  return (
    <div className="absolute bottom-12 left-2.5 px-2 py-1 rounded bg-black/75 text-white text-[10px] font-mono border border-white/10">
      Sursă demo: {demoClip}
    </div>
  );
}

export function CameraFooter({ camera, isWebcam }) {
  return (
    <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-black/75 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10 flex items-center justify-between text-xs">
      <div>
        <p className="font-bold text-white text-xs leading-none">{camera?.name}</p>
        <p className="text-[10px] text-slate-300 font-normal mt-0.5 leading-none">{camera?.subtitle}</p>
      </div>
      <span className="text-[10px] font-mono text-slate-400">
        {isWebcam
          ? 'SURSĂ: camera acestui dispozitiv'
          : `RTSP: ${camera?.rtsp_url ? camera?.rtsp_url.split('/').pop() : camera?.id}`}
      </span>
    </div>
  );
}

// Permission lifecycle, same copy as /lab: a pending grant says what it waits for, a
// failure says what the browser answered.
export function WebcamRequestCard() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/80">
      <Camera size={34} className="text-[#33E1FF]" />
      <p className="text-white text-sm font-bold">Se cere accesul la cameră…</p>
      <p className="text-slate-300 text-xs">Confirmă permisiunea în browser.</p>
    </div>
  );
}

export function WebcamErrorCard({ error, onRetry }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-4 bg-black/85">
      <CameraOff size={34} className="text-[#D73833]" />
      <p className="text-white text-sm font-bold">{error.title}</p>
      <p className="text-slate-300 text-xs max-w-sm">{error.detail}</p>
      <p className="font-mono text-[10px] text-slate-500">
        {[error.name, error.message].filter(Boolean).join(': ')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 px-3 py-1.5 rounded-lg bg-[#33E1FF] hover:bg-[#7EEBFF] text-[#1F1F1F] text-[11px] font-bold inline-flex items-center gap-1.5 shadow"
      >
        <RotateCcw size={13} />
        Încearcă din nou
      </button>
      <p className="text-[10px] text-slate-400">sau alege altă cameră din meniul Cameră</p>
    </div>
  );
}
