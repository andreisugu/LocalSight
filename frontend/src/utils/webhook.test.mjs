// The webhook configuration, message and transport are pure, so every rule the panel and
// the notifier rely on is pinned here without a browser.
//
// The privacy assertions are deliberately part of the message test: a snapshot URL, a blob
// URL or a token appearing in a pushed message is the one failure this feature must not have.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_WEBHOOK_SETTINGS,
  WEBHOOK_CHANNELS,
  WEBHOOK_SENT_KEY,
  WEBHOOK_STORAGE_KEY,
  buildIncidentMessage,
  buildIncidentSummary,
  buildRelayRequest,
  isRelayUrl,
  normalizeRelayUrl,
  normalizeWebhookSettings,
  readWebhookSettings,
  sendTestWebhook,
  sendWebhook,
  storeWebhookSettings,
} from './webhook.js';

/** A localStorage stand-in that records what was written. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

const EVENT = {
  event_id: 'evt_cam-03_1762136198000_7',
  type: 'RESTRICTED_ZONE',
  severity: 'CRITICAL',
  camera_id: 'cam-03',
  camera_code: 'CAM-03',
  zone_id: 'baggage-area',
  detected_at: '2026-11-03T00:16:38Z',
  snapshot_url: 'blob:http://localhost:5173/9f31c4',
  report: {
    what: 'Persoană în zona restricționată baggage-area.',
    where: 'Zona bagaje — banda 2',
  },
};

const ENABLED = { enabled: true, relayUrl: 'http://localhost:8787', channel: 'ntfy', token: '' };

describe('webhook settings', () => {
  it('defaults to OFF with no relay and the channel list the relay supports', () => {
    assert.deepEqual({ ...DEFAULT_WEBHOOK_SETTINGS }, {
      enabled: false,
      relayUrl: '',
      channel: 'ntfy',
      token: '',
    });
    assert.deepEqual([...WEBHOOK_CHANNELS], ['slack', 'discord', 'telegram', 'ntfy']);
    assert.equal(WEBHOOK_STORAGE_KEY, 'localsight.webhook');
    assert.equal(WEBHOOK_SENT_KEY, 'localsight.webhook.sent');
  });

  it('accepts only http(s) relay URLs, without credentials or a trailing slash', () => {
    assert.equal(normalizeRelayUrl(' http://localhost:8787/ '), 'http://localhost:8787');
    assert.equal(normalizeRelayUrl('https://relay.example/base/'), 'https://relay.example/base');
    // A base is not a request URL: a stray query or fragment is dropped, then `/notify` is added.
    assert.equal(
      normalizeRelayUrl('https://relay.example/base/?token=1#x'),
      'https://relay.example/base'
    );
    assert.equal(normalizeRelayUrl('ws://relay.example'), '');
    assert.equal(normalizeRelayUrl('relay.example'), '');
    assert.equal(normalizeRelayUrl('http://user:pass@relay.example'), '');
    assert.equal(normalizeRelayUrl(''), '');
    assert.equal(normalizeRelayUrl(null), '');
    assert.equal(normalizeRelayUrl(`http://relay.example/${'a'.repeat(600)}`), '');
    assert.equal(isRelayUrl('http://127.0.0.1:8787'), true);
    assert.equal(isRelayUrl('nope'), false);
  });

  it('normalizes a partial object into the complete validated shape', () => {
    assert.deepEqual(normalizeWebhookSettings(null), { ...DEFAULT_WEBHOOK_SETTINGS });
    assert.deepEqual(
      normalizeWebhookSettings({
        enabled: 'yes',
        relayUrl: 'https://relay.example/',
        channel: 'telegram',
        token: '  shared  ',
      }),
      { enabled: false, relayUrl: 'https://relay.example', channel: 'telegram', token: 'shared' }
    );
    assert.deepEqual(
      normalizeWebhookSettings({ enabled: true, channel: 'carrier-pigeon', relayUrl: 'ftp://x' }),
      { enabled: true, relayUrl: '', channel: 'ntfy', token: '' }
    );
  });

  it('reads a missing or corrupt blob as the defaults', () => {
    assert.deepEqual(readWebhookSettings(memoryStorage()), { ...DEFAULT_WEBHOOK_SETTINGS });
    assert.deepEqual(
      readWebhookSettings(memoryStorage({ [WEBHOOK_STORAGE_KEY]: '{not json' })),
      { ...DEFAULT_WEBHOOK_SETTINGS }
    );
    assert.deepEqual(
      readWebhookSettings(memoryStorage({ [WEBHOOK_STORAGE_KEY]: 'x'.repeat(5000) })),
      { ...DEFAULT_WEBHOOK_SETTINGS }
    );
    const stored = memoryStorage({
      [WEBHOOK_STORAGE_KEY]: JSON.stringify({ enabled: true, relayUrl: 'http://localhost:8787', channel: 'slack' }),
    });
    assert.deepEqual(readWebhookSettings(stored), {
      enabled: true,
      relayUrl: 'http://localhost:8787',
      channel: 'slack',
      token: '',
    });
  });

  it('merges a patch, persists it, and never keeps a broken relay URL', () => {
    const storage = memoryStorage();
    const afterEnable = storeWebhookSettings({ enabled: true }, storage);
    assert.equal(afterEnable.enabled, true);

    const afterUrl = storeWebhookSettings({ relayUrl: 'http://localhost:8787/' }, storage);
    assert.equal(afterUrl.relayUrl, 'http://localhost:8787');

    // Typing an incomplete URL clears the stored one instead of keeping a stale address.
    assert.equal(storeWebhookSettings({ relayUrl: 'http://' }, storage).relayUrl, '');
    // An unknown channel is ignored; the previous choice stays.
    assert.equal(storeWebhookSettings({ channel: 'slack' }, storage).channel, 'slack');
    assert.equal(storeWebhookSettings({ channel: 'pigeon' }, storage).channel, 'slack');
    // A non-boolean enable flag is ignored too.
    assert.equal(storeWebhookSettings({ enabled: 'off' }, storage).enabled, true);

    assert.deepEqual(JSON.parse(storage.dump()[WEBHOOK_STORAGE_KEY]), {
      enabled: true,
      relayUrl: '',
      channel: 'slack',
      token: '',
    });
  });

  it('keeps the setting for this tab when storage refuses the write', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    assert.deepEqual(storeWebhookSettings({ enabled: true, token: 'abc' }, blocked), {
      enabled: true,
      relayUrl: '',
      channel: 'ntfy',
      token: 'abc',
    });
  });
});

describe('incident message', () => {
  it('renders the documented five lines and nothing else', () => {
    const message = buildIncidentMessage(EVENT, { appUrl: 'https://example.test/LocalSight/' });
    assert.equal(
      message,
      [
        '[LocalSight] CRITICAL · Zonă restricționată',
        'CAM-03 · baggage-area · Zona bagaje — banda 2',
        'Persoană în zona restricționată baggage-area.',
        'Detectat: 03.11.2026 02:16:38',
        'Aplicație: https://example.test/LocalSight/incidents',
      ].join('\n')
    );
  });

  it('carries severity, camera, zone and time but never an image, a blob or a token', () => {
    const message = buildIncidentMessage(EVENT, { appUrl: 'https://example.test/' });
    assert.match(message, /CRITICAL/);
    assert.match(message, /CAM-03/);
    assert.match(message, /baggage-area/);
    assert.match(message, /03\.11\.2026 02:16:38/);
    assert.doesNotMatch(message, /blob:/);
    assert.doesNotMatch(message, /snapshot/i);
    assert.doesNotMatch(message, /9f31c4/);
    // No deep link: a local incident detail only exists in this tab's IndexedDB.
    assert.doesNotMatch(message, /\/incidents\/evt_/);
  });

  it('falls back to the type and ids when the report is missing', () => {
    const message = buildIncidentMessage(
      {
        event_id: 'evt_x',
        type: 'NO_PPE',
        severity: 'WARNING',
        camera_id: 'stand12',
        zone_id: 'apron-stand12',
        detected_at: 'not a date',
      },
      {}
    );
    const lines = message.split('\n');
    assert.equal(lines[0], '[LocalSight] WARNING · Echipament lipsă');
    assert.equal(lines[1], 'stand12 · apron-stand12');
    assert.match(lines[2], /apron-stand12/);
    assert.equal(lines[3], 'Detectat: —');
    assert.equal(lines.length, 4, 'no app line without an app URL');
  });

  it('does not repeat the engine template where line', () => {
    const message = buildIncidentMessage({
      type: 'RESTRICTED_ZONE',
      severity: 'WARNING',
      camera_id: 'CAM-03',
      zone_id: 'baggage-area',
      detected_at: '2026-11-03T00:16:38Z',
      report: { what: 'Persoană în zonă.', where: 'CAM-03 • baggage-area' },
    });
    assert.equal(message.split('\n')[1], 'CAM-03 · baggage-area');
  });

  it('names a camera whose id equals its zone id only once', () => {
    const message = buildIncidentMessage({
      type: 'RESTRICTED_ZONE',
      severity: 'WARNING',
      camera_id: 'baggage-area',
      zone_id: 'baggage-area',
      detected_at: '2026-11-03T00:16:38Z',
      report: { what: 'Persoană în zonă.', where: 'CAM-03 • Bagaje — poarta • Zona bagaje — banda 2' },
    });
    assert.equal(
      message.split('\n')[1],
      'baggage-area · CAM-03 • Bagaje — poarta • Zona bagaje — banda 2'
    );
  });

  it('accepts a Date and an epoch for the detection time', () => {
    const event = { ...EVENT, detected_at: new Date('2026-11-03T00:16:38Z') };
    assert.match(buildIncidentMessage(event, {}), /Detectat: 03\.11\.2026 02:16:38/);
    assert.match(buildIncidentMessage({ ...EVENT, detected_at: Date.parse('2026-11-03T00:16:38Z') }, {}), /03\.11\.2026/);
  });
});

describe('relay request', () => {
  it('posts the channel, the text and a whitelisted incident', () => {
    const { url, init } = buildRelayRequest(
      { ...ENABLED, relayUrl: 'http://localhost:8787/', channel: 'telegram', token: ' shared ' },
      'hello',
      EVENT
    );
    assert.equal(url, 'http://localhost:8787/notify');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['X-Relay-Token'], 'shared');
    const body = JSON.parse(init.body);
    assert.equal(body.channel, 'telegram');
    assert.equal(body.text, 'hello');
    assert.deepEqual(body.incident, {
      event_id: EVENT.event_id,
      type: 'RESTRICTED_ZONE',
      severity: 'CRITICAL',
      camera_id: 'cam-03',
      zone_id: 'baggage-area',
      detected_at: '2026-11-03T00:16:38Z',
    });
    assert.deepEqual(Object.keys(body.incident).sort(), [
      'camera_id',
      'detected_at',
      'event_id',
      'severity',
      'type',
      'zone_id',
    ]);
    assert.doesNotMatch(init.body, /blob:|snapshot/i);
  });

  it('omits the token header when no token is configured', () => {
    const { init } = buildRelayRequest(ENABLED, 'hello', EVENT);
    assert.equal(Object.hasOwn(init.headers, 'X-Relay-Token'), false);
  });

  it('summarizes non-object input instead of throwing', () => {
    assert.deepEqual(buildIncidentSummary(null), {
      event_id: '',
      type: '',
      severity: '',
      camera_id: '',
      zone_id: '',
      detected_at: '',
    });
  });
});

describe('sending', () => {
  it('sends nothing when the feature is off', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 202 };
    };
    const result = await sendWebhook(normalizeWebhookSettings({ ...ENABLED, enabled: false }), 'x', EVENT, fetchImpl);
    assert.deepEqual(result, { ok: false, status: 0, error: 'disabled' });
    assert.equal(calls, 0);
  });

  it('sends nothing when no relay URL is configured', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 202 };
    };
    const result = await sendWebhook({ ...ENABLED, relayUrl: '' }, 'x', EVENT, fetchImpl);
    assert.deepEqual(result, { ok: false, status: 0, error: 'disabled' });
    assert.equal(calls, 0);
  });

  it('reports a 202 as a success', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 202 };
    };
    const result = await sendWebhook(ENABLED, 'hello', EVENT, fetchImpl);
    assert.deepEqual(result, { ok: true, status: 202, error: '' });
    assert.equal(seen.url, 'http://localhost:8787/notify');
  });

  it('turns a relay error into a short result instead of a throw', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    const result = await sendWebhook(ENABLED, 'hello', EVENT, fetchImpl);
    assert.deepEqual(result, { ok: false, status: 503, error: 'http_503' });
  });

  it('never throws on a network failure', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await sendWebhook(ENABLED, 'hello', EVENT, fetchImpl);
    assert.deepEqual(result, { ok: false, status: 0, error: 'network' });
  });

  it('aborts a request that outlives the timeout', async () => {
    const fetchImpl = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    const result = await sendWebhook(ENABLED, 'hello', EVENT, fetchImpl, { timeoutMs: 10 });
    assert.deepEqual(result, { ok: false, status: 0, error: 'timeout' });
  });

  it('sends a clearly marked test message through the same relay', async () => {
    let body = null;
    const fetchImpl = async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 202 };
    };
    const result = await sendTestWebhook(
      { ...ENABLED, channel: 'slack' },
      { appUrl: 'https://example.test/', now: Date.parse('2026-11-03T00:16:38Z'), fetchImpl }
    );
    assert.deepEqual(result, { ok: true, status: 202, error: '' });
    assert.equal(body.channel, 'slack');
    assert.match(body.text, /^\[LocalSight TEST\] WARNING · Zonă restricționată/);
    assert.match(body.text, /Mesaj de test/);
    assert.equal(body.incident.event_id, 'evt_test_webhook');
  });

  it('does not send a test while the feature is off', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 202 };
    };
    const result = await sendTestWebhook({ ...ENABLED, enabled: false }, { fetchImpl });
    assert.deepEqual(result, { ok: false, status: 0, error: 'disabled' });
    assert.equal(calls, 0);
  });
});
