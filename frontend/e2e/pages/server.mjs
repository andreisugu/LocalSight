#!/usr/bin/env node
/**
 * A GitHub Pages stand-in for the Pages-shape e2e run.
 *
 * `vite preview` understands the base path, but it is still a dev server: it answers
 * unknown paths with 200 + index.html and it is not what Pages does. This server mirrors
 * the three properties the deployed app actually depends on:
 *
 *   1. the artifact lives under /LocalSight/, and `/LocalSight` redirects to the slash;
 *   2. an unknown path returns 404.html (the app shell) with status 404, exactly like
 *      Pages' SPA fallback — a deep link works, but the HTTP status is still 404;
 *   3. no COOP/COEP headers are sent, so `crossOriginIsolated` can only become true
 *      through public/coi-serviceworker.js. That is the production condition, and the
 *      whole point of running this suite.
 *
 * It also serves Range requests, because the engine test decodes a real MP4.
 *
 * Not shipped, not imported by the app: only playwright.pages.config.js starts it.
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../dist');
const PREFIX = '/LocalSight';
const HOST = '127.0.0.1';
const PORT = Number(process.env.PW_PAGES_PORT) || 4317;

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.onnx', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function contentType(file) {
  // NOTICE has no extension on purpose (it is a file in public/, copied verbatim).
  if (file.endsWith(`${sep}NOTICE`)) return 'text/plain; charset=utf-8';
  return CONTENT_TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream';
}

/** Copy index.html to 404.html once, mirroring the `cp` step in pages.yml. */
function writeFallback() {
  const index = join(DIST, 'index.html');
  if (!existsSync(index)) {
    console.error(`[pages-server] ${index} is missing; run the build first.`);
    process.exit(1);
  }
  const html = readFileSync(index);
  const fallback = join(DIST, '404.html');
  if (!existsSync(fallback) || !readFileSync(fallback).equals(html)) {
    writeFileSync(fallback, html);
  }
}

function sendText(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

function serveFile(req, res, file, status) {
  const stats = statSync(file);
  // Pages sends max-age=600 for every file; keeping that here means the browser caches
  // the shell exactly like it will in production.
  const headers = {
    'Content-Type': contentType(file),
    'Cache-Control': 'max-age=600',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };

  const range = req.headers.range;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const last = match[2] ? Number(match[2]) : stats.size - 1;
    const end = Math.min(last, stats.size - 1);
    if (start <= end && start < stats.size) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(status, { ...headers, 'Content-Length': stats.size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

writeFallback();

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }

  // Pages redirects the repo root without a slash; the router needs the trailing slash.
  if (pathname === '/') {
    res.writeHead(302, { Location: `${PREFIX}/` });
    res.end();
    return;
  }
  if (pathname === PREFIX) {
    res.writeHead(301, { Location: `${PREFIX}/` });
    res.end();
    return;
  }
  if (!pathname.startsWith(`${PREFIX}/`)) {
    sendText(res, 404, `not found: the artifact is served under ${PREFIX}/`);
    return;
  }

  const relative = pathname.slice(PREFIX.length + 1) || 'index.html';
  const file = resolve(DIST, relative);
  // No path traversal: every served file must stay inside dist/.
  if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) {
    sendText(res, 403, 'forbidden');
    return;
  }

  if (existsSync(file) && statSync(file).isFile()) {
    serveFile(req, res, file, 200);
    return;
  }

  // Pages' SPA fallback: the app shell with status 404. Deep links render, but nobody
  // should mistake the response for a 200.
  serveFile(req, res, join(DIST, '404.html'), 404);
});

server.listen(PORT, HOST, () => {
  console.log(`[pages-server] ${HOST}:${PORT}${PREFIX}/ -> ${DIST}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
