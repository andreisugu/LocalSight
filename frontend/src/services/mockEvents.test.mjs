import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_EVENTS } from '../data/incidents.js';
import {
  FALLBACK_REPORT,
  acknowledge,
  cloneEvent,
  markFalsePositive,
  regenerateReport,
  reopen,
} from './mockEvents.js';

const NOW = new Date('2026-11-02T09:00:00.000Z');
const open = () => INITIAL_EVENTS.find((event) => event.status === 'open');
const acknowledged = () => INITIAL_EVENTS.find((event) => event.status === 'acknowledged');
const escalated = () => INITIAL_EVENTS.find((event) => event.status === 'escalated');

test('a clone can be edited without touching the fixture it came from', () => {
  const source = open();
  const copy = cloneEvent(source);

  copy.report.what = 'changed';
  copy.confidence.temporal.seen = 0;
  copy.context.engine_on = !source.context.engine_on;
  copy.status = 'acknowledged';

  assert.notEqual(source.report.what, 'changed');
  assert.notEqual(source.confidence.temporal.seen, 0);
  assert.equal(source.status, 'open');
  assert.equal(cloneEvent(null), null);
});

test('acknowledging records the operator and the moment', () => {
  const source = open();
  const updated = acknowledge(source, 'Dispecer', NOW);

  assert.equal(updated.status, 'acknowledged');
  assert.equal(updated.acked_by, 'Dispecer');
  assert.equal(updated.acked_at, NOW.toISOString());
  assert.equal(updated.event_id, source.event_id);
  // The transition is pure: the fixture keeps its old status.
  assert.equal(source.status, 'open');
  assert.equal(source.acked_at, null);
});

test('a false positive leaves the incident status but keeps the envelope', () => {
  const source = escalated();
  const updated = markFalsePositive(source);

  assert.equal(updated.status, 'false_positive');
  assert.equal(updated.event_id, source.event_id);
  assert.equal(updated.severity, source.severity);
  assert.equal(source.status, 'escalated');
});

test('reopening clears the confirmation and restarts the escalation window', () => {
  const source = acknowledged();
  const updated = reopen(source);

  assert.equal(updated.status, 'open');
  assert.equal(updated.acked_at, null);
  assert.equal(updated.acked_by, null);
  assert.equal(updated.escalated_at, null);
  assert.equal(updated.event_id, source.event_id);
  assert.ok(source.acked_at, 'the fixture still has its confirmation');
});

test('regenerating keeps the written report and stamps the source', () => {
  const source = open();
  const updated = regenerateReport(source, NOW);

  assert.equal(updated.report.source, 'llm');
  assert.equal(updated.report.what, source.report.what);
  assert.equal(updated.report.where, source.report.where);
  assert.equal(updated.report.when, source.report.when);
  assert.equal(source.report.source, 'llm');
});

test('an incident without a report gets the template instead of blanks', () => {
  const updated = regenerateReport({ event_id: 'evt_x', report: null }, NOW);

  assert.deepEqual(updated.report, {
    what: FALLBACK_REPORT.what,
    where: FALLBACK_REPORT.where,
    when: NOW.toISOString(),
    severity_reason: FALLBACK_REPORT.severity_reason,
    recommended_action: FALLBACK_REPORT.recommended_action,
    source: 'llm',
  });
});
