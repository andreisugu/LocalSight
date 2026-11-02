// Cross-origin isolation on a static host (GitHub Pages), plus a versioned runtime cache.
//
// The COOP/COEP service-worker pattern is inspired by gzuidhof/coi-serviceworker (MIT,
// Copyright (c) 2021 Guido Zuidhof); this implementation is written for LocalSight. The
// MIT notice for the pattern ships in /LICENSES.txt.
//
// ONNX Runtime's wasm backend can only use SharedArrayBuffer — and therefore more than one
// thread — on a document that is `crossOriginIsolated`. That flag needs COOP/COEP response
// headers, and Pages sends none (they cannot be configured per-path). A service worker is
// the only lever left: it re-fetches same-origin requests and rebuilds the responses with
// the headers, which is enough for the document to become isolated.
//
// The same worker now also owns a runtime cache, because venue wifi is the real demo
// condition. The rules are chosen so a cache can never hide a deploy:
//
//   - documents (index.html and every deep link) are network-first. A cached shell is only
//     served when the network itself fails, so a stale HTML can never outlive a deploy.
//   - immutable files are cache-first: content-hashed `/assets/*`, the ONNX models,
//     the demo clips, the stills and the three fixed files (logo, favicon, NOTICE). They
//     are filled on the first successful fetch, so the second visit and the offline visit
//     do not re-download them.
//   - the cache name is the build SHA carried by the registration URL (`?v=<sha>`). Every
//     activation deletes the previous version's caches, so an old bundle cannot survive a
//     deploy and `caches.keys()` stays bounded to one entry.
//   - the worker script itself, cross-origin requests and non-GET requests are never
//     cached or intercepted beyond what isolation needs.
//
// Cached responses keep the COOP/COEP (documents, worker scripts) and CORP (assets)
// headers they were stored with, because a `require-corp` document refuses to start a
// worker whose response carries no COEP even when it comes from the Cache API.

