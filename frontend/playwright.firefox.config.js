import { defineConfig } from '@playwright/test';

// The Firefox run, and the only suite that is not Chromium: a phone-shaped Firefox with the
// autoplay policy Firefox for Android ships.
//
// Why it exists: the browser engine is paced by the <video> element, so a clip the browser
// refuses to start feeds the worker once and then nothing. Firefox for Android blocks the
// automatic playback of *every* media element — muted clips included, because its
// `media.autoplay.default` is 5, "block audio and video" — while a MediaStream (the local
// camera) is exempt. That is why the engine could run on the webcam and never on the demo
// clip on a phone. `e2e/firefox-mobile/autoplay.spec.js` pins the two behaviours that fix
// it: the card names the policy, and one tap starts the clip and the engine.
//
// The server is the same GitHub Pages stand-in the Pages suite uses (base /LocalSight/,
// 404.html fallback, no COOP/COEP), and the build command is the same one too.
//
// `PW_BASE_URL` reuses an already-running Pages-shape server, exactly like the other
// configs: `npm run serve:test -- --base /LocalSight/` prints the URL.
//
// Needs `npx playwright install firefox`; CI installs Chromium only, so this suite stays an
// explicit `npm run e2e:firefox` instead of joining the default run.
const PORT = Number(process.env.PW_FIREFOX_PORT) || 4319;
const BASE_PATH = '/LocalSight/';
const BASE_URL = process.env.PW_BASE_URL || `http://127.0.0.1:${PORT}${BASE_PATH}`;
const EXTERNAL_SERVER = Boolean(process.env.PW_BASE_URL);

export default defineConfig({
  testDir: './e2e/firefox-mobile',
  // One worker: the test downloads the models and runs ONNX on the CPU, so a second
  // browser would mostly measure contention.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Model download + WASM warm-up on one thread is the long step; a hung page must fail
  // with a readable timeout instead of looking flaky.
  timeout: 300_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // A 390×844 phone with touch and an Android user agent: the shape the bug was reported
    // on.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
    locale: 'ro-RO',
  },
  projects: [
    {
      // `browserName` and the launch preferences belong to a project: that is the level the
      // test runner applies to the worker's browser launch. Playwright cannot emulate the
      // Android *platform*, so these two preferences carry the one difference that matters.
      name: 'firefox-mobile',
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: {
            // Firefox for Android blocks audible *and* inaudible media by default.
            'media.autoplay.default': 5,
            // Transient activation: the gesture must be recent, the strict variant.
            'media.autoplay.blocking_policy': 2,
          },
        },
      },
    },
  ],
  ...(EXTERNAL_SERVER
    ? {}
    : {
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
      }),
});
