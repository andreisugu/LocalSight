// Minimal IoU + centre-distance tracker: the browser stand-in for ByteTrack on the Python
// edge.
//
// ByteTrack has two association stages (confident and weak detections) and a Kalman
// filter per track. With one camera in a tab, neither earns its port: the rule engine
// only needs a stable integer id per person for a few seconds, and an id change after a
// long occlusion costs at most one rule window. Reference: `docs/browser-engine.md` §3.
//
// Two association passes. The first is IoU, which is exact when the same person overlaps
// their previous box. At 1.3-1.5 fps on WASM a walker moves far enough between processed
// frames that IoU drops to zero, so a second pass matches what IoU left over by centre
// distance, relative to the larger box height (people move roughly one person-height per
// step, while people standing next to each other stay a body-width apart). The second
// pass runs only on the leftovers of the first, greedily by smallest distance, so a
// confidently overlapping pair can never be overruled and two nearby people cannot
// collapse into one track.
//
// Deterministic by construction: both passes are greedy over all remaining
// (track, detection) pairs sorted by score (descending IoU, then ascending centre
// distance) with the track id and the input index as tie-breakers, so the same frames
// always produce the same ids. Ageing is counted in frames, not milliseconds, so a
// dropped frame cannot age a track faster than a processed one.
//
// Pure functions and plain objects: no DOM, no inference, no imports.

const DEFAULT_IOU_THRESHOLD = 0.3;
const DEFAULT_MAX_AGE_FRAMES = 30;
const DEFAULT_CENTER_MATCH = true;
const DEFAULT_CENTER_DISTANCE_FACTOR = 0.8;

/**
 * @typedef {[number, number, number, number]} Bbox Normalized `[x1, y1, x2, y2]`.
 */

/**
 * A detection handed to {@link update}, in frame-normalized coordinates and in input
 * order. `confidence` is the detector score; `1` stands in when the caller has none.
 *
 * @typedef {object} TrackerDetection
 * @property {Bbox} bbox
 * @property {number} [confidence] Detector score, defaults to `1`.
 */

/**
 * One matched track for the current frame.
 *
 * @typedef {object} TrackedBox
 * @property {number} trackId Stable id, starts at `1` and is never reused.
 * @property {Bbox} bbox The matched detection box.
 * @property {number} confidence The matched detection score.
 */

/**
 * Intersection over union of two normalized boxes.
 *
 * @param {Bbox} a
 * @param {Bbox} b
 * @returns {number} IoU in 0..1; `0` when the boxes do not overlap.
 */
export function iou(a, b) {
  const overlapW = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const overlapH = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = overlapW * overlapH;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Height of a normalized box, clamped at zero for a degenerate input.
 *
 * @param {Bbox} box
 * @returns {number}
 */
function heightOf(box) {
  return Math.max(0, box[3] - box[1]);
}

/**
 * Euclidean distance between two box centres, in frame-normalized units.
 *
 * @param {Bbox} a
 * @param {Bbox} b
 * @returns {number}
 */
function centerDistance(a, b) {
  const dx = (a[0] + a[2] - b[0] - b[2]) / 2;
  const dy = (a[1] + a[3] - b[1] - b[3]) / 2;
  return Math.hypot(dx, dy);
}

/**
 * @param {unknown} box
 * @param {string} field
 * @returns {Bbox}
 * @throws {TypeError} Not four finite numbers.
 */
function requireBox(box, field) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
    throw new TypeError(`${field} must be [x1, y1, x2, y2] with finite numbers`);
  }
  return [box[0], box[1], box[2], box[3]];
}

/**
 * Create an IoU + centre-distance tracker.
 *
 * A detection is matched to at most one track and a track to at most one detection per
 * frame. First pass: greedy by descending IoU. Second pass, only over what the first
 * pass left unmatched: greedy by ascending centre distance, where a pair is eligible
 * when the distance between centres is at most `centerDistanceFactor` times the larger
 * of the two box heights. An unmatched track keeps its box and id for up to
 * `maxAgeFrames` frames, so a one-frame detection drop does not split a presence; after
 * that it is dropped and the next matching detection gets a fresh id. Unmatched
 * detections always start a new track, in input order.
 *
 * `centerMatch` exists for callers that need the pure IoU behaviour (and for tests of
 * that stage in isolation); the browser engine keeps it on.
 *
 * @param {object} [options]
 * @param {number} [options.iouThreshold] Minimum IoU for a match, in (0, 1]. Defaults to 0.3.
 * @param {number} [options.maxAgeFrames] Missed frames a track survives. Defaults to 30.
 * @param {boolean} [options.centerMatch] Match leftovers by centre distance. Defaults to true.
 * @param {number} [options.centerDistanceFactor] Centre distance budget, in box heights.
 *   Defaults to 0.8.
 * @returns {{ update: (detections: TrackerDetection[], nowMs?: number) => TrackedBox[] }}
 * @throws {RangeError|TypeError} An option has the wrong type or is outside its range.
 */
