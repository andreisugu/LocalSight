// Zone geometry and the rule engine, ported 1:1 from the edge reference:
// ml/safesight_ml/zones.py, plus zone_active() from ml/safesight_ml/overlay.py and
// triggers_event() from ml/safesight_ml/pipeline.py.
//
// Pure functions and plain classes: no DOM, no inference, no imports. Zones are plain
// objects shaped like the ones `GET /zones` returns (snake_case fields, polygons as
// [[x, y], ...] normalized to 0..1), so an object straight from the API can be passed in.

/**
 * A normalized frame point: `[x, y]`, both in 0..1.
 * @typedef {[number, number]} Point
 */

/**
 * A zone as served by the API (`docs/contract.md`).
 * @typedef {object} Zone
 * @property {string} id
 * @property {Point[]} polygon At least 3 points, normalized to 0..1, in contour order.
 * @property {string} rule_type `RESTRICTED`, `PPE_REQUIRED`, `NO_SMOKING` or `CROWD_WATCH`.
 * @property {'always' | 'engine_on'} [active_when] Defaults to `always`.
 * @property {string[]} [required_ppe] Defaults to `[]`.
 * @property {number} [debounce_s] Minimum time in the zone before an event, defaults to 1.0.
 */

/**
 * One presence confirmed by the rule engine.
 * @typedef {object} RuleDecision
 * @property {number} seen Frames of the window in which the track was inside.
 * @property {number} window Frames currently in the window (at most `window_frames`).
 * @property {number} duration_s Seconds from the first frame of the presence.
 */

/**
 * Feet at or below this many frame heights are cut off by the bottom edge of the frame,
 * so the feet are not visible and the membership state holds.
 * @type {number}
 */
export const TRUNCATED_BOTTOM = 0.985;

/** Zone rule -> the vest state that counts as a violation. Only hi-vis is checked. */
const PPE_VIOLATION_STATE = { hi_vis_vest: 'no_vest' };

/**
 * Key for one (track, zone) pair, matching the Python dict key `(track_id, zone.id)`.
 * @param {number} trackId
 * @param {string} zoneId
 * @returns {string}
 */
function stateKey(trackId, zoneId) {
  return `${trackId}\u0000${zoneId}`;
}

/**
 * Ray casting on normalized coordinates: is the point inside the polygon?
 *
 * Same algorithm as the reference, including its half-open edges: a point exactly on
 * the left/top boundary counts as inside, one exactly on the right/bottom boundary as
 * outside. Use {@link signedDistance} when the answer near an edge matters.
 *
 * @param {Point} point
 * @param {Point[]} polygon
 * @returns {boolean}
 */
