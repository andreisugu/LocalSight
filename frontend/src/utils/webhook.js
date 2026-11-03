// Opt-in, text-only webhook notifications for real engine incidents.
//
// The app is static, so it cannot hold a Slack/Discord/Telegram secret and cannot rely on
// those providers accepting a browser POST (CORS). The app therefore talks to one optional
// self-hosted relay (`scripts/webhook-relay.mjs`) and nothing else: the relay keeps the
// provider env and formats the message. Without a relay URL the setting sends nothing.
//
// This module is pure. It reads no environment, no clock and no globals: the caller passes
// `appUrl`, the message timestamp comes from the event, and `fetch` is injected. Node's
// test runner imports it directly.
//
// Privacy: only text leaves the tab. The message is built from the event's type, severity,
// camera and zone ids, the operator-facing report text and the detection time. The snapshot
// URL, the blob URL, the report's image and any deep link are never read, and a token is
// only ever a request header — never part of the message.

import { TYPE_LABELS } from '../data/labels.js';
import { readStoredJson } from './storage.js';
import { TIME_ZONE } from './time.js';

/** Where the panel keeps the configuration, in this browser only. */
export const WEBHOOK_STORAGE_KEY = 'localsight.webhook';

/** Where the notifier keeps the ids it already delivered, so a reload does not resend. */
export const WEBHOOK_SENT_KEY = 'localsight.webhook.sent';

/** The providers the relay knows how to format for. */
export const WEBHOOK_CHANNELS = Object.freeze(['slack', 'discord', 'telegram', 'ntfy']);

/** Default OFF: an operator must opt in, and nothing is sent until a relay is named. */
export const DEFAULT_WEBHOOK_SETTINGS = Object.freeze({
  enabled: false,
  relayUrl: '',
  channel: 'ntfy',
  token: '',
});

/** The relay is a loopback call; 8 s is generous for one small POST and keeps the queue moving. */
export const WEBHOOK_TIMEOUT_MS = 8000;

/** A relay URL is not a payload: this bound only stops a planted blob from being kept. */
export const WEBHOOK_URL_MAX_CHARS = 512;

/** A shared relay token is short; a longer string is truncated instead of stored whole. */
export const WEBHOOK_TOKEN_MAX_CHARS = 512;

const SETTINGS_MAX_CHARS = 4096;

const TITLE = 'LocalSight';

// `hourCycle: 'h23'` avoids the "24:00" that some locales print at midnight with `hour12:false`.
const DATE_TIME = new Intl.DateTimeFormat('ro-RO', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * A trimmed, non-empty string from the first usable value, else `''`.
 *
 * @param {...unknown} values
 * @returns {string}
 */
function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * `http(s)` only, no credentials, no trailing slash. Anything else becomes `''`, so an
 * invalid value is stored as "not configured" instead of as a broken address.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRelayUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > WEBHOOK_URL_MAX_CHARS) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  // A URL with credentials would put a secret in localStorage and in the message header.
  if (url.username || url.password) return '';
  if (!url.hostname) return '';
  // The base never carries a query or a fragment: `/notify` is appended to it below.
  url.search = '';
  url.hash = '';
  // The relay appends `/notify` itself, so the stored base never ends with a slash.
  return url.toString().replace(/\/+$/, '');
}

/**
 * @param {unknown} value
 * @returns {boolean} whether the value is a relay URL the app may call.
 */
export function isRelayUrl(value) {
  return normalizeRelayUrl(value) !== '';
}

/**
 * @param {unknown} value
 * @returns {string} a trimmed shared token, or `''`.
 */
function normalizeToken(value) {
  return typeof value === 'string'
    ? value.trim().slice(0, WEBHOOK_TOKEN_MAX_CHARS)
    : '';
}

/**
 * Validate one candidate object into the complete settings shape. A missing or broken field
 * falls back to its default; this function never returns a partial object.
 *
 * @param {unknown} value
 * @returns {{enabled: boolean, relayUrl: string, channel: string, token: string}}
 */
