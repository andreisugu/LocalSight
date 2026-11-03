#!/usr/bin/env node
// Optional, self-hosted relay for LocalSight webhook notifications.
//
// LocalSight is a static app: it can neither keep provider secrets nor reliably post to
// Slack/Discord/Telegram from the browser (CORS, and a webhook URL in the bundle is public
// the moment it ships). This relay is the small piece that is allowed to hold the secret:
// the app posts one JSON payload here, the relay formats it per provider and calls the
// provider from Node.
//
// Nothing but text goes out. The payload carries the incident's identifiers and the message
// the app already rendered; no snapshot, no blob, no face, no image.
//
// This file is not part of the static build and has no dependencies beyond Node 20.
//
//   node scripts/webhook-relay.mjs
//
//   PORT=8787 HOST=127.0.0.1 \
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
//   NTFY_TOPIC=localsight-demo \
//   RELAY_TOKEN=$(openssl rand -hex 16) \
//   ALLOW_ORIGIN=https://example.github.io \
//   node scripts/webhook-relay.mjs
//
// Endpoints:
//   GET  /health -> {ok:true, channels:[...]}          no secrets
//   POST /notify -> 202 {ok:true, channel}              X-Relay-Token when RELAY_TOKEN is set
//                   400 / 401 / 413 / 502 / 503 {error:"short-code"}

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_NTFY_URL = 'https://ntfy.sh';
const MAX_BODY_BYTES = 64 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;
// Discord rejects content over 2 000 characters; the others are more generous. The relay
// clips to the tightest limit that still carries the whole message for the demo incident.
const DISCORD_TEXT_LIMIT = 1900;

/** The channels the relay understands; the order is also what `/health` prints. */
export const CHANNELS = Object.freeze(['slack', 'discord', 'telegram', 'ntfy']);

/**
 * Read one environment variable as trimmed text. A missing variable is `''`, never the
 * string "undefined", so a provider configured with an empty value stays unconfigured.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} source
 * @param {string} name
 * @returns {string}
 */
