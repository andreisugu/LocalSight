// Keep zone polygons on the ground when the camera pans, tilts or zooms.
//
// Hand-port of the removed Python edge (`ml/safesight_ml/align.py`) to dependency-free JS
// that can run inside the browser worker. Zones are drawn once on a reference frame; every
// few frames the current frame is matched to the reference (features -> Hamming matching ->
// RANSAC homography) and the polygons are mapped into the current view. If the match
// fails, the zones are "unknown" for that frame and no zone rule fires: a wrong polygon is
// worse than none.
//
// The pipeline is the same as the reference, one step at a time:
// - `extractFeatures` (features.js) replaces `cv2.ORB_create(1500)`;
// - `matchFeatures` (features.js) replaces `BFMatcher(NORM_HAMMING)` with the same 0.75
//   ratio test, plus a mutual-best filter;
// - the homography is a normalized 4-point DLT inside RANSAC, replacing
//   `cv2.findHomography(..., RANSAC, 4.0 / 640)`, with the reference's plausibility checks;
// - a failed match chains through the last matched frame, as the reference does, so a fast
//   pan can still be followed by composing two homographies.
//
// Everything is in normalized frame coordinates (0..1 on both axes), so the reference
// image and the stream may have different resolutions. The RANSAC threshold is 4 px at the
// 640 px working width, exactly the reference's `4.0 / WORK_WIDTH`.
//
// Pure: no DOM, no canvas, no fetch, no model. The caller hands in RGBA pixels.

import {
  assertRgbaImage,
  createSeededRandom,
  extractFeatures,
  matchFeatures,
} from './features.js';

/** Working width of the grey image: the reference implementation's `WORK_WIDTH`. */
export const WORK_WIDTH = 640;
/** A fixed apron camera never scales the scene by more than this between frames. */
export const MAX_SCALE_CHANGE = 4;
/** Default inlier floor: below this many RANSAC inliers the frame counts as lost. */
export const MIN_INLIERS = 40;

/** RANSAC reprojection threshold, in normalized units: 4 px at 640 px. */
const RANSAC_THRESHOLD = 4 / WORK_WIDTH;
/** Probability that a sampled model is not contaminated, used for the adaptive stop. */
const RANSAC_CONFIDENCE = 0.995;
/** Hard cap on RANSAC samples, whatever the adaptivity says. */
const RANSAC_MAX_ITERATIONS = 512;
/** Fixed seed: the same frames always produce the same homography. */
const RANSAC_SEED = 0x5eed1234;
/** Below this many descriptors a frame cannot contribute a usable homography. */
const MIN_FEATURES = 8;
/** A pivot below this makes the 8x8 DLT system singular (degenerate point quadruple). */
const PIVOT_EPSILON = 1e-12;
/** A homogeneous denominator below this maps the point to infinity. */
const DENOMINATOR_EPSILON = 1e-12;

/**
 * @typedef {[number, number]} Point Normalized frame point, both coordinates in 0..1.
 * @typedef {[number, number, number, number, number, number, number, number, number]} Homography
 *   Row-major 3x3 mapping normalized current-frame points to normalized reference points.
 */

/**
 * Multiply two row-major 3x3 matrices.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {Float64Array}
 */
function multiply3(a, b) {
  const out = new Float64Array(9);
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
 * Invert a row-major 3x3 matrix.
 *
 * `null` for anything that would map a polygon to noise: malformed or non-finite input, or
 * a determinant that is zero relative to the matrix norm (the frame collapsed onto a line).
 *
 * @param {ArrayLike<number> | null | undefined} homography
 * @returns {Float64Array | null}
 */
export function invertHomography(homography) {
  if (
    homography === null ||
    homography === undefined ||
    typeof homography.length !== 'number' ||
    homography.length !== 9
  ) {
    return null;
  }
  const h = Array.from(homography);
  if (!h.every(Number.isFinite)) return null;

  const [a, b, c, d, e, f, g, i, j] = h;
  const determinant = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  const norm = Math.max(...h.map(Math.abs)) || 1;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 * norm ** 3) return null;

  const inverse = new Float64Array([
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ]);
  for (let index = 0; index < 9; index += 1) inverse[index] /= determinant;
  return inverse.every(Number.isFinite) ? inverse : null;
}

