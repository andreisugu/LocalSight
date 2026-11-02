// Hi-vis vest check by colour: the browser port of the removed `ml/safesight_ml/ppe.py`.
//
// Each person track gets one of three states: `vest`, `no_vest` or `unknown`. A frame only
// counts when the person is big enough and fully inside the frame, and `no_vest` also
// needs a confident person detection, because the low scores on our clips came from
// partial boxes and from objects mistaken for people, not from people without a vest.
//
// `no_vest` raises `NO_PPE` in a `PPE_REQUIRED` zone that requires `hi_vis_vest`;
// `unknown` never does. This is still a colour heuristic, not a trained classifier.
//
// Input shape. The Python reference takes an OpenCV `np.ndarray` in BGR. In the browser the
// raw frame arrives as ImageData, i.e. RGBA, so this module takes the plain object
// `{ data, width, height }`, with `r = data[i]`, `g = data[i + 1]`, `b = data[i + 2]`,
// `a = data[i + 3]` and `i = 4 * (y * width + x)` (top-left first). The conversion below
// feeds the channels as BGR, in the order `cv2.cvtColor(..., COLOR_BGR2HSV)` expects, and
// ignores alpha.
//
// HSV keeps OpenCV's 8-bit scale: H in 0..179 (degrees / 2), S and V in 0..255 - not
// H in 0..360. The three `cv2.inRange` masks become one arithmetic pass over the torso
// band: no DOM, no canvas, no per-pixel allocation. This runs on the raw frame before the
// face blur, exactly where `ppe.py` runs.
//
// Wiring: `pipeline.js` takes one state per detection through `vestStates`, in detection
// order, so the caller does `tracker.update(trackId, vestSample(frame, bbox), confidence,
// now, personPx)` per person on the raw frame, before the blur overwrites that region.
// That call is not in this file.
//
// The constants keep their Python names, so the two files can be read side by side.

/** Share of fluorescent pixels at or above which a person is judged to wear a vest. */
export const HIVIS_MIN = 0.1; // ppe.py: HIVIS_MIN
/** Below this, with a confident detection: no vest. Between the two: unknown. */
export const NO_VEST_MAX = 0.03; // ppe.py: NO_VEST_MAX
/** Smaller people have too few torso pixels to judge, in frame pixels. */
export const MIN_PERSON_PX = 80; // ppe.py: MIN_PERSON_PX
/** Claiming "no vest" needs more pixels than judging a vest, in frame pixels. */
export const MIN_PERSON_PX_NO_VEST = 150; // ppe.py: MIN_PERSON_PX_NO_VEST
/** Good frames before a track gets a state. */
export const MIN_SAMPLES = 5; // ppe.py: MIN_SAMPLES
/** "No vest" looks at the last RECENT good frames. */
export const RECENT = 30; // ppe.py: RECENT
/** Frames needed before "no vest" may be claimed. */
export const MIN_SAMPLES_NO_VEST = 10; // ppe.py: MIN_SAMPLES_NO_VEST
/** Boxes on barriers and equipment scored 0.39-0.50: do not call those "no vest". */
export const MIN_CONFIDENCE_NO_VEST = 0.5; // ppe.py: MIN_CONFIDENCE_NO_VEST
/** A box this close to the frame border is cut: `x <= EDGE` or `x >= 1 - EDGE`. */
export const EDGE = 0.005; // ppe.py: EDGE

/** @typedef {[number, number, number, number]} Bbox Normalized `[x1, y1, x2, y2]`. */

/**
 * An RGBA frame, the shape `ctx.getImageData()` returns and the only thing this module
 * reads. A typed array is expected in practice, but any indexable buffer of length
 * `width * height * 4` works.
 *
 * @typedef {object} RgbaFrame
 * @property {ArrayLike<number>} data RGBA bytes, `r, g, b, a` per pixel.
 * @property {number} width Pixels per row.
 * @property {number} height Rows.
 */

