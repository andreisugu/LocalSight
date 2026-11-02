// Label geometry for the zone outlines drawn on the processed frame.
//
// The worker draws the polygons; this module decides what the label says, how big it is
// and where it goes. Presentation only: the polygons, the rules and the events are not
// touched here.
//
// Two constraints drive the numbers:
// - the frame is processed at 1280 px but shown at ~349 px on a 375 px viewport, so a
//   20 px intrinsic font used to render at ~5.5 px and was unreadable (QA F3);
// - zones can share a top vertex, and labels drawn at the same point overprint (QA F4).
//
// Font size is a fraction of the intrinsic frame width, so the label keeps the same
// relative size on every screen: 1/32 of 1280 is 40 px intrinsic, ~11 px on a 375 px
// viewport and ~32 px on the largest stage at 1440 px. Text is short (a character budget
// plus an ellipsis) and laid out in non-overlapping boxes.

/** Keep `value` inside `[min, max]`; NaN falls back to the lower bound. */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Intrinsic font size as a fraction of the canvas width (1280 px -> 40 px). */
export const ZONE_LABEL_FONT_RATIO = 1 / 32;
/** Below this the text stops being a label; above it the label eats the frame. */
export const ZONE_LABEL_MIN_FONT_PX = 16;
export const ZONE_LABEL_MAX_FONT_PX = 56;
/** Upper bound for the zone name before the ellipsis; the prefix/suffix are extra. */
export const ZONE_LABEL_NAME_MAX_CHARS = 26;
/** The label box never takes more than this share of the frame width. */
export const ZONE_LABEL_MAX_WIDTH_RATIO = 0.72;
export const ZONE_LABEL_PREFIX = 'ZONĂ: ';
export const ZONE_LABEL_INACTIVE_SUFFIX = ' (inactiv)';
export const ZONE_LABEL_ELLIPSIS = '…';

/** CSS font for a label, shared by measurement and drawing. */
export function zoneLabelFont(fontPx) {
  return `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
}

/**
 * Intrinsic label font size for a canvas width. Zero for an unusable width, so the caller
 * can skip drawing instead of dividing by zero.
 * @param {number} canvasWidth
 * @returns {number}
 */
export function zoneLabelFontPx(canvasWidth) {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return 0;
  return Math.max(
    ZONE_LABEL_MIN_FONT_PX,
    Math.min(ZONE_LABEL_MAX_FONT_PX, Math.round(canvasWidth * ZONE_LABEL_FONT_RATIO)),
  );
}

/** Trimmed string for a display name, falling back to the id and then to `?`. */
export function zoneLabelName(name, id) {
  const asText = (value) => (value === null || value === undefined ? '' : String(value).trim());
  return asText(name) || asText(id) || '?';
}

/**
 * Cut a string to a character budget, ending with one ellipsis. Counts code points, not
 * UTF-16 units, so a name with emoji cannot be cut through a surrogate pair.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function ellipsizeText(text, maxChars) {
  const chars = Array.from(String(text ?? ''));
  if (!Number.isFinite(maxChars) || chars.length <= maxChars) return chars.join('');
  if (maxChars <= 0) return '';
  if (maxChars === 1) return ZONE_LABEL_ELLIPSIS;
  return `${chars.slice(0, maxChars - 1).join('')}${ZONE_LABEL_ELLIPSIS}`;
}

/**
 * Label text for one zone: `ZONĂ: <name>` plus `(inactiv)` for a dimmed zone.
 *
 * The name is first cut to the character budget, then shortened further while the
 * measured label does not fit `maxWidth`. The state suffix is kept as long as it fits, so
 * an inactive zone never looks active just because its name is long.
 *
 * @param {object} input
 * @param {string} [input.name]
 * @param {string} [input.id]
 * @param {boolean} [input.active]
 * @param {number} [input.maxChars] Character budget for the name only.
 * @param {number} [input.maxWidth] Measured-width budget for the whole label, in px.
 * @param {(text: string) => number} [input.measure]
 * @returns {string}
 */
export function zoneLabelText({
  name,
  id,
  active = true,
  maxChars = ZONE_LABEL_NAME_MAX_CHARS,
  maxWidth = Infinity,
  measure,
} = {}) {
  const suffix = active ? '' : ZONE_LABEL_INACTIVE_SUFFIX;
  const budget = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : ZONE_LABEL_NAME_MAX_CHARS;
  const chars = Array.from(ellipsizeText(zoneLabelName(name, id), budget));
  const fit = (text) => !measure || measure(text) <= maxWidth;

  const full = `${ZONE_LABEL_PREFIX}${chars.join('')}${suffix}`;
  if (fit(full)) return full;

  // Keep the prefix and the state suffix; only the name gives way.
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${ZONE_LABEL_PREFIX}${chars.join('')}${ZONE_LABEL_ELLIPSIS}${suffix}`;
    if (fit(candidate)) return candidate;
  }
  const justPrefix = `${ZONE_LABEL_PREFIX}${ZONE_LABEL_ELLIPSIS}${suffix}`;
  if (fit(justPrefix)) return justPrefix;
  // Degenerate width: the suffix no longer fits either, but the zone still needs a name.
  return ZONE_LABEL_PREFIX.trim();
}

