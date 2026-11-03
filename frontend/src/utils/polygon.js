// Polygon geometry for the zone editor. Points are normalised { x, y } in 0..1.
//
// The editor has to know whether a draft outline crosses itself before it lets the operator
// save, and this module answers that with orientation signs: three points are clockwise,
// counter-clockwise or collinear, and two segments cross when their endpoints sit on
// opposite sides of each other. The collinear and endpoint-touching cases are decided by
// asking whether an endpoint lies inside the other segment's bounding box.
//
// Everything here is pure and dependency-free. Coordinates are normalised, so EPSILON is far
// below one screen pixel; it absorbs floating-point noise and never moves a point.
const EPSILON = 1e-9;
// -- orientation primitives ------------------------------------------------------------
// Twice the signed area of the triangle (a, b, c); negative is clockwise in screen space.
const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
// Collapse an orientation value to -1, 0 or +1, with EPSILON as the "collinear" band.
const orientationSign = (value) => {
  if (value > EPSILON) return 1;
  if (value < -EPSILON) return -1;
  return 0;
};
// Is p inside the axis-aligned box that a and b span? Inclusive by EPSILON on every side.
const insideBox = (a, b, p) => {
  const withinX = p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON;
  const withinY = p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
  return withinX && withinY;
};
// -- segment intersection --------------------------------------------------------------
// Do segments firstA-firstB and secondA-secondB share any point: crossing, touching at an
// endpoint, or overlapping collinearly?
//
// A proper crossing puts firstA and firstB on opposite sides of secondA-secondB *and*
// secondA and secondB on opposite sides of firstA-firstB, so both orientation products are
// negative. Anything else can only touch, which is the degenerate branch: an endpoint that
// lies on the other segment.
export const segmentsIntersect = (firstA, firstB, secondA, secondB) => {
  const firstASide = orientationSign(orientation(secondA, secondB, firstA));
  const firstBSide = orientationSign(orientation(secondA, secondB, firstB));
  const secondASide = orientationSign(orientation(firstA, firstB, secondA));
  const secondBSide = orientationSign(orientation(firstA, firstB, secondB));
  const properCrossing = firstASide * firstBSide < 0 && secondASide * secondBSide < 0;
  if (properCrossing) return true;
  const firstATouches = firstASide === 0 && insideBox(secondA, secondB, firstA);
  const firstBTouches = firstBSide === 0 && insideBox(secondA, secondB, firstB);
  const secondATouches = secondASide === 0 && insideBox(firstA, firstB, secondA);
  const secondBTouches = secondBSide === 0 && insideBox(firstA, firstB, secondB);
  return firstATouches || firstBTouches || secondATouches || secondBTouches;
};
// -- self-crossing detection -----------------------------------------------------------
// Indices of the edges that cross another, non-adjacent edge. Edge i joins point i to point
// i + 1; with `closed`, the last edge joins the last point back to the first.
//
// Adjacency is a predicate on indices, not a matrix: consecutive edges share an endpoint by
// construction (and so do the two edges that meet at the closing point), so only independent
// pairs reach the segment test. A polygon needs at least four points to cross itself.
export const crossingEdges = (points, closed = true) => {
  const pointCount = points.length;
  if (pointCount < 4) return new Set();
  const edgeCount = closed ? pointCount : pointCount - 1;
  const edge = (index) => [points[index], points[(index + 1) % pointCount]];
  const sharesEndpoint = (a, b) =>
    Math.abs(a - b) === 1 ||
    (closed && ((a === 0 && b === edgeCount - 1) || (b === 0 && a === edgeCount - 1)));
  const indices = Array.from({ length: edgeCount }, (_, index) => index);
  const crossingPairs = indices.flatMap((a) =>
    indices
      .filter((b) => b > a && !sharesEndpoint(a, b))
      .filter((b) => segmentsIntersect(...edge(a), ...edge(b)))
      .map((b) => [a, b])
  );
  return new Set(crossingPairs.flat());
};
// -- angular ordering ------------------------------------------------------------------
// The same points ordered by angle around their centroid. Untangles any convex shape and most
// simple ones; a strongly concave outline can still come out wrong, so it is a button, not an
// automatic fix.
const ARC_NOISE = 1e-15;
// Arc rank: 0 = (-π, 0), 1 = 0, 2 = (0, π), 3 = π. A negative zero still counts as "below".
const arcRank = (dx, dy) => {
  if (dy < 0) return 0;
  if (dy > 0) return 2;
  if (dx >= 0) return 1;
  return Object.is(dy, -0) ? 0 : 3;
};
// Cross product of two centroid-relative vectors, i.e. the turn from a to b.
const turnBetween = (a, b) => a.dx * b.dy - a.dy * b.dx;
// The comparator splits the plane into the same four arcs `Math.atan2` produces and orders
// each arc by cross product. A turn smaller than double-precision resolution is a tie: there
// the exact `atan2` comparison is used, so near-collinear rays keep the deterministic order
// they had before. Equal directions fall back to distance, then to input order.
const compareAroundCentre = (a, b) => {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const turn = turnBetween(a, b);
  // Below this relative size the cross product is rounding noise, not a direction.
  if (Math.abs(turn) > ARC_NOISE * Math.sqrt(a.radius * b.radius)) return turn > 0 ? -1 : 1;
  if (a.angle !== b.angle) return a.angle - b.angle;
  if (a.radius !== b.radius) return a.radius - b.radius;
  return a.index - b.index;
};
const centroidOf = (points) => {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: total.x / points.length, y: total.y / points.length };
};
const describeAround = (point, index, centre) => {
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    point,
    index,
    dx,
    dy,
    rank: arcRank(dx, dy),
    radius: dx * dx + dy * dy,
    angle: Math.atan2(dy, dx),
  };
};
export const orderAroundCentroid = (points) => {
  if (points.length < 2) return [...points];
  const centre = centroidOf(points);
  return points
    .map((point, index) => describeAround(point, index, centre))
    .sort(compareAroundCentre)
    .map((record) => record.point);
};
