// The one home for display times and dates.
//
// The backend stores UTC and the operators read Romania's clock, so every screen that
// prints a timestamp asks this module instead of building its own `Intl.DateTimeFormat`.
// Business rules that depend on the clock (shift windows, the operational day, the demo
// fixture window) stay in `data/clock.js`: those answer "when", this module answers "how
// it reads".
//
// `Intl.DateTimeFormat` construction is the expensive part, so each format exists once and
// is reused. A missing value and a broken value are different: the caller chooses the
// placeholder for the first, and a broken timestamp is always an em dash.

export const TIME_ZONE = 'Europe/Bucharest';

/** Marker for a value that is present but unreadable (a broken timestamp is not pending). */
export const INVALID_TIME = '—';

const TIME = new Intl.DateTimeFormat('ro-RO', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const DATE_TIME = new Intl.DateTimeFormat('ro-RO', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Contract dates are ISO calendar days (`YYYY-MM-DD`). They carry no time zone, so they are
// reformatted by hand: passing them through `Intl` would move the day across midnight for
// a reader in another zone.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {unknown} value ISO string, epoch milliseconds or Date.
 * @returns {Date|null} `null` when the value cannot be read as a date.
 */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Bucharest wall-clock time: `HH:MM:SS`.
 *
 * @param {string|number|Date|null|undefined} value
 * @param {{placeholder?: string}} [options] Text for a missing value.
 * @returns {string}
 */
export function formatTime(value, { placeholder = 'În așteptare' } = {}) {
  if (!value) return placeholder;
  const date = toDate(value);
  return date ? TIME.format(date) : INVALID_TIME;
}

/**
 * Bucharest day and time: `DD.MM, HH:MM:SS`, the shape the incident list and the audit
 * trail have always shown.
 *
 * @param {string|number|Date|null|undefined} value
 * @param {{placeholder?: string}} [options] Text for a missing value (`—` by default).
 * @returns {string}
 */
export function formatDateTime(value, { placeholder = INVALID_TIME } = {}) {
  if (!value) return placeholder;
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : INVALID_TIME;
}

/**
 * `2026-11-02` → `02.11.2026`. Anything else (null, a partial date, a localised date)
 * renders as `—` instead of being guessed.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatDate(value) {
  const match = ISO_DATE.exec(String(value ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : INVALID_TIME;
}

/**
 * A duration in seconds as the operator reads it, whole seconds and a unit: `43 sec`.
 * No measurement yet is `—`, never `0`.
 *
 * @param {number|string|null|undefined} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return INVALID_TIME;
  return `${Math.round(Number(seconds))} sec`;
}
