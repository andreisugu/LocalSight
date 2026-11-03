import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import './index.css'; // Tailwind layers, base typography and the print rules.

// The static host cannot send COOP/COEP, and those two headers are what make ONNX Runtime's
// wasm backend multi-threaded. `public/coi-serviceworker.js` re-serves same-origin
// navigations with both headers, so registering it is what switches that path on. Every
// other situation (dev server, a browser without service workers, a host that already
// isolates) simply skips it and the app is unchanged.
const RELOAD_FLAG = 'localsight.coi.reload';
const CACHE_NAMESPACE = String(import.meta.env.VITE_BUILD_SHA || 'dev');

/**
 * The worker's `?v=` query is its cache namespace: a deploy with a new SHA activates a new
 * worker, which drops the previous cache instead of quietly serving the old bundle. A local
 * build has no SHA and registers `v=dev`; hashed asset names still fetch the new files.
 */
function isolationWorkerUrl() {
  const version = encodeURIComponent(CACHE_NAMESPACE);
  return `${import.meta.env.BASE_URL}coi-serviceworker.js?v=${version}`;
}

function installIsolationWorker() {
  const supported = 'serviceWorker' in navigator;
  if (!supported || !import.meta.env.PROD) return;

  // A host that already sends COOP/COEP itself (dev server, a real origin) needs no worker.
  // An isolated document *controlled by this worker* must still register, though: returning
  // visitors on Pages are isolated precisely because the worker runs, and skipping
  // registration there would pin them to the worker (and cache) they first received.
  if (window.crossOriginIsolated && !navigator.serviceWorker.controller) return;

  // The first load is not isolated yet: the worker can only add headers to a document it
  // controls. Once it claims this page, reload exactly once so the document is re-fetched
  // isolated. The sessionStorage guard makes that "once per tab, ever": a worker that fails
  // to isolate can cost one reload, never a loop.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
      // No sessionStorage means no guard, and no guard means no reload.
      return;
    }
    window.location.reload();
  });

  navigator.serviceWorker
    .register(isolationWorkerUrl(), { scope: import.meta.env.BASE_URL })
    .catch((error) => {
      // Isolation is an optimisation: without it the engine still runs, just on one thread.
      console.warn('[coi] service worker registration failed:', error.message);
    });
}

/** The document shell: strict mode, the error boundary, then the application itself. */
const applicationTree = <StrictMode><ErrorBoundary><AppRoot /></ErrorBoundary></StrictMode>;

function mountApplication() {
  const host = document.getElementById('root');
  if (!host) throw new Error('LocalSight: the #root mount node is missing from the shell.');
  createRoot(host).render(applicationTree);
}

installIsolationWorker();
mountApplication();
