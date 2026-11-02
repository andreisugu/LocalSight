// Keypoint detection and binary descriptors for the zone aligner.
//
// The Python edge aligned zones with OpenCV ORB (`cv2.ORB_create(1500)`) and a Hamming
// brute-force matcher. The browser build has no OpenCV and no WASM blob, so this module is
// the dependency-free replacement that keeps the same behaviour: FAST-9 corners, an
// intensity-centroid orientation, a rotated 256-bit BRIEF descriptor, and a Hamming
// nearest-neighbour match with Lowe's ratio test plus a mutual-best filter.
//
// Deliberate differences from ORB, all in the direction of "cheap and safe":
// - two scale levels instead of eight, because the working image is at most 640 px wide and
//   an apron camera moves by a few percent between frames; a real zoom jump still ends as
//   "lost", which the aligner already treats as "no zone rule fires";
// - the BRIEF sampling pattern is fixed and generated from a seeded PRNG instead of
//   trained (rBRIEF). Reference and current frame use the same pattern, which is all the
//   matcher needs;
// - at most two features per 32 px cell per level, so brute-force matching stays inside the
//   frame budget: a few hundred descriptors per image instead of OpenCV's 1500.
//
// No DOM, no dependency, no hidden state. The caller passes RGBA pixels as
// `{ data, width, height }`, which is exactly what `ImageData` already is.

/** Working width of the grey image: the reference implementation's `WORK_WIDTH`. */
const DEFAULT_WORK_WIDTH = 640;
/** Upper bound on descriptors per image, to keep matching O(n^2) small. */
const DEFAULT_MAX_FEATURES = 400;
/** FAST corner threshold on 0..255 luminance. ORB's default is 20. */
const DEFAULT_FAST_THRESHOLD = 18;
/** Scale pyramid: level 0 plus one level shrunk by this factor (ORB uses 1.2). */
const PYRAMID_SCALE = 1.25;
const PYRAMID_LEVELS = 2;
/** Grid cell for feature spreading, in working pixels. */
const CELL_SIZE = 32;
/** Border left unexamined: descriptor sampling reaches 14 px plus rounding. */
const MARGIN = 18;
/** Descriptor length in bits and 32-bit words. */
const DESCRIPTOR_BITS = 256;
const DESCRIPTOR_WORDS = DESCRIPTOR_BITS / 32;
/** Orientation patch radius, in working pixels. */
const ORIENTATION_RADIUS = 12;

/**
 * @typedef {object} RgbaImage RGBA pixels, row-major, four bytes per pixel.
 * @property {Uint8ClampedArray | Uint8Array} data
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} FeatureSet Keypoints in one image and their descriptors.
 * @property {Float64Array} points Normalized `[x0, y0, x1, y1, ...]`, both in 0..1.
 * @property {Uint32Array} descriptors Eight 32-bit words (256 bits) per keypoint.
 * @property {number} count
 * @property {number} width Working image width, for diagnostics.
 * @property {number} height Working image height, for diagnostics.
 */

/**
 * @typedef {object} FeatureMatches Two index lists into the matched feature sets.
 * @property {Int32Array} current Indices into the current frame's descriptors.
 * @property {Int32Array} reference Indices into the reference frame's descriptors.
 * @property {Int32Array} distances Hamming distance of each pair.
 */

/** Bresenham circle of radius 3, clockwise from the top: the FAST-9 test pattern. */
const FAST_CIRCLE = new Int8Array([
  0, -3, 1, -3, 2, -2, 3, -1, 3, 0, 3, 1, 2, 2, 1, 3,
  0, 3, -1, 3, -2, 2, -3, 1, -3, 0, -3, -1, -2, -2, -1, -3,
]);

