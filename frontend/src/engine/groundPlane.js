// Metric ground plane: four clicked ground points turn the tracker's foot points from
// frame-normalized image coordinates into metres on the apron.
//
// This is the prototype from `docs/product/innovation-engine.md` §2.1. It is deliberately
// pure: no DOM, no model, no dependency. The calibration UI in `/lab` supplies four image
// points (in order around the rectangle) and the real rectangle they enclose; everything
// else is arithmetic. Live, the rules and the event contract do not read any of it yet.
//
// Why a homography and not one scale factor: a camera looks at the apron at an angle, so a
// metre near the bottom of the frame covers more pixels than a metre near the horizon. A
// projective map (3x3, eight degrees of freedom after fixing the scale) is the exact model
// for a planar ground surface seen by a pinhole camera. Four point pairs fit it exactly,
// which is why four clicks are enough, and also why the fit itself cannot report an error: a
// bad calibration is silent here, so the UI must label the result as a prototype.
//
// Numerical notes:
// - the eight unknowns come from an 8x8 linear system solved by Gaussian elimination with
//   partial pivoting; no matrix library, no 12x12 adjugate;
// - both point sets are normalized before the solve (Hartley: centroid at the origin, mean
//   distance sqrt(2)), because raw pixel coordinates make the system badly conditioned;
// - degenerate input (collinear, duplicated, non-finite) makes the system singular, and the
//   fit is rejected instead of producing metres out of noise.
//
// Conventions: a point is `{ x, y }`; a homography is a flat row-major array of nine
// numbers; a person's foot point is the bottom-centre of their box, exactly the
// `[(x1 + x2) / 2, y2]` that `ZoneMembership.update` already uses.

/** Largest accepted residual after the solve, relative to the ground rectangle size. */
const REPROJECTION_TOLERANCE = 1e-6;
/** A homogeneous denominator below this means the point maps to infinity. */
const DENOMINATOR_EPSILON = 1e-12;
/** Pivot below this makes the 8x8 system effectively singular on normalized coordinates. */
const PIVOT_EPSILON = 1e-10;

/**
 * @typedef {{ x: number, y: number }} Point2
 * @typedef {[number, number, number, number, number, number, number, number, number]} Homography
 *   Row-major 3x3: `[h11, h12, h13, h21, h22, h23, h31, h32, h33]`.
 */

/**
 * @param {unknown} point
 * @returns {boolean} A point with two finite coordinates.
 */
function isPoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

/**
 * @param {unknown} points
 * @returns {boolean} Exactly four finite points.
 */
function isPointQuad(points) {
  return Array.isArray(points) && points.length === 4 && points.every(isPoint);
}

/**
 * Hartley normalization of one point set: centroid at the origin, mean distance sqrt(2).
 *
 * The map is the similarity `p' = s * (p - c)`; `inverse` is its 3x3 matrix form, which is
 * what the denormalization of the homography needs.
 *
 * @param {Point2[]} points
 * @returns {{ points: Point2[], forward: number[], inverse: number[] } | null}
 *   Normalized points plus the 3x3 maps in both directions, or `null` when the set has no
 *   spread (every point identical), which no rectangle can have.
 */
function normalizePoints(points) {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const meanDistance =
    points.reduce((sum, point) => sum + Math.hypot(point.x - cx, point.y - cy), 0) /
    points.length;
  if (!(meanDistance > 0) || !Number.isFinite(meanDistance)) return null;
  const factor = Math.SQRT2 / meanDistance;
  const forward = [factor, 0, -factor * cx, 0, factor, -factor * cy, 0, 0, 1];
  const inverse = [1 / factor, 0, cx, 0, 1 / factor, cy, 0, 0, 1];
  if (!forward.every(Number.isFinite) || !inverse.every(Number.isFinite)) return null;
  return {
    points: points.map((point) => ({ x: (point.x - cx) * factor, y: (point.y - cy) * factor })),
    forward,
    inverse,
  };
}