export function normalizeWebhookSettings(value) {
  const settings = { ...DEFAULT_WEBHOOK_SETTINGS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return settings;

  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (typeof candidate.enabled === 'boolean') settings.enabled = candidate.enabled;
  settings.relayUrl = normalizeRelayUrl(candidate.relayUrl);
  if (WEBHOOK_CHANNELS.includes(candidate.channel)) settings.channel = candidate.channel;
  settings.token = normalizeToken(candidate.token);
  return settings;
}

/**
 * Read the stored configuration. A missing key, a corrupt blob or an oversized value all
 * read as the defaults (OFF, no relay).
 *
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {{enabled: boolean, relayUrl: string, channel: string, token: string}}
 */
export function readWebhookSettings(storage = defaultStorage()) {
  const parsed = readStoredJson(storage, WEBHOOK_STORAGE_KEY, { maxChars: SETTINGS_MAX_CHARS });
  return normalizeWebhookSettings(parsed);
}

/**
 * Merge a patch into what is stored and write it back. An invalid relay URL clears the
 * stored one (the panel keeps the raw draft visible); an unknown channel is ignored so a
 * stale select value cannot silently switch providers.
 *
 * @param {{enabled?: unknown, relayUrl?: unknown, channel?: unknown, token?: unknown}} [patch]
 * @param {{getItem(key: string): string|null, setItem(key: string, value: string): void}|null|undefined} [storage]
 * @returns {{enabled: boolean, relayUrl: string, channel: string, token: string}}
 */
export function storeWebhookSettings(patch = {}, storage = defaultStorage()) {
  const next = readWebhookSettings(storage);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return next;

  if (Object.hasOwn(patch, 'enabled') && typeof patch.enabled === 'boolean') {
    next.enabled = patch.enabled;
  }
  if (Object.hasOwn(patch, 'relayUrl')) next.relayUrl = normalizeRelayUrl(patch.relayUrl);
  if (Object.hasOwn(patch, 'channel') && WEBHOOK_CHANNELS.includes(patch.channel)) {
    next.channel = patch.channel;
  }
  if (Object.hasOwn(patch, 'token')) next.token = normalizeToken(patch.token);

  try {
    storage?.setItem(WEBHOOK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The setting still applies to this tab; only persistence is lost.
  }
  return next;
}

/**
 * The detection time as the operator reads it: `DD.MM.YYYY HH:MM:SS` on Romania's clock.
 *
 * @param {unknown} value ISO string, epoch milliseconds or Date.
 * @returns {string} an em dash when the value cannot be read.
 */
export function formatWebhookTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(/** @type {string|number} */ (value));
  if (Number.isNaN(date.getTime())) return '—';
  const parts = {};
  for (const part of DATE_TIME.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * The text payload for one incident. Deterministic: the same event and `appUrl` produce the
 * same string on every run, and nothing in it is read from the browser.
 *
 * Shape:
 *   [LocalSight] CRITICAL · Zonă restricționată
 *   CAM-03 · baggage-area · Zona bagaje — banda 2
 *   Persoană în zona restricționată …
 *   Detectat: 03.11.2026 02:16:38
 *   Aplicație: https://host/LocalSight/incidents
 *
 * `appUrl` is the app base (ending with a slash is fine); the line points at the incident
 * list, never at a deep link: the detail of a local engine incident only exists in this
 * tab's IndexedDB and would be dead for every other reader.
 *
 * @param {object} event
 * @param {{appUrl?: string}} [options]
 * @returns {string}
 */
export function buildIncidentMessage(event, { appUrl = '' } = {}) {
  const data = event && typeof event === 'object' ? event : {};
  const severity = firstText(data.severity).toUpperCase() || 'WARNING';
  const type = firstText(data.type);
  const typeLabel = TYPE_LABELS[type] || type || 'Eveniment';
  const camera = firstText(data.camera_code, data.camera_id) || 'camera';
  const zone = firstText(data.zone_id) || 'zona configurată';
  const report = data.report && typeof data.report === 'object' ? data.report : {};
  const what = firstText(report.what) || `Eveniment de siguranță (${typeLabel}) în ${zone}.`;
  const where = firstText(report.where);

  // The engine's template report repeats the camera and zone; append `where` only when it
  // adds a place the ids do not already carry. A camera whose id equals its zone id (the
  // demo baggage camera) is named once.
  const location = camera === zone ? [camera] : [camera, zone];
  if (where && !where.includes(camera) && !where.includes(zone)) location.push(where);

  const lines = [
    `[${TITLE}] ${severity} · ${typeLabel}`,
    location.join(' · '),
    what,
    `Detectat: ${formatWebhookTime(data.detected_at)}`,
  ];

  const base = typeof appUrl === 'string' ? appUrl.trim() : '';
  if (base) lines.push(`Aplicație: ${base.endsWith('/') ? base : `${base}/`}incidents`);

  return lines.join('\n');
}

/**
 * The whitelist the relay receives. `snapshot_url`, the blob and the report body stay here:
 * the relay only needs the identifiers and the severity for its priority header.
 *
 * @param {object} event
 * @returns {{event_id: string, type: string, severity: string, camera_id: string,
 *            zone_id: string, detected_at: string}}
 */
export function buildIncidentSummary(event) {
  const data = event && typeof event === 'object' ? event : {};
  return {
    event_id: firstText(data.event_id),
    type: firstText(data.type),
    severity: firstText(data.severity).toUpperCase(),
    camera_id: firstText(data.camera_id),
    zone_id: firstText(data.zone_id),
    detected_at: firstText(data.detected_at),
  };
}

/**
 * The request the app posts to the relay.
 *
 * @param {unknown} settings
 * @param {string} text
 * @param {object} [incident]
 * @returns {{url: string, init: {method: 'POST', headers: Record<string, string>, body: string}}}
 */
export function buildRelayRequest(settings, text, incident = {}) {
  const current = normalizeWebhookSettings(settings);
  const headers = { 'Content-Type': 'application/json' };
  if (current.token) headers['X-Relay-Token'] = current.token;
  return {
    url: current.relayUrl ? `${current.relayUrl}/notify` : '',
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel: current.channel,
        text: typeof text === 'string' ? text : '',
        incident: buildIncidentSummary(incident),
      }),
    },
  };
}