/** Offsets inside the orientation patch, as `[dx, dy, dx, dy, ...]`. */
const ORIENTATION_OFFSETS = (() => {
  const offsets = [];
  for (let dy = -ORIENTATION_RADIUS; dy <= ORIENTATION_RADIUS; dy += 1) {
    for (let dx = -ORIENTATION_RADIUS; dx <= ORIENTATION_RADIUS; dx += 1) {
      if (dx * dx + dy * dy <= ORIENTATION_RADIUS * ORIENTATION_RADIUS) {
        offsets.push(dx, dy);
      }
    }
  }
  return new Int8Array(offsets);
})();

/**
 * 256 descriptor sampling pairs `[ax, ay, bx, by]`, drawn from a seeded normal
 * distribution (BRIEF uses sigma = patch / 5, here 6 px around the keypoint) and clamped
 * inside the 14 px sampling radius. Deterministic: every session describes the same
 * corner the same way, which the matcher relies on.
 */
const BRIEF_PATTERN = (() => {
  const random = createSeededRandom(0x51ed270b);
  const normal = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const pattern = new Int8Array(DESCRIPTOR_BITS * 4);
  for (let bit = 0; bit < DESCRIPTOR_BITS; bit += 1) {
    let ax = 0;
    let ay = 0;
    let bx = 0;
    let by = 0;
    do {
      ax = Math.round(normal() * 6);
      ay = Math.round(normal() * 6);
    } while (ax * ax + ay * ay > 196);
    do {
      bx = Math.round(normal() * 6);
      by = Math.round(normal() * 6);
    } while (bx * bx + by * by > 196 || (ax === bx && ay === by));
    const offset = bit * 4;
    pattern[offset] = ax;
    pattern[offset + 1] = ay;
    pattern[offset + 2] = bx;
    pattern[offset + 3] = by;
  }
  return pattern;
})();

/**
 * Deterministic 32-bit PRNG (mulberry32). Shared by the descriptor pattern and the RANSAC
 * sampler: a fixed seed is what makes an alignment reproducible and testable.
 *
 * @param {number} seed
 * @returns {() => number} Uniform values in `[0, 1)`.
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Throw unless the value is an RGBA image with enough bytes for every pixel.
 *
 * @param {unknown} image
 * @returns {asserts image is RgbaImage}
 * @throws {TypeError} The value is not `{ data, width, height }` with `width * height * 4`
 *   readable bytes.
 */
export function assertRgbaImage(image) {
  if (image === null || typeof image !== 'object') {
    throw new TypeError('image must be { data, width, height } with RGBA pixels');
  }
  const { data, width, height } = /** @type {RgbaImage} */ (image);
  if (
    data === null ||
    typeof data !== 'object' ||
    typeof data.length !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new TypeError('image must be { data, width, height } with positive integer sizes');
  }
  if (data.length < width * height * 4) {
    throw new TypeError('image.data must hold width * height * 4 RGBA bytes');
  }
}

/**
 * One luminance value per working pixel.
 *
 * The image is downscaled to `workWidth` by box averaging (the browser equivalent of
 * `cv2.INTER_AREA`) so a 1080p frame costs the same as a 640 px one, then converted with
 * the same integer weights `cv2.COLOR_RGBA2GRAY` uses. Small frames are never upscaled:
 * inventing pixels would not create detail.
 *
 * @param {RgbaImage} image
 * @param {number} workWidth
 * @returns {{ gray: Uint8Array, width: number, height: number }}
 */