/** Do two label boxes touch? Coordinates are canvas px. */
export function rectanglesOverlap(a, b, margin = 0) {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

/** The vertex a reader scans first: top-most, then left-most. */
export function topVertex(points) {
  let top = points[0];
  for (const point of points) {
    if (point[1] < top[1] || (point[1] === top[1] && point[0] < top[0])) top = point;
  }
  return top;
}

/**
 * Lay out every zone label on the processed frame.
 *
 * Each label is anchored at its polygon's top vertex: above the vertex when there is
 * room, below it otherwise, clamped inside the canvas. When two boxes would overlap, the
 * second one is stepped up by one label height (then down, then two heights up, ...),
 * which staggers coincident top vertices instead of overprinting them.
 *
 * @param {object} input
 * @param {number} input.width Canvas width in px (intrinsic frame size).
 * @param {number} input.height Canvas height in px.
 * @param {Array<{name?: string, id?: string, active?: boolean, topX: number, topY: number}>} input.zones
 *   One entry per drawable zone, in draw order; `topX`/`topY` are normalized 0..1.
 * @param {(text: string) => number} [input.measure] Text width in canvas px.
 * @returns {Array<{text: string, x: number, y: number, width: number, height: number,
 *   fontPx: number, padding: number, active: boolean}>}
 */
export function layoutZoneLabels({ width, height, zones, measure } = {}) {
  const fontPx = zoneLabelFontPx(width);
  if (!fontPx || !Number.isFinite(height) || height <= 0 || !Array.isArray(zones)) return [];

  const padding = Math.max(2, Math.round(fontPx * 0.3));
  const boxHeight = fontPx + padding * 2;
  const gap = Math.max(2, Math.round(fontPx * 0.1));
  const margin = Math.max(1, Math.round(gap / 2));
  const step = boxHeight + gap;
  const measureText =
    typeof measure === 'function'
      ? measure
      : (text) => Array.from(text).length * fontPx * 0.62;
  const maxWidth = Math.max(
    fontPx * 6,
    Math.min(width * ZONE_LABEL_MAX_WIDTH_RATIO, width - padding * 2),
  );

  const placed = [];
  const labels = [];
  for (const zone of zones) {
    const active = zone?.active !== false;
    const text = zoneLabelText({
      name: zone?.name,
      id: zone?.id,
      active,
      maxChars: ZONE_LABEL_NAME_MAX_CHARS,
      maxWidth,
      measure: measureText,
    });
    const boxWidth = Math.min(
      width,
      Math.ceil(measureText(text)) + padding * 2,
    );
    const topX = clamp(Number.isFinite(zone?.topX) ? zone.topX : 0.5, 0, 1);
    const topY = clamp(Number.isFinite(zone?.topY) ? zone.topY : 0, 0, 1);
    const anchorX = clamp(Math.round(topX * width), 0, Math.max(0, width - boxWidth));
    const anchorY = topY * height;
    // Above the vertex by default; below it when the frame has no room above.
    const above = anchorY - boxHeight - gap;
    const baseY = above >= 0 ? above : clamp(anchorY + gap, 0, Math.max(0, height - boxHeight));
    const maxY = Math.max(0, height - boxHeight);

    // 0, one height up, one down, two up, two down, ... the first free slot wins.
    let x = anchorX;
    let y = clamp(baseY, 0, maxY);
    for (let distance = 0; distance <= Math.ceil(height / step); distance += 1) {
      const directions = distance === 0 ? [0] : [-1, 1];
      let found = false;
      for (const direction of directions) {
        const candidateY = baseY + direction * distance * step;
        if (candidateY < 0 || candidateY > maxY) continue;
        const candidate = { x, y: candidateY, width: boxWidth, height: boxHeight };
        if (placed.every((other) => !rectanglesOverlap(candidate, other, margin))) {
          y = candidateY;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const label = { text, x, y, width: boxWidth, height: boxHeight, fontPx, padding, active };
    placed.push(label);
    labels.push(label);
  }
  return labels;
}
