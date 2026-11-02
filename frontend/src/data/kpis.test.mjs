import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_EVENTS } from './incidents.js';
import { INITIAL_KPIS, deriveKpis } from './kpis.js';

const event = (overrides = {}) => ({
  status: 'open',
  severity: 'CRITICAL',
  detected_at: '2026-11-02T06:00:00.000Z',
  notified_at: '2026-11-02T06:00:01.500Z',
  ...overrides,
});

test('the demo KPIs agree with the fixture list', () => {
  assert.deepEqual(INITIAL_KPIS, {
    ppe_compliance_pct: 93.8,
    open_incidents_count: 4,
    detection_to_alert_latency_s: 1.3,
    escalated_incidents_count: 2,
  });
});

test('open incidents means open plus escalated', () => {
  const kpis = deriveKpis([
    event({ status: 'open' }),
    event({ status: 'escalated' }),
    event({ status: 'acknowledged' }),
    event({ status: 'resolved' }),
    event({ status: 'false_positive', severity: 'WARNING' }),
  ]);
  assert.equal(kpis.open_incidents_count, 2);
  assert.equal(kpis.escalated_incidents_count, 1);
});

test('latency is the detection → notification gap, rounded to one decimal', () => {
  assert.equal(
    deriveKpis([event({ notified_at: '2026-11-02T06:00:01.000Z' })]).detection_to_alert_latency_s,
    1
  );
  assert.equal(
    deriveKpis([
      event({ notified_at: '2026-11-02T06:00:01.000Z' }),
      event({ notified_at: '2026-11-02T06:00:02.000Z' }),
    ]).detection_to_alert_latency_s,
    1.5
  );
  // 1.375 s and 1.285 s average to 1.33 s, shown as 1.3.
  assert.equal(
    deriveKpis([
      event({ notified_at: '2026-11-02T06:00:01.375Z' }),
      event({ notified_at: '2026-11-02T06:00:01.285Z' }),
    ]).detection_to_alert_latency_s,
    1.3
  );
});

test('no events means dashes and zeroes, not NaN', () => {
  assert.deepEqual(deriveKpis([]), {
    ppe_compliance_pct: 93.8,
    open_incidents_count: 0,
    detection_to_alert_latency_s: '—',
    escalated_incidents_count: 0,
  });
  assert.deepEqual(deriveKpis(undefined), {
    ppe_compliance_pct: 93.8,
    open_incidents_count: 0,
    detection_to_alert_latency_s: '—',
    escalated_incidents_count: 0,
  });
});

test('a supplied PPE rate is passed through, never inferred from incidents', () => {
  assert.equal(deriveKpis([{ status: 'open', severity: 'WARNING' }], 97.25).ppe_compliance_pct, 97.25);
});

test('every fixture event contributes to the latency average', () => {
  assert.equal(INITIAL_EVENTS.length, 8);
  assert.ok(INITIAL_EVENTS.every((row) => typeof row.notified_at === 'string'));
});