function workingGray(image, workWidth) {
  const { data, width, height } = image;
  const scale = Math.min(1, workWidth / width);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const gray = new Uint8Array(outWidth * outHeight);

  if (outWidth === width && outHeight === height) {
    for (let index = 0, offset = 0; index < gray.length; index += 1, offset += 4) {
      gray[index] = (data[offset] * 77 + data[offset + 1] * 150 + data[offset + 2] * 29 + 128) >> 8;
    }
    return { gray, width: outWidth, height: outHeight };
  }

  const startX = new Int32Array(outWidth);
  const endX = new Int32Array(outWidth);
  for (let x = 0; x < outWidth; x += 1) {
    startX[x] = Math.floor((x * width) / outWidth);
    endX[x] = Math.max(startX[x] + 1, Math.floor(((x + 1) * width) / outWidth));
  }
  const startY = new Int32Array(outHeight);
  const endY = new Int32Array(outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    startY[y] = Math.floor((y * height) / outHeight);
    endY[y] = Math.max(startY[y] + 1, Math.floor(((y + 1) * height) / outHeight));
  }

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sourceY = startY[y]; sourceY < endY[y]; sourceY += 1) {
        let offset = (sourceY * width + startX[x]) * 4;
        for (let sourceX = startX[x]; sourceX < endX[x]; sourceX += 1, offset += 4) {
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
          count += 1;
        }
      }
      gray[y * outWidth + x] = ((red * 77 + green * 150 + blue * 29 + (count << 7)) / count) >> 8;
    }
  }
  return { gray, width: outWidth, height: outHeight };
}

/**
 * Separable `[1, 2, 1] / 4` blur. The descriptors sample this image instead of the raw
 * one, so a few levels of sensor noise cannot flip descriptor bits.
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function blur121(gray, width, height) {
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const center = gray[row + x];
      const left = x > 0 ? gray[row + x - 1] : center;
      const right = x + 1 < width ? gray[row + x + 1] : center;
      horizontal[row + x] = (left + 2 * center + right + 2) >> 2;
    }
  }
  const blurred = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const above = y > 0 ? row - width : row;
    const below = y + 1 < height ? row + width : row;
    for (let x = 0; x < width; x += 1) {
      blurred[row + x] =
        (horizontal[above + x] + 2 * horizontal[row + x] + horizontal[below + x] + 2) >> 2;
    }
  }
  return blurred;
}

/**
 * FAST-9 score map: `0` for "not a corner", otherwise the summed absolute difference of
 * the 16 circle pixels. Writing the score into a full-size map is what makes the 3x3
 * non-maximum suppression below a single scan.
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @param {number} threshold
 * @param {Int32Array} scoreMap Cleared `width * height` buffer, filled in place.
 * @returns {void}
 */
function detectCorners(gray, width, height, threshold, scoreMap) {
  const circle = FAST_CIRCLE;
  const endX = width - MARGIN;
  const endY = height - MARGIN;

  for (let y = MARGIN; y < endY; y += 1) {
    let index = y * width + MARGIN;
    for (let x = MARGIN; x < endX; x += 1, index += 1) {
      const center = gray[index];
      const high = center + threshold;
      const low = center - threshold;

      // High-speed test: of the four compass points, at least three must agree. A 9-pixel
      // arc is long enough to contain three of them for every corner worth having.
      let bright = 0;
      let dark = 0;
      let value = gray[index - 3 * width];
      if (value > high) bright += 1;
      else if (value < low) dark += 1;
      value = gray[index + 3];
      if (value > high) bright += 1;
      else if (value < low) dark += 1;
      value = gray[index + 3 * width];
      if (value > high) bright += 1;
      else if (value < low) dark += 1;
      value = gray[index - 3];
      if (value > high) bright += 1;
      else if (value < low) dark += 1;
      if (bright < 3 && dark < 3) continue;

      const brighter = bright >= 3;
      let run = 0;
      let corner = false;
      // 32 steps, not 16: a run crossing the end of the circle must stay contiguous.
      for (let step = 0; step < 32; step += 1) {
        const offset = (step & 15) * 2;
        const sample = gray[index + circle[offset + 1] * width + circle[offset]];
        const on = brighter ? sample > high : sample < low;
        if (on) {
          run += 1;
          if (run >= 9) {
            corner = true;
            break;
          }
        } else {
          run = 0;
        }
      }
      if (!corner) continue;

      let score = 0;
      for (let step = 0; step < 16; step += 1) {
        const offset = step * 2;
        const sample = gray[index + circle[offset + 1] * width + circle[offset]];
        score += sample > center ? sample - center : center - sample;
      }
      scoreMap[index] = score > 0 ? score : 1;
    }
  }
}

