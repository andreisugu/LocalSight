import test from 'node:test';
import assert from 'node:assert/strict';
import { canDo } from './eventActions.js';

// Mirrors ACTIONS in backend/app/services/events.py. If this table changes, the backend
// must change in the same PR; the UI would otherwise offer a button that gets a 409.
test('ack is allowed only from open or escalated', () => {
  assert.equal(canDo('ack', 'open'), true);
  assert.equal(canDo('ack', 'escalated'), true);
  for (const status of ['acknowledged', 'false_positive', 'resolved', undefined, null, '']) {
    assert.equal(canDo('ack', status), false, `ack from ${status}`);
  }
});

test('false_positive is allowed from open, escalated or acknowledged', () => {
  for (const status of ['open', 'escalated', 'acknowledged']) {
    assert.equal(canDo('false_positive', status), true, `false_positive from ${status}`);
  }
  for (const status of ['false_positive', 'resolved', undefined]) {
    assert.equal(canDo('false_positive', status), false, `false_positive from ${status}`);
  }
});

test('reopen is allowed from every closed status', () => {
  for (const status of ['acknowledged', 'false_positive', 'escalated', 'resolved']) {
    assert.equal(canDo('reopen', status), true, `reopen from ${status}`);
  }
  for (const status of ['open', undefined]) {
    assert.equal(canDo('reopen', status), false, `reopen from ${status}`);
  }
});

test('unknown actions never pass', () => {
  assert.equal(canDo('delete', 'open'), false);
  assert.equal(canDo('', 'open'), false);
  assert.equal(canDo(undefined, 'open'), false);
});
