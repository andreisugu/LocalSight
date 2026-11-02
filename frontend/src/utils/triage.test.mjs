import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EPISODE_WINDOW_S,
  HOLD_MAX_S,
  activeHolds,
  canHold,
  createTriageState,
  freezeWhileReading,
  groupEpisodes,
  holdWarning,
  nextAction,
  queueRows,
  rankIncidents,
  releaseFreeze,
  releaseHold,
  remainingS,
} from './triage.js';

// One fixed clock for the whole file. Every assertion is about the rule, never about the
// machine's wall clock, so a run at 03:00 and a run at 17:00 see the same queue.
const NOW = Date.parse('2026-11-02T10:00:00.000Z');
const at = (offsetS) => new Date(NOW + offsetS * 1000).toISOString();

let sequence = 0;
function event(overrides = {}) {
  sequence += 1;
  return {
    event_id: `evt_test_${String(sequence).padStart(3, '0')}`,
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    track_id: 7,
    detected_at: at(-60),
    escalate_after_s: 120,
    ...overrides,
  };
}

const ids = (rows) => rows.map((row) => row.eventId);

// ---------------------------------------------------------------------------------------
// Ranking: escalated → severity → deadline → age → event_id
// ---------------------------------------------------------------------------------------

test('an escalated WARNING outranks an open CRITICAL, and says why', () => {
  const escalated = event({
    event_id: 'evt_escalated',
    severity: 'WARNING',
    status: 'escalated',
    detected_at: at(-10),
    escalate_after_s: 120,
  });
  const critical = event({
    event_id: 'evt_critical',
    severity: 'CRITICAL',
    status: 'open',
    detected_at: at(-10),
    escalate_after_s: 300,
  });

  const rows = rankIncidents([critical, escalated], NOW);
  assert.deepEqual(ids(rows), ['evt_escalated', 'evt_critical']);
  assert.equal(rows[0].reason, 'escaladat');
  assert.equal(rows[1].reason, 'critic');
});

test('CRITICAL beats WARNING even when the warning is already overdue', () => {
  const critical = event({
    event_id: 'evt_critical',
    severity: 'CRITICAL',
    detected_at: at(-10),
    escalate_after_s: 300,
  });
  const overdueWarning = event({
    event_id: 'evt_warning',
    severity: 'WARNING',
    detected_at: at(-100),
    escalate_after_s: 5,
  });

  const rows = rankIncidents([overdueWarning, critical], NOW);
  assert.deepEqual(ids(rows), ['evt_critical', 'evt_warning']);
  // The warning is below because of its severity; the overdue deadline is the next fact.
  assert.equal(rows[1].reason, 'avertisment');
  assert.equal(rows[1].remainingS, -95);
});

test('inside one severity the nearest deadline wins', () => {
  const far = event({ event_id: 'evt_far', detected_at: at(-10), escalate_after_s: 200 });
  const near = event({ event_id: 'evt_near', detected_at: at(-10), escalate_after_s: 30 });

  const rows = rankIncidents([far, near], NOW);
  assert.deepEqual(ids(rows), ['evt_near', 'evt_far']);
  assert.equal(rows[0].reason, 'critic');
  assert.equal(rows[1].reason, 'deadline 190 s');
});

test('the same deadline falls back to the oldest detection, then to the id', () => {
  // Both deadlines are +20 s from NOW; only the detection time differs.
  const old = event({ event_id: 'evt_old', detected_at: at(-100), escalate_after_s: 120 });
  const young = event({ event_id: 'evt_young', detected_at: at(-10), escalate_after_s: 30 });
  const twin = event({ event_id: 'evt_young_twin', detected_at: at(-10), escalate_after_s: 30 });

  const rows = rankIncidents([young, old, twin], NOW);
  assert.deepEqual(ids(rows), ['evt_old', 'evt_young', 'evt_young_twin']);
  assert.equal(rows[1].reason, 'vechime');
  assert.equal(rows[2].reason, 'ordine stabilă');
});

test('two CRITICALs are ordered by deadline, not by arrival', () => {
  const later = event({ event_id: 'evt_later', detected_at: at(-10), escalate_after_s: 300 });
  const sooner = event({ event_id: 'evt_sooner', detected_at: at(-60), escalate_after_s: 120 });

  const rows = rankIncidents([later, sooner], NOW);
  assert.deepEqual(ids(rows), ['evt_sooner', 'evt_later']);
  assert.equal(rows[0].reason, 'critic');
  assert.equal(rows[1].reason, 'deadline 290 s');
});