/**
 * Solve `matrix * x = rhs` in place with Gaussian elimination and partial pivoting.
 *
 * @param {number[][]} matrix Square matrix, modified in place.
 * @param {number[]} rhs Right-hand side, modified in place.
 * @returns {number[] | null} The solution, or `null` when a pivot vanishes (singular).
 */
function solveLinearSystem(matrix, rhs) {
  const size = matrix.length;
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(matrix[pivotRow][column]) < PIVOT_EPSILON) return null;
    if (pivotRow !== column) {
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
      [rhs[column], rhs[pivotRow]] = [rhs[pivotRow], rhs[column]];
    }
    const pivot = matrix[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / pivot;
      if (factor === 0) continue;
      for (let inner = column; inner < size; inner += 1) {
        matrix[row][inner] -= factor * matrix[column][inner];
      }
      rhs[row] -= factor * rhs[column];
    }
  }
  const solution = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = rhs[row];
    for (let column = row + 1; column < size; column += 1) {
      sum -= matrix[row][column] * solution[column];
    }
    solution[row] = sum / matrix[row][row];
  }
  return solution;
}

/**
 * Multiply two row-major 3x3 matrices.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]}
 */
function multiply3(a, b) {
  const out = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let inner = 0; inner < 3; inner += 1) {
        sum += a[row * 3 + inner] * b[inner * 3 + column];
      }
      out[row * 3 + column] = sum;
    }
  }
  return out;
}

/**
 * Fit the homography that maps four image points onto four ground points, in metres.
 *
 * The point order is the rectangle order: `dst[0]` is the origin, and the UI offers
 * `[[0, 0], [w, 0], [w, h], [0, h]]`.
 *
 * @param {Point2[]} src Four image points, e.g. frame-normalized or pixels.
 * @param {Point2[]} dst Four ground points, in metres.
 * @returns {Homography | null} The row-major 3x3 matrix, or `null` when the input is
 *   malformed, the points are collinear or duplicated, or the fit is numerically meaningless.
 */
export function homographyFromPoints(src, dst) {
  if (!isPointQuad(src) || !isPointQuad(dst)) return null;

  const srcNorm = normalizePoints(src);
  const dstNorm = normalizePoints(dst);
  if (!srcNorm || !dstNorm) return null;

  // Two equations per correspondence, with h33 fixed to 1:
  //   h11 x + h12 y + h13 - u h31 x - u h32 y = u
  //   h21 x + h22 y + h23 - v h31 x - v h32 y = v
  const matrix = [];
  const rhs = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = srcNorm.points[index];
    const { x: u, y: v } = dstNorm.points[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }

  const solution = solveLinearSystem(matrix, rhs);
  if (!solution || !solution.every(Number.isFinite)) return null;

  // Denormalize: H = T_dst^-1 * H_norm * T_src.
  const normalized = /** @type {number[]} */ ([...solution, 1]);
  const homography = multiply3(
    multiply3(dstNorm.inverse, normalized),
    srcNorm.forward,
  );
  if (!homography.every(Number.isFinite)) return null;

  // Fix the arbitrary scale so the matrix reads like a normal 3x3 homography.
  const scale = Math.abs(homography[8]) > DENOMINATOR_EPSILON
    ? homography[8]
    : Math.max(...homography.map(Math.abs)) || 1;
  const fixed = homography.map((value) => value / scale);
  if (!fixed.every(Number.isFinite)) return null;

  // Four points fit exactly; anything above round-off means the set was near-degenerate and
  // the solve amplified noise. A monotone camera map does not.
  const extent = Math.max(
    Math.abs(dst[0].x - dst[2].x),
    Math.abs(dst[1].x - dst[3].x),
    Math.abs(dst[0].y - dst[2].y),
    Math.abs(dst[1].y - dst[3].y),
    1,
  );
  for (let index = 0; index < 4; index += 1) {
    const projected = projectPoint(fixed, src[index]);
    if (!projected) return null;
    const error = Math.hypot(projected.x - dst[index].x, projected.y - dst[index].y);
    if (!(error <= REPROJECTION_TOLERANCE * extent)) return null;
  }

  return /** @type {Homography} */ (fixed);
}