/**
 * Is this matrix a believable camera move, or a degenerate fit?
 *
 * The reference's `_plausible`, check for check: finite entries, `h33` not ~0, the 2x2
 * linear part's determinant within `1 / MAX_SCALE_CHANGE^2 .. MAX_SCALE_CHANGE^2`, and
 * perspective terms below 2. A strong perspective term means the fit collapsed, not that
 * the camera tilted.
 *
 * @param {ArrayLike<number> | null | undefined} homography Row-major 3x3.
 * @returns {boolean}
 */
export function isPlausibleHomography(homography) {
  if (
    homography === null ||
    homography === undefined ||
    typeof homography.length !== 'number' ||
    homography.length !== 9
  ) {
    return false;
  }
  const h = Array.from(homography);
  if (!h.every(Number.isFinite)) return false;
  if (Math.abs(h[8]) < 1e-9) return false;

  const scale = h[8];
  const determinant = (h[0] / scale) * (h[4] / scale) - (h[1] / scale) * (h[3] / scale);
  const limit = MAX_SCALE_CHANGE * MAX_SCALE_CHANGE;
  if (!(determinant >= 1 / limit && determinant <= limit)) return false;
  return Math.abs(h[6] / scale) < 2 && Math.abs(h[7] / scale) < 2;
}

/**
 * Solve `matrix * x = rhs` in place with Gaussian elimination and partial pivoting.
 *
 * @param {Float64Array} matrix Row-major square matrix, modified in place.
 * @param {Float64Array} rhs Modified in place.
 * @param {number} size
 * @returns {Float64Array | null} The solution, or `null` for a singular system.
 */
function solveLinear(matrix, rhs, size) {
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row * size + column]) > Math.abs(matrix[pivotRow * size + column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(matrix[pivotRow * size + column]) < PIVOT_EPSILON) return null;
    if (pivotRow !== column) {
      for (let inner = 0; inner < size; inner += 1) {
        const swap = matrix[column * size + inner];
        matrix[column * size + inner] = matrix[pivotRow * size + inner];
        matrix[pivotRow * size + inner] = swap;
      }
      const swap = rhs[column];
      rhs[column] = rhs[pivotRow];
      rhs[pivotRow] = swap;
    }
    const pivot = matrix[column * size + column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row * size + column] / pivot;
      if (factor === 0) continue;
      for (let inner = column; inner < size; inner += 1) {
        matrix[row * size + inner] -= factor * matrix[column * size + inner];
      }
      rhs[row] -= factor * rhs[column];
    }
  }

  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = rhs[row];
    for (let column = row + 1; column < size; column += 1) {
      sum -= matrix[row * size + column] * solution[column];
    }
    solution[row] = sum / matrix[row * size + row];
  }
  return solution.every(Number.isFinite) ? solution : null;
}

/**
 * Normalized DLT homography from four or more point pairs.
 *
 * One code path serves both uses: an exact fit on a RANSAC sample of four, and a
 * least-squares refit on all inliers. Both point sets are Hartley-normalized first
 * (centroid at the origin, mean distance sqrt(2)), because raw 0..1 coordinates leave the
 * 8x8 system badly conditioned; the solution is denormalized afterwards.
 *
 * @param {Float64Array} srcX
 * @param {Float64Array} srcY
 * @param {Float64Array} dstX
 * @param {Float64Array} dstY
 * @param {ArrayLike<number>} indices Point pairs to use.
 * @returns {Float64Array | null} Row-major 3x3, scaled to a unit maximum entry, or `null`
 *   for a degenerate sample (duplicated/collinear points, singular system).
 */
