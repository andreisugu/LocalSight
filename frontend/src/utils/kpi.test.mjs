import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_KPIS, activeCounts, applyActiveCounts } from './kpi.js';

const events = [
  { event_id: 'a', status: 'open' },
  { event_id: 'b', status: 'escalated' },
  { event_id: 'c', status: 'acknowledged' },
  { event_id: 'd', status: 'false_positive' },
  { event_id: 'e', status: 'resolved' },
  { event_id: 'f', status: 'escalated' },
];

test('open counts open plus escalated; escalated counts escalated only', () => {
  assert.deepEqual(activeCounts(events), {
    open_incidents_count: 3,
    escalated_incidents_count: 2,
  });
});

test('acknowledging the only open incident drops both counts', () => {
  assert.deepEqual(activeCounts([{ status: 'open' }]), {
    open_incidents_count: 1,
    escalated_incidents_count: 0,
  });
  assert.deepEqual(activeCounts([{ status: 'acknowledged' }]), {
    open_incidents_count: 0,
    escalated_incidents_count: 0,
  });
});

test('an empty or malformed list counts nothing', () => {
  assert.deepEqual(activeCounts([]), { open_incidents_count: 0, escalated_incidents_count: 0 });
  assert.deepEqual(activeCounts([null, undefined, {}]), {
    open_incidents_count: 0,
    escalated_incidents_count: 0,
  });
});

test('applying counts keeps the tiles that cannot come from incidents', () => {
  const kpis = {
    ...EMPTY_KPIS,
    ppe_compliance_pct: 93.8,
    detection_to_alert_latency_s: 2.4,
  };
  assert.deepEqual(applyActiveCounts(kpis, events), {
    ppe_compliance_pct: 93.8,
    open_incidents_count: 3,
    detection_to_alert_latency_s: 2.4,
    escalated_incidents_count: 2,
  });
});

test('applying counts does not mutate the current tiles', () => {
  const kpis = { ...EMPTY_KPIS, open_incidents_count: 7 };
  const next = applyActiveCounts(kpis, [{ status: 'open' }]);
  assert.equal(kpis.open_incidents_count, 7);
  assert.equal(next.open_incidents_count, 1);
  assert.notEqual(next, kpis);
});

test('the empty shape matches the tiles the header renders', () => {
  assert.deepEqual(Object.keys(EMPTY_KPIS).sort(), [
    'detection_to_alert_latency_s',
    'escalated_incidents_count',
    'open_incidents_count',
    'ppe_compliance_pct',
  ]);
});
