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
