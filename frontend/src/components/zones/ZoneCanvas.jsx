import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, Wand2 } from 'lucide-react';

// A click this close to the first point closes the outline instead of adding a point.
const CLOSE_RADIUS_PX = 12;

/**
 * The drawing surface: reference frame, polygon outline, draggable vertices and the
 * "+" handle on every edge. It owns pointer geometry only; every change is reported
 * upwards, and the draft machine decides what is undoable.
 */
export default function ZoneCanvas({
  points,
  closed,
  selectedIndex,
  crossing,
  hasCrossing,
  referenceUrl,
  onAddPoint,
  onClose,
  onSelect,
  onBeginGesture,
  onEndGesture,
  onMovePoint,
  onInsertPoint,
  onDeletePoint,
  onReorder,
  onRedraw,
}) {
  const canvasRef = useRef(null);
  // The point being dragged; pointer capture keeps events on the canvas.
  const dragRef = useRef(null);
  // The click that ends a drag must not also add a point.
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [aspect, setAspect] = useState(null);

  // A new reference frame gets its own aspect ratio; keep the old one until it loads.
  useEffect(() => {
    setAspect(null);
  }, [referenceUrl]);

  const hasReference = Boolean(referenceUrl);
  const sized = hasReference && aspect;

  const pointFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const nearFirstPoint = (event) => {
    if (points.length < 3) return false;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = event.clientX - (rect.left + points[0].x * rect.width);
    const dy = event.clientY - (rect.top + points[0].y * rect.height);
    return Math.hypot(dx, dy) <= CLOSE_RADIUS_PX;
  };

  const startDrag = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current.setPointerCapture?.(event.pointerId);
    dragRef.current = { index };
    setDragging(true);
    onSelect(index);
    onBeginGesture();
  };

  const handleCanvasClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (closed) {
      onSelect(null);
      return;
    }
    if (nearFirstPoint(event)) {
      onClose();
      return;
    }
    onAddPoint(pointFromEvent(event));
  };

  const handleVertexPointerDown = (event, index) => {
    if (event.button !== 0) return;
    if (!closed && index === 0 && points.length >= 3) {
      // While drawing, the first point closes the zone instead of moving it.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    startDrag(event, index);
  };

  const handleEdgePointerDown = (event, edgeIndex) => {
    if (event.button !== 0) return;
    const a = points[edgeIndex];
    const b = points[(edgeIndex + 1) % points.length];
    startDrag(event, edgeIndex + 1);
    // The insert is part of the same gesture, so one undo removes the new point too.
    onInsertPoint(edgeIndex, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    onMovePoint(drag.index, pointFromEvent(event));
  };

  const handlePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    onEndGesture();
    suppressClickRef.current = true;
    // No click follows a cancelled or outside release; never eat the next real click.
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const handleDelete = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    onDeletePoint(index);
  };

  return (
    // The drawing surface keeps its own scroll-free box; the two actions that used to float
    // over the polygon live below it, so the frame is not covered by chrome (M13).
    <div className="min-w-0 space-y-2">
      <div
        data-testid="zone-canvas"
        ref={canvasRef}
        onClick={handleCanvasClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ ...(sized ? { aspectRatio: aspect } : {}), touchAction: 'none' }}
        className={`relative rounded-xl overflow-hidden bg-black border-2 border-slate-300 dark:border-[#D73833]/40 shadow-2xl select-none ${
          sized ? 'w-full max-h-[68vh] mx-auto' : 'min-h-[380px]'
        } ${dragging ? 'cursor-grabbing' : closed ? 'cursor-default' : 'cursor-crosshair'}`}
      >
        {hasReference ? (
          <img
            key={referenceUrl}
            src={referenceUrl}
            alt="Cadru de referință"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            draggable={false}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth && naturalHeight) setAspect(naturalWidth / naturalHeight);
            }}
            onError={() => setAspect(null)}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-black flex items-center justify-center">
            <p className="text-[11px] text-slate-400 font-mono text-center px-6">
              Fără cadru de referință. Încarcă unul din panoul din dreapta,
              <br />
              sau pornește edge-ul ca să apară imaginea camerei.
            </p>
          </div>
        )}

        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {points.length > 1 && closed && (
            <polygon
              points={points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
              fill={hasCrossing ? 'rgba(255, 235, 51, 0.25)' : 'rgba(215, 56, 51, 0.20)'}
              stroke="#D73833"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.length > 1 && !closed && (
            <polyline
              points={points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
              fill="none"
              stroke="#D73833"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="6,4"
            />
          )}
          {[...crossing].map((index) => {
            const a = points[index];
            const b = points[(index + 1) % points.length];
            return (
              <line
                key={`crossing-${index}`}
                x1={a.x * 1000}
                y1={a.y * 1000}
                x2={b.x * 1000}
                y2={b.y * 1000}
                stroke="#FFEB33"
                strokeWidth="5"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Midpoint handle on every edge: drag it to add a point exactly there. */}
        {closed &&
          points.length >= 3 &&
          points.map((a, index) => {
            const b = points[(index + 1) % points.length];
            return (
              <div
                key={`edge-${index}`}
                data-testid={`zone-edge-${index}`}
                onPointerDown={(event) => handleEdgePointerDown(event, index)}
                onClick={(event) => event.stopPropagation()}
                style={{ left: `${((a.x + b.x) / 2) * 100}%`, top: `${((a.y + b.y) / 2) * 100}%` }}
                className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 border border-white/80 text-white text-[10px] leading-[10px] flex items-center justify-center cursor-copy opacity-60 hover:opacity-100 after:absolute after:left-1/2 after:top-1/2 after:h-6 after:w-6 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
                title="Trage ca să adaugi un punct pe această latură"
              >
                +
              </div>
            );
          })}

        {points.map((point, index) => {
          const closesZone = !closed && index === 0 && points.length >= 3;
          const isSelected = selectedIndex === index;
          return (
            <div
              key={`point-${index}`}
              data-testid={`zone-point-${index}`}
              onPointerDown={(event) => handleVertexPointerDown(event, index)}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => handleDelete(event, index)}
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg after:absolute after:left-1/2 after:top-1/2 after:h-6 after:w-6 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] ${
                closesZone
                  ? 'w-5 h-5 bg-emerald-400 border-white ring-4 ring-emerald-400/40 cursor-pointer'
                  : isSelected
                  ? 'w-4 h-4 bg-[#FFEB33] border-white ring-4 ring-[#FFEB33]/50 cursor-grab'
                  : 'w-3.5 h-3.5 bg-white border-[#D73833] ring-2 ring-[#D73833]/50 cursor-grab'
              }`}
              title={
                closesZone
                  ? 'Click aici ca să închizi zona'
                  : `Punct ${index + 1} (${point.x.toFixed(3)}, ${point.y.toFixed(3)}): trage ca să-l muți, click dreapta ca să-l ștergi`
              }
            >
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/80 pointer-events-none">
                {index + 1}
              </span>
            </div>
          );
        })}

        {hasCrossing && (
          <div className="absolute top-3 left-3 right-3 bg-[#FFEB33] text-[#1F1F1F] px-3 py-1.5 rounded-lg text-[11px] font-bold shadow flex items-center gap-2 pointer-events-none">
            <AlertTriangle size={14} className="shrink-0 text-[#D73833]" aria-hidden="true" />
            Laturile marcate cu galben se intersectează: zona nu e un perimetru. Mută punctele sau
            reordonează-le.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {hasCrossing && (
          <button
            type="button"
            onClick={onReorder}
            className="min-h-[32px] px-2.5 py-1 rounded bg-[#FFEB33] hover:bg-yellow-400 text-[#1F1F1F] text-xs font-bold flex items-center gap-1 shadow"
            title="Ordonează punctele în jurul centrului zonei"
          >
            <Wand2 size={13} aria-hidden="true" /> Reordonează punctele
          </button>
        )}
        <button
          type="button"
          onClick={onRedraw}
          className="min-h-[32px] px-2.5 py-1 rounded bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold flex items-center gap-1 border border-[#D73833]"
          title="Șterge toate punctele și desenează zona din nou"
        >
          <Trash2 size={13} aria-hidden="true" /> Desenează din nou
        </button>
      </div>
    </div>
  );
}
