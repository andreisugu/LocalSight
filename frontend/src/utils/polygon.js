// Polygon geometry for the zone editor. Points are normalised { x, y } in 0..1.
//
// The editor needs to know whether a draft outline crosses itself before it lets the
// operator save. This module answers that with a parametric segment test: the two lines
// p1 + t·r and p3 + u·s are solved for (t, u) with cross products instead of classifying
// four orientation signs. The collinear/overlapping and endpoint-touching cases take a
// separate branch that asks whether an endpoint lies on the other segment.
//
// Everything here is pure and dependency-free. Coordinates are normalised, so EPS is far
// below one screen pixel; it absorbs floating-point noise and never moves a point.

const EPS = 1e-9;

/** 2-D cross product of the vectors (ux, uy) and (vx, vy). */
function cross(ux, uy, vx, vy) {
  return ux * vy - uy * vx;
}

/**
 * Does p lie on the closed segment a-b? Collinearity is a cross-product test; the
 * position along the segment is an inclusive coordinate box, which is exactly what an
 * on-segment test needs and is more forgiving than a projection at the endpoints.
 */
function onSegment(a, b, p) {
  if (Math.abs(cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y)) > EPS) return false;
  return (
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

/**
 * Do segments p1-p2 and p3-p4 share any point (crossing, touching at an endpoint, or
 * overlapping collinearly)?
 */
export function segmentsIntersect(p1, p2, p3, p4) {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = p4.x - p3.x;
  const sy = p4.y - p3.y;
  const qx = p3.x - p1.x;
  const qy = p3.y - p1.y;

  const denominator = cross(rx, ry, sx, sy);

  // Parallel or collinear segments have no unique (t, u) solution, so they get their
  // own path: they meet only when an endpoint of one lies on the other.
  if (Math.abs(denominator) <= EPS) {
    return (
      onSegment(p1, p2, p3) ||
      onSegment(p1, p2, p4) ||
      onSegment(p3, p4, p1) ||
      onSegment(p3, p4, p2)
    );
  }

  // p1 + t·r = p3 + u·s. A proper crossing has both parameters strictly inside (0, 1);
  // the tolerance is the segment-scale equivalent of the EPS used on cross products.
  const t = cross(qx, qy, sx, sy) / denominator;
  const u = cross(qx, qy, rx, ry) / denominator;
  const tolerance = EPS / Math.abs(denominator);

  if (t > tolerance && t < 1 - tolerance && u > tolerance && u < 1 - tolerance) {
    return true;
  }

  // Not a proper crossing, but the lines still meet: it can be an endpoint touch.
  return (
    onSegment(p1, p2, p3) ||
    onSegment(p1, p2, p4) ||
    onSegment(p3, p4, p1) ||
    onSegment(p3, p4, p2)
  );
}

/**
 * Indices of the edges that cross another, non-adjacent edge. Edge i joins point i to
 * point i + 1; with `closed`, the last edge joins the last point back to the first.
 *
 * Adjacency is precomputed in a matrix: adjacent edges share an endpoint by construction
 * and are skipped, so only independent pairs reach the segment test.
 */
export function crossingEdges(points, closed = true) {
  const n = points.length;
  // A polygon needs at least four points to cross itself (a triangle cannot).
  if (n < 4) return new Set();

  const edgeCount = closed ? n : n - 1;
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    from: points[index],
    to: points[(index + 1) % n],
  }));

  const adjacent = Array.from({ length: edgeCount }, () =>
    new Array(edgeCount).fill(false)
  );
  for (let i = 0; i < edgeCount - 1; i += 1) {
    adjacent[i][i + 1] = true;
    adjacent[i + 1][i] = true;
  }
  if (closed && edgeCount > 1) {
    adjacent[edgeCount - 1][0] = true;
    adjacent[0][edgeCount - 1] = true;
  }

  const crossing = new Set();
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 1; j < edgeCount; j += 1) {
      if (adjacent[i][j]) continue;
      if (segmentsIntersect(edges[i].from, edges[i].to, edges[j].from, edges[j].to)) {
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
 * The comparator splits the plane into the same four arcs `Math.atan2` produces
 * ([-π, 0), 0, (0, π), π) and orders each arc by cross product. Equal directions fall
 * back to distance from the centroid, then to input order, so the result is deterministic
 * for duplicated rays.
 */
export function orderAroundCentroid(points) {
  if (points.length < 2) return [...points];

  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  /** Arc rank: 0 = (-π, 0), 1 = 0, 2 = (0, π), 3 = π. */
  function arc(dx, dy) {
    if (dy < 0) return 0;
    if (dy === 0) return dx >= 0 ? 1 : Object.is(dy, -0) ? 0 : 3;
    return 2;
  }

  const placed = points.map((point, index) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    return { point, index, dx, dy, arc: arc(dx, dy), distance: dx * dx + dy * dy };
  });

  placed.sort((a, b) => {
    if (a.arc !== b.arc) return a.arc - b.arc;
    const turn = cross(a.dx, a.dy, b.dx, b.dy);
    if (turn !== 0) return turn > 0 ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.index - b.index;
  });

  return placed.map((item) => item.point);
}
