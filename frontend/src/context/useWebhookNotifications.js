// The opt-in notifier: real engine incidents -> the optional webhook relay.
//
// What this hook is honest about, because the app has no backend:
//
// - It only ever considers events the in-tab engine produced (`event.local === true`). The
//   eight demo fixtures are demo data and must never be pushed to a real channel.
// - It runs while the tab is open. There is no service worker, no background sync and no
//   server queue: closing the tab stops notifications, and a hidden tab may be throttled by
//   the browser. The Settings panel says the same thing in the same words.
// - It is best effort. Each incident is attempted once with up to three retries (2 s, 5 s,
//   10 s). A failed incident is not retried again on the next render, so a dead relay cannot
//   turn into an infinite loop; a reload starts a new attempt.
// - Delivered ids live in localStorage (`localsight.webhook.sent`, capped at 200), so a
//   reload does not resend yesterday's incidents.
//
// The pure pieces (`readSentIds`, `rememberSentId`, `queueableIncidents`, `deliverWithRetry`)
// live in this module so `node --test` pins them without React; the hook itself is only the
// wiring. Messages are text; nothing here reads a snapshot or an image.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildIncidentMessage,
  normalizeWebhookSettings,
  sendTestWebhook,
  sendWebhook,
  WEBHOOK_SENT_KEY,
} from '../utils/webhook.js';

/** Newest delivered ids kept; the oldest is dropped first. */
export const WEBHOOK_SENT_LIMIT = 200;

/** Backoff after a failed attempt. One initial try plus one wait per entry. */
export const WEBHOOK_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 10000]);

/** The status the Settings panel renders. `off` is a configuration state, not an error. */
export const WEBHOOK_STATUS = Object.freeze({
  OFF: 'off',
  IDLE: 'idle',
  SENDING: 'sending',
  SENT: 'sent',
  ERROR: 'error',
});

const SENT_MAX_CHARS = 16 * 1024;

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * Read the delivered ids, newest last. A missing, corrupt or oversized value reads as an
 * empty list; duplicates are collapsed and the list is capped at `WEBHOOK_SENT_LIMIT`.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {string[]}
 */
export function readSentIds(storage = defaultStorage()) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  let raw;
  try {
    raw = storage.getItem(WEBHOOK_SENT_KEY);
  } catch {
    return [];
  }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > SENT_MAX_CHARS) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of parsed) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.slice(-WEBHOOK_SENT_LIMIT);
}

/**
 * Append one id, keeping the newest `WEBHOOK_SENT_LIMIT` and never duplicating. Pure: the
 * caller decides when to persist the result.
 *
 * @param {Iterable<string>} ids
 * @param {unknown} eventId
 * @returns {string[]}
 */
export function rememberSentId(ids, eventId) {
  const next = [];
  const seen = new Set();
  for (const value of ids || []) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  const id = typeof eventId === 'string' ? eventId.trim() : '';
  if (id && !seen.has(id)) next.push(id);
  return next.slice(-WEBHOOK_SENT_LIMIT);
}

/**
 * @param {Iterable<string>} ids
 * @param {{setItem(key: string, value: string): void}|null|undefined} [storage]
 * @returns {string[]} the list that was written, capped.
 */
export function storeSentIds(ids, storage = defaultStorage()) {
  const next = rememberSentId(ids, '');
  try {
    storage?.setItem(WEBHOOK_SENT_KEY, JSON.stringify(next));
  } catch {
    // The list still applies to this tab; only persistence is lost.
  }
  return next;
}

/**
 * The incidents this run may send: real engine events only, not fixtures, not already
 * delivered, not already attempted and not part of the backlog that existed when the
 * operator opted in.
 *
 * @param {Array<object>|null|undefined} events
 * @param {{sent?: Iterable<string>, attempted?: Iterable<string>, baseline?: Iterable<string>}} [known]
 * @returns {Array<object>}
 */
export function queueableIncidents(events, { sent = [], attempted = [], baseline = [] } = {}) {
  const sentIds = new Set(sent);
  const attemptedIds = new Set(attempted);
  const baselineIds = new Set(baseline);
  if (!Array.isArray(events)) return [];
  return events.filter((event) => {
    if (!event || typeof event !== 'object') return false;
    if (event.local !== true) return false;
    if (typeof event.event_id !== 'string' || !event.event_id) return false;
    if (baselineIds.has(event.event_id)) return false;
    return !sentIds.has(event.event_id) && !attemptedIds.has(event.event_id);
  });
}

/** Default wait used between retries; injectable so tests do not sleep. */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send one message, retrying a bounded number of times. Pure enough to test: the transport,
 * the wait and the status sink are injected.
 *
 * @param {unknown} settings
 * @param {string} text
 * @param {object} incident
 * @param {{
 *   send?: typeof sendWebhook,
 *   sleep?: (ms: number) => Promise<void>,
 *   onStatus?: (status: object) => void,
 *   isCancelled?: () => boolean,
 * }} [options]
 * @returns {Promise<{ok: boolean, status: number, error: string}>}
 */