/**
 * One track's smoothed state. Mirrors `_Track` in `ppe.py`.
 *
 * @typedef {object} _Track
 * @property {number} score EMA of the per-frame ratio.
 * @property {number} samples Good frames counted so far.
 * @property {number} confidence EMA of the detector confidence.
 * @property {number} lastSeen Seconds, as given to `update`.
 * @property {number[]} recent Last {@link RECENT} ratios (Python `deque(maxlen=RECENT)`).
 * @property {number[]} recentPx Last {@link RECENT} person heights in frame pixels.
 */

/**
 * @param {unknown} box
 * @returns {Bbox}
 * @throws {TypeError} Not four finite numbers.
 */
function requireBbox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
    throw new TypeError('bbox must be [x1, y1, x2, y2] with finite numbers');
  }
  return [box[0], box[1], box[2], box[3]];
}

/**
 * @param {unknown} image
 * @returns {RgbaFrame}
 * @throws {TypeError} Missing buffer, or its length does not match `width * height * 4`.
 */
function requireFrame(image) {
  if (image === null || typeof image !== 'object') {
    throw new TypeError('frame must be { data, width, height }');
  }
  const { data, width, height } = /** @type {RgbaFrame} */ (image);
  if (!Number.isInteger(width) || width <= 0) {
    throw new TypeError('frame.width must be a positive integer');
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new TypeError('frame.height must be a positive integer');
  }
  if (data === null || typeof data !== 'object' || !Number.isInteger(data.length)) {
    throw new TypeError('frame.data must be an indexable RGBA buffer');
  }
  if (data.length !== width * height * 4) {
    throw new TypeError('frame.data length must be width * height * 4 (RGBA)');
  }
  return /** @type {RgbaFrame} */ (image);
}

/**
 * Does one pixel fall in any of the three hi-vis ranges?
 *
 * Colours are passed in BGR order, like the reference. The float HSV is quantized to
 * OpenCV's 8-bit storage (H in 0..179, S and V in 0..255) before the inclusive `inRange`
 * comparisons, so the thresholds mean what they mean in `ppe.py`.
 *
 * `Math.round` is the closest JS match to OpenCV's quantization, which happens in float32
 * and so sends a hue landing exactly on `.5` to either side at random. Measured on a real
 * 4K demo frame: 279 differing pixels of 8.29M with half-up, 4005 with ties-to-even. The
 * remaining differences are all one hue step at a range edge (a ratio below 0.002).
 *
 * @param {number} b Blue, 0..255.
 * @param {number} g Green, 0..255.
 * @param {number} r Red, 0..255.
 * @returns {boolean}
 */
function isHiVisPixel(b, g, r) {
  const v = Math.max(b, g, r);
  const min = Math.min(b, g, r);
  const delta = v - min;
  const s = v === 0 ? 0 : Math.round((255 * delta) / v);

  let h = 0;
  if (delta !== 0) {
    if (v === r) h = (60 * (g - b)) / delta;
    else if (v === g) h = 120 + (60 * (b - r)) / delta;
    else h = 240 + (60 * (r - g)) / delta;
    if (h < 0) h += 360;
  }
  // OpenCV stores hue as degrees / 2 rounded to a byte, hence 0..179.
  h = Math.round(h / 2);

  const orange = h >= 3 && h <= 22 && s >= 140 && v >= 140;
  const yellowGreen = h >= 23 && h <= 65 && s >= 100 && v >= 120;
  // Overcast or snow washes a yellow-green vest out (saturation ~60 on cam02); keep it
  // when it is still bright. Snow and white surfaces stay out (saturation ~10).
  const paleYellowGreen = h >= 23 && h <= 65 && s >= 45 && v >= 170;
  return orange || yellowGreen || paleYellowGreen;
}

/**
 * Share of fluorescent pixels in the torso band of a person box, on the raw, unblurred
 * frame. Port of `hivis_ratio`: the band is 15%..55% of the box height and 20%..80% of its
 * width, in normalized coordinates.
 *
 * @param {RgbaFrame} frame RGBA frame, `width * height * 4` bytes.
 * @param {Bbox} bbox Normalized `[x1, y1, x2, y2]`.
 * @returns {number | null} Ratio in 0..1, or `null` when the band is empty.
 * @throws {TypeError} Malformed frame or bbox.
 */
