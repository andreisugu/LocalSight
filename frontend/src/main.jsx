import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import './index.css';

// GitHub Pages cannot send COOP/COEP, so ORT's wasm backend would stay single-threaded
// there. `public/coi-serviceworker.js` re-serves same-origin navigations with those two
// headers; this registration is what turns it on. Nothing else in the app changes if it is
// unavailable: dev, unsupported browsers and already-isolated hosts skip it entirely.
const COI_RELOAD_KEY = 'localsight.coi.reload';

function registerIsolationWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  if (window.crossOriginIsolated) return;

  // The first load is not isolated yet: the worker can only add headers to a document it
  // controls. Once it claims this page, reload exactly once so the document is re-fetched
  // isolated. The sessionStorage guard makes that "once per tab, ever": a worker that fails
  // to isolate can cost one reload, never a loop.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (sessionStorage.getItem(COI_RELOAD_KEY)) return;
      sessionStorage.setItem(COI_RELOAD_KEY, '1');
    } catch {
      // No sessionStorage means no guard, and no guard means no reload.
      return;
    }
    window.location.reload();
  });

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}coi-serviceworker.js`, { scope: import.meta.env.BASE_URL })
    .catch((error) => {
      // Isolation is an optimization: without it the engine still runs, just on one thread.
      console.warn('[coi] service worker registration failed:', error.message);
    });
}

registerIsolationWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
