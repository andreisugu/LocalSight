import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_EVENTS } from './incidents.js';
import { buildShiftReport, INITIAL_SHIFT_REPORT } from './report.js';
import {
  OPERATIONAL_DATE,
  OPERATIONAL_SHIFT_ID,
  SHIFT_LABELS,
  shortShiftLabel,
} from './shift.js';

test('the demo report shows 8 incidents, 43 s to acknowledge and 2 escalations', () => {
  assert.deepEqual(INITIAL_SHIFT_REPORT.kpi, {
    total_events: 8,
    critical_events: 4,
    warning_events: 4,
    avg_ack_time_s: 43,
    ppe_compliance_pct: 93.8,
  });
  assert.equal(INITIAL_SHIFT_REPORT.total_events, 8);
  assert.equal(INITIAL_SHIFT_REPORT.false_positives, 0);
  assert.equal(INITIAL_SHIFT_REPORT.shift, SHIFT_LABELS[OPERATIONAL_SHIFT_ID]);
  assert.equal(INITIAL_SHIFT_REPORT.date, OPERATIONAL_DATE);
});

test('the report numbers come from the incidents, not a table', () => {
  assert.equal(INITIAL_SHIFT_REPORT.total_events, INITIAL_EVENTS.length);
  const critical = INITIAL_EVENTS.filter((event) => event.severity === 'CRITICAL').length;
  assert.equal(INITIAL_SHIFT_REPORT.kpi.critical_events, critical);
  assert.equal(
    INITIAL_SHIFT_REPORT.by_type.reduce((sum, row) => sum + row.count, 0),
    INITIAL_EVENTS.length
  );
  assert.equal(
    INITIAL_SHIFT_REPORT.by_hour.reduce((sum, row) => sum + row.events, 0),
    INITIAL_EVENTS.length
  );
});

test('per-type rows split severity and keep the list order', () => {
  assert.deepEqual(INITIAL_SHIFT_REPORT.by_type, [
    {
      type: 'RESTRICTED_ZONE',
      label: 'Zonă restricționată',
      count: 4,
      critical: 4,
      warning: 0,
      false_positive: 0,
    },
    {
      type: 'NO_PPE',
      label: 'Echipament lipsă',
      count: 4,
      critical: 0,
      warning: 4,
      false_positive: 0,
    },
  ]);
});

test('per-zone rows are labelled with the zone name and use the shift average when empty', () => {
  assert.deepEqual(
    INITIAL_SHIFT_REPORT.by_zone.map((row) => row.zone),
    ['Stand 12 — motor stâng', 'Taxiway B — linie de așteptare', 'Zona bagaje — banda 2', 'Platformă Stand 12']
  );
  const engine = INITIAL_SHIFT_REPORT.by_zone[0];
  // No confirmation in this zone, so it reports the global average instead of a zero.
  assert.equal(engine.critical, 2);
  assert.equal(engine.avg_ack_s, 43);
  assert.equal(INITIAL_SHIFT_REPORT.by_zone[1].avg_ack_s, 22);
  assert.equal(INITIAL_SHIFT_REPORT.by_zone[2].avg_ack_s, 64);
  assert.equal(INITIAL_SHIFT_REPORT.by_zone[3].avg_ack_s, 43);
});

test('the summary is composed from the same numbers', () => {
  const summary = INITIAL_SHIFT_REPORT.summary;
  assert.ok(summary.startsWith(`${shortShiftLabel(OPERATIONAL_SHIFT_ID)}: 8 evenimente, 4 critice și 4 avertismente.`));
  assert.ok(summary.includes('2 incidente sunt încă deschise, iar 2 au escaladat'));
  assert.ok(summary.includes('Timpul mediu de confirmare a fost 43 s'));
  assert.ok(summary.includes('conformitatea PPE 93,8%'));
});

test('coverage counts blind minutes only when they exist', () => {
  const { coverage } = INITIAL_SHIFT_REPORT;
  assert.ok(coverage.offline_minutes >= 0 && coverage.offline_minutes <= 4);
  assert.ok(coverage.coverage > 0 && coverage.coverage <= 1);

  const short = buildShiftReport([], { minutesIntoShift: 30 });
  assert.deepEqual(short.coverage, { coverage: 1, offline_minutes: 0 });

  const hour = buildShiftReport([], { minutesIntoShift: 60 });
  assert.deepEqual(hour.coverage, { coverage: 0.983, offline_minutes: 1 });
});

test('a false positive is counted separately and left out of the incident totals', () => {
  const events = [
    event({ status: 'open', severity: 'CRITICAL', type: 'RESTRICTED_ZONE', detected_at: '2026-11-02T08:00:00.000Z' }),
    event({
      status: 'acknowledged',
      severity: 'WARNING',
      type: 'NO_PPE',
      detected_at: '2026-11-02T08:10:00.000Z',
      acked_at: '2026-11-02T08:10:30.000Z',
    }),
    event({ status: 'false_positive', severity: 'WARNING', type: 'NO_PPE', detected_at: '2026-11-02T08:20:00.000Z' }),
  ];

  const report = buildShiftReport(events, {
    shiftId: 'shift_1',
    operationalDate: '2026-11-02',
    minutesIntoShift: 120,
    zones: [{ zone_id: 'engine-left', name: 'Stand 12 — motor stâng' }],
    ppeCompliancePct: 90,
  });

  assert.equal(report.total_events, 2);
  assert.equal(report.false_positives, 1);
  assert.equal(report.kpi.total_events, 2);
  assert.equal(report.kpi.critical_events, 1);
  assert.equal(report.kpi.warning_events, 1);
  assert.equal(report.kpi.avg_ack_time_s, 30);
  assert.deepEqual(report.by_type.map((row) => [row.type, row.count, row.false_positive]), [
    ['RESTRICTED_ZONE', 1, 0],
    ['NO_PPE', 1, 1],
  ]);
  assert.equal(report.by_hour.reduce((sum, row) => sum + row.events, 0), 2);
  assert.ok(report.summary.includes('2 evenimente'));
});

test('an empty shift yields zeroes instead of NaN', () => {
  const report = buildShiftReport([], {
    shiftId: 'shift_3',
    operationalDate: '2026-11-01',
    minutesIntoShift: 30,
    zones: [],
  });
  assert.equal(report.total_events, 0);
  assert.equal(report.kpi.avg_ack_time_s, 0);
  assert.deepEqual(report.by_type, []);
  assert.deepEqual(report.by_zone, []);
  assert.deepEqual(report.by_hour, []);
  assert.equal(report.coverage.offline_minutes, 0);
  assert.equal(report.coverage.coverage, 1);
});

function event({ detected_at, acked_at = null, ...overrides }) {
  return {
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    zone_id: 'engine-left',
    detected_at,
    acked_at,
    ...overrides,
  };
}