/**
 * POST one message to the relay. Never throws: the queue needs a result, not an exception.
 *
 * Returns `{ok, status, error}` where `error` is a short code (`disabled`, `timeout`,
 * `network`, `http_<status>`) and `status` is the relay's HTTP status or `0`. A disabled
 * feature and an empty relay URL are both "nothing to send", reported as `disabled`.
 *
 * @param {unknown} settings
 * @param {string} text
 * @param {object} [incident]
 * @param {typeof fetch} [fetchImpl]
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, status: number, error: string}>}
 */
export async function sendWebhook(
  settings,
  text,
  incident = {},
  fetchImpl = globalThis.fetch,
  { timeoutMs = WEBHOOK_TIMEOUT_MS } = {}
) {
  const current = normalizeWebhookSettings(settings);
  if (!current.enabled || !current.relayUrl) {
    return { ok: false, status: 0, error: 'disabled' };
  }
  if (typeof fetchImpl !== 'function') return { ok: false, status: 0, error: 'no-fetch' };

  const { url, init } = buildRelayRequest(current, text, incident);
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadline);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response || typeof response.ok !== 'boolean') {
      return { ok: false, status: 0, error: 'network' };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `http_${response.status}` };
    }
    return { ok: true, status: response.status, error: '' };
  } catch (error) {
    if (error && typeof error === 'object' && error.name === 'AbortError') {
      return { ok: false, status: 0, error: 'timeout' };
    }
    return { ok: false, status: 0, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The sample the Settings button sends. It goes through the same transport and formatting,
 * so a green status means the relay really answered.
 *
 * @param {unknown} settings
 * @param {{appUrl?: string, fetchImpl?: typeof fetch, now?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, status: number, error: string}>}
 */
export async function sendTestWebhook(
  settings,
  { appUrl = '', fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = WEBHOOK_TIMEOUT_MS } = {}
) {
  const sample = {
    event_id: 'evt_test_webhook',
    type: 'RESTRICTED_ZONE',
    severity: 'WARNING',
    camera_id: 'CAM-TEST',
    zone_id: 'test-zone',
    detected_at: new Date(now).toISOString(),
    report: {
      what: 'Mesaj de test: notificările webhook sunt configurate corect.',
      where: 'Cameră de test · zonă de test',
    },
  };
  // The TEST marker is the one difference, so a reader cannot mistake it for an incident.
  const text = buildIncidentMessage(sample, { appUrl }).replace(`[${TITLE}]`, `[${TITLE} TEST]`);
  return sendWebhook(settings, text, sample, fetchImpl, { timeoutMs });
}
