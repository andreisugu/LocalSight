// Presentation helpers for the operator queue.
//
// `utils/triage.js` owns the rule (ranking, holds, freeze, keyboard decisions) and is
// covered by its own node tests. This module owns the few transformations the *row* needs
// before it can be painted — countdown text, the draining bar, the hold chip time and the
// episode collapse — so those can be checked without a browser too. No React, no DOM:
// `isTypingTarget` takes the fields it needs instead of an event, so a test can pass a
// plain object.

import { DEFAULT_EPISODE_WINDOW_S, groupEpisodes } from '../../utils/triage.js';
import { formatTime } from '../../utils/time.js';

/** Shown when a row has no deadline; never invent a timer the contract did not supply. */
export const NO_DEADLINE = '—';

/** The copy the product uses for a deadline that already passed. */
export const OVERDUE = 'termen depășit';

/**
 * `mm:ss` until the deadline, `termen depășit` once it passed, `—` when unknown.
 *
 * Ceil is deliberate: a row with 0.4 s left still reads `00:01`, so the countdown only
 * says "overdue" when it really is. The rank reason uses `Math.round`, so the two numbers
 * can differ by a second at most; they never disagree about the direction.
 *
 * @param {number|null|undefined} remainingS seconds left, negative once overdue.
 * @returns {string}
 */
export function countdownLabel(remainingS) {
  if (remainingS == null || !Number.isFinite(remainingS)) return NO_DEADLINE;
  if (remainingS <= 0) return OVERDUE;
  const total = Math.ceil(remainingS);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Fraction of the escalation window still left, for the draining bar. A missing or
 * non-positive threshold and an unknown deadline both mean "no bar": a bar needs a whole.
 *
 * @param {object|null|undefined} event
 * @param {number|null|undefined} remainingS
 * @returns {number|null} 0…1, or null when the bar cannot be computed.
 */
export function deadlineProgress(event, remainingS) {
  const threshold = Number(event?.escalate_after_s);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  if (remainingS == null || !Number.isFinite(remainingS)) return null;
  return Math.max(0, Math.min(1, remainingS / threshold));
}

/**
 * `HH:MM` in Bucharest for the hold chip, `—` when the timestamp is unreadable.
 *
 * @param {number|string|Date|null|undefined} until epoch milliseconds.
 * @returns {string}
 */
export function holdUntilLabel(until) {
  return formatTime(until, { placeholder: '—' }).slice(0, 5);
}

/**
 * True when a key press belongs to a text field and the queue must stand down.
 *
 * @param {{tagName?: string, isContentEditable?: boolean}} [target]
 * @returns {boolean}
 */
export function isTypingTarget(target) {
  const tag = String(target?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target?.isContentEditable === true;
}

/**
 * Collapse ranked rows into the rows the queue paints: one per episode, represented by the
 * episode's highest-ranked event, with every raw event kept for the expander.
 *
 * A single-event episode is still an episode here; the caller decides whether to show the
 * `1 episod · N detecții` line by looking at `episode.count`. Events the grouping could
 * not place (no matching episode) are never dropped — they render as their own row.
 *
 * @param {Array<{eventId: string}>} rows ranked rows from `queueRows`.
 * @param {Array<object>} events the same events, for `groupEpisodes` and the raw list.
 * @param {{windowS?: number}} [options]
 * @returns {Array<{row: object, episode: object|null, raws: Array<object>}>}
 */
export function episodeRows(rows, events, { windowS = DEFAULT_EPISODE_WINDOW_S } = {}) {
  if (!Array.isArray(rows)) return [];
  const byId = new Map(
    (Array.isArray(events) ? events : [])
      .filter((event) => event && event.event_id != null)
      .map((event) => [String(event.event_id), event])
  );

  const episodes = groupEpisodes(byId.size === 0 ? [] : [...byId.values()], { windowS });
  const episodeOf = new Map();
  for (const episode of episodes) {
    for (const eventId of episode.eventIds) episodeOf.set(eventId, episode);
  }

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const episode = episodeOf.get(row.eventId) ?? null;
    if (episode && seen.has(episode.id)) continue;
    if (episode) seen.add(episode.id);
    const raws = episode
      ? episode.eventIds.map((eventId) => byId.get(eventId)).filter(Boolean)
      : [];
    out.push({ row, episode, raws });
  }
  return out;
}