/**
 * Keep local maxima of the score map and spread them over a grid: at most two corners per
 * 40 px cell, so one busy edge cannot starve the rest of the frame of matches.
 *
 * @param {Int32Array} scoreMap
 * @param {number} width
 * @param {number} height
 * @param {number} maxFeatures
 * @returns {{ xs: number[], ys: number[], scores: number[] }}
 */
function selectKeypoints(scoreMap, width, height, maxFeatures) {
  const cellsX = Math.ceil(width / CELL_SIZE);
  const cellsY = Math.ceil(height / CELL_SIZE);
  const cellCount = cellsX * cellsY;
  const firstScore = new Int32Array(cellCount);
  const firstIndex = new Int32Array(cellCount).fill(-1);
  const secondScore = new Int32Array(cellCount);
  const secondIndex = new Int32Array(cellCount).fill(-1);

  const endX = width - MARGIN;
  const endY = height - MARGIN;
  for (let y = MARGIN; y < endY; y += 1) {
    for (let x = MARGIN; x < endX; x += 1) {
      const index = y * width + x;
      const score = scoreMap[index];
      if (score === 0) continue;
      if (
        score < scoreMap[index - 1] ||
        score < scoreMap[index + 1] ||
        score < scoreMap[index - width - 1] ||
        score < scoreMap[index - width] ||
        score < scoreMap[index - width + 1] ||
        score < scoreMap[index + width - 1] ||
        score < scoreMap[index + width] ||
        score < scoreMap[index + width + 1]
      ) {
        continue;
      }
      const cell = ((y / CELL_SIZE) | 0) * cellsX + ((x / CELL_SIZE) | 0);
      if (score > firstScore[cell]) {
        secondScore[cell] = firstScore[cell];
        secondIndex[cell] = firstIndex[cell];
        firstScore[cell] = score;
        firstIndex[cell] = index;
      } else if (score > secondScore[cell]) {
        secondScore[cell] = score;
        secondIndex[cell] = index;
      }
    }
  }

  const xs = [];
  const ys = [];
  const scores = [];
  for (let cell = 0; cell < cellCount; cell += 1) {
    if (firstIndex[cell] >= 0) {
      xs.push(firstIndex[cell] % width);
      ys.push((firstIndex[cell] / width) | 0);
      scores.push(firstScore[cell]);
    }
    if (secondIndex[cell] >= 0) {
      xs.push(secondIndex[cell] % width);
      ys.push((secondIndex[cell] / width) | 0);
      scores.push(secondScore[cell]);
    }
  }

  if (xs.length <= maxFeatures) return { xs, ys, scores };

  const order = xs.map((_, index) => index);
  order.sort((a, b) => scores[b] - scores[a]);
  return {
    xs: order.slice(0, maxFeatures).map((index) => xs[index]),
    ys: order.slice(0, maxFeatures).map((index) => ys[index]),
    scores: order.slice(0, maxFeatures).map((index) => scores[index]),
  };
}

/**
 * Dominant gradient direction of the patch, as ORB computes it: the angle from the centre
 * to the intensity centroid. Rotating the BRIEF pattern by it keeps descriptors stable
 * when the camera rotates.
 *
 * @param {Uint8Array} image
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @returns {number} Radians.
 */
function patchOrientation(image, width, x, y) {
  let m10 = 0;
  let m01 = 0;
  for (let k = 0; k < ORIENTATION_OFFSETS.length; k += 2) {
    const dx = ORIENTATION_OFFSETS[k];
    const dy = ORIENTATION_OFFSETS[k + 1];
    const value = image[(y + dy) * width + x + dx];
    m10 += dx * value;
    m01 += dy * value;
  }
  return m10 === 0 && m01 === 0 ? 0 : Math.atan2(m01, m10);
}

/**
 * Write one 256-bit rotated BRIEF descriptor.
 *
 * @param {Uint8Array} image Smoothed working image.
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @param {number} angle Radians, from {@link patchOrientation}.
 * @param {Uint32Array} words Descriptor buffer.
 * @param {number} wordOffset First of the eight words to write.
 * @returns {void}
 */