export async function deliverWithRetry(settings, text, incident, {
  send = sendWebhook,
  sleep = wait,
  onStatus,
  isCancelled = () => false,
} = {}) {
  let result = { ok: false, status: 0, error: 'cancelled' };
  for (let attempt = 0; attempt <= WEBHOOK_RETRY_DELAYS_MS.length; attempt += 1) {
    if (isCancelled()) return result;
    const message = attempt === 0
      ? 'Se trimite…'
      : `Reîncercare ${attempt}/${WEBHOOK_RETRY_DELAYS_MS.length}…`;
    onStatus?.({ state: WEBHOOK_STATUS.SENDING, at: Date.now(), message });
    result = await send(settings, text, incident);
    if (result.ok) return result;
    if (attempt === WEBHOOK_RETRY_DELAYS_MS.length) return result;
    // Turning the feature off mid-retry must stop the loop before it sleeps again.
    if (isCancelled()) return { ok: false, status: 0, error: 'cancelled' };
    await sleep(WEBHOOK_RETRY_DELAYS_MS[attempt]);
  }
  return result;
}

/**
 * The notifier. Mounted once by `SecurityProvider`, after the incident store.
 *
 * @param {{
 *   events?: Array<object>,
 *   settings?: unknown,
 *   appUrl?: string,
 *   onStatus?: (status: object) => void,
 * }} [options]
 * @returns {{
 *   status: {state: string, at: number|null, message: string},
 *   sendTest: () => Promise<{ok: boolean, status: number, error: string}>,
 * }}
 */
export default function useWebhookNotifications({ events = [], settings, appUrl = '', onStatus } = {}) {
  const [status, setStatus] = useState({ state: WEBHOOK_STATUS.IDLE, at: null, message: '' });

  const sentRef = useRef(null);
  if (sentRef.current === null) sentRef.current = new Set(readSentIds());
  // A failed incident is remembered for this session only: it is not retried on every new
  // event, but a reload (a human decision to try again) may.
  const attemptedRef = useRef(new Set());
  const queuedRef = useRef(new Set());
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  // The incidents that already existed when the operator opted in. They are not "new", so
  // enabling notifications mid-shift must not push the whole visible backlog.
  const baselineRef = useRef(new Set());
  const wasEnabledRef = useRef(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const appUrlRef = useRef(appUrl);
  appUrlRef.current = appUrl;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const report = useCallback((state, message = '') => {
    const next = { state, at: Date.now(), message };
    setStatus(next);
    onStatusRef.current?.(next);
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const current = normalizeWebhookSettings(settingsRef.current);
        if (!current.enabled || !current.relayUrl) {
          queueRef.current = [];
          queuedRef.current.clear();
          break;
        }
        const eventId = queueRef.current.shift();
        queuedRef.current.delete(eventId);
        attemptedRef.current.add(eventId);
        const event = eventsRef.current.find((item) => item?.event_id === eventId);
        if (!event) continue;

        const text = buildIncidentMessage(event, { appUrl: appUrlRef.current });
        const result = await deliverWithRetry(current, text, event, {
          onStatus: report,
          isCancelled: () => !normalizeWebhookSettings(settingsRef.current).enabled,
        });
        if (result.ok) {
          const next = rememberSentId([...sentRef.current], eventId);
          sentRef.current = new Set(next);
          storeSentIds(next);
          report(WEBHOOK_STATUS.SENT, 'Incident trimis.');
        } else if (result.error !== 'cancelled') {
          report(WEBHOOK_STATUS.ERROR, result.error || 'Trimiterea a eșuat.');
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [report]);

  // A disabled configuration clears everything: no queue, no retry, status `off`. Turning it
  // back on baselines the list as it is then, so only later incidents are sent.
  useEffect(() => {
    const current = normalizeWebhookSettings(settings);
    if (!current.enabled) {
      wasEnabledRef.current = false;
      baselineRef.current = new Set();
      queueRef.current = [];
      queuedRef.current.clear();
      if (status.state !== WEBHOOK_STATUS.OFF) report(WEBHOOK_STATUS.OFF, '');
      return;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      baselineRef.current = new Set(
        eventsRef.current
          .filter((event) => event?.local === true && typeof event.event_id === 'string')
          .map((event) => event.event_id)
      );
    }
    if (status.state === WEBHOOK_STATUS.OFF) report(WEBHOOK_STATUS.IDLE, '');
  }, [settings, report, status.state]);

  // Only new real incidents are queued. Events already queued, sent, attempted or present at
  // opt-in are skipped, so the effect can run on every render without duplicating a send.
  useEffect(() => {
    if (!normalizeWebhookSettings(settings).enabled) return;
    const fresh = queueableIncidents(events, {
      sent: sentRef.current,
      attempted: [...attemptedRef.current, ...queuedRef.current],
      baseline: baselineRef.current,
    });
    if (fresh.length === 0) return;
    for (const event of fresh) {
      queueRef.current.push(event.event_id);
      queuedRef.current.add(event.event_id);
    }
    void pump();
  }, [events, settings, pump]);

  const sendTest = useCallback(async () => {
    const current = normalizeWebhookSettings(settingsRef.current);
    if (!current.enabled) {
      report(WEBHOOK_STATUS.OFF, 'Notificările sunt oprite.');
      return { ok: false, status: 0, error: 'disabled' };
    }
    if (!current.relayUrl) {
      report(WEBHOOK_STATUS.ERROR, 'Lipsește URL-ul releului.');
      return { ok: false, status: 0, error: 'no-relay' };
    }
    report(WEBHOOK_STATUS.SENDING, 'Se trimite mesajul de test…');
    const result = await sendTestWebhook(current, { appUrl: appUrlRef.current });
    if (result.ok) report(WEBHOOK_STATUS.SENT, 'Mesaj de test trimis.');
    else report(WEBHOOK_STATUS.ERROR, result.error || 'Trimiterea a eșuat.');
    return result;
  }, [report]);

  return { status, sendTest };
}