function readEnv(source, name) {
  const value = source[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Everything the relay needs, read once at startup. Secrets stay in this object and are
 * never included in a response or a log line.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [source]
 * @returns {{
 *   port: number, host: string, allowOrigin: string, relayToken: string,
 *   slackWebhookUrl: string, discordWebhookUrl: string,
 *   telegramBotToken: string, telegramChatId: string,
 *   ntfyUrl: string, ntfyTopic: string,
 * }}
 */
export function readConfig(source = process.env) {
  const port = Number(readEnv(source, 'PORT'));
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    host: readEnv(source, 'HOST') || DEFAULT_HOST,
    allowOrigin: readEnv(source, 'ALLOW_ORIGIN') || '*',
    relayToken: readEnv(source, 'RELAY_TOKEN'),
    slackWebhookUrl: readEnv(source, 'SLACK_WEBHOOK_URL'),
    discordWebhookUrl: readEnv(source, 'DISCORD_WEBHOOK_URL'),
    telegramBotToken: readEnv(source, 'TELEGRAM_BOT_TOKEN'),
    telegramChatId: readEnv(source, 'TELEGRAM_CHAT_ID'),
    ntfyUrl: (readEnv(source, 'NTFY_URL') || DEFAULT_NTFY_URL).replace(/\/+$/, ''),
    ntfyTopic: readEnv(source, 'NTFY_TOPIC'),
  };
}

/**
 * Which channels have everything they need. Values are never included.
 *
 * @param {ReturnType<typeof readConfig>} config
 * @returns {string[]}
 */
export function configuredChannels(config) {
  return CHANNELS.filter((channel) => {
    if (channel === 'slack') return Boolean(config.slackWebhookUrl);
    if (channel === 'discord') return Boolean(config.discordWebhookUrl);
    if (channel === 'telegram') return Boolean(config.telegramBotToken && config.telegramChatId);
    return Boolean(config.ntfyTopic);
  });
}

/**
 * Compare the configured token with the one the app sent in constant time. An empty
 * configuration means "no token required"; a missing header then still passes.
 *
 * @param {string} expected
 * @param {string|undefined} provided
 * @returns {boolean}
 */
function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** CORS headers for every response, including the preflight. `*` is the documented default. */
function corsHeaders(config) {
  return {
    'Access-Control-Allow-Origin': config.allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * Send one JSON response. Short error codes only: a provider body can echo the token in a
 * URL, so it is never forwarded.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {object} body
 * @param {ReturnType<typeof readConfig>} config
 */
function sendJson(response, status, body, config) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...corsHeaders(config),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

/**
 * Read and parse the request body with a hard size cap. Once the cap is crossed the rest of
 * the body is discarded (never buffered) and the handler can answer 413 while the client is
 * still uploading; dropping the socket instead would leave the caller without a JSON error.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (message, code) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error(message), { code }));
    };
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep consuming so the client can read the 413, but never keep the bytes.
        chunks.length = 0;
        fail('payload-too-large', 'payload-too-large');
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid-json'), { code: 'invalid-json' }));
      }
    });
    request.on('error', () => fail('request-error', 'request-error'));
  });
}

/** Truncate text to a provider limit without cutting the marker in half. */
function clip(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Build the provider call. The Telegram URL contains the bot token, so this result must
 * never be logged or returned.
 *
 * @param {string} channel
 * @param {string} text
 * @param {{severity?: unknown}} incident
 * @param {ReturnType<typeof readConfig>} config
 * @returns {{url: string, init: {method: string, headers: Record<string,string>, body: string}}}
 */
export function buildProviderRequest(channel, text, incident, config) {
  if (channel === 'slack') {
    return {
      url: config.slackWebhookUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clip(text, 39_000) }),
      },
    };
  }

  if (channel === 'discord') {
    return {
      url: config.discordWebhookUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: clip(text, DISCORD_TEXT_LIMIT) }),
      },
    };
  }

  if (channel === 'telegram') {
    const form = new URLSearchParams({
      chat_id: config.telegramChatId,
      text: clip(text, 4_000),
    });
    return {
      url: `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
    };
  }

  const severity = typeof incident?.severity === 'string' ? incident.severity.toUpperCase() : '';
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: 'LocalSight',
    Tags: 'warning',
  };
  // ntfy treats the priority as a normal header; only a real incident raises it.
  if (severity === 'CRITICAL' || severity === 'WARNING') headers.Priority = 'high';
  return {
    url: `${config.ntfyUrl}/${encodeURIComponent(config.ntfyTopic)}`,
    init: { method: 'POST', headers, body: text },
  };
}

/**
 * `POST /notify`.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {ReturnType<typeof readConfig>} config
 */
async function handleNotify(request, response, config) {
  const header = request.headers['x-relay-token'];
  if (!tokenMatches(config.relayToken, Array.isArray(header) ? header[0] : header)) {
    sendJson(response, 401, { error: 'unauthorized' }, config);
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const code = error?.code === 'payload-too-large' ? 413 : 400;
    sendJson(response, code, { error: error?.code || 'invalid-json' }, config);
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { error: 'invalid-payload' }, config);
    return;
  }

  const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() : '';
  if (!CHANNELS.includes(channel)) {
    sendJson(response, 400, { error: 'unknown-channel' }, config);
    return;
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    sendJson(response, 400, { error: 'empty-text' }, config);
    return;
  }

  if (!configuredChannels(config).includes(channel)) {
    sendJson(response, 503, { error: 'channel-not-configured' }, config);
    return;
  }

  const incident = body.incident && typeof body.incident === 'object' && !Array.isArray(body.incident)
    ? body.incident
    : {};

  let providerResponse;
  try {
    const { url, init } = buildProviderRequest(channel, text, incident, config);
    providerResponse = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    // Never surface the provider error: the Telegram URL carries the bot token.
    sendJson(response, 502, { error: 'provider-unreachable' }, config);
    return;
  }

  if (!providerResponse.ok) {
    sendJson(response, 502, { error: 'provider-rejected' }, config);
    return;
  }

  // Drain the provider body so the socket can be reused.
  try {
    await providerResponse.arrayBuffer();
  } catch {
    // The delivery already succeeded; a failed drain changes nothing.
  }

  sendJson(response, 202, { ok: true, channel }, config);
}

/**
 * Build the HTTP server. Exported so the relay can be exercised without spawning the CLI.
 *
 * @param {ReturnType<typeof readConfig>} config
 * @returns {import('node:http').Server}
 */
export function createRelayServer(config) {
  return createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || config.host}`);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(config));
      response.end();
      return;
    }

    if (url.pathname === '/health') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method-not-allowed' }, config);
        return;
      }
      sendJson(response, 200, { ok: true, channels: configuredChannels(config) }, config);
      return;
    }

    if (url.pathname === '/notify') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method-not-allowed' }, config);
        return;
      }
      handleNotify(request, response, config).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'relay-error' }, config);
        else response.end();
      });
      return;
    }

    sendJson(response, 404, { error: 'not-found' }, config);
  });
}

/**
 * Start the relay and print what is configured — never the values.
 *
 * @param {ReturnType<typeof readConfig>} [config]
 * @returns {import('node:http').Server}
 */
export function startRelay(config = readConfig()) {
  const channels = configuredChannels(config);
  const server = createRelayServer(config);
  server.listen(config.port, config.host, () => {
    const shownHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
    const tokenState = config.relayToken
      ? 'X-Relay-Token required'
      : 'no RELAY_TOKEN: anyone who can reach this port may post';
    console.log(
      `[webhook-relay] listening on http://${shownHost}:${config.port} · channels: ${
        channels.length > 0 ? channels.join(', ') : 'none configured'
      }`
    );
    console.log(`[webhook-relay] health GET /health · notify POST /notify · ${tokenState}`);
    if (channels.length === 0) {
      console.log('[webhook-relay] no provider env set: /notify answers 503 until one is configured');
    }
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

// Run only when this file is the entry point, so importing it never binds a port.
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry && import.meta.url === entry) {
  startRelay();
}