/**
 * Map one point through a homography.
 *
 * @param {number[] | null | undefined} homography Row-major 3x3.
 * @param {Point2 | null | undefined} point
 * @returns {Point2 | null} The mapped point, or `null` for a malformed matrix, a malformed
 *   point, a point at infinity, or a non-finite result.
 */
export function projectPoint(homography, point) {
  if (
    !Array.isArray(homography) ||
    homography.length !== 9 ||
    !homography.every(Number.isFinite) ||
    !isPoint(point)
  ) {
    return null;
  }
  const denominator = homography[6] * point.x + homography[7] * point.y + homography[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < DENOMINATOR_EPSILON) return null;
  const x = (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator;
  const y = (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * A calibration matrix is usable only if it is a real plane map: finite, and invertible. A
 * singular matrix (all zeros, or one that collapses the frame onto a line) would map every
 * foot point onto the same metre or onto a line and report a confident 0 m/s.
 *
 * @param {number[] | null | undefined} homography Row-major 3x3.
 * @returns {boolean}
 */
function isUsableHomography(homography) {
  if (
    !Array.isArray(homography) ||
    homography.length !== 9 ||
    !homography.every(Number.isFinite)
  ) {
    return false;
  }
  const [a, b, c, d, e, f, g, h, i] = homography;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const norm = Math.max(...homography.map(Math.abs)) || 1;
  return Math.abs(determinant) > 1e-12 * norm ** 3;
}

/**
 * Bottom-centre of a normalized `[x1, y1, x2, y2]` box: the foot point the tracker's zone
 * membership already uses. The box is not checked against the frame here; the caller decides
 * what to do with a truncated track.
 *
 * @param {number[] | null | undefined} bbox
 * @returns {Point2 | null}
 */
export function footPointFromBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  return { x: (bbox[0] + bbox[2]) / 2, y: bbox[3] };
}

/**
 * Ground distance and speed between two foot points.
 *
 * `null` is returned instead of `0` whenever the reading would be a guess: no calibration, a
 * non-positive or non-finite `dt` (two frames at the same media time, a paused clip, a clock
 * that jumped), a foot point that maps to infinity, or a non-finite result.
 *
 * @param {object} sample
 * @param {Point2 | null | undefined} sample.foot Foot point of the current frame.
 * @param {Point2 | null | undefined} sample.previousFoot Foot point of the previous frame.
 * @param {number} sample.dt Seconds between the two frames.
 * @param {number[] | null | undefined} sample.H Calibration homography.
 * @returns {{ speedMps: number | null, distanceM: number | null, valid: boolean }}
 */
export function groundMetrics({ foot, previousFoot, dt, H } = {}) {
  const invalid = { speedMps: null, distanceM: null, valid: false };
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return invalid;
  if (!isUsableHomography(H)) return invalid;
  const current = projectPoint(H, foot);
  const previous = projectPoint(H, previousFoot);
  if (!current || !previous) return invalid;
  const distanceM = Math.hypot(current.x - previous.x, current.y - previous.y);
  const speedMps = distanceM / dt;
  if (!Number.isFinite(distanceM) || !Number.isFinite(speedMps)) return invalid;
  return { speedMps, distanceM, valid: true };
}

/**
 * Exponential moving average for a noisy per-frame speed.
 *
 * @param {number | null} previous Previous smoothed speed, `null` before the first sample.
 * @param {number | null} sample New measurement, `null` when the frame had none.
 * @param {number} [alpha] Weight of the new sample, in (0, 1]; defaults to 0.35 (about four
 *   frames of memory, under a second at 5 fps).
 * @returns {number | null} The smoothed speed; the previous value when the sample is missing.
 * @throws {RangeError} `alpha` is not a finite number in (0, 1].
 */
export function smoothSpeed(previous, sample, alpha = 0.35) {
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new RangeError('alpha must be a finite number in (0, 1]');
  }
  const usable = typeof sample === 'number' && Number.isFinite(sample);
  if (!usable) return typeof previous === 'number' && Number.isFinite(previous) ? previous : null;
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return sample;
  return previous + alpha * (sample - previous);
}