export function hivisRatio(frame, bbox) {
  const { data, width, height } = requireFrame(frame);
  const [x1, y1, x2, y2] = requireBbox(bbox);
  const bw = x2 - x1;
  const bh = y2 - y1;

  // Python: int() truncates toward zero, and the slice clamps to the buffer.
  const left = Math.trunc((x1 + 0.2 * bw) * width);
  const right = Math.trunc((x2 - 0.2 * bw) * width);
  const top = Math.trunc((y1 + 0.15 * bh) * height);
  const bottom = Math.trunc((y1 + 0.55 * bh) * height);

  const x0 = Math.min(width, Math.max(0, left));
  const xEnd = Math.min(width, Math.max(0, right));
  const y0 = Math.min(height, Math.max(0, top));
  const yEnd = Math.min(height, Math.max(0, bottom));
  // Python: `if crop.size == 0: return None` - a zero or inverted band has nothing to judge.
  if (x0 >= xEnd || y0 >= yEnd) return null;

  let hits = 0;
  for (let y = y0; y < yEnd; y += 1) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < xEnd; x += 1, i += 4) {
      // RGBA buffer -> BGR arguments, the channel order cv2 reads from an OpenCV frame.
      if (isHiVisPixel(data[i + 2], data[i + 1], data[i])) hits += 1;
    }
  }
  return hits / ((xEnd - x0) * (yEnd - y0));
}

/**
 * The ratio for one frame, or `null` when the box is too small or cut by the frame.
 * Port of `vest_sample`.
 *
 * @param {RgbaFrame} frame RGBA frame.
 * @param {Bbox} bbox Normalized `[x1, y1, x2, y2]`.
 * @returns {number | null} Ratio in 0..1, or `null` when the frame does not count.
 * @throws {TypeError} Malformed frame or bbox.
 */
export function vestSample(frame, bbox) {
  const { height } = requireFrame(frame);
  const [x1, y1, x2, y2] = requireBbox(bbox);
  // A person smaller than MIN_PERSON_PX has too few torso pixels to judge.
  if ((y2 - y1) * height < MIN_PERSON_PX) return null;
  if (x1 <= EDGE || y1 <= EDGE || x2 >= 1 - EDGE || y2 >= 1 - EDGE) return null;
  return hivisRatio(frame, [x1, y1, x2, y2]);
}

/**
 * Append to a bounded history, dropping the oldest value (Python's `deque(maxlen=RECENT)`).
 *
 * @param {number[]} history
 * @param {number} value
 * @returns {void}
 */
function append(history, value) {
  history.push(value);
  if (history.length > RECENT) history.shift();
}

/**
 * numpy's default (`linear`) percentile, so the p90 gate means the same as
 * `np.percentile(track.recent, 90)` in `ppe.py`.
 *
 * @param {number[]} values Non-empty.
 * @param {number} q Percentile in 0..100.
 * @returns {number}
 */
function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = ((sorted.length - 1) * q) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * Median, averaging the two middle values on an even count (`np.median`).
 *
 * @param {number[]} values Non-empty.
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Smooths the per-frame ratio per track and turns it into a vest state.
 * Port of `VestTracker`.
 */
export class VestTracker {
  /** @type {Map<number, _Track>} */
  #tracks = new Map();
  /** @type {number} */
  #alpha;
  /** @type {number} */
  #ttlS;

  /**
   * @param {object} [options]
   * @param {number} [options.alpha] EMA weight of the newest frame. Defaults to 0.2.
   * @param {number} [options.ttlS] Seconds before an unseen track is pruned. Defaults to 10.0.
   */
  constructor({ alpha = 0.2, ttlS = 10.0 } = {}) {
    if (typeof alpha !== 'number' || !(alpha > 0 && alpha <= 1)) {
      throw new RangeError('alpha must be in (0, 1]');
    }
    if (typeof ttlS !== 'number' || !(ttlS > 0)) {
      throw new RangeError('ttlS must be > 0');
    }
    this.#alpha = alpha;
    this.#ttlS = ttlS;
  }