test('an unknown deadline sorts last inside its severity and never invents a timer', () => {
  const timed = event({ event_id: 'evt_timed', severity: 'WARNING', detected_at: at(-10), escalate_after_s: 60 });
  const noTimer = event({ event_id: 'evt_notimer', severity: 'WARNING', escalate_after_s: null });
  const noClock = event({ event_id: 'evt_noclock', severity: 'WARNING', detected_at: 'not-a-date' });

  const rows = rankIncidents([noClock, noTimer, timed], NOW);
  // Both unknown-deadline rows sort last; the one with a readable time comes first.
  assert.deepEqual(ids(rows), ['evt_timed', 'evt_notimer', 'evt_noclock']);
  assert.equal(rows[0].remainingS, 50);
  assert.equal(rows[0].deadlineAt, NOW + 50_000);
  assert.equal(rows[1].deadlineAt, null);
  assert.equal(rows[2].deadlineAt, null);
  assert.equal(rows[1].reason, 'termen necunoscut');
  assert.equal(rows[2].reason, 'fără oră');
});

test('deadline math uses detected_at + escalate_after_s and rejects a no-op threshold', () => {
  const detectedAt = at(-90);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: 120 }, NOW), 30);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: 120 }, new Date(NOW)), 30);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: 0 }, NOW), null);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: -5 }, NOW), null);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: true }, NOW), null);
  assert.equal(remainingS({ detected_at: detectedAt, escalate_after_s: '45' }, NOW), -45);
  assert.equal(remainingS({ detected_at: 'nope', escalate_after_s: 45 }, NOW), null);
  assert.equal(remainingS({}, NOW), null);
});

test('an overdue deadline is reachable, readable and negative', () => {
  const late = event({ event_id: 'evt_late', severity: 'WARNING', detected_at: at(-100), escalate_after_s: 30 });
  const [row] = rankIncidents([late], NOW);
  assert.equal(row.remainingS, -70);
  assert.equal(row.reason, 'termen depășit');

  const rows = rankIncidents([
    event({ event_id: 'evt_a', severity: 'WARNING', detected_at: at(-10), escalate_after_s: 200 }),
    late,
  ], NOW);
  assert.deepEqual(ids(rows), ['evt_late', 'evt_a']);
  assert.equal(rows[0].reason, 'termen depășit');
});

test('every input event comes back once, whatever its status, and nothing is mutated', () => {
  const events = [
    event({ event_id: 'evt_open', status: 'open' }),
    event({ event_id: 'evt_acked', status: 'acknowledged' }),
    event({ event_id: 'evt_escalated', status: 'escalated' }),
    event({ event_id: 'evt_fp', status: 'false_positive' }),
  ];
  const snapshot = structuredClone(events);

  const rows = rankIncidents(events, NOW);
  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(ids(rows)), new Set(events.map((item) => item.event_id)));
  assert.deepEqual(events, snapshot);
  assert.equal(rows[0].eventId, 'evt_escalated');
});

test('an empty or invalid input is an empty queue, not a crash', () => {
  assert.deepEqual(rankIncidents(undefined, NOW), []);
  assert.deepEqual(rankIncidents(null, NOW), []);
  assert.deepEqual(rankIncidents([], NOW), []);
  assert.deepEqual(rankIncidents('nope', NOW), []);
  assert.deepEqual(rankIncidents([null, undefined, 42, {}], NOW), []);
  assert.deepEqual(groupEpisodes(null), []);
  assert.deepEqual(groupEpisodes([null, 7]), []);
});

test('a status change is the only thing that moves a row under a fixed event set', () => {
  const a = event({ event_id: 'evt_a', detected_at: at(-10), escalate_after_s: 100 });
  const b = event({ event_id: 'evt_b', detected_at: at(-10), escalate_after_s: 200 });
  const before = ids(rankIncidents([a, b], NOW));
  const later = ids(rankIncidents([a, b], NOW + 50_000));
  assert.deepEqual(before, later);

  const escalated = ids(rankIncidents([a, { ...b, status: 'escalated' }], NOW));
  assert.deepEqual(escalated, ['evt_b', 'evt_a']);
});

// ---------------------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------------------