const ISOLATING_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Same-origin only: this worker must never turn the app into a cross-origin embedder.
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// A worker script needs the embedder policy on its own response too: Chromium refuses to
// start a dedicated worker from an isolated document when the script response carries no
// COEP (`blockedReason: coep-frame-resource-needs-coep-header`), even same-origin. The
// engine worker is a module worker, so without this the page isolates and the engine dies.
const WORKER_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// Same-origin resources need no COEP value of their own, but marking them explicitly keeps
// them usable if the app is ever embedded or the document policy changes.
const RESOURCE_HEADERS = {
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const WORKER_DESTINATIONS = new Set(['worker', 'sharedworker', 'serviceworker']);

// The registration URL is `coi-serviceworker.js?v=<VITE_BUILD_SHA>`; a local build
// without a SHA registers `?v=dev`. The path stays the same, so the scope and the update
// mechanism are unchanged — only the cache namespace changes per deploy.
const VERSION = (() => {
  try {
    return new URL(self.location.href).searchParams.get('v') || 'dev';
  } catch {
    return 'dev';
  }
})();

// Prefix keeps the cleanup from deleting caches that belong to other apps on the same
// GitHub Pages origin (`<user>.github.io` is shared by every project).
const CACHE_PREFIX = 'localsight-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

// Keys are resolved against the worker's own URL, which is what makes the cache work under
// the `/LocalSight/` subpath without duplicating the base anywhere.
const SHELL_URL = new URL('index.html', self.location.href).href;
const ASSETS_PREFIX = new URL('assets/', self.location.href).href;
const MODELS_PREFIX = new URL('models/', self.location.href).href;
const MEDIA_PREFIX = new URL('media/', self.location.href).href;
const STILLS_PREFIX = new URL('media/stills/', self.location.href).href;
const FIXED_FILES = new Set(
  ['logo.svg', 'favicon.svg', 'NOTICE', 'LICENSES.txt', 'theme-init.js'].map((name) => new URL(name, self.location.href).href),
);

/** Rebuild a response with extra headers, or hand back the original when that is unsafe. */
function withHeaders(response, extra) {
  // Rebuilding drops opaque responses and cannot express statuses outside 200-599.
  if (response.type === 'opaque' || response.status < 200 || response.status > 599) return response;
  // 204/205/304 have no body; `new Response(body, {status})` throws for them. A 304
  // revalidation keeps the cached document (which already carries the headers when it was
  // fetched isolated), and a 204 never renders a document.
  if (response.status === 204 || response.status === 205 || response.status === 304) return response;
  // Already stamped (a cache hit, or a document served by an isolated host): no need to
  // stream the body through a new Response for nothing.
  const names = Object.keys(extra);
  if (names.every((name) => response.headers.get(name) === extra[name])) return response;
  const headers = new Headers(response.headers);
  names.forEach((name) => headers.set(name, extra[name]));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Headers a cached asset must keep for a `require-corp` document to use it. */
function headersFor(request) {
  return WORKER_DESTINATIONS.has(request.destination) ? WORKER_HEADERS : RESOURCE_HEADERS;
}

/**
 * True for files whose URL changes whenever their content changes. Everything else
 * (`coi-serviceworker.js`, the HTML, `404.html`) is deliberately excluded.
 */
function isImmutableAsset(url) {
  if (url.href.startsWith(ASSETS_PREFIX)) return true;
  if (url.href.startsWith(MODELS_PREFIX) && url.pathname.endsWith('.onnx')) return true;
  if (url.href.startsWith(STILLS_PREFIX)) return true;
  if (url.href.startsWith(MEDIA_PREFIX) && url.pathname.endsWith('.mp4')) return true;
  return FIXED_FILES.has(url.href);
}

/** A minimal offline answer for a navigation that has no cached shell yet. */
function offlineResponse() {
  const body =
    '<!doctype html><meta charset="utf-8"><title>LocalSight offline</title>' +
    '<body style="font-family:system-ui;padding:2rem">' +
    '<h1>LocalSight is offline</h1>' +
    '<p>Această pagină nu a fost încărcată în cache. Reconectează-te și reîncarcă o dată; ' +
    'după prima vizită aplicația pornește și fără rețea.</p>';
  return new Response(body, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...ISOLATING_HEADERS,
    },
  });
}

/**
 * Open the current cache for writing, or return `null` when this worker has already been
 * replaced. A superseded worker must not recreate the cache its successor just deleted:
 * without this guard an in-flight handler could resurrect the old version's cache a moment
 * after activation and leave two caches on the origin forever.
 * @returns {Promise<Cache|null>}
 */
async function writableCache() {
  const active = self.registration?.active;
  if (active && active.scriptURL !== self.location.href) return null;
  return caches.open(CACHE_NAME);
}

/**
 * Network-first document handler. The HTML is used exactly as served (with the isolation
 * headers added); the last successful shell is kept only as the offline fallback.
 */
async function handleDocument(event) {
  const request = event.request;
  try {
    // `no-cache` revalidates with the host instead of trusting its max-age, so a fresh
    // deploy shows up on the next load rather than up to ten minutes later.
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.status === 200 && response.type === 'basic') {
      // Best effort: a cache write must never fail the page itself.
      try {
        const cache = await writableCache();
        if (cache) await cache.put(SHELL_URL, withHeaders(response.clone(), ISOLATING_HEADERS));
      } catch (error) {
        console.warn('[coi] could not cache the app shell:', error.message);
      }
    }
    return withHeaders(response, ISOLATING_HEADERS);
  } catch {
    try {
      // `caches.match` never creates a cache, so a replaced worker cannot revive one.
      const cached = await caches.match(SHELL_URL, { ignoreVary: true });
      if (cached) return withHeaders(cached, ISOLATING_HEADERS);
    } catch (cacheError) {
      console.warn('[coi] could not read the cached app shell:', cacheError.message);
    }
    return offlineResponse();
  }
}

/**
 * Cache-first handler for immutable files. On a miss the response is fetched and stored,
 * then served. Range requests (a `<video>` asks for `bytes=0-`) are fetched in full so the
 * cache always holds the whole file; the browser accepts a 200 answer to a Range request.
 */
