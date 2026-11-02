import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE,
  countdownLabel,
  deadlineProgress,
  episodeRows,
  holdUntilLabel,
  isTypingTarget,
} from './triageRows.js';

// ---------------------------------------------------------------------------------------
// Countdown copy
// ---------------------------------------------------------------------------------------

test('a countdown reads mm:ss and only says overdue when it really is', () => {
  assert.equal(countdownLabel(42), '00:42');
  assert.equal(countdownLabel(42.4), '00:43');
  assert.equal(countdownLabel(0.4), '00:01');
  assert.equal(countdownLabel(125), '02:05');
  assert.equal(countdownLabel(0), OVERDUE);
  assert.equal(countdownLabel(-3), OVERDUE);
});

test('an unknown deadline prints an em dash, never a zero', () => {
  assert.equal(countdownLabel(null), '—');
  assert.equal(countdownLabel(undefined), '—');
  assert.equal(countdownLabel(Number.NaN), '—');
});

// ---------------------------------------------------------------------------------------
// Draining bar
// ---------------------------------------------------------------------------------------

test('the bar is the remaining share of the escalation window', () => {
  assert.equal(deadlineProgress({ escalate_after_s: 120 }, 60), 0.5);
  assert.equal(deadlineProgress({ escalate_after_s: 120 }, 0), 0);
  assert.equal(deadlineProgress({ escalate_after_s: 120 }, -30), 0);
  assert.equal(deadlineProgress({ escalate_after_s: 120 }, 240), 1);
});

test('a missing threshold or deadline means no bar at all', () => {
  assert.equal(deadlineProgress({ escalate_after_s: null }, 60), null);
  assert.equal(deadlineProgress({ escalate_after_s: 0 }, 60), null);
  assert.equal(deadlineProgress({}, 60), null);
  assert.equal(deadlineProgress({ escalate_after_s: 120 }, null), null);
  assert.equal(deadlineProgress(null, 60), null);
});

// ---------------------------------------------------------------------------------------
// Hold chip
// ---------------------------------------------------------------------------------------

test('the hold chip prints HH:MM in Bucharest, and an em dash for a broken value', () => {
  // 17:00 UTC is 19:00 in Bucharest in November (EET, UTC+2).
  assert.equal(holdUntilLabel(Date.parse('2026-11-02T17:00:00.000Z')), '19:00');
  assert.equal(holdUntilLabel(null), '—');
  assert.equal(holdUntilLabel('not-a-date'), '—');
});

// ---------------------------------------------------------------------------------------
// Typing guard
// ---------------------------------------------------------------------------------------

test('typing targets stand the shortcuts down', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'textarea' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({}), false);
  assert.equal(isTypingTarget(null), false);
});

// ---------------------------------------------------------------------------------------
// Episode collapse
// ---------------------------------------------------------------------------------------

const at = (offsetS) => new Date(Date.parse('2026-11-02T10:00:00.000Z') + offsetS * 1000).toISOString();

function event(id, overrides = {}) {
  return {
    event_id: id,
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    track_id: 17,
    detected_at: at(-60),
    escalate_after_s: 120,
    ...overrides,
  };
}

test('one walk-through becomes one row, headed by its highest-ranked event', () => {
  const first = event('evt_a', { detected_at: at(-30), severity: 'WARNING' });
  const second = event('evt_b', { detected_at: at(-10), severity: 'CRITICAL' });
  const rows = [{ eventId: 'evt_b' }, { eventId: 'evt_a' }];

  const collapsed = episodeRows(rows, [first, second]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].row.eventId, 'evt_b');
  assert.equal(collapsed[0].episode.count, 2);
  // Detection order, so the expander opens on the story as it happened.
  assert.deepEqual(collapsed[0].raws.map((raw) => raw.event_id), ['evt_a', 'evt_b']);
});

test('different tracks stay two rows; every ranked row is reachable', () => {
  const a = event('evt_a', { track_id: 17 });
  const b = event('evt_b', { track_id: 23 });
  const collapsed = episodeRows([{ eventId: 'evt_a' }, { eventId: 'evt_b' }], [a, b]);
  assert.deepEqual(collapsed.map((entry) => entry.row.eventId), ['evt_a', 'evt_b']);
  assert.equal(collapsed[0].raws.length, 1);
});

test('a row the grouping cannot place is still rendered', () => {
  const broken = event('evt_broken', { detected_at: 'not-a-date' });
  const collapsed = episodeRows([{ eventId: 'evt_broken' }], [broken]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].episode.count, 1);
  assert.deepEqual(collapsed[0].raws.map((raw) => raw.event_id), ['evt_broken']);
});

test('an empty list is empty, and bad input does not throw', () => {
  assert.deepEqual(episodeRows([], []), []);
  assert.deepEqual(episodeRows(null, []), []);
  assert.deepEqual(episodeRows([{ eventId: 'evt_missing' }], []), [
    { row: { eventId: 'evt_missing' }, episode: null, raws: [] },
  ]);
});