function burst({ startS = -100, step = 15, count = 5, ...overrides } = {}) {
  return Array.from({ length: count }, (_, index) => event({
    event_id: `evt_burst_${index}`,
    severity: index === count - 1 ? 'CRITICAL' : 'WARNING',
    detected_at: at(startS + index * step),
    track_id: 3,
    report: { what: 'Persoană sub motor' },
    ...overrides,
  }));
}

test('a burst becomes one episode with a count and the maximum severity', () => {
  const events = burst();
  const episodes = groupEpisodes(events);

  assert.equal(episodes.length, 1);
  const [episode] = episodes;
  assert.equal(episode.count, 5);
  assert.equal(episode.maxSeverity, 'CRITICAL');
  assert.equal(episode.firstAt, at(-100));
  assert.equal(episode.lastAt, at(-40));
  assert.deepEqual(episode.eventIds, events.map((item) => item.event_id));
  assert.equal(episode.title, 'Persoană sub motor');
  assert.equal(episode.where, 'stand12 · engine-left');
  assert.equal(episode.id, 'ep:evt_burst_0');
});

test('the anchored window splits a story that runs too long, and keeps an exact boundary', () => {
  const events = [
    event({ event_id: 'evt_0', track_id: 1, detected_at: at(0) }),
    event({ event_id: 'evt_100', track_id: 1, detected_at: at(100) }),
    event({ event_id: 'evt_220', track_id: 1, detected_at: at(220) }),
  ];

  const episodes = groupEpisodes(events, { windowS: 120 });
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map((episode) => episode.eventIds), [
    ['evt_220'],
    ['evt_0', 'evt_100'],
  ]);

  const boundary = groupEpisodes([
    event({ event_id: 'evt_b0', track_id: 2, detected_at: at(0) }),
    event({ event_id: 'evt_b120', track_id: 2, detected_at: at(120) }),
  ], { windowS: 120 });
  assert.equal(boundary.length, 1);
  assert.equal(boundary[0].count, 2);
});

test('without a track the episode is camera + zone, and a different track stays apart', () => {
  const noTrack = [
    event({ event_id: 'evt_nt_0', track_id: undefined, detected_at: at(-40) }),
    event({ event_id: 'evt_nt_1', track_id: 0, detected_at: at(-20) }),
  ];
  const tracked = event({ event_id: 'evt_track_8', track_id: 8, detected_at: at(-30) });
  const otherZone = event({ event_id: 'evt_zone', track_id: 7, zone_id: 'engine-right', detected_at: at(-30) });
  const otherCamera = event({ event_id: 'evt_cam', track_id: 7, camera_id: 'taxiway-b', detected_at: at(-30) });

  const episodes = groupEpisodes([...noTrack, tracked, otherZone, otherCamera]);
  const byId = new Map(episodes.map((episode) => [episode.id, episode]));

  assert.deepEqual(byId.get('ep:evt_nt_0').eventIds, ['evt_nt_0', 'evt_nt_1']);
  assert.equal(byId.get('ep:evt_nt_0').count, 2);
  // track 0 means "no person track" in the contract, so it groups with the trackless row.
  assert.deepEqual(byId.get('ep:evt_track_8').eventIds, ['evt_track_8']);
  assert.deepEqual(byId.get('ep:evt_zone').eventIds, ['evt_zone']);
  assert.deepEqual(byId.get('ep:evt_cam').eventIds, ['evt_cam']);
  assert.equal(episodes.length, 4);
});

test('one walk-through may fire several rule types and stays one episode', () => {
  const events = [
    event({ event_id: 'evt_ppe', type: 'NO_PPE', track_id: 4, detected_at: at(-30), severity: 'WARNING' }),
    event({ event_id: 'evt_zone', type: 'RESTRICTED_ZONE', track_id: 4, detected_at: at(-10), severity: 'CRITICAL' }),
  ];
  const episodes = groupEpisodes(events);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].count, 2);
  assert.equal(episodes[0].maxSeverity, 'CRITICAL');
});

test('max severity is never downgraded by a later warning', () => {
  const events = [
    event({ event_id: 'evt_first_critical', severity: 'CRITICAL', track_id: 5, detected_at: at(-30) }),
    event({ event_id: 'evt_then_warning', severity: 'WARNING', track_id: 5, detected_at: at(-10) }),
  ];
  const [episode] = groupEpisodes(events);
  assert.equal(episode.maxSeverity, 'CRITICAL');
});