export function createTracker({
  iouThreshold = DEFAULT_IOU_THRESHOLD,
  maxAgeFrames = DEFAULT_MAX_AGE_FRAMES,
  centerMatch = DEFAULT_CENTER_MATCH,
  centerDistanceFactor = DEFAULT_CENTER_DISTANCE_FACTOR,
} = {}) {
  if (typeof iouThreshold !== 'number' || !(iouThreshold > 0 && iouThreshold <= 1)) {
    throw new RangeError('iouThreshold must be in (0, 1]');
  }
  if (!Number.isInteger(maxAgeFrames) || maxAgeFrames < 0) {
    throw new RangeError('maxAgeFrames must be an integer >= 0');
  }
  if (typeof centerMatch !== 'boolean') {
    throw new TypeError('centerMatch must be a boolean');
  }
  if (
    typeof centerDistanceFactor !== 'number' ||
    !Number.isFinite(centerDistanceFactor) ||
    centerDistanceFactor <= 0
  ) {
    throw new RangeError('centerDistanceFactor must be a finite number > 0');
  }

  /**
   * @type {Array<{ trackId: number, bbox: Bbox, confidence: number, missed: number,
   *               lastSeenMs: number }>}
   */
  let tracks = [];
  let nextId = 1;

  /**
   * Advance the tracker by one frame.
   *
   * The result has exactly one entry per detection, in the order the detections were
   * given, so a caller can line per-detection data (a PPE state, a mask) up by index.
   * Tracks coasting through this frame are not returned: they have no new box.
   *
   * @param {TrackerDetection[]} detections Normalized detections for this frame.
   * @param {number} [nowMs] Frame timestamp, recorded for diagnostics only.
   * @returns {TrackedBox[]} Matched tracks, in detection order.
   * @throws {TypeError} A detection is malformed or `nowMs` is not a finite number.
   */
  function update(detections, nowMs = 0) {
    if (!Array.isArray(detections)) throw new TypeError('detections must be an array');
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }

    const items = detections.map((detection, index) => {
      if (detection === null || typeof detection !== 'object') {
        throw new TypeError(`detections[${index}] must be an object`);
      }
      const bbox = requireBox(detection.bbox, `detections[${index}].bbox`);
      const confidence = detection.confidence === undefined ? 1 : detection.confidence;
      if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
        throw new TypeError(`detections[${index}].confidence must be a finite number`);
      }
      return { bbox, confidence, index };
    });

    const pairs = [];
    for (const track of tracks) {
      for (const item of items) {
        const overlap = iou(track.bbox, item.bbox);
        if (overlap >= iouThreshold) pairs.push({ track, item, overlap });
      }
    }
    pairs.sort(
      (left, right) =>
        right.overlap - left.overlap ||
        left.track.trackId - right.track.trackId ||
        left.item.index - right.item.index,
    );

    const takenTracks = new Set();
    const takenItems = new Set();
    const matchedByTrack = new Map();
    for (const pair of pairs) {
      if (takenTracks.has(pair.track.trackId) || takenItems.has(pair.item.index)) continue;
      takenTracks.add(pair.track.trackId);
      takenItems.add(pair.item.index);
      matchedByTrack.set(pair.track.trackId, pair.item);
    }

    // Second pass: people seen at a low frame rate move more than their own overlap.
    // Only the leftovers of the IoU pass are candidates, so a pair with a real overlap
    // is never reassigned by distance and a stationary person's track cannot be taken
    // by a neighbour who happens to stand close.
    if (centerMatch) {
      const distances = [];
      for (const track of tracks) {
        if (takenTracks.has(track.trackId)) continue;
        for (const item of items) {
          if (takenItems.has(item.index)) continue;
          const distance = centerDistance(track.bbox, item.bbox);
          const budget = centerDistanceFactor * Math.max(heightOf(track.bbox), heightOf(item.bbox));
          if (distance > budget) continue;
          distances.push({ track, item, distance });
        }
      }
      distances.sort(
        (left, right) =>
          left.distance - right.distance ||
          left.track.trackId - right.track.trackId ||
          left.item.index - right.item.index,
      );
      for (const pair of distances) {
        if (takenTracks.has(pair.track.trackId) || takenItems.has(pair.item.index)) continue;
        takenTracks.add(pair.track.trackId);
        takenItems.add(pair.item.index);
        matchedByTrack.set(pair.track.trackId, pair.item);
      }
    }

    const nextTracks = [];
    /** @type {Array<{ index: number, track: TrackedBox }>} */
    const output = [];

    for (const track of tracks) {
      const item = matchedByTrack.get(track.trackId);
      if (item === undefined) {
        const missed = track.missed + 1;
        // Survive `maxAgeFrames` misses; the miss that exceeds the budget drops the track.
        if (missed > maxAgeFrames) continue;
        nextTracks.push({ ...track, missed });
        continue;
      }
      // Each item is matched at most once, and its box is already a private copy.
      const bbox = item.bbox;
      nextTracks.push({
        trackId: track.trackId,
        bbox,
        confidence: item.confidence,
        missed: 0,
        lastSeenMs: nowMs,
      });
      output.push({
        index: item.index,
        track: { trackId: track.trackId, bbox, confidence: item.confidence },
      });
    }

    for (const item of items) {
      if (takenItems.has(item.index)) continue;
      const track = {
        trackId: nextId,
        bbox: item.bbox,
        confidence: item.confidence,
        missed: 0,
        lastSeenMs: nowMs,
      };
      nextId += 1;
      nextTracks.push(track);
      output.push({
        index: item.index,
        track: { trackId: track.trackId, bbox: track.bbox, confidence: track.confidence },
      });
    }

    tracks = nextTracks;
    output.sort((left, right) => left.index - right.index);
    return output.map((entry) => entry.track);
  }

  return { update };
}
