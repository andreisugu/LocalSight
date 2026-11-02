// Minimal IoU tracker: the browser stand-in for ByteTrack on the Python edge.
//
// ByteTrack has two association stages (confident and weak detections) and a Kalman
// filter per track. With one camera in a tab, neither earns its port: the rule engine
// only needs a stable integer id per person for a few seconds, and an id change after a
// long occlusion costs at most one rule window. Reference: `docs/browser-engine.md` §3.
//
// Deterministic by construction: greedy matching over all (track, detection) pairs sorted
// by descending IoU with the track id and the input index as tie-breakers, so the same
// frames always produce the same ids. Ageing is counted in frames, not milliseconds, so a
// dropped frame cannot age a track faster than a processed one.
//
// Pure functions and plain objects: no DOM, no inference, no imports.

const DEFAULT_IOU_THRESHOLD = 0.3;
const DEFAULT_MAX_AGE_FRAMES = 30;

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
 * Create an IoU tracker.
 *
 * A detection is matched to at most one track and a track to at most one detection per
 * frame, greedily by descending IoU. An unmatched track keeps its box and id for up to
 * `maxAgeFrames` frames, so a one-frame detection drop does not split a presence; after
 * that it is dropped and the next matching detection gets a fresh id. Unmatched
 * detections always start a new track, in input order.
 *
 * @param {object} [options]
 * @param {number} [options.iouThreshold] Minimum IoU for a match, in (0, 1]. Defaults to 0.3.
 * @param {number} [options.maxAgeFrames] Missed frames a track survives. Defaults to 30.
 * @returns {{ update: (detections: TrackerDetection[], nowMs?: number) => TrackedBox[] }}
 * @throws {RangeError} An option is outside its range.
 */
export function createTracker({ iouThreshold = DEFAULT_IOU_THRESHOLD, maxAgeFrames = DEFAULT_MAX_AGE_FRAMES } = {}) {
  if (typeof iouThreshold !== 'number' || !(iouThreshold > 0 && iouThreshold <= 1)) {
    throw new RangeError('iouThreshold must be in (0, 1]');
  }
  if (!Number.isInteger(maxAgeFrames) || maxAgeFrames < 0) {
    throw new RangeError('maxAgeFrames must be an integer >= 0');
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