test('episodes are newest first and every raw event stays addressable', () => {
  const old = event({ event_id: 'evt_old', track_id: 1, detected_at: at(-600) });
  const middle = event({ event_id: 'evt_mid', track_id: 2, detected_at: at(-300) });
  const newest = event({ event_id: 'evt_new', track_id: 3, detected_at: at(-10) });

  const episodes = groupEpisodes([old, newest, middle]);
  assert.deepEqual(episodes.map((episode) => episode.id), [
    'ep:evt_new',
    'ep:evt_mid',
    'ep:evt_old',
  ]);
  const flattened = episodes.flatMap((episode) => episode.eventIds);
  assert.equal(flattened.length, 3);
  assert.deepEqual(new Set(flattened), new Set(['evt_old', 'evt_mid', 'evt_new']));
});

test('an unreadable timestamp gets its own episode at the end instead of a guessed window', () => {
  const dated = event({ event_id: 'evt_dated', track_id: 1, detected_at: at(-10) });
  const broken = event({ event_id: 'evt_broken', track_id: 1, detected_at: 'not-a-date' });

  const episodes = groupEpisodes([broken, dated]);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].id, 'ep:evt_dated');
  assert.equal(episodes[1].id, 'ep:evt_broken');
  assert.equal(episodes[1].firstAt, null);
  assert.equal(episodes[1].lastAt, null);
});

test('an invalid window falls back to the documented default', () => {
  const events = [
    event({ event_id: 'evt_w0', track_id: 1, detected_at: at(0) }),
    event({ event_id: 'evt_w60', track_id: 1, detected_at: at(60) }),
  ];
  assert.equal(groupEpisodes(events).length, 1);
  assert.equal(groupEpisodes(events, { windowS: 'nope' }).length, 1);
  assert.equal(DEFAULT_EPISODE_WINDOW_S, 120);
  // A zero window still merges events detected at the same instant.
  assert.equal(groupEpisodes(events, { windowS: 0 })[0].count, 1);
});

// ---------------------------------------------------------------------------------------
// Holds: WARNING only, 15 minutes, reason required, session-local
// ---------------------------------------------------------------------------------------

function holdable() {
  const warning = event({
    event_id: 'evt_warning',
    severity: 'WARNING',
    detected_at: at(-10),
    escalate_after_s: 120,
  });
  const critical = event({
    event_id: 'evt_critical',
    severity: 'CRITICAL',
    detected_at: at(-10),
    escalate_after_s: 120,
  });
  return { warning, critical, state: createTriageState([warning, critical], { operator: 'Dispecer' }) };
}

test('a WARNING can be held for 900 s with its reason and actor', () => {
  const { warning, state } = holdable();
  const before = structuredClone(warning);
  const result = holdWarning(state, 'evt_warning', '  verific cu radioul  ', NOW);

  assert.equal(result.ok, true);
  assert.equal(result.code, null);
  assert.deepEqual(result.state.holds.evt_warning, {
    reason: 'verific cu radioul',
    until: NOW + HOLD_MAX_S * 1000,
    by: 'Dispecer',
  });
  assert.equal(HOLD_MAX_S, 900);
  // The event is a read model input, not a place to keep session state.
  assert.equal(result.state.events[0], warning);
  assert.deepEqual(warning, before);
});

test('a CRITICAL cannot be held and the refusal says why', () => {
  const { critical, state } = holdable();
  const result = holdWarning(state, 'evt_critical', 'prea ocupat', NOW);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'critical');
  assert.match(result.message, /Criticele nu pot fi amânate/);
  assert.deepEqual(result.state.holds, {});
  assert.equal(canHold(critical), false);
  assert.equal(canHold(holdable().warning), true);
});

test('a hold without a reason is refused, and no hold is written', () => {
  const { state } = holdable();
  for (const reason of ['', '   ', null, undefined, 42]) {
    const result = holdWarning(state, 'evt_warning', reason, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'reason-required');
    assert.deepEqual(result.state.holds, {});
  }
  const long = holdWarning(state, 'evt_warning', 'x'.repeat(141), NOW);
  assert.equal(long.code, 'reason-too-long');
});

test('a hold needs a live WARNING that is still in the list', () => {
  const { state } = holdable();
  assert.equal(holdWarning(state, 'evt_missing', 'motiv', NOW).code, 'not-found');

  const closed = [event({ event_id: 'evt_closed', severity: 'WARNING', status: 'acknowledged' })];
  assert.equal(
    holdWarning(createTriageState(closed), 'evt_closed', 'motiv', NOW).code,
    'closed'
  );

  const unknownSeverity = [event({ event_id: 'evt_unknown', severity: 'INFO', status: 'open' })];
  assert.equal(
    holdWarning(createTriageState(unknownSeverity), 'evt_unknown', 'motiv', NOW).code,
    'not-warning'
  );
  assert.equal(canHold(closed[0]), false);
  assert.equal(canHold(null), false);
});

