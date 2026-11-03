import { defineConfig, devices } from '@playwright/test';

// The smoke suite runs against the real static build, not the dev server: the
// thing that ships to Pages is `npm run build` output rendered by a static file
// server. `vite preview` behaves like Pages for history routing (unknown paths
// fall back to index.html), so deep links such as /incidents/<id> are testable.
// Parallel sessions (agents/worktrees) must not fight over one preview port.
// `PW_PORT=4310 npm run test:e2e` is enough; CI keeps the default.
//
// `PW_BASE_URL` is the opt-in fast path: when it is set, this config starts nothing
// (no build, no preview) and runs against the server the caller already owns, e.g.
//
//   npm run serve:test                     # prints a URL, serves dist/ for as long as it lives
//   PW_BASE_URL=http://127.0.0.1:53941/ npm run e2e:smoke
//
// Unset (CI, plain `npm run test:e2e`) keeps the exact old behaviour: one build of
// the mock app, one `vite preview` on PW_PORT, never reused.
const PORT = Number(process.env.PW_PORT) || 4173;
const BASE_URL = process.env.PW_BASE_URL || `http://127.0.0.1:${PORT}`;
const EXTERNAL_SERVER = Boolean(process.env.PW_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  // The Pages-shape suite lives under e2e/pages and has its own config + server: this
  // run keeps the default base `/` and must stay exactly the five smoke tests.
  // e2e/firefox-mobile belongs to playwright.firefox.config.js for the same reason: it
  // needs Firefox and the Android autoplay policy, neither of which exists here.
  testIgnore: ['**/pages/**', '**/firefox-mobile/**'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A smoke test that flakes is worse than no smoke test: no retries, so a real
  // problem shows up as a red job instead of being retried away.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No server when PW_BASE_URL names one: whoever owns it also owns the build.
  ...(EXTERNAL_SERVER
    ? {}
    : {
        webServer: {
          // VITE_USE_MOCK is read at build time (import.meta.env), so it belongs to the
          // build step, not to preview: the app must boot with no backend at all.
          command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: BASE_URL,
          timeout: 180_000,
          // Never reuse a server: a leftover preview would serve an old dist and the
          // smoke test would pass on a build that no longer exists.
          reuseExistingServer: false,
          env: { ...process.env, VITE_USE_MOCK: 'true' },
        },
      }),
});
