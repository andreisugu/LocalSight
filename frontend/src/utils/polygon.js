// Polygon geometry for the zone editor. Points are normalised { x, y } in 0..1.
//
// The same crossing check exists server-side (backend/app/geometry.py) and rejects a
// self-crossing polygon with 422, so the editor blocks Save before that happens. This
// module is deliberately pure and dependency-free; the rewrite keeps the public API
// (`segmentsIntersect`, `crossingEdges`, `orderAroundCentroid`) intact.

// Coordinates are normalised to 0..1, so 1e-9 is far below one screen pixel. It is used
// only to absorb floating-point noise in collinearity tests, never to move a point.
const EPS = 1e-9;

/** Signed area of the triangle (a, b, c); sign tells the turn direction. */
function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function sign(value) {
  if (value > EPS) return 1;
  if (value < -EPS) return -1;
  return 0;
}

/** Is p inside the axis-aligned box of the segment a-b (inclusive)? */
function withinBox(a, b, p) {
  return (
    Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS
  );
}

/**
 * Do segments p1-p2 and p3-p4 share any point (crossing, touching at an endpoint, or
 * overlapping collinearly)?
 */
export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);

  // Proper crossing: each segment has one endpoint on each side of the other.
  if (sign(d1) * sign(d2) < 0 && sign(d3) * sign(d4) < 0) return true;

  // Touching or collinear: the point must also lie within the segment's box.
  if (sign(d1) === 0 && withinBox(p3, p4, p1)) return true;
  if (sign(d2) === 0 && withinBox(p3, p4, p2)) return true;
  if (sign(d3) === 0 && withinBox(p1, p2, p3)) return true;
  if (sign(d4) === 0 && withinBox(p1, p2, p4)) return true;

  return false;
}

/**
 * Indices of the edges that cross another, non-adjacent edge. Edge i joins point i to
 * point i + 1; with `closed`, the last edge joins the last point back to the first.
 *
 * Adjacent edges share an endpoint by construction and are not treated as crossings.
 */
export function crossingEdges(points, closed = true) {
  const n = points.length;
  // A polygon needs at least four points to cross itself (a triangle cannot).
  if (n < 4) return new Set();

  const count = closed ? n : n - 1;
  const crossing = new Set();

  for (let i = 0; i < count; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < count; j += 1) {
      // Edge 0 and the closing edge are adjacent in a closed polygon.
      if (j === i + 1 || (closed && i === 0 && j === n - 1)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        crossing.add(i);
        crossing.add(j);
      }
    }
  }

  return crossing;
}

/**
 * The same points ordered by angle around their centroid. Untangles any convex shape and
 * most simple ones; a strongly concave outline can still come out wrong, so it is a
 * button, not an automatic fix.
 *
 * Equal angles are ordered by distance from the centroid so the result is deterministic
 * for duplicated directions (two points on the same ray from the centre).
 */
export function orderAroundCentroid(points) {
  if (points.length < 2) return [...points];

  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    if (angleA !== angleB) return angleA - angleB;

    const distanceA = (a.x - cx) ** 2 + (a.y - cy) ** 2;
    const distanceB = (b.x - cx) ** 2 + (b.y - cy) ** 2;
    return distanceA - distanceB;
  });
}