async function handleImmutable(event) {
  const request = event.request;
  const headers = headersFor(request);
  try {
    // Read-only lookup: `caches.match` searches every cache without creating one, which
    // matters for a worker that has just been replaced by a newer version.
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return withHeaders(cached, headers);
  } catch {
    // A cache miss/read failure just means "go to the network".
  }

  const networkRequest = request.headers.has('range')
    ? new Request(request.url, { method: 'GET', mode: 'same-origin', credentials: 'same-origin' })
    : request;
  const response = await fetch(networkRequest);

  // Only complete, same-origin 200s are stored: a 206 would cache a fragment and a 404
  // (a deploy that no longer ships the file) must not stick.
  if (response.status === 200 && response.type === 'basic') {
    try {
      const cache = await writableCache();
      if (cache) await cache.put(new Request(request.url), withHeaders(response.clone(), headers));
    } catch (error) {
      console.warn('[coi] could not cache an asset:', error.message);
    }
  }
  return withHeaders(response, headers);
}

/**
 * Cache the shell's own hashed assets (JS/CSS) as soon as a version activates. Without
 * this, the load that discovered a deploy is served by the *previous* worker: its assets
 * land in the old cache, which activation deletes, and an offline reload after the deploy
 * would have the shell but no script. Only same-origin `/assets/` references are touched.
 * @param {Cache} cache
 * @param {string} html
 */
async function seedShellAssets(cache, html) {
  const assetsPath = new URL('assets/', self.location.href).pathname;
  const references = new Set();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    let resolved;
    try {
      resolved = new URL(match[1].split('#')[0], self.location.href);
    } catch {
      continue;
    }
    if (resolved.origin !== self.location.origin) continue;
    if (!resolved.pathname.startsWith(assetsPath)) continue;
    references.add(resolved.href);
  }
  await Promise.all(
    [...references].map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url, { cache: 'no-cache' });
        if (response.status === 200 && response.type === 'basic') {
          await cache.put(url, withHeaders(response, RESOURCE_HEADERS));
        }
      } catch (error) {
        console.warn('[coi] could not pre-cache a shell asset:', url, error.message);
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  // A waiting worker would leave the first load un-isolated until every tab is closed.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Take over pages that were already open under the previous worker.
      await self.clients.claim();
      // Seed the offline shell and the bundle it points at for *this* version. The deploy
      // navigation is handled by the previous worker, so without this an activate that
      // deletes the old cache would leave the new one empty until some later navigation.
      // This is a fallback copy, not a freshness cache: navigations are still network-first
      // and overwrite it.
      try {
        const response = await fetch(SHELL_URL, { cache: 'no-cache' });
        if (response.status === 200 && response.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(SHELL_URL, withHeaders(response.clone(), ISOLATING_HEADERS));
          await seedShellAssets(cache, await response.text());
        }
      } catch (error) {
        console.warn('[coi] could not seed the app shell:', error.message);
      }
      // Remove every cache from an older build, so exactly one versioned cache remains.
      // This runs after the seed attempt: a deploy that cannot be seeded still leaves a
      // single (possibly empty) cache, never an unbounded set.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Non-GET traffic (and the odd POST a future integration adds) is never cached.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Only our own origin is touched; cross-origin requests go straight to the network.
  if (url.origin !== self.location.origin) return;
  // Never intercept the worker script itself: caching it would make an update unreachable.
  if (url.pathname.endsWith('/coi-serviceworker.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleDocument(event));
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith(
      handleImmutable(event).catch(() => {
        // Offline with no cached copy: behave exactly like a failed fetch.
        return Response.error();
      }),
    );
  }
  // Everything else (worker scripts outside /assets, manifests, unknown paths) keeps the
  // previous behaviour: plain network fetch with the headers the isolation checks need.
  if (WORKER_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      fetch(request).then((response) => withHeaders(response, WORKER_HEADERS)),
    );
  }
});
