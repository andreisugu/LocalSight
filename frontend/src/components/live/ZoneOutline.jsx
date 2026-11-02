import { outlineForZone } from './liveMedia';

// The zone outline is configuration, not a detection: it is drawn from the zone editor's
// polygon and stays visible when the engine is off so the visitor still sees where the
// rule applies. It is never derived from an incident track, and the label says so.
export default function ZoneOutline({ zone }) {
  const outline = outlineForZone(zone);
  if (!outline) return null;

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <polygon
          points={outline.pointsAttr}
          fill="rgba(255,235,51,0.10)"
          stroke="#FFEB33"
          strokeWidth="2"
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The label belongs to the polygon's own corner: keeping it away from the bottom
          centre leaves the honest note and its button unobstructed. */}
      <div
        style={{ left: `${outline.leftPct}%`, top: `${outline.topPct}%` }}
        className="absolute -translate-y-full pl-1 pb-0.5 pointer-events-none"
      >
        <span className="inline-block px-2 py-1 rounded bg-black/75 text-[#FFEB33] text-[10px] font-mono border border-[#FFEB33]/40 whitespace-nowrap">
          zonă configurată: {zone.zone_id} · nu este detecție
        </span>
      </div>
    </>
  );
}