function fitHomography(srcX, srcY, dstX, dstY, indices) {
  const count = indices.length;
  if (count < 4) return null;

  let srcCenterX = 0;
  let srcCenterY = 0;
  let dstCenterX = 0;
  let dstCenterY = 0;
  for (let k = 0; k < count; k += 1) {
    const index = indices[k];
    srcCenterX += srcX[index];
    srcCenterY += srcY[index];
    dstCenterX += dstX[index];
    dstCenterY += dstY[index];
  }
  srcCenterX /= count;
  srcCenterY /= count;
  dstCenterX /= count;
  dstCenterY /= count;

  let srcSpread = 0;
  let dstSpread = 0;
  for (let k = 0; k < count; k += 1) {
    const index = indices[k];
    srcSpread += Math.hypot(srcX[index] - srcCenterX, srcY[index] - srcCenterY);
    dstSpread += Math.hypot(dstX[index] - dstCenterX, dstY[index] - dstCenterY);
  }
  srcSpread /= count;
  dstSpread /= count;
  if (!(srcSpread > 0) || !(dstSpread > 0)) return null;

  const srcScale = Math.SQRT2 / srcSpread;
  const dstScale = Math.SQRT2 / dstSpread;
  if (!Number.isFinite(srcScale) || !Number.isFinite(dstScale)) return null;

  // Two equations per correspondence, with h33 fixed to 1:
  //   h11 x + h12 y + h13 - u h31 x - u h32 y = u
  //   h21 x + h22 y + h23 - v h31 x - v h32 y = v
  // Accumulated into normal equations A^T A x = A^T b, so any point count works.
  const normal = new Float64Array(64);
  const rhs = new Float64Array(8);
  const row = new Float64Array(8);

  for (let k = 0; k < count; k += 1) {
    const index = indices[k];
    const x = (srcX[index] - srcCenterX) * srcScale;
    const y = (srcY[index] - srcCenterY) * srcScale;
    const u = (dstX[index] - dstCenterX) * dstScale;
    const v = (dstY[index] - dstCenterY) * dstScale;

    row[0] = x;
    row[1] = y;
    row[2] = 1;
    row[3] = 0;
    row[4] = 0;
    row[5] = 0;
    row[6] = -u * x;
    row[7] = -u * y;
    accumulate(normal, rhs, row, u);
    row[0] = 0;
    row[1] = 0;
    row[2] = 0;
    row[3] = x;
    row[4] = y;
    row[5] = 1;
    row[6] = -v * x;
    row[7] = -v * y;
    accumulate(normal, rhs, row, v);
  }

  // Mirror the upper triangle: the solver wants a full matrix.
  for (let a = 1; a < 8; a += 1) {
    for (let b = 0; b < a; b += 1) normal[a * 8 + b] = normal[b * 8 + a];
  }

  const solution = solveLinear(normal, rhs, 8);
  if (solution === null) return null;

  const srcNormalization = new Float64Array([
    srcScale, 0, -srcScale * srcCenterX,
    0, srcScale, -srcScale * srcCenterY,
    0, 0, 1,
  ]);
  const dstDenormalization = new Float64Array([
    1 / dstScale, 0, dstCenterX,
    0, 1 / dstScale, dstCenterY,
    0, 0, 1,
  ]);
  const normalized = new Float64Array([...solution, 1]);
  const homography = multiply3(multiply3(dstDenormalization, normalized), srcNormalization);
  if (!homography.every(Number.isFinite)) return null;

  // Fix the arbitrary scale to a unit maximum entry. `isPlausibleHomography` then reads
  // `h33` relative to the rest of the matrix, which is how it spots a collapsed fit.
  let largest = 0;
  for (let index = 0; index < 9; index += 1) largest = Math.max(largest, Math.abs(homography[index]));
  if (!(largest > 0)) return null;
  for (let index = 0; index < 9; index += 1) homography[index] /= largest;
  return homography;
}

/**
 * Add one DLT row to the normal equations.
 *
 * @param {Float64Array} normal Row-major 8x8, upper triangle written.
 * @param {Float64Array} rhs
 * @param {Float64Array} row Eight coefficients.
 * @param {number} value Right-hand side.
 * @returns {void}
 */
function accumulate(normal, rhs, row, value) {
  for (let a = 0; a < 8; a += 1) {
    const coefficient = row[a];
    if (coefficient === 0) continue;
    rhs[a] += coefficient * value;
    for (let b = a; b < 8; b += 1) normal[a * 8 + b] += coefficient * row[b];
  }
}