test('a hold expires at 15 minutes even if nobody releases it', () => {
  const { state } = holdable();
  const held = holdWarning(state, 'evt_warning', 'motiv', NOW).state;

  assert.equal(activeHolds(held, NOW + 899_000).evt_warning.reason, 'motiv');
  assert.deepEqual(activeHolds(held, NOW + HOLD_MAX_S * 1000), {});
  assert.equal(queueRows(held, NOW + 899_000).find((row) => row.eventId === 'evt_warning').hold.reason, 'motiv');
  assert.equal(queueRows(held, NOW + 900_000).find((row) => row.eventId === 'evt_warning').hold, null);
});

test('release removes one hold, keeps the others and never mutates the stored state', () => {
  const warning = event({ event_id: 'evt_w1', severity: 'WARNING', detected_at: at(-10) });
  const other = event({ event_id: 'evt_w2', severity: 'WARNING', detected_at: at(-20) });
  const state = createTriageState([warning, other]);

  const first = holdWarning(state, 'evt_w1', 'primul', NOW).state;
  const second = holdWarning(first, 'evt_w2', 'al doilea', NOW).state;
  const snapshot = structuredClone(second);

  const released = releaseHold(second, 'evt_w1');
  assert.deepEqual(Object.keys(released.holds), ['evt_w2']);
  assert.deepEqual(second, snapshot);
  assert.deepEqual(Object.keys(state.holds), []);
  // Releasing an unknown hold is a no-op, not a crash.
  assert.deepEqual(releaseHold(released, 'evt_missing').holds, { evt_w2: released.holds.evt_w2 });
});

test('holds are session-local: they never appear on the event itself', () => {
  const { state, warning } = holdable();
  const before = structuredClone(warning);
  const held = holdWarning(state, 'evt_warning', 'motiv', NOW).state;

  assert.deepEqual(warning, before);
  assert.equal('hold' in warning, false);
  assert.equal('queue' in warning, false);
  const row = queueRows(held, NOW).find((item) => item.eventId === 'evt_warning');
  assert.equal(row.hold.reason, 'motiv');
  assert.equal('hold' in row.event, false);
});

// ---------------------------------------------------------------------------------------
// Freeze while reading
// ---------------------------------------------------------------------------------------

function freezeFixture() {
  const a = event({ event_id: 'evt_a', detected_at: at(-10), escalate_after_s: 100 });
  const b = event({ event_id: 'evt_b', detected_at: at(-10), escalate_after_s: 300 });
  const warning = event({ event_id: 'evt_warning', severity: 'WARNING', detected_at: at(-10) });
  return { a, b, warning, state: createTriageState([a, b, warning]) };
}

test('freeze keeps the sequence while a timer flips a status underneath the reader', () => {
  const { state, b } = freezeFixture();
  const before = queueRows(state, NOW);
  assert.deepEqual(ids(before), ['evt_a', 'evt_b', 'evt_warning']);

  const frozen = freezeWhileReading(state, 'evt_a', NOW);
  assert.equal(frozen.focusedEventId, 'evt_a');
  assert.deepEqual(frozen.frozenOrder, ['evt_a', 'evt_b', 'evt_warning']);

  // Same ids, new status: a fresh rank would move evt_b to the top.
  const escalatedEvents = frozen.events.map((item) => (
    item.event_id === 'evt_b' ? { ...item, status: 'escalated' } : item
  ));
  assert.deepEqual(ids(rankIncidents(escalatedEvents, NOW)), ['evt_b', 'evt_a', 'evt_warning']);
  assert.deepEqual(ids(queueRows({ ...frozen, events: escalatedEvents }, NOW)), [
    'evt_a',
    'evt_b',
    'evt_warning',
  ]);

  // Reasons are recomputed for the order actually shown, not the fresh one.
  assert.equal(queueRows({ ...frozen, events: escalatedEvents }, NOW)[0].reason, 'critic');
  assert.equal(b.status, 'open');
});

