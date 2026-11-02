import { defineConfig, devices } from '@playwright/test';

// The smoke suite runs against the real static build, not the dev server: the
// thing that ships to Pages is `npm run build` output rendered by a static file
// server. `vite preview` behaves like Pages for history routing (unknown paths
// fall back to index.html), so deep links such as /incidents/<id> are testable.
// Parallel sessions (agents/worktrees) must not fight over one preview port.
// `PW_PORT=4310 npm run test:e2e` is enough; CI keeps the default.
const PORT = Number(process.env.PW_PORT) || 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The Pages-shape suite lives under e2e/pages and has its own config + server: this
  // run keeps the default base `/` and must stay exactly the five smoke tests.
  testIgnore: '**/pages/**',
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
});
