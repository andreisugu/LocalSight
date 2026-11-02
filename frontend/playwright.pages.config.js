import { defineConfig, devices } from '@playwright/test';

// The second e2e run: exactly what GitHub Pages serves, not the default-base build.
//
// `vite preview` is not enough here. Pages publishes the app under /LocalSight/, answers
// unknown paths with 404.html, and — the part that matters most — sends no COOP/COEP,
// so `crossOriginIsolated` only becomes true after coi-serviceworker.js takes control.
// e2e/pages/server.mjs mirrors those three properties, and the suite asserts them.
//
// The build is the same command as pages.yml (VITE_USE_MOCK=true VITE_BASE=/LocalSight/).
const PORT = Number(process.env.PW_PAGES_PORT) || 4317;
const BASE_PATH = '/LocalSight/';
const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: './e2e/pages',
  // One worker: the engine test loads 10 MB of models and runs ONNX on the CPU, so two
  // browsers in parallel would measure each other's contention rather than the engine.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Same rule as the smoke suite: no retries, a real problem must be a red job.
  retries: 0,
  // The engine warm-up (model download + WASM session) is the long step; each test can
  // override this, but a hung page must not sit for the default 30 s and look flaky.
  timeout: 120_000,
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
    // VITE_USE_MOCK and VITE_BASE are build-time values, so they belong to this command.
    // server.mjs also writes the 404.html fallback Pages expects, then serves dist/ under
    // /LocalSight/ with the same cache headers and no COOP/COEP.
    command: 'npm run build && node e2e/pages/server.mjs',
    url: BASE_URL,
    timeout: 240_000,
    // Never reuse: a leftover server would test a dist that no longer exists.
    reuseExistingServer: false,
    env: { ...process.env, VITE_USE_MOCK: 'true', VITE_BASE: BASE_PATH },
  },
});
