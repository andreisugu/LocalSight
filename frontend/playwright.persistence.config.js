import { defineConfig, devices } from '@playwright/test';

// The third e2e run: durable evidence, against the deployed shape (base /LocalSight/).
//
// It is separate from `playwright.config.js` (exactly five smoke tests) and from
// `playwright.pages.config.js` (exactly the Pages suite), because it starts the engine and
// waits for a real incident — minutes, not seconds — and must not slow those suites down.
//
//   VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
//   PW_PORT=4352 npx playwright test --config=playwright.persistence.config.js
//
// The server is `e2e/pages/server.mjs`: same subpath, same 404 fallback, same missing
// COOP/COEP headers as GitHub Pages.
const PORT = Number(process.env.PW_PORT) || 4352;
const BASE_PATH = '/LocalSight/';
const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: './persistence-e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // The engine warm-up (models + WASM session) plus the incident wait dominate.
  timeout: 240_000,
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
    command: 'npm run build && node e2e/pages/server.mjs',
    url: BASE_URL,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      VITE_USE_MOCK: 'true',
      VITE_BASE: BASE_PATH,
      PW_PAGES_PORT: String(PORT),
    },
  },
});
