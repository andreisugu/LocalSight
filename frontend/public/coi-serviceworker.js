// Cross-origin isolation on a static host (GitHub Pages).
//
// ONNX Runtime's wasm backend can only use SharedArrayBuffer — and therefore more than one
// thread — on a document that is `crossOriginIsolated`. That flag needs COOP/COEP response
// headers, and Pages sends none (they cannot be configured per-path). A service worker is
// the only lever left: it re-fetches same-origin requests and rebuilds the responses with
// the headers, which is enough for the document to become isolated.
//
// This worker caches nothing on purpose. A cached shell behind a service worker is the
// worst failure mode for a demo: the next deploy would be invisible, and a stale bundle
// would outlive the files it points at. Every request still goes to the network.

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

const WORKER_DESTINATIONS = new Set(['worker', 'sharedworker', 'serviceworker']);

/** Rebuild a response with extra headers, or hand back the original when that is unsafe. */
function withHeaders(response, extra) {
  // Rebuilding drops opaque responses and cannot express statuses outside 200-599.
  if (response.type === 'opaque' || response.status < 200 || response.status > 599) return response;
  // 204/205/304 have no body; `new Response(body, {status})` throws for them. A 304
  // revalidation keeps the cached document (which already carries the headers when it was
  // fetched isolated), and a 204 never renders a document.
  if (response.status === 204 || response.status === 205 || response.status === 304) return response;
  const headers = new Headers(response.headers);
  Object.keys(extra).forEach((name) => headers.set(name, extra[name]));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', () => {
  // A waiting worker would leave the first load un-isolated until every tab is closed.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Only our own origin is touched, and only the two request kinds that the isolation
  // checks apply to: documents and worker scripts. Every asset is left exactly as served.
  if (url.origin !== self.location.origin) return;
  const isDocument = request.mode === 'navigate';
  const isWorkerScript = WORKER_DESTINATIONS.has(request.destination);
  if (!isDocument && !isWorkerScript) return;

  event.respondWith(
    fetch(request).then((response) => withHeaders(response, isDocument ? ISOLATING_HEADERS : WORKER_HEADERS)),
  );
});
