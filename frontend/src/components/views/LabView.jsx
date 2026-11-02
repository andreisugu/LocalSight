import React, { useEffect, useRef, useState } from 'react';
import { Activity, Cpu, Upload, Video } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useEngine } from '../../engine/useEngine';

const MODEL_HINT = `${import.meta.env.BASE_URL}models/yolo26n.onnx + ${import.meta.env.BASE_URL}models/yunet.onnx`;

// Spike page: proves YOLO + YuNet run in the browser on a looping clip. No backend, no
// zones, no incidents - the pipeline pieces live in src/engine and can be promoted later.
export default function LabView() {
  const { themeStyles } = useTheme();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [clipUrl, setClipUrl] = useState(import.meta.env.VITE_DEMO_VIDEO || '');
  const [objectUrl, setObjectUrl] = useState('');

  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: Boolean(clipUrl),
  });

  // Revoke the blob URL of a picked file when it is replaced or the page unmounts.
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const onPickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setClipUrl(url);
  };

  const statusLabel = {
    idle: 'waiting for a clip',
    loading: 'loading models',
    running: 'running',
    error: 'engine error',
    unsupported: 'unsupported browser',
  }[engine.status] || engine.status;

  const badgeColour = engine.status === 'running'
    ? '#33E1FF'
    : engine.status === 'error' || engine.status === 'unsupported'
      ? '#FF5C5C'
      : '#FFEB33';

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: themeStyles.textColor }}>
            <Activity size={18} />
            Lab - in-browser engine
          </h1>
          <p className="text-sm opacity-60" style={{ color: themeStyles.textColor }}>
            YOLO person detection and YuNet face blur, ONNX Runtime Web, no backend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2"
            style={{ backgroundColor: themeStyles.cardBg, color: themeStyles.textColor }}
          >
            <Upload size={14} />
            Pick a clip
            <input type="file" accept="video/*" className="hidden" onChange={onPickFile} />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: themeStyles.textColor }}>
        <span className="flex items-center gap-1">
          <Cpu size={14} />
          status: <strong style={{ color: badgeColour }}>{statusLabel}</strong>
        </span>
        <span>fps: <strong>{engine.fps || '—'}</strong></span>
        <span>persons: <strong>{engine.persons}</strong></span>
        <span>faces: <strong>{engine.faces}</strong></span>
        <span>frame: <strong>{engine.ms ? `${engine.ms} ms` : '—'}</strong></span>
        <span className="opacity-60">
          provider: {engine.providers.length ? engine.providers.join(' → ') : '—'}
        </span>
      </div>

      {(engine.status === 'error' || engine.status === 'unsupported') && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ borderColor: '#FF5C5C', color: themeStyles.textColor, backgroundColor: themeStyles.cardBg }}
        >
          <div className="font-semibold">Engine not running</div>
          <div className="opacity-70">{engine.message || 'Unknown error.'}</div>
          <div className="opacity-50 mt-1 font-mono text-xs">
            Expected models at {MODEL_HINT}. The clip still plays below; without the graphs
            the canvas has nothing to draw.
          </div>
        </div>
      )}

      {engine.status === 'loading' && (
        <div className="text-sm opacity-60" style={{ color: themeStyles.textColor }}>
          {engine.message || 'Loading the models...'} (first load is tens of MB)
        </div>
      )}

      <div className="relative rounded overflow-hidden" style={{ backgroundColor: '#000' }}>
        <canvas
          ref={canvasRef}
          className="block w-full h-auto max-h-[70vh] object-contain"
        />
        {!clipUrl && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
            style={{ color: themeStyles.textColor }}
          >
            <Video size={28} />
            <span>Pick a local clip to start the engine.</span>
            <span className="opacity-50 font-mono text-xs">
              VITE_DEMO_VIDEO is not set, so no default clip is loaded.
            </span>
          </div>
        )}
      </div>

      {/* The source video stays hidden: the canvas shows the processed frames, this element
          only feeds them. */}
      <video
        ref={videoRef}
        src={clipUrl || undefined}
        className="hidden"
        loop
        muted
        playsInline
        autoPlay
        preload="auto"
      />

      <p className="text-xs opacity-50" style={{ color: themeStyles.textColor }}>
        Spike only: person boxes, face blur and fps. Zones, incidents and reports are not
        wired here.
      </p>
    </div>
  );
}
