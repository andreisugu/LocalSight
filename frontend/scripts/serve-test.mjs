#!/usr/bin/env node
/**
 * Dependency-free static server for `dist/`, for the local test loop.
 *
 * Why it exists: every Playwright run used to start its own server *and* rebuild first, so
 * a two-second spec change paid a fresh `vite build`. This server is meant to be started
 * once, print its URL, and stay up while you re-run a suite against it:
 *
 *   npm run e2e:serve                 # or: node scripts/serve-test.mjs --base /LocalSight/
 *   PW_BASE_URL=http://127.0.0.1:53941/LocalSight/ npm run e2e:pages
 *
 * It serves the same artifact `vite preview` and GitHub Pages serve, with the three
 * properties the e2e suites depend on:
 *
 *   1. an optional mount prefix (`--base /LocalSight/`), with `/` and the prefix without a
 *      trailing slash redirecting into it, exactly like Pages;
 *   2. an unknown path answers with the app shell. At the root mount that is a 200, the
 *      way `vite preview` behaves — Chromium logs a 404 document as a console error and
 *      the smoke suite forbids console errors. Under a prefix it is `404.html` with status
 *      404, the way Pages behaves — a deep link boots, but the response is not a 200 that
 *      nobody meant. The status is part of the shape each suite measures;
 *   3. no COOP/COEP headers by default, so `crossOriginIsolated` can only become true
 *      through public/coi-serviceworker.js. That is the production condition and the thing
 *      the Pages suite measures. `--coi` opts into the headers for fast UI-only runs.
 *
 * Range requests are supported because the engine suite decodes MP4s. Responses are
 * `no-store`: rebuilding `dist/` under a running server must never be masked by a browser
 * cache and turn a real failure into a green run. Nothing here asserts caching; the
 * service-worker path that production relies on is unaffected.
 *
 * Port 0 (the default) asks the OS for a free port, so parallel agents and worktrees never
 * fight over 4173/4317, and the URL is printed — copy it into `PW_BASE_URL`.
 *
 * Not shipped, not imported by the app: only tests and local runs use it.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const HOST = '127.0.0.1';

const USAGE = `usage: node scripts/serve-test.mjs [options]

  --base <path>   mount prefix, e.g. /LocalSight/ (default /)
  --port <n>      port to listen on; 0 (default) asks the OS for a free one
  --root <dir>    directory to serve (default ../dist)
  --coi           send COOP/COEP (isolated without the service worker; UI-only runs)
  --json          print one JSON line with the URL on stdout, diagnostics on stderr
  --help          this text
`;

function fail(message) {
  console.error(`[serve-test] ${message}`);
  process.exit(1);
}

/** Parse the tiny CLI by hand: no dependency, no flag library, no surprises. */
function parseArgs(argv) {
  const options = { base: '/', port: 0, root: join(FRONTEND, 'dist'), coi: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === '--base') {
      options.base = argv[++i];
    } else if (arg === '--port') {
      options.port = Number(argv[++i]);
    } else if (arg === '--root') {
      options.root = resolve(argv[++i] || '');
    } else if (arg === '--coi') {
      options.coi = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      fail(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  // `/LocalSight`, `/LocalSight/` and `/` all become a prefix without a trailing slash
  // ('' for the root mount), so request matching has exactly one shape.
  const raw = String(options.base || '/');
  if (!raw.startsWith('/')) fail(`--base must start with "/": ${raw}`);
  options.prefix = raw.replace(/\/+$/, '');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    fail(`--port must be 0-65535: ${options.port}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

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

/**
 * The app shell an unknown path answers with. `404.html` is the Pages fallback (verify and
 * CI copy it); a local build that has not been copied yet still gets a shell, not a
 * blank error page.
 */
function shellPath() {
  const fallback = join(options.root, '404.html');
  return existsSync(fallback) ? fallback : join(options.root, 'index.html');
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(req, res, file, status) {
  const stats = statSync(file);
  const headers = {
    'Content-Type': contentType(file),
    // Deliberately not Pages' max-age=600: a rebuild under a running server must show up
    // on the next reload. See the file comment.
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };
  if (options.coi) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
  }

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

if (!existsSync(join(options.root, 'index.html'))) {
  fail(`${join(options.root, 'index.html')} is missing; run \`npm run build\` first.`);
}

// A subpath mount only works when the artifact was built for it; otherwise every asset
// 404s and the page is blank. Say so instead of letting the suite fail cryptically.
if (options.prefix && !readFileSync(join(options.root, 'index.html'), 'utf8').includes(`${options.prefix}/assets/`)) {
  console.error(
    `[serve-test] warning: ${join(options.root, 'index.html')} does not reference ` +
      `${options.prefix}/assets/ — was it built with VITE_BASE=${options.prefix}/ ?`
  );
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }

  const prefix = options.prefix;

  if (!prefix) {
    // Root mount: behave like any static host with an SPA fallback.
    const relative = pathname.replace(/^\/+/, '') || 'index.html';
    const file = resolve(options.root, relative);
    if (file !== options.root && !file.startsWith(`${options.root}${sep}`)) {
      sendText(res, 403, 'forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isFile()) {
      serveFile(req, res, file, 200);
      return;
    }
    // `vite preview` answers an unknown path with 200 + index.html, and the smoke suite
    // asserts a clean console: a 404 document is logged as a console error by Chromium.
    serveFile(req, res, shellPath(), 200);
    return;
  }

  // Mounted under a prefix, like Pages: the root and the slashless prefix redirect into it
  // so the router sees the trailing slash it expects.
  if (pathname === '/') {
    res.writeHead(302, { Location: `${prefix}/` });
    res.end();
    return;
  }
  if (pathname === prefix) {
    res.writeHead(301, { Location: `${prefix}/` });
    res.end();
    return;
  }
  if (!pathname.startsWith(`${prefix}/`)) {
    sendText(res, 404, `not found: this build is served under ${prefix}/`);
    return;
  }

  const relative = pathname.slice(prefix.length + 1) || 'index.html';
  const file = resolve(options.root, relative);
  // No path traversal: every served file must stay inside the root.
  if (file !== options.root && !file.startsWith(`${options.root}${sep}`)) {
    sendText(res, 403, 'forbidden');
    return;
  }

  if (existsSync(file) && statSync(file).isFile()) {
    serveFile(req, res, file, 200);
    return;
  }

  // Pages' SPA fallback: the shell with status 404, so a deep link works and nobody
  // mistakes it for a 200.
  serveFile(req, res, shellPath(), 404);
});

server.listen(options.port, HOST, () => {
  const { port } = server.address();
  const base = options.prefix ? `${options.prefix}/` : '/';
  const url = `http://${HOST}:${port}${base}`;
  if (options.json) {
    // One machine-readable line: verify.mjs reads exactly this.
    process.stdout.write(
      `${JSON.stringify({ url, port, base, root: options.root, coi: options.coi })}\n`
    );
    console.error(`[serve-test] ${url} -> ${options.root}`);
  } else {
    console.log(`[serve-test] ${url} -> ${options.root}${options.coi ? ' (COOP/COEP)' : ''}`);
    if (base !== '/') {
      console.log(`[serve-test] PW_BASE_URL=${url}`);
    }
  }
});

// Playwright and the verify script close the server with SIGTERM; keep-alive sockets from a
// browser would otherwise hold `server.close()` open until they time out.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    // A stuck socket must not turn cleanup into a hang.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
