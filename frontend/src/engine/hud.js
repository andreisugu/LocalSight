// Colour of the person boxes on the processed canvas.
//
// The frame is annotated before `pipeline.step` runs, so the worker cannot ask the rule
// engine whether a box is under an armed zone: every person box would keep the default
// yellow, even when the frame is about to raise a CRITICAL incident. This module repeats
// the membership test the pipeline is about to make, on the same normalized detections and
// the same zone list, purely for presentation.
//
// Pure: no DOM, no canvas, no worker state, so it can be unit-tested directly and can never
// take a frame down. A person whose feet are under no armed rule keeps the default colour;
// the rule types that are silent in `triggersEvent` stay silent here too, so the HUD cannot
// show a severity the pipeline would not raise.

import { TRUNCATED_BOTTOM, pointInPolygon, triggersEvent, zoneActive } from './zones.js';

/**
 * Box colours by severity, plus the colour a box keeps when no armed rule covers it.
 * @type {{ critical: string, warning: string, default: string }}
 */
export const HUD_COLOURS = Object.freeze({
  critical: '#D73833',
  warning: '#FFB020',
  default: '#FFEB33',
});

/** Severity -> stroke colour. Only the two contract severities exist. */
const SEVERITY_COLOURS = Object.freeze({
  CRITICAL: HUD_COLOURS.critical,
  WARNING: HUD_COLOURS.warning,
});

/**
 * One person box on the HUD.
 * @typedef {object} HudState
 * @property {string} colour Stroke colour for the box and its label.
 * @property {'CRITICAL' | 'WARNING' | null} severity Severity of the armed rule, or null.
 * @property {string | null} zoneId The zone that decided the colour, or null.
 * @property {string | null} ruleType Its `rule_type`, or null.
 */

/** The state of a person no armed rule covers. A fresh object, so callers may mutate it. */
function defaultHudState() {
  return {
    colour: HUD_COLOURS.default,
    severity: null,
    zoneId: null,
    ruleType: null,
  };
}

/**
 * The stroke colour for one state, falling back to the default for a missing state (an
 * unpaired detection, or a caller that skipped the pass).
 * @param {HudState | null | undefined} state
 * @returns {string}
 */
export function hudColourFor(state) {
  return typeof state?.colour === 'string' && state.colour ? state.colour : HUD_COLOURS.default;
}

/**
 * A polygon that {@link pointInPolygon} can consume: at least three finite `[x, y]` pairs.
 * A malformed zone is skipped, never thrown on, because drawing must not cost a frame.
 * @param {unknown} polygon
 * @returns {boolean}
 */
function polygonUsable(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  return polygon.every(
    (point) =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
  );
}

/**
 * The foot point of a pipeline-shaped detection, or null when there is none to test.
 * A box touching the bottom edge has its feet cut off, so it says nothing about membership.
 * @param {{ bbox?: number[] }} detection
 * @returns {[number, number] | null} Normalized `[x, y]`.
 */
function footPoint(detection) {
  const bbox = detection?.bbox;
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const [x1, , x2, y2] = bbox;
  if (![x1, x2, y2].every(Number.isFinite)) return null;
  if (y2 >= TRUNCATED_BOTTOM) return null;
  return [(x1 + x2) / 2, y2];
}

/**
 * The armed rule covering one person's feet, or null. The highest severity wins
 * (`CRITICAL` over `WARNING`); on a tie the first zone in the list keeps the state, so the
 * colour does not flicker between two zones of the same severity.
 * @param {[number, number]} foot Normalized foot point.
 * @param {import('./zones.js').Zone[]} zones Zones in configuration order.
 * @param {boolean} engineOn
 * @param {string | null} vestState `vest`, `no_vest` or `unknown`.
 * @returns {HudState | null}
 */
function hudStateAt(foot, zones, engineOn, vestState) {
  let best = null;
  for (const zone of zones) {
    if (zone === null || typeof zone !== 'object') continue;
    if (!zoneActive(zone, engineOn)) continue;
    if (!triggersEvent(zone, vestState)) continue;
    if (!polygonUsable(zone.polygon)) continue;
    if (!pointInPolygon(foot, zone.polygon)) continue;

    const severity = zone.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
    if (best === null || (severity === 'CRITICAL' && best.severity !== 'CRITICAL')) {
      best = {
        colour: SEVERITY_COLOURS[severity],
        severity,
        zoneId: zone.id ?? null,
        ruleType: zone.rule_type ?? null,
      };
    }
  }
  return best;
}

/**
 * One HUD state per detection, aligned by index with the pipeline's own list.
 *
 * @param {{ bbox: number[], confidence?: number }[]} detections Pipeline-shaped normalized
 *   detections, exactly what `pipeline.step` receives.
 * @param {object} [config]
 * @param {import('./zones.js').Zone[]} [config.zones] Zones for this frame: the aligned list,
 *   `[]` when the view is lost, or the configured list without a reference.
 * @param {boolean} [config.engineOn] The camera's engine switch, as the zone rules see it.
 * @param {(string | null)[]} [config.vestStates] PPE state per detection, aligned by index.
 * @returns {HudState[]}
 */
export function personHudStates(detections, { zones = [], engineOn = true, vestStates = [] } = {}) {
  const list = Array.isArray(detections) ? detections : [];
  const zoneList = Array.isArray(zones) ? zones : [];
  const states = Array.isArray(vestStates) ? vestStates : [];

  return list.map((detection, index) => {
    const foot = footPoint(detection);
    if (foot === null) return defaultHudState();
    // A missing entry is the same as `unknown`: PPE rules stay silent, RESTRICTED fires.
    const vestState = states[index] ?? null;
    return hudStateAt(foot, zoneList, engineOn, vestState) ?? defaultHudState();
  });
}
