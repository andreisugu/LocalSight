import reactPlugin from '@vitejs/plugin-react';
// Three knobs decide how this build is served.
// 1. base: a static build under a repo subpath on Pages (e.g. /LocalSight/) needs an
//    absolute base; a relative './' would break the deep links the history router serves.
const BASE_PATH = process.env.VITE_BASE || '/';
// 2. worker: the engine worker imports ONNX Runtime dynamically on its first start, and an
//    IIFE worker cannot code-split (those imports get inlined back into the worker chunk),
//    so the format has to stay ES modules.
const WORKER_OPTIONS = { format: 'es' };
// 3. webhook relay origin: the CSP is static, so a remote relay has to be named at build
//    time. `VITE_WEBHOOK_ORIGIN=https://relay.example` adds exactly that origin; unset is
//    replaced with an empty string so the placeholder never ships.
const WEBHOOK_ORIGIN = process.env.VITE_WEBHOOK_ORIGIN || '';
const webhookCspPlugin = {
  name: 'webhook-csp',
  transformIndexHtml(html) {
    return html.replaceAll('%VITE_WEBHOOK_ORIGIN%', WEBHOOK_ORIGIN);
  },
};
// 4. server: 5173 is the port the demo run sheet and the e2e helper expect, and `host`
//    keeps the LAN demo reachable from a phone on the same network.
const DEV_PORT = 5173;
const DEV_SERVER_OPTIONS = {
  host: true,
  port: DEV_PORT,
  open: false, // the run sheet opens the browser; the dev server never steals focus
};
/** @type {import('vite').UserConfig} */
const viteConfig = {
  base: BASE_PATH,
  plugins: [reactPlugin(), webhookCspPlugin],
  worker: WORKER_OPTIONS,
  server: DEV_SERVER_OPTIONS,
};
export default viteConfig;
