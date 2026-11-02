import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentsIntersect, crossingEdges, orderAroundCentroid } from './polygon.js';

const p = (x, y) => ({ x, y });

test('segments crossing in the middle intersect', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(1, 1), p(0, 1), p(1, 0)), true);
});

test('segments sharing an endpoint intersect (and the editor blocks the polygon)', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(1, 1), p(1, 1), p(2, 0)), true);
});

test('collinear overlapping segments intersect', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(2, 0), p(1, 0), p(3, 0)), true);
});

test('collinear but disjoint segments do not intersect', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(1, 0), p(2, 0), p(3, 0)), false);
});

test('parallel segments do not intersect', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(1, 0), p(0, 1), p(1, 1)), false);
});

test('a T-junction intersects', () => {
  assert.equal(segmentsIntersect(p(0, 0), p(2, 0), p(1, -1), p(1, 1)), true);
});

test('a square has no crossing edges', () => {
  const square = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
  assert.deepEqual([...crossingEdges(square)], []);
});

test('a bow-tie reports both crossing edges', () => {
  const bowTie = [p(0, 0), p(1, 1), p(1, 0), p(0, 1)];
  assert.deepEqual([...crossingEdges(bowTie)].sort((a, b) => a - b), [0, 2]);
});

test('a concave L-shape is not a crossing', () => {
  const shape = [p(0, 0), p(1, 0), p(1, 0.5), p(0.5, 0.5), p(0.5, 1), p(0, 1)];
  assert.deepEqual([...crossingEdges(shape)], []);
});

test('open polylines use n-1 edges and still detect a crossing', () => {
  const open = [p(0, 0), p(1, 1), p(1, 0), p(0, 1)];
  assert.deepEqual([...crossingEdges(open, false)].sort((a, b) => a - b), [0, 2]);
});

test('fewer than four points cannot cross', () => {
  assert.equal(crossingEdges([p(0, 0), p(1, 1), p(0, 1)]).size, 0);
  assert.equal(crossingEdges([]).size, 0);
});

test('ordering around the centroid produces a cyclic order of the same points', () => {
  const square = [p(0, 0), p(1, 1), p(1, 0), p(0, 1)];
  const ordered = orderAroundCentroid(square);
  assert.equal(ordered.length, 4);
  assert.deepEqual(
    [...ordered].sort((a, b) => (a.x - b.x) || (a.y - b.y)),
    [...square].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  );
  // Consecutive points in the result are adjacent corners of the square, never diagonals.
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1);
  }
});

test('equal angles are ordered by distance, deterministically', () => {
  const points = [p(2, 0), p(-1, 0), p(1, 0)];
  const ordered = orderAroundCentroid(points);
  assert.deepEqual(ordered.map((q) => q.x), [1, 2, -1]);
});

test('ordering a single point returns a copy', () => {
  const only = p(0.3, 0.7);
  const out = orderAroundCentroid([only]);
  assert.notEqual(out, [only]);
  assert.deepEqual(out, [only]);
});

// ---------------------------------------------------------------------------
// Property tests. The 14 examples above pin the expected behaviour; these gen-
// erate inputs instead, so a different implementation still has to agree with
// an independent orientation-sign reference over thousands of cases.
// ---------------------------------------------------------------------------

const EPS = 1e-9;

/** Deterministic LCG: a failure is reproducible from the printed seed. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Independent reference: the classic four orientation-sign test. */
function referenceSegmentsIntersect(a, b, c, d) {
  const orient = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const sign = (value) => (value > EPS ? 1 : value < -EPS ? -1 : 0);
  const inBox = (u, v, w) =>
    w.x >= Math.min(u.x, v.x) - EPS &&
    w.x <= Math.max(u.x, v.x) + EPS &&
    w.y >= Math.min(u.y, v.y) - EPS &&
    w.y <= Math.max(u.y, v.y) + EPS;

  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);

  if (sign(d1) * sign(d2) < 0 && sign(d3) * sign(d4) < 0) return true;
  if (sign(d1) === 0 && inBox(c, d, a)) return true;
  if (sign(d2) === 0 && inBox(c, d, b)) return true;
  if (sign(d3) === 0 && inBox(a, b, c)) return true;
  if (sign(d4) === 0 && inBox(a, b, d)) return true;
  return false;
}