test('a new event re-ranks even while focused: a fresh CRITICAL never waits', () => {
  const { state } = freezeFixture();
  const frozen = freezeWhileReading(state, 'evt_a', NOW);
  const urgent = event({ event_id: 'evt_urgent', detected_at: at(-5), escalate_after_s: 10 });

  const rows = queueRows({ ...frozen, events: [...frozen.events, urgent] }, NOW);
  assert.equal(rows[0].eventId, 'evt_urgent');
  assert.equal(rows.length, 4);
});

test('release re-ranks immediately, and focus on the same row keeps the snapshot', () => {
  const { state } = freezeFixture();
  const frozen = freezeWhileReading(state, 'evt_a', NOW);
  const again = freezeWhileReading(frozen, 'evt_a', NOW + 30_000);
  assert.deepEqual(again.frozenOrder, frozen.frozenOrder);

  const switched = freezeWhileReading(frozen, 'evt_b', NOW);
  assert.equal(switched.focusedEventId, 'evt_b');
  assert.deepEqual(switched.frozenOrder, ['evt_a', 'evt_b', 'evt_warning']);

  const released = releaseFreeze(frozen);
  assert.equal(released.focusedEventId, null);
  assert.equal(released.frozenOrder, null);

  const cleared = freezeWhileReading(frozen, null, NOW);
  assert.equal(cleared.frozenOrder, null);
  assert.equal(cleared.focusedEventId, null);
});

test('a hold or a release is an action, so the freeze ends', () => {
  const { state, warning } = freezeFixture();
  const frozen = freezeWhileReading(state, 'evt_a', NOW);

  const held = holdWarning(frozen, 'evt_warning', 'motiv', NOW).state;
  assert.equal(held.frozenOrder, null);
  assert.equal(held.focusedEventId, 'evt_a');

  const heldAgain = { ...held, frozenOrder: ['evt_a', 'evt_b', 'evt_warning'] };
  const released = releaseHold(heldAgain, 'evt_warning');
  assert.equal(released.frozenOrder, null);
  assert.equal(warning.event_id, 'evt_warning');
});

test('queueRows keeps every ranked row and attaches null when nothing is held', () => {
  const { state } = freezeFixture();
  const rows = queueRows(state, NOW);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.hold === null));
  assert.deepEqual(rows.map((row) => row.eventId), ids(rankIncidents(state.events, NOW)));
});

// ---------------------------------------------------------------------------------------
// Keyboard mapping
// ---------------------------------------------------------------------------------------

test('the queue keys map to actions and respect the status table', () => {
  const open = event({ event_id: 'evt_open', severity: 'WARNING', status: 'open' });
  assert.deepEqual(
    nextAction('a', { event: open }),
    { type: 'ack', eventId: 'evt_open', allowed: true, hint: null }
  );
  assert.equal(nextAction('A', { event: open }).type, 'ack');
  assert.equal(nextAction('f', { event: open }).type, 'false-positive');
  assert.equal(nextAction('Enter', { event: open }).type, 'open');
  assert.equal(nextAction('h', { event: open }).allowed, true);
  assert.equal(nextAction('Escape', { event: open, held: true }).type, 'release-hold');
  assert.equal(nextAction('Escape', { event: open, held: true }).allowed, true);
  assert.equal(nextAction('Escape', { event: open, held: false }).allowed, false);

  const acked = { ...open, status: 'acknowledged' };
  assert.equal(nextAction('a', { event: acked }).allowed, false);
  assert.equal(nextAction('f', { event: acked }).allowed, true);
});

test('H refuses a CRITICAL and explains, and typed keys stand down', () => {
  const critical = event({ event_id: 'evt_critical', severity: 'CRITICAL' });
  const refused = nextAction('h', { event: critical });
  assert.equal(refused.type, 'hold');
  assert.equal(refused.allowed, false);
  assert.match(refused.hint, /Criticele nu pot fi amânate/);

  const warning = event({ severity: 'WARNING' });
  const alreadyHeld = nextAction('h', { event: warning, held: true });
  assert.equal(alreadyHeld.allowed, false);
  assert.match(alreadyHeld.hint, /deja ținut/);

  assert.deepEqual(nextAction('a', { event: critical, typing: true }), {
    type: 'none',
    eventId: null,
    allowed: false,
    hint: 'Tastarea are prioritate.',
  });
  assert.equal(nextAction('x', { event: critical }).type, 'none');
  assert.equal(nextAction('', { event: critical }).type, 'none');
  assert.equal(nextAction(null, { event: critical }).type, 'none');
  assert.equal(nextAction('a', {}).allowed, false);
});