export function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    if ((y1 > y) !== (y2 > y)) {
      const xCross = ((x2 - x1) * (y - y1)) / (y2 - y1) + x1;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Distance from the polygon edge in frame heights: > 0 inside, < 0 outside, 0 on it.
 *
 * This is `cv2.pointPolygonTest(contour, point, measureDist=True)` re-implemented:
 * the magnitude is the distance to the nearest contour *segment* (so a point diagonally
 * off a corner is measured to the corner, not to an edge line), and the sign comes from
 * the edge-crossing parity. The reference stores the contour as float32, so coordinates
 * are narrowed with Math.fround first; the arithmetic itself is double, as in OpenCV.
 *
 * `aspect` is width / height, so x and y are measured in the same unit and the result is
 * expressed in person-heights.
 *
 * @param {Point} point
 * @param {Point[]} polygon
 * @param {number} [aspect] Width / height of the frame. Defaults to 1.0.
 * @returns {number} Signed distance in frame heights.
 */
export function signedDistance(point, polygon, aspect = 1.0) {
  const px = Math.fround(point[0] * aspect);
  const py = Math.fround(point[1]);
  const n = polygon.length;
  let minNum = Infinity;
  let minDenom = 1;
  let crossings = 0;

  let v0x = Math.fround(polygon[n - 1][0] * aspect);
  let v0y = Math.fround(polygon[n - 1][1]);

  for (let i = 0; i < n; i += 1) {
    const vx = Math.fround(polygon[i][0] * aspect);
    const vy = Math.fround(polygon[i][1]);

    const dx = vx - v0x;
    const dy = vy - v0y;
    const dx1 = px - v0x;
    const dy1 = py - v0y;
    const dx2 = px - vx;
    const dy2 = py - vy;

    let distNum;
    let distDenom = 1;
    if (dx1 * dx + dy1 * dy <= 0) {
      // Closest point is the edge start.
      distNum = dx1 * dx1 + dy1 * dy1;
    } else if (dx2 * dx + dy2 * dy >= 0) {
      // Closest point is the edge end.
      distNum = dx2 * dx2 + dy2 * dy2;
    } else {
      // Closest point is inside the segment: squared perpendicular distance over |edge|^2.
      const cross = dy1 * dx - dx1 * dy;
      distNum = cross * cross;
      distDenom = dx * dx + dy * dy;
    }

    if (distNum * minDenom < minNum * distDenom) {
      minNum = distNum;
      minDenom = distDenom;
      if (minNum === 0) break; // On the contour: the distance is 0, the sign is moot.
    }

    // Not a crossing: horizontal edge, or the edge is entirely to the left of the point.
    const skip =
      (v0y <= py && vy <= py) || (v0y > py && vy > py) || (v0x < px && vx < px);
    if (!skip) {
      let parity = dy1 * dx - dx1 * dy;
      if (dy < 0) parity = -parity;
      if (parity > 0) crossings += 1;
    }

    v0x = vx;
    v0y = vy;
  }

  const distance = Math.sqrt(minNum / minDenom);
  return crossings % 2 === 0 ? -distance : distance;
}

/**
 * Is the zone live right now? `always` zones are always live, `engine_on` zones follow
 * the engine switch. Any other value (e.g. the roadmap `schedule`) behaves like
 * `engine_on`, exactly as in the reference.
 *
 * @param {Zone} zone
 * @param {boolean} engineOn
 * @returns {boolean}
 */
export function zoneActive(zone, engineOn) {
  return (zone.active_when ?? 'always') === 'always' || Boolean(engineOn);
}

/**
 * Does this zone raise an event for a person in the given PPE state?
 *
 * `RESTRICTED` fires for anyone inside. `PPE_REQUIRED` fires only when a required item
 * is provably missing, so an `unknown` vest state is silent. Every other rule type is
 * silent by default, whether or not the rest of the system maps it to an event type.
 *
 * @param {Zone} zone
 * @param {string | null} [vestState] `vest`, `no_vest` or `unknown`.
 * @returns {boolean}
 */
export function triggersEvent(zone, vestState = null) {
  if (zone.rule_type === 'RESTRICTED') return true;
  if (zone.rule_type !== 'PPE_REQUIRED') return false;
  const required = zone.required_ppe ?? [];
  return Object.entries(PPE_VIOLATION_STATE).some(
    ([item, violation]) => required.includes(item) && vestState === violation,
  );
}

/**
 * Is a person in a zone, with a margin so that standing on the edge does not flicker.
 *
 * A person enters once the feet are `margin` person-heights inside the polygon and leaves
 * once they are `margin` outside; in between the last state holds. When the box touches
 * the bottom of the frame the feet are not visible, so the state holds too and no new
 * entry starts.
 */
export class ZoneMembership {
  /** @type {Map<string, { inside: boolean, seen: number }>} */
  #state = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.margin] Entry/exit band in person-heights. Defaults to 0.10.
   * @param {number} [options.ttl_s] Seconds before an unseen track is forgotten. Defaults to 10.0.
   */
  constructor({ margin = 0.1, ttl_s = 10.0 } = {}) {
    if (margin < 0) throw new RangeError('margin must be >= 0');
    /** @type {number} */
    this.margin = margin;
    /** @type {number} */
    this.ttl_s = ttl_s;
    /** @type {number} How many times a track changed side. */
    this.transitions = 0;
  }

  /**
   * Update the membership of one track in one zone for one frame.
   *
   * @param {object} input
   * @param {number} input.trackId
   * @param {[number, number, number, number]} input.bbox Normalized `[x1, y1, x2, y2]`.
   * @param {Zone} input.zone
   * @param {number} input.now Seconds, monotonic.
   * @param {number} [input.aspect] Frame width / height. Defaults to 1.0.
   * @returns {boolean} Whether the track counts as inside after this frame.
   */
  update({ trackId, bbox, zone, now, aspect = 1.0 }) {
    const key = stateKey(trackId, zone.id);
    const previous = this.#state.get(key)?.inside ?? false;
    const [x1, y1, x2, y2] = bbox;

    let inside;
    if (y2 >= TRUNCATED_BOTTOM) {
      inside = previous;
    } else {
      const depth = signedDistance([(x1 + x2) / 2.0, y2], zone.polygon, aspect);
      const band = this.margin * (y2 - y1);
      if (depth >= band) {
        inside = true;
      } else if (depth <= -band) {
        inside = false;
      } else {
        inside = previous;
      }
    }

    if (inside !== previous) this.transitions += 1;
    this.#state.set(key, { inside, seen: now });
    return inside;
  }

  /**
   * Forget tracks that have not been updated for `ttl_s` seconds.
   * @param {number} now Seconds, monotonic.
   * @returns {void}
   */
  prune(now) {
    for (const [key, state] of this.#state) {
      if (now - state.seen >= this.ttl_s) this.#state.delete(key);
    }
  }
}

/**
 * One event per presence, with debounce, temporal confidence and cooldown.
 *
 * The state is per `(track_id, zone.id)`: a presence emits once, survives frames where the
 * track drops out, and is dropped `cooldown_s` after the track was first seen outside, so
 * the same person can raise a second event after leaving.
 */
export class RuleEngine {
  /** @type {Map<string, { firstSeen: number, lastSeen: number, seen: boolean[], emitted: boolean, leftAt: number | null }>} */
  #states = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.window_frames] Frames kept in the temporal window. Defaults to 15.
   * @param {number} [options.min_window] Frames needed before confirming. Defaults to 5.
   * @param {number} [options.seen_ratio] Share of the window that must be inside. Defaults to 0.8.
   * @param {number} [options.cooldown_s] Seconds after leaving before state is dropped. Defaults to 10.0.
   */
  constructor({ window_frames = 15, min_window = 5, seen_ratio = 0.8, cooldown_s = 10.0 } = {}) {
    if (window_frames < 1) throw new RangeError('window_frames must be >= 1');
    if (min_window < 1 || min_window > window_frames) {
      throw new RangeError('min_window must be between 1 and window_frames');
    }
    if (!(seen_ratio >= 0.0 && seen_ratio <= 1.0)) {
      throw new RangeError('seen_ratio must be between 0 and 1');
    }
    /** @type {number} */
    this.window_frames = window_frames;
    /** @type {number} */
    this.min_window = min_window;
    /** @type {number} */
    this.seen_ratio = seen_ratio;
    /** @type {number} */
    this.cooldown_s = cooldown_s;
  }

  /**
   * Append to the rolling window, dropping the oldest frame (Python's `deque(maxlen=...)`).
   * @param {{ seen: boolean[] }} state
   * @param {boolean} value
   * @returns {void}
   */
  #append(state, value) {
    state.seen.push(value);
    if (state.seen.length > this.window_frames) state.seen.shift();
  }

  /**
   * Update the rule state for one track/zone pair at one frame.
   *
   * @param {object} input
   * @param {number} input.trackId
   * @param {Zone} input.zone
   * @param {boolean} input.inZone Result of {@link ZoneMembership.update}.
   * @param {number} input.now Seconds, monotonic.
   * @param {boolean} input.engineOn
   * @returns {RuleDecision | null} A decision on the frame the presence is confirmed, else null.
   */
  observe({ trackId, zone, inZone, now, engineOn }) {
    const key = stateKey(trackId, zone.id);

    if (!zoneActive(zone, engineOn)) {
      this.#states.delete(key);
      return null;
    }

    let state = this.#states.get(key) ?? null;

    if (!inZone) {
      if (state === null) return null;
      state.lastSeen = now;
      this.#append(state, false);
      if (state.leftAt === null) state.leftAt = now;
      if (now - state.leftAt >= this.cooldown_s) this.#states.delete(key);
      return null;
    }

    if (state === null) {
      state = { firstSeen: now, lastSeen: now, seen: [true], emitted: false, leftAt: null };
      this.#states.set(key, state);
    } else {
      state.lastSeen = now;
      state.leftAt = null;
      this.#append(state, true);
    }

    if (state.emitted) return null;

    const window = state.seen.length;
    const seen = state.seen.reduce((count, value) => count + (value ? 1 : 0), 0);
    const duration = now - state.firstSeen;
    const confirmed = window >= this.min_window && seen / window >= this.seen_ratio;
    if (duration < (zone.debounce_s ?? 1.0) || !confirmed) return null;

    state.emitted = true;
    return Object.freeze({ seen, window, duration_s: duration });
  }

  /**
   * Drop states that have not been seen for longer than the cooldown.
   * @param {number} now Seconds, monotonic.
   * @returns {void}
   */
  prune(now) {
    for (const [key, state] of this.#states) {
      if (now - state.lastSeen >= this.cooldown_s) this.#states.delete(key);
    }
  }

  /**
   * Forget every state, e.g. when the camera switches.
   * @returns {void}
   */
  reset() {
    this.#states.clear();
  }
}