test('property: 5,000 random segments match an independent orientation reference', () => {
  const random = makeRandom(0x5afe5167);
  const unit = () => random();

  for (let caseIndex = 0; caseIndex < 5000; caseIndex += 1) {
    const mode = Math.floor(random() * 6);
    let a = p(unit(), unit());
    let b = p(unit(), unit());
    let c = p(unit(), unit());
    let d = p(unit(), unit());

    if (mode === 1) {
      // Quarter-grid points: many endpoint touches and exact collinearities.
      const grid = () => Math.round(unit() * 8) / 8;
      a = p(grid(), grid());
      b = p(grid(), grid());
      c = p(grid(), grid());
      d = p(grid(), grid());
    } else if (mode === 2) {
      // Shared endpoint, in either direction.
      c = random() < 0.5 ? p(a.x, a.y) : p(b.x, b.y);
    } else if (mode === 3) {
      // Four points on one line, so overlap/disjoint are both likely.
      const ox = unit();
      const oy = unit();
      const dx = unit() - 0.5;
      const dy = unit() - 0.5;
      const at = () => (unit() - 0.5) * 3;
      a = p(ox + at() * dx, oy + at() * dy);
      b = p(ox + at() * dx, oy + at() * dy);
      c = p(ox + at() * dx, oy + at() * dy);
      d = p(ox + at() * dx, oy + at() * dy);
    } else if (mode === 4) {
      // Degenerate segments: both point-like, or one point-like.
      b = random() < 0.5 ? p(a.x, a.y) : p(a.x + 1e-12, a.y - 1e-12);
      if (random() < 0.5) d = p(c.x, c.y);
    } else if (mode === 5) {
      // Almost-touching endpoints, within a few EPS.
      c = p(b.x + (unit() - 0.5) * 4e-9, b.y + (unit() - 0.5) * 4e-9);
    }

    const expected = referenceSegmentsIntersect(a, b, c, d);
    const actual = segmentsIntersect(a, b, c, d);
    assert.equal(
      actual,
      expected,
      `case ${caseIndex}: ${JSON.stringify({ a, b, c, d })}`
    );
  }
});

test('property: random simple polygons have no crossing edges', () => {
  const random = makeRandom(0x51a9e1);
  for (let caseIndex = 0; caseIndex < 500; caseIndex += 1) {
    const count = 3 + Math.floor(random() * 10);
    const step = (Math.PI * 2) / count;
    // Star-shaped: one vertex per ray, with every angular gap below pi so the
    // centroid stays inside the outline. Any positive radius keeps it simple.
    const polygon = Array.from({ length: count }, (_, index) => {
      const angle = index * step + (random() - 0.5) * step * 0.6;
      const radius = 0.1 + random() * 0.4;
      return p(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
    });
    assert.deepEqual(
      [...crossingEdges(polygon)],
      [],
      `simple polygon ${caseIndex} reported a crossing`
    );
  }
});

test('property: bow-ties always report crossings', () => {
  const random = makeRandom(0xb0a712);
  for (let caseIndex = 0; caseIndex < 300; caseIndex += 1) {
    // Random invertible affine transform of the canonical bow-tie, plus jitter.
    const angle = random() * Math.PI * 2;
    const scale = 0.2 + random() * 0.6;
    const cos = Math.cos(angle) * scale;
    const sin = Math.sin(angle) * scale;
    const tx = 0.2 + random() * 0.6;
    const ty = 0.2 + random() * 0.6;
    const jitter = () => (random() - 0.5) * 0.01;
    const transform = (x, y) =>
      p(tx + x * cos - y * sin + jitter(), ty + x * sin + y * cos + jitter());

    const bowTie = [transform(0, 0), transform(1, 1), transform(1, 0), transform(0, 1)];
    assert.deepEqual(
      [...crossingEdges(bowTie)].sort((a, b) => a - b),
      [0, 2],
      `bow-tie ${caseIndex} did not report its two crossing edges`
    );
  }
});

test('property: ordering is a permutation and cyclic for convex shapes', () => {
  const random = makeRandom(0xc0a7e1);
  const key = (point) => `${point.x.toFixed(12)},${point.y.toFixed(12)}`;

  for (let caseIndex = 0; caseIndex < 500; caseIndex += 1) {
    const count = 3 + Math.floor(random() * 10);
    const step = (Math.PI * 2) / count;
    // Points on an ellipse are strictly convex; the jitter only changes the
    // spacing, never the curvature sign, and every angular gap stays below pi.
    const convex = Array.from({ length: count }, (_, index) => {
      const angle = index * step + (random() - 0.5) * step * 0.5;
      return p(0.5 + Math.cos(angle) * 0.35, 0.5 + Math.sin(angle) * 0.25);
    });
    const shuffled = [...convex].sort(() => random() - 0.5);

    const ordered = orderAroundCentroid(shuffled);

    // Same multiset, same length: ordering never invents or drops a point.
    assert.deepEqual(ordered.map(key).sort(), shuffled.map(key).sort());
    // A valid cyclic order of a convex outline has no crossing edges.
    assert.deepEqual(
      [...crossingEdges(ordered)],
      [],
      `convex ordering ${caseIndex} was not cyclic`
    );

    // Walking the result visits the angles counter-clockwise with exactly one wrap.
    const cx = ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length;
    const cy = ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length;
    const anglesOut = ordered.map((point) => {
      const angle = Math.atan2(point.y - cy, point.x - cx);
      return angle < 0 ? angle + Math.PI * 2 : angle;
    });
    let descents = 0;
    for (let i = 0; i < anglesOut.length; i += 1) {
      const next = anglesOut[(i + 1) % anglesOut.length];
      if (next < anglesOut[i]) descents += 1;
    }
    assert.equal(descents, 1, `convex ordering ${caseIndex} did not wrap once`);
  }
});