/**
 * Count matches that the homography reprojects within the threshold.
 *
 * @param {Float64Array} homography
 * @param {Float64Array} srcX
 * @param {Float64Array} srcY
 * @param {Float64Array} dstX
 * @param {Float64Array} dstY
 * @param {number} count
 * @param {number} thresholdSquared
 * @param {Int32Array | null} inliers Optional buffer receiving the inlier indices.
 * @returns {number}
 */
function countInliers(homography, srcX, srcY, dstX, dstY, count, thresholdSquared, inliers) {
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = homography;
  let found = 0;
  for (let index = 0; index < count; index += 1) {
    const x = srcX[index];
    const y = srcY[index];
    const denominator = h6 * x + h7 * y + h8;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < DENOMINATOR_EPSILON) continue;
    const dx = (h0 * x + h1 * y + h2) / denominator - dstX[index];
    const dy = (h3 * x + h4 * y + h5) / denominator - dstY[index];
    if (dx * dx + dy * dy <= thresholdSquared) {
      if (inliers !== null) inliers[found] = index;
      found += 1;
    }
  }
  return found;
}

/**
 * RANSAC homography from matched correspondences, current frame -> reference frame.
 *
 * Deterministic by construction: fixed seed, fixed iteration cap, and the same adaptive
 * stop rule as the usual implementation. Every sample must pass
 * {@link isPlausibleHomography} before it is allowed to count inliers, so a wild fit cannot
 * win by chance. The winning model is refit on all its inliers and only kept if it still
 * clears `minInliers`.
 *
 * @param {import('./features.js').FeatureSet} reference
 * @param {import('./features.js').FeatureSet} current
 * @param {import('./features.js').FeatureMatches} matches
 * @param {object} [options]
 * @param {number} [options.threshold] Reprojection threshold, normalized. Defaults to 4/640.
 * @param {number} [options.minInliers] Inlier floor. Defaults to 40.
 * @param {number} [options.maxIterations] Sample cap. Defaults to 512.
 * @returns {Float64Array | null}
 */
export function ransacHomography(
  reference,
  current,
  matches,
  { threshold = RANSAC_THRESHOLD, minInliers = MIN_INLIERS, maxIterations = RANSAC_MAX_ITERATIONS } = {},
) {
  const count = matches.current.length;
  if (count < 4 || count < minInliers) return null;
  if (!Number.isFinite(threshold) || threshold <= 0) return null;

  const srcX = new Float64Array(count);
  const srcY = new Float64Array(count);
  const dstX = new Float64Array(count);
  const dstY = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const currentIndex = matches.current[index];
    const referenceIndex = matches.reference[index];
    srcX[index] = current.points[currentIndex * 2];
    srcY[index] = current.points[currentIndex * 2 + 1];
    dstX[index] = reference.points[referenceIndex * 2];
    dstY[index] = reference.points[referenceIndex * 2 + 1];
  }

  const random = createSeededRandom(RANSAC_SEED);
  const thresholdSquared = threshold * threshold;
  const sample = new Int32Array(4);
  const inliers = new Int32Array(count);
  let required = Math.max(1, Math.min(RANSAC_MAX_ITERATIONS, maxIterations));
  let best = null;
  let bestCount = 0;

  for (let iteration = 0; iteration < required; iteration += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      let candidate = (random() * count) | 0;
      let duplicate = true;
      while (duplicate) {
        duplicate = false;
        for (let previous = 0; previous < slot; previous += 1) {
          if (sample[previous] === candidate) {
            duplicate = true;
            break;
          }
        }
        if (duplicate) candidate = (random() * count) | 0;
      }
      sample[slot] = candidate;
    }

    const homography = fitHomography(srcX, srcY, dstX, dstY, sample);
    if (homography === null || !isPlausibleHomography(homography)) continue;

    const inlierCount = countInliers(homography, srcX, srcY, dstX, dstY, count, thresholdSquared, null);
    if (inlierCount <= bestCount) continue;
    bestCount = inlierCount;
    best = homography;
    if (bestCount >= count) break;

    // Adaptive stop: the chance of drawing four inliers, raised to the iteration count.
    const inlierRatio = bestCount / count;
    if (inlierRatio >= 0.999) break;
    const probability = 1 - inlierRatio ** 4;
    if (probability <= 0) break;
    const estimate = Math.ceil(Math.log(1 - RANSAC_CONFIDENCE) / Math.log(probability));
    required = Math.max(1, Math.min(required, RANSAC_MAX_ITERATIONS, estimate));
  }

  if (best === null || bestCount < minInliers) return null;

  // Least-squares refit on every inlier: a four-point sample carries the keypoints'
  // pixel-grid rounding, the refit averages it out. Keep the sample model if the refit is
  // worse, which can happen on a near-degenerate inlier set.
  const inlierCount = countInliers(best, srcX, srcY, dstX, dstY, count, thresholdSquared, inliers);
  const refined = fitHomography(srcX, srcY, dstX, dstY, inliers.subarray(0, inlierCount));
  if (refined !== null && isPlausibleHomography(refined)) {
    const refinedInliers = countInliers(
      refined,
      srcX,
      srcY,
      dstX,
      dstY,
      count,
      thresholdSquared,
      null,
    );
    if (refinedInliers >= bestCount) return refined;
  }
  return best;
}

