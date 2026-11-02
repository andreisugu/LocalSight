// Time primitives shared by the demo fixtures and the API layer.
//
// The apron works on Romania's clock, the backend stores UTC and the screens show
// Europe/Bucharest. Shifts start at 06:00, 14:00 and 22:00, and the operational day
// changes at 06:00, so a night shift opened at 02:00 still belongs to yesterday. Those
// rules live here once and take a clock argument, which keeps them testable without
// faking the global `Date`.

const TIME_ZONE = 'Europe/Bucharest';

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60_000;

const SHIFT_START_HOURS = Object.freeze({
  shift_1: 6,
  shift_2: 14,
  shift_3: 22,
});

const OPERATIONAL_DAY_START_HOUR = SHIFT_START_HOURS.shift_1;
const HOURS_PER_DAY = 24;

const PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const pad2 = (value) => String(value).padStart(2, '0');

/** Calendar and clock fields of `date` as they read in Europe/Bucharest. */
export function zonedParts(date = new Date()) {
  const fields = {};
  for (const part of PARTS_FORMATTER.formatToParts(date)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields;
}

/** `YYYY-MM-DD` from already extracted fields, without re-parsing a Date. */
function dateStringFromParts({ year, month, day }) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Today's calendar date in Romania (a report requested "now" uses this). */
export function zonedDateString(date = new Date()) {
  return dateStringFromParts(zonedParts(date));
}

/** Operational day: before 06:00 the shift still belongs to the previous date. */
export function operationalDateAt(date = new Date()) {
  const { year, month, day, hour } = zonedParts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  if (hour < OPERATIONAL_DAY_START_HOUR) shifted.setUTCDate(shifted.getUTCDate() - 1);
  return dateStringFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Shift containing `date`: 22–06 is shift 3, 06–14 shift 1, 14–22 shift 2. */
export function shiftIdAt(date = new Date()) {
  const { hour } = zonedParts(date);
  if (hour >= SHIFT_START_HOURS.shift_3 || hour < SHIFT_START_HOURS.shift_1) return 'shift_3';
  return hour < SHIFT_START_HOURS.shift_2 ? 'shift_1' : 'shift_2';
}

/** Whole minutes elapsed since the current shift started. */
export function minutesIntoShiftAt(date = new Date()) {
  const { hour, minute } = zonedParts(date);
  const startHour = SHIFT_START_HOURS[shiftIdAt(date)];
  return ((hour - startHour + HOURS_PER_DAY) % HOURS_PER_DAY) * 60 + minute;
}

/** `HH:MM:SS` in Romania, the clock the incident timeline shows. */
export function roTime(date = new Date()) {
  const { hour, minute, second } = zonedParts(date);
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

/** Romanian decimal separator (`2.6` → `2,6`), as the copy already writes it. */
export function roDecimal(value) {
  return String(value).replace('.', ',');
}

/**
 * The window the demo incidents live in, derived from the load time.
 *
 * The newest incident sits a few seconds ago; the others are spread back across the
 * shift, capped at 168 minutes so "all today" never falls into the previous shift and
 * floored at 4 minutes so escalation (30 s) and acknowledgement (up to 64 s) still fit
 * when the page is opened right after a shift starts.
 */
export function createShiftWindow(now = new Date()) {
  const shiftId = shiftIdAt(now);
  const minutesIntoShift = minutesIntoShiftAt(now);
  const spreadMinutes = Math.min(168, Math.max(minutesIntoShift, 4));
  const newestAgeMs = Math.min(45 * SECOND_MS, 0.1 * spreadMinutes * MINUTE_MS);

  return {
    shiftId,
    operationalDate: operationalDateAt(now),
    minutesIntoShift,
    spreadMinutes,
    newestDetectedAt: new Date(now.getTime() - newestAgeMs),
    ageAt: (fraction) => new Date(now.getTime() - fraction * spreadMinutes * MINUTE_MS),
  };
}
