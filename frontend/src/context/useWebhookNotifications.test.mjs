// Pure rules behind the notifier: what counts as a sendable incident, how the delivered-id
// list is bounded, and how retries behave. The React wiring itself is exercised by the
// browser run, not here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_SENT_LIMIT,
  WEBHOOK_STATUS,
  deliverWithRetry,
  queueableIncidents,
  readSentIds,
  rememberSentId,
  storeSentIds,
} from './useWebhookNotifications.js';
import { WEBHOOK_SENT_KEY } from '../utils/webhook.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

const local = (id) => ({ event_id: id, local: true, type: 'RESTRICTED_ZONE', severity: 'CRITICAL' });
const fixture = (id) => ({ event_id: id, type: 'RESTRICTED_ZONE', severity: 'CRITICAL' });

describe('delivered ids', () => {
  it('reads nothing from a missing, corrupt or foreign blob', () => {
    assert.deepEqual(readSentIds(memoryStorage()), []);
    assert.deepEqual(readSentIds(memoryStorage({ [WEBHOOK_SENT_KEY]: '{oops' })), []);
    assert.deepEqual(readSentIds(memoryStorage({ [WEBHOOK_SENT_KEY]: '{"a":1}' })), []);
    assert.deepEqual(readSentIds(memoryStorage({ [WEBHOOK_SENT_KEY]: 'x'.repeat(20_000) })), []);
  });

  it('keeps only unique non-empty ids, newest last', () => {
    const storage = memoryStorage({
      [WEBHOOK_SENT_KEY]: JSON.stringify(['evt_a', '', 7, ' evt_b ', 'evt_a', 'evt_c']),
    });
    assert.deepEqual(readSentIds(storage), ['evt_a', 'evt_b', 'evt_c']);
  });

  it('caps the list at the documented bound and drops the oldest first', () => {
    const ids = Array.from({ length: WEBHOOK_SENT_LIMIT }, (_, index) => `evt_${index}`);
    const next = rememberSentId(ids, 'evt_new');
    assert.equal(next.length, WEBHOOK_SENT_LIMIT);
    assert.equal(next[0], 'evt_1');
    assert.equal(next[next.length - 1], 'evt_new');
  });

  it('does not append the same id twice', () => {
    assert.deepEqual(rememberSentId(['evt_a', 'evt_b'], 'evt_a'), ['evt_a', 'evt_b']);
  });

  it('persists the capped list', () => {
    const storage = memoryStorage();
    const written = storeSentIds(['evt_a'], storage);
    assert.deepEqual(written, ['evt_a']);
    assert.deepEqual(JSON.parse(storage.dump()[WEBHOOK_SENT_KEY]), ['evt_a']);
  });
});

describe('queue selection', () => {
  it('takes real engine incidents only, never fixtures', () => {
    const events = [local('evt_1'), fixture('evt_2'), { local: 'true', event_id: 'evt_3' }];
    assert.deepEqual(queueableIncidents(events).map((event) => event.event_id), ['evt_1']);
  });

  it('skips delivered and already-attempted ids', () => {
    const events = [local('evt_1'), local('evt_2'), local('evt_3')];
    const queued = queueableIncidents(events, { sent: ['evt_1'], attempted: ['evt_2'] });
    assert.deepEqual(queued.map((event) => event.event_id), ['evt_3']);
  });

  it('skips the backlog that existed when notifications were enabled', () => {
    const events = [local('evt_1'), local('evt_2'), local('evt_3')];
    const queued = queueableIncidents(events, { baseline: ['evt_1', 'evt_2'] });
    assert.deepEqual(queued.map((event) => event.event_id), ['evt_3']);
  });

  it('ignores malformed input', () => {
    assert.deepEqual(queueableIncidents(null), []);
    assert.deepEqual(queueableIncidents([null, {}, { local: true }]), []);
  });
});

describe('retry', () => {
  const settings = { enabled: true, relayUrl: 'http://localhost:8787', channel: 'ntfy', token: '' };

  it('pins the documented backoff', () => {
    assert.deepEqual([...WEBHOOK_RETRY_DELAYS_MS], [2000, 5000, 10000]);
  });

  it('retries a failed send with the documented waits, then succeeds', async () => {
    const sleeps = [];
    const statuses = [];
    let calls = 0;
    const result = await deliverWithRetry(settings, 'text', local('evt_1'), {
      send: async () => {
        calls += 1;
        return calls < 3
          ? { ok: false, status: 503, error: 'http_503' }
          : { ok: true, status: 202, error: '' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onStatus: (status) => statuses.push(status.state),
    });
    assert.deepEqual(result, { ok: true, status: 202, error: '' });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [2000, 5000]);
    assert.deepEqual(statuses, [
      WEBHOOK_STATUS.SENDING,
      WEBHOOK_STATUS.SENDING,
      WEBHOOK_STATUS.SENDING,
    ]);
  });

  it('gives up after one try plus three retries and returns the last error', async () => {
    const sleeps = [];
    let calls = 0;
    const result = await deliverWithRetry(settings, 'text', local('evt_1'), {
      send: async () => {
        calls += 1;
        return { ok: false, status: 0, error: 'network' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.deepEqual(result, { ok: false, status: 0, error: 'network' });
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [2000, 5000, 10000]);
  });

  it('stops between attempts when the configuration is turned off', async () => {
    const sleeps = [];
    let calls = 0;
    let cancelled = false;
    const result = await deliverWithRetry(settings, 'text', local('evt_1'), {
      send: async () => {
        calls += 1;
        cancelled = true;
        return { ok: false, status: 0, error: 'network' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      isCancelled: () => cancelled,
    });
    assert.deepEqual(result, { ok: false, status: 0, error: 'cancelled' });
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });
});
