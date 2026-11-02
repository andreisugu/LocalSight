import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftReport } from './shiftReport.js';
import { SHIFT_LABEL as SHIFT, makeEvent as event } from '../test/factories.mjs';

const build = (events, options = {}) =>
  buildShiftReport(events, {
    now: new Date('2026-11-02T14:30:00.000Z'),
    shiftLabel: SHIFT,
    operationalDate: '2026-11-02',
    ...options,
  });

test('counts severity and status from the events, not a fixture', () => {
  const report = build([
    event({ status: 'open' }),
    event({ status: 'escalated', severity: 'CRITICAL' }),
    event({ status: 'acknowledged', severity: 'WARNING' }),
    event({ status: 'resolved', severity: 'WARNING' }),
    event({ status: 'false_positive', severity: 'WARNING' }),
  ]);

  assert.equal(report.kpi.total_events, 5);
  assert.equal(report.kpi.critical_events, 2);
  assert.equal(report.kpi.warning_events, 3);
  assert.equal(report.kpi.open_events, 1);
  assert.equal(report.kpi.escalated_events, 1);
  assert.equal(report.kpi.acknowledged_events, 1);
  assert.equal(report.kpi.resolved_events, 1);
  assert.equal(report.kpi.false_positive_events, 1);
});

test('the report keeps the shift label and the supplied operational date', () => {
  const report = build([event()]);
  assert.equal(report.shift, SHIFT);
  assert.equal(report.date, '2026-11-02');
  assert.equal(report.source, 'template');
});

test('the operational date is derived from the clock when it is missing', () => {
  const beforeSix = buildShiftReport([event()], {
    now: new Date('2026-11-02T03:30:00.000Z'), // 05:30 in Bucharest, still the previous shift day
    shiftLabel: SHIFT,
  });
  assert.equal(beforeSix.date, '2026-11-01');

  const afterSix = buildShiftReport([event()], {
    now: new Date('2026-11-02T05:30:00.000Z'), // 07:30 in Bucharest
    shiftLabel: SHIFT,
  });
  assert.equal(afterSix.date, '2026-11-02');
});

test('mean acknowledgement is the average over acked events', () => {
  const report = build([
    event({ status: 'acknowledged', detected_at: '2026-11-02T16:00:00.000Z', acked_at: '2026-11-02T16:00:20.000Z' }),
    event({ status: 'resolved', detected_at: '2026-11-02T16:01:00.000Z', acked_at: '2026-11-02T16:01:40.000Z' }),
    event({ status: 'open' }),
  ]);
  assert.equal(report.kpi.avg_ack_time_s, 30);
  assert.equal(report.kpi.acked_events, 2);
});

test('no acknowledgement means null, not a fake zero', () => {
  const report = build([event({ status: 'open' }), event({ status: 'escalated' })]);
  assert.equal(report.kpi.avg_ack_time_s, null);
  assert.equal(report.kpi.acked_events, 0);
  assert.doesNotMatch(report.summary, /timpul mediu până la confirmare a fost 0/);
  assert.match(report.summary, /nu poate fi calculat/);
});

test('acknowledgement times with unreadable or reversed dates are ignored', () => {
  const report = build([
    event({ acked_at: 'not-a-date' }),
    event({ detected_at: 'nope', acked_at: '2026-11-02T16:00:00.000Z' }),
    event({ detected_at: '2026-11-02T16:00:10.000Z', acked_at: '2026-11-02T16:00:00.000Z' }),
    event({ detected_at: '2026-11-02T16:00:00.000Z', acked_at: '2026-11-02T16:00:12.000Z' }),
  ]);
  assert.equal(report.kpi.avg_ack_time_s, 12);
});

test('by_type uses the Romanian labels already used in the view', () => {
  const report = build([
    event({ type: 'RESTRICTED_ZONE' }),
    event({ type: 'NO_PPE', severity: 'WARNING' }),
    event({ type: 'NO_PPE', severity: 'WARNING' }),
    event({ type: 'SMOKING', severity: 'WARNING' }),
    event({ type: 'CAMERA_OFFLINE', severity: 'WARNING' }),
  ]);

  assert.deepEqual(
    report.by_type.map((row) => [row.type, row.label, row.count]),
    [
      ['RESTRICTED_ZONE', 'Zonă restricționată', 1],
      ['NO_PPE', 'Echipament lipsă', 2],
      ['SMOKING', 'Fumat', 1],
      ['CAMERA_OFFLINE', 'Cameră offline', 1],
    ]
  );
  assert.equal(report.kpi.no_ppe_events, 2);
  assert.equal(report.ppe.no_ppe_incidents, 2);
  // Every counted event belongs to exactly one type row, unknown types included.
  assert.equal(report.by_type.reduce((sum, row) => sum + row.count, 0), report.kpi.total_events);
});

test('an unknown or missing type is counted, not dropped', () => {
  const report = build([event({ type: 'SOMETHING_NEW' }), event({ type: undefined })]);
  assert.equal(report.kpi.total_events, 2);
  assert.equal(report.by_type.reduce((sum, row) => sum + row.count, 0), 2);
  assert.ok(report.by_type.every((row) => row.label));
});