/**
 * Map one normalized point through a homography.
 *
 * @param {ArrayLike<number>} homography Row-major 3x3.
 * @param {number} x
 * @param {number} y
 * @returns {Point | null} `null` when the point maps to infinity or the arithmetic fails.
 */
function projectPoint(homography, x, y) {
  const denominator = homography[6] * x + homography[7] * y + homography[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < DENOMINATOR_EPSILON) return null;
  const mappedX = (homography[0] * x + homography[1] * y + homography[2]) / denominator;
  const mappedY = (homography[3] * x + homography[4] * y + homography[5]) / denominator;
  return Number.isFinite(mappedX) && Number.isFinite(mappedY) ? [mappedX, mappedY] : null;
}

/**
 * Keeps zone polygons on the ground while a fixed camera moves.
 *
 * One instance belongs to one camera and one reference image: the reference features are
 * computed once in the constructor and reused for every update. Call {@link ZoneAligner.update}
 * with every frame (it throttles itself to `everyN`), then {@link ZoneAligner.alignZones}
 * to get the polygons for that view. `null` means "unknown": skip the zone rules for the
 * frame rather than test a guessed polygon.
 *
 * @example
 * const aligner = new ZoneAligner({ reference: referenceImageData, everyN: 5 });
 * for (const frame of frames) {
 *   if (aligner.update(frame)) {
 *     const zones = aligner.alignZones(configuredZones); // non-null
 *     pipeline.step(detections, now, { frameWidth, frameHeight, zones });
 *   } else {
 *     pipeline.step(detections, now, { frameWidth, frameHeight, zones: [] });
 *   }
 * }
 */
export class ZoneAligner {
  /** @type {import('./features.js').FeatureSet} */
  #reference;
  /** @type {import('./features.js').FeatureSet | null} */
  #last = null;
  /** @type {Float64Array | null} Current frame -> reference frame. */
  #toReference = null;
  /** @type {number} */
  #calls = 0;

  /**
   * @param {object} input
   * @param {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} input.reference
   *   RGBA reference frame: the one the zone polygons were drawn on.
   * @param {number} [input.everyN] Attempt a match every N calls. Defaults to 5.
   * @param {number} [input.minInliers] RANSAC inlier floor. Defaults to 40.
   * @throws {TypeError|RangeError} The reference, cadence or inlier floor is malformed.
   */
  constructor({ reference, everyN = 5, minInliers = MIN_INLIERS } = {}) {
    if (!Number.isInteger(everyN) || everyN < 1) {
      throw new RangeError('everyN must be an integer >= 1');
    }
    if (!Number.isInteger(minInliers) || minInliers < 4) {
      throw new RangeError('minInliers must be an integer >= 4');
    }
    this.everyN = everyN;
    this.minInliers = minInliers;
    /** @type {number} Updates that failed to match and left the view unaligned. */
    this.lostUpdates = 0;
    this.#reference = extractFeatures(reference, { workWidth: WORK_WIDTH });
    /**
     * Descriptors found in the reference frame. Zero means the reference is untextured and
     * every update will be lost, so the caller can skip alignment entirely.
     * @type {number}
     */
    this.referenceFeatureCount = this.#reference.count;
  }