function describe(image, width, x, y, angle, words, wordOffset) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let bits = 0;
  let bitIndex = 0;
  for (let bit = 0; bit < DESCRIPTOR_BITS; bit += 1) {
    const offset = bit * 4;
    const ax = Math.round(BRIEF_PATTERN[offset] * cos - BRIEF_PATTERN[offset + 1] * sin);
    const ay = Math.round(BRIEF_PATTERN[offset] * sin + BRIEF_PATTERN[offset + 1] * cos);
    const bx = Math.round(BRIEF_PATTERN[offset + 2] * cos - BRIEF_PATTERN[offset + 3] * sin);
    const by = Math.round(BRIEF_PATTERN[offset + 2] * sin + BRIEF_PATTERN[offset + 3] * cos);
    const first = image[(y + ay) * width + x + ax];
    const second = image[(y + by) * width + x + bx];
    if (first < second) bits |= 1 << bitIndex;
    bitIndex += 1;
    if (bitIndex === 32) {
      words[wordOffset + (bit >> 5)] = bits >>> 0;
      bits = 0;
      bitIndex = 0;
    }
  }
}

/**
 * An empty result, shared shape with a real one so callers never branch on `undefined`.
 *
 * @param {number} [width]
 * @param {number} [height]
 * @returns {FeatureSet}
 */
function emptyFeatures(width = 0, height = 0) {
  return {
    points: new Float64Array(0),
    descriptors: new Uint32Array(0),
    count: 0,
    width,
    height,
  };
}

/**
 * Box-downscale a grey image by `factor` (area averaging, like `cv2.INTER_AREA`). Used to
 * build the next pyramid level.
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @param {number} factor
 * @returns {{ gray: Uint8Array, width: number, height: number }}
 */
function downscaleGray(gray, width, height, factor) {
  const outWidth = Math.max(1, Math.round(width / factor));
  const outHeight = Math.max(1, Math.round(height / factor));
  if (outWidth === width && outHeight === height) return { gray, width, height };

  const startX = new Int32Array(outWidth);
  const endX = new Int32Array(outWidth);
  for (let x = 0; x < outWidth; x += 1) {
    startX[x] = Math.floor((x * width) / outWidth);
    endX[x] = Math.max(startX[x] + 1, Math.floor(((x + 1) * width) / outWidth));
  }
  const startY = new Int32Array(outHeight);
  const endY = new Int32Array(outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    startY[y] = Math.floor((y * height) / outHeight);
    endY[y] = Math.max(startY[y] + 1, Math.floor(((y + 1) * height) / outHeight));
  }

  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let sum = 0;
      let count = 0;
      for (let sourceY = startY[y]; sourceY < endY[y]; sourceY += 1) {
        for (let sourceX = startX[x]; sourceX < endX[x]; sourceX += 1) {
          sum += gray[sourceY * width + sourceX];
          count += 1;
        }
      }
      out[y * outWidth + x] = (sum + (count >> 1)) / count;
    }
  }
  return { gray: out, width: outWidth, height: outHeight };
}

/**
 * Detect and describe the corners of one grey image, at most `budget` of them.
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @param {number} fastThreshold
 * @param {number} budget
 * @returns {{ points: Float64Array, descriptors: Uint32Array, count: number }}
 */
function describeGray(gray, width, height, fastThreshold, budget) {
  const smoothed = blur121(gray, width, height);
  const scoreMap = new Int32Array(width * height);
  detectCorners(gray, width, height, fastThreshold, scoreMap);
  const { xs, ys } = selectKeypoints(scoreMap, width, height, budget);

  const count = xs.length;
  const points = new Float64Array(count * 2);
  const descriptors = new Uint32Array(count * DESCRIPTOR_WORDS);
  for (let index = 0; index < count; index += 1) {
    points[index * 2] = xs[index] / width;
    points[index * 2 + 1] = ys[index] / height;
    const angle = patchOrientation(smoothed, width, xs[index], ys[index]);
    describe(smoothed, width, xs[index], ys[index], angle, descriptors, index * DESCRIPTOR_WORDS);
  }
  return { points, descriptors, count };
}