test('by_hour buckets in Bucharest time and crosses midnight in order', () => {
  const report = build([
    // 23:30 and 23:50 on Nov 1 in Bucharest (EET, UTC+2)
    event({ detected_at: '2026-11-01T21:50:00.000Z' }),
    event({ detected_at: '2026-11-01T21:30:00.000Z' }),
    // 00:10 on Nov 2 in Bucharest
    event({ detected_at: '2026-11-01T22:10:00.000Z' }),
    // 01:05 on Nov 2 in Bucharest
    event({ detected_at: '2026-11-01T23:05:00.000Z' }),
  ]);

  assert.deepEqual(report.by_hour, [
    { hour: '23:00', events: 2 },
    { hour: '00:00', events: 1 },
    { hour: '01:00', events: 1 },
  ]);
});

test('by_zone averages only the acks inside the zone', () => {
  const report = build([
    event({ zone_id: 'taxiway-b', detected_at: '2026-11-02T16:00:00.000Z', acked_at: '2026-11-02T16:00:10.000Z' }),
    event({ zone_id: 'taxiway-b', detected_at: '2026-11-02T16:01:00.000Z', acked_at: '2026-11-02T16:01:30.000Z' }),
    event({ zone_id: 'baggage-area', status: 'open' }),
  ]);

  const taxiway = report.by_zone.find((row) => row.zone === 'taxiway-b');
  const baggage = report.by_zone.find((row) => row.zone === 'baggage-area');
  assert.equal(taxiway.avg_ack_s, 20);
  assert.equal(baggage.avg_ack_s, null);
});

test('an engine event with a template report counts like any other incident', () => {
  const report = build([
    event({
      local: true,
      model: 'yolo26n',
      status: 'open',
      report: { what: 'Persoană în zona restricționată webcam-view.', source: 'template' },
    }),
  ]);
  assert.equal(report.kpi.total_events, 1);
  assert.equal(report.kpi.open_events, 1);
  assert.equal(report.kpi.critical_events, 1);
  assert.equal(report.by_type[0].count, 1);
});

test('invalid and missing fields never produce NaN or Infinity', () => {
  const report = build([
    event({ detected_at: undefined, acked_at: undefined, zone_id: undefined, severity: undefined, status: undefined }),
    event({ detected_at: 'total garbage', acked_at: '2026-11-02T16:00:05.000Z', zone_id: undefined }),
    null,
    'not-an-event',
  ]);

  assert.equal(report.kpi.total_events, 2);
  assert.equal(report.kpi.avg_ack_time_s, null);
  assert.deepEqual(report.by_hour, []);
  assert.equal(report.by_zone.length, 1);
  assert.equal(report.by_zone[0].zone, '—');
  assert.doesNotMatch(JSON.stringify(report), /NaN|Infinity|Invalid Date/);
  assert.doesNotMatch(report.summary, /NaN|Infinity|undefined/);
});

test('an empty shift reports zeros and says there are no events', () => {
  const report = build([]);

  assert.deepEqual(report.kpi, {
    total_events: 0,
    critical_events: 0,
    warning_events: 0,
    avg_ack_time_s: null,
    open_events: 0,
    escalated_events: 0,
    acknowledged_events: 0,
    acked_events: 0,
    resolved_events: 0,
    false_positive_events: 0,
    no_ppe_events: 0,
  });
  assert.deepEqual(report.by_type, []);
  assert.deepEqual(report.by_hour, []);
  assert.deepEqual(report.by_zone, []);
  assert.equal(report.ppe.no_ppe_incidents, 0);
  assert.match(report.summary, /nu există evenimente în tura curentă/);
  assert.doesNotMatch(JSON.stringify(report), /NaN|Infinity/);
});

test('a missing or non-array event list is handled like an empty shift', () => {
  assert.equal(buildShiftReport(undefined, { shiftLabel: SHIFT }).kpi.total_events, 0);
  assert.equal(buildShiftReport(null, { shiftLabel: SHIFT }).kpi.total_events, 0);
  assert.equal(buildShiftReport('nope', { shiftLabel: SHIFT }).kpi.total_events, 0);
});

test('the summary cites the same numbers as the cards and the charts', () => {
  const report = build([
    event({ status: 'open' }),
    event({ status: 'open' }),
    event({ status: 'escalated', severity: 'WARNING' }),
    event({ type: 'NO_PPE', severity: 'WARNING', status: 'acknowledged', acked_at: '2026-11-02T16:00:43.000Z' }),
  ]);

  assert.match(report.summary, /^Tura 2: 4 evenimente, 2 critice și 2 avertismente\./);
  assert.match(report.summary, /2 incidente sunt încă deschise, 1 a escaladat, 1 este confirmat/);
  assert.match(report.summary, /timpul mediu până la confirmare a fost 43 s/i);
  assert.match(report.summary, /NO_PPE\): 1/);
  assert.match(report.summary, /Zonă restricționată 3/);
  assert.match(report.summary, /Echipament lipsă 1/);
  assert.doesNotMatch(report.summary, /conformitatea PPE \d/i);
});