  /**
   * Attempt to re-estimate the camera motion, at most every `everyN` calls.
   *
   * Returns `true` while the current view is aligned, including the calls between two
   * attempts, which keep the last homography. `false` means the view is lost: no polygon is
   * known for it and the caller must not run zone rules.
   *
   * A failed direct match falls back to chaining through the last frame that matched, as
   * the reference does, which covers a pan too large for a single direct match.
   *
   * @param {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} frame
   *   RGBA pixels of the current frame.
   * @returns {boolean}
   * @throws {TypeError} The frame is not an RGBA image.
   */
  update(frame) {
    assertRgbaImage(frame);
    this.#calls += 1;
    if ((this.#calls - 1) % this.everyN !== 0) return this.#toReference !== null;
    // An untextured reference can never match: report lost without paying for extraction.
    if (this.#reference.count < MIN_FEATURES) {
      this.#toReference = null;
      this.lostUpdates += 1;
      return false;
    }

    const current = extractFeatures(frame, { workWidth: WORK_WIDTH });
    let toReference = this.#estimate(this.#reference, current);
    if (toReference === null && this.#last !== null && this.#toReference !== null) {
      const step = this.#estimate(this.#last, current);
      toReference = step === null ? null : multiply3(this.#toReference, step);
      if (toReference !== null && !isPlausibleHomography(toReference)) toReference = null;
    }

    if (toReference === null) {
      this.#toReference = null;
      this.lostUpdates += 1;
      return false;
    }
    this.#toReference = toReference;
    this.#last = current;
    return true;
  }

  /**
   * Match two feature sets and estimate the homography between them.
   *
   * @param {import('./features.js').FeatureSet} from
   * @param {import('./features.js').FeatureSet} to
   * @returns {Float64Array | null}
   */
  #estimate(from, to) {
    if (from.count < MIN_FEATURES || to.count < MIN_FEATURES) return null;
    const matches = matchFeatures(from, to);
    if (matches.current.length < this.minInliers) return null;
    return ransacHomography(from, to, matches, { minInliers: this.minInliers });
  }

  /**
   * Zone polygons in the current view, or `null` when the view is not aligned.
   *
   * The input polygons are in reference-frame normalized coordinates and are never
   * mutated: each zone is shallow-copied with a new `polygon`. Corners may sit outside the
   * frame after a pan, which is expected; a corner that maps to infinity makes the whole
   * frame unusable and returns `null` rather than a truncated polygon.
   *
   * @param {Array<{ polygon: number[][] }>} zones Zones shaped like the API serves them.
   * @returns {Array<object> | null}
   * @throws {TypeError} `zones` is not an array of objects with finite `[x, y]` polygons.
   */
  alignZones(zones) {
    if (!Array.isArray(zones)) throw new TypeError('zones must be an array');
    if (this.#toReference === null) return null;
    const toCurrent = invertHomography(this.#toReference);
    if (toCurrent === null) return null;

    const aligned = [];
    for (const zone of zones) {
      if (zone === null || typeof zone !== 'object' || !Array.isArray(zone.polygon)) {
        throw new TypeError('each zone must be an object with a polygon array');
      }
      const polygon = [];
      for (const point of zone.polygon) {
        if (
          !Array.isArray(point) ||
          point.length < 2 ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1])
        ) {
          throw new TypeError('zone polygon points must be finite [x, y] pairs');
        }
        const mapped = projectPoint(toCurrent, point[0], point[1]);
        if (mapped === null) return null;
        polygon.push(mapped);
      }
      aligned.push({ ...zone, polygon });
    }
    return aligned;
  }

  /**
   * Forget the alignment and the cadence, e.g. when the camera or the reference changes.
   *
   * The reference features stay: a new reference image needs a new instance, because zones
   * drawn on another frame cannot be mapped with the old one's features.
   *
   * @returns {void}
   */
  reset() {
    this.#toReference = null;
    this.#last = null;
    this.#calls = 0;
    this.lostUpdates = 0;
  }
}