/**
 * Detect corners and describe them on a two-level scale pyramid.
 *
 * The coordinates are normalized to each level's image (0..1 on both axes), so a reference
 * frame and a stream frame may have different resolutions and still be matched, and a
 * level-1 descriptor matches a level-0 corner seen slightly zoomed in.
 *
 * @param {RgbaImage} image RGBA pixels, e.g. `ImageData` from a canvas.
 * @param {object} [options]
 * @param {number} [options.workWidth] Working width in pixels. Defaults to 640.
 * @param {number} [options.maxFeatures] Descriptor budget across all levels. Defaults to 400.
 * @param {number} [options.fastThreshold] FAST threshold, 0..255. Defaults to 18.
 * @returns {FeatureSet}
 * @throws {TypeError|RangeError} The image or an option is malformed.
 */
export function extractFeatures(
  image,
  { workWidth = DEFAULT_WORK_WIDTH, maxFeatures = DEFAULT_MAX_FEATURES, fastThreshold = DEFAULT_FAST_THRESHOLD } = {},
) {
  assertRgbaImage(image);
  if (!Number.isFinite(workWidth) || workWidth < 1) {
    throw new RangeError('workWidth must be a finite number >= 1');
  }
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1) {
    throw new RangeError('maxFeatures must be an integer >= 1');
  }
  if (!Number.isFinite(fastThreshold) || fastThreshold < 0) {
    throw new RangeError('fastThreshold must be a finite number >= 0');
  }

  const base = workingGray(image, workWidth);
  if (base.width < 2 * MARGIN + 1 || base.height < 2 * MARGIN + 1) {
    return emptyFeatures(base.width, base.height);
  }

  const levels = [base];
  for (let level = 1; level < PYRAMID_LEVELS; level += 1) {
    const previous = levels[level - 1];
    const next = downscaleGray(previous.gray, previous.width, previous.height, PYRAMID_SCALE);
    if (next.width < 2 * MARGIN + 1 || next.height < 2 * MARGIN + 1) break;
    levels.push(next);
  }

  // Split the budget between levels; the last level absorbs any rounding remainder.
  const perLevel = Math.max(8, Math.floor(maxFeatures / levels.length));
  const parts = levels.map((level, index) => {
    const budget = index === levels.length - 1 ? maxFeatures - perLevel * (levels.length - 1) : perLevel;
    return describeGray(level.gray, level.width, level.height, fastThreshold, budget);
  });

  const count = parts.reduce((sum, part) => sum + part.count, 0);
  const points = new Float64Array(count * 2);
  const descriptors = new Uint32Array(count * DESCRIPTOR_WORDS);
  let offset = 0;
  for (const part of parts) {
    points.set(part.points, offset * 2);
    descriptors.set(part.descriptors, offset * DESCRIPTOR_WORDS);
    offset += part.count;
  }
  return { points, descriptors, count, width: base.width, height: base.height };
}

/**
 * A 32-bit Hamming distance over eight descriptor words.
 *
 * @param {Uint32Array} first
 * @param {number} firstOffset
 * @param {Uint32Array} second
 * @param {number} secondOffset
 * @returns {number} Bit difference, 0..256.
 */