  /**
   * Fold one frame into a track and return its state.
   *
   * `ratio` is `null` when the frame did not count (small or cut box): the track keeps its
   * score and its sample count, so an occlusion cannot reset a state, but `lastSeen` still
   * moves and the track survives pruning.
   *
   * @param {number} trackId Stable tracker id.
   * @param {number | null} ratio From {@link vestSample}.
   * @param {number} [confidence] Detector confidence for this person box. Defaults to 1.
   * @param {number} [now] Seconds, monotonic. Defaults to 0.
   * @param {number} [personPx] Box height in frame pixels. Defaults to `Infinity`.
   * @returns {'vest' | 'no_vest' | 'unknown'}
   * @throws {TypeError} A value has the wrong type.
   */
  update(trackId, ratio, confidence = 1.0, now = 0.0, personPx = Infinity) {
    if (typeof trackId !== 'number' || !Number.isFinite(trackId)) {
      throw new TypeError('trackId must be a finite number');
    }
    if (ratio !== null && (typeof ratio !== 'number' || !Number.isFinite(ratio))) {
      throw new TypeError('ratio must be a finite number or null');
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      throw new TypeError('confidence must be a finite number');
    }
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new TypeError('now must be a finite number');
    }
    if (typeof personPx !== 'number' || Number.isNaN(personPx)) {
      throw new TypeError('personPx must be a number');
    }

    let track = this.#tracks.get(trackId);
    if (track === undefined) {
      track = { score: 0.0, samples: 0, confidence: 0.0, lastSeen: 0.0, recent: [], recentPx: [] };
      this.#tracks.set(trackId, track);
    }
    track.lastSeen = now;

    if (ratio !== null) {
      if (track.samples === 0) {
        track.score = ratio;
        track.confidence = confidence;
      } else {
        track.score += this.#alpha * (ratio - track.score);
        track.confidence += this.#alpha * (confidence - track.confidence);
      }
      track.samples += 1;
      append(track.recent, ratio);
      append(track.recentPx, personPx);
    }
    return this.state(trackId);
  }

  /**
   * The state of a track, from what has been folded in so far.
   *
   * `vest` needs a smoothed ratio at or above {@link HIVIS_MIN}. `no_vest` needs all four
   * of: {@link MIN_SAMPLES_NO_VEST} samples, a p90 of the recent window below
   * {@link NO_VEST_MAX} (a worn vest shows up at least now and then), a median person
   * height of at least {@link MIN_PERSON_PX_NO_VEST} frame pixels and a smoothed
   * confidence of at least {@link MIN_CONFIDENCE_NO_VEST}. Everything else is `unknown`.
   *
   * @param {number} trackId
   * @returns {'vest' | 'no_vest' | 'unknown'}
   */
  state(trackId) {
    const track = this.#tracks.get(trackId);
    if (track === undefined || track.samples < MIN_SAMPLES) return 'unknown';
    if (track.score >= HIVIS_MIN) return 'vest';
    if (
      track.samples >= MIN_SAMPLES_NO_VEST &&
      percentile(track.recent, 90) < NO_VEST_MAX &&
      median(track.recentPx) >= MIN_PERSON_PX_NO_VEST &&
      track.confidence >= MIN_CONFIDENCE_NO_VEST
    ) {
      return 'no_vest';
    }
    return 'unknown';
  }

  /**
   * Smoothed ratio for a track, or `null` before the first good frame.
   *
   * @param {number} trackId
   * @returns {number | null}
   */
  score(trackId) {
    const track = this.#tracks.get(trackId);
    return track === undefined || track.samples === 0 ? null : track.score;
  }

  /**
   * Drop tracks not seen for `ttlS`; a short occlusion keeps the state.
   *
   * @param {number} now Seconds, monotonic.
   * @returns {void}
   */
  prune(now) {
    for (const [trackId, track] of this.#tracks) {
      if (now - track.lastSeen >= this.#ttlS) this.#tracks.delete(trackId);
    }
  }
}