function hamming(first, firstOffset, second, secondOffset) {
  let distance = 0;
  for (let word = 0; word < DESCRIPTOR_WORDS; word += 1) {
    let value = first[firstOffset + word] ^ second[secondOffset + word];
    value -= (value >>> 1) & 0x55555555;
    value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
    distance += Math.imul((value + (value >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  return distance;
}

/**
 * @param {unknown} value
 * @returns {boolean} A feature set produced by {@link extractFeatures}.
 */
function isFeatureSet(value) {
  if (value === null || typeof value !== 'object') return false;
  const { points, descriptors, count } = /** @type {FeatureSet} */ (value);
  return (
    Number.isInteger(count) &&
    count >= 0 &&
    points instanceof Float64Array &&
    descriptors instanceof Uint32Array &&
    points.length >= count * 2 &&
    descriptors.length >= count * DESCRIPTOR_WORDS
  );
}

/**
 * Match the current frame's descriptors against the reference frame's.
 *
 * Three filters, in the reference implementation's order and spirit:
 * 1. Lowe's ratio test (0.75 by default): the nearest reference descriptor must be clearly
 *    nearer than the second, otherwise the corner is not distinctive;
 * 2. a distance ceiling, so an unrelated frame cannot manufacture "good" matches out of
 *    the tail of the Hamming distribution (random 256-bit pairs sit around 128);
 * 3. mutual best: a pair survives only if each side is the other's nearest neighbour.
 *    This is the "unique match" filter, and it is free here because the same O(n*m) pass
 *    already knows every reference descriptor's best current partner.
 *
 * @param {FeatureSet} reference
 * @param {FeatureSet} current
 * @param {object} [options]
 * @param {number} [options.ratio] Lowe ratio in (0, 1]. Defaults to 0.75.
 * @param {number} [options.maxDistance] Hamming ceiling, 0..256. Defaults to 72.
 * @returns {FeatureMatches}
 * @throws {TypeError|RangeError} A feature set or an option is malformed.
 */
export function matchFeatures(reference, current, { ratio = 0.75, maxDistance = 72 } = {}) {
  if (!isFeatureSet(reference) || !isFeatureSet(current)) {
    throw new TypeError('matchFeatures expects feature sets from extractFeatures');
  }
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new RangeError('ratio must be a finite number in (0, 1]');
  }
  if (!Number.isInteger(maxDistance) || maxDistance < 0 || maxDistance > DESCRIPTOR_BITS) {
    throw new RangeError('maxDistance must be an integer in 0..256');
  }

  const empty = { current: new Int32Array(0), reference: new Int32Array(0), distances: new Int32Array(0) };
  const referenceCount = reference.count;
  const currentCount = current.count;
  if (referenceCount < 2 || currentCount < 2) return empty;

  const referenceWords = reference.descriptors;
  const currentWords = current.descriptors;
  const referenceBestDistance = new Int32Array(referenceCount).fill(DESCRIPTOR_BITS + 1);
  const referenceBestCurrent = new Int32Array(referenceCount).fill(-1);

  const matchedCurrent = [];
  const matchedReference = [];
  const matchedDistances = [];

  for (let index = 0; index < currentCount; index += 1) {
    const currentOffset = index * DESCRIPTOR_WORDS;
    let best = DESCRIPTOR_BITS + 1;
    let bestIndex = -1;
    let second = DESCRIPTOR_BITS + 1;

    for (let candidate = 0; candidate < referenceCount; candidate += 1) {
      const distance = hamming(currentWords, currentOffset, referenceWords, candidate * DESCRIPTOR_WORDS);
      if (distance < best) {
        second = best;
        best = distance;
        bestIndex = candidate;
      } else if (distance < second) {
        second = distance;
      }
      if (distance < referenceBestDistance[candidate]) {
        referenceBestDistance[candidate] = distance;
        referenceBestCurrent[candidate] = index;
      }
    }

    if (bestIndex < 0) continue;
    if (best > maxDistance) continue;
    // Strict `<`, like `pair[0].distance < 0.75 * pair[1].distance` in the reference.
    if (!(best < ratio * second)) continue;
    if (referenceBestCurrent[bestIndex] !== index) continue;

    matchedCurrent.push(index);
    matchedReference.push(bestIndex);
    matchedDistances.push(best);
  }

  return {
    current: Int32Array.from(matchedCurrent),
    reference: Int32Array.from(matchedReference),
    distances: Int32Array.from(matchedDistances),
  };
}
