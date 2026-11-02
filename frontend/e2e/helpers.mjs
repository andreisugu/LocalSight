import { expect } from '@playwright/test';

// Shared e2e helpers. Every suite (smoke, Pages shape, persistence) selects through the
// stable hooks the app carries, never through visible copy: the design work rewrites copy
// and ARIA names, and a suite that breaks on a better sentence is not testing the product.
//
// The hooks live on real elements (`data-testid`/`data-event-id`); none of them changes
// behaviour, layout or the accessibility tree.

/** The app is served under this base by GitHub Pages and by the persistence server. */
export const PAGES_BASE = '/LocalSight/';

/** Model download + WASM warm-up before the worker reports its first processed frame. */
export const ENGINE_START_TIMEOUT_MS = 120_000;

/**
 * How long a real clip test waits for the engine to produce an incident. One frame takes
 * ~170 ms on this machine (≈5.8 fps at 1280 px, 4 threads) and the restricted-zone rule
 * needs a continuous presence, so the first incident arrives within seconds. The timeout
 * is generous on purpose: a slower CI box must fail on no incident at all, not on pace.
 */
export const INCIDENT_TIMEOUT_MS = 120_000;

/** Mock snapshot CDN: a third-party image host the build must not depend on in tests. */
const MOCK_CDN = /images\.unsplash\.com/;

/** ONNX Runtime prints shape verifications through console.error while the model warms. */
const ONNX_NOISE = /VerifyOutputSizes|Expected shape from model/;

/**
 * GitHub Pages answers every app route with 404.html and status 404 by design; the app
 * then renders it. Only document paths are skipped, so a missing asset still counts.
 */
const APP_DOCUMENT_PATH =
  /\/LocalSight\/(?:incidents|settings|zones|reports|live|lab|bench)(?:\/|$)/;

/**
 * Collects everything the page reports as a problem. `onnxNoise` and `pagesFallback` are
 * opt-in so each suite keeps counting exactly what it counted before: the default-base
 * smoke run has neither the engine noise nor the 404 fallback.
 */
export function watchPageErrors(page, { onnxNoise = false, pagesFallback = false } = {}) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location()?.url || '';
    const text = message.text();
    if (MOCK_CDN.test(source) || MOCK_CDN.test(text)) return;
    if (onnxNoise && ONNX_NOISE.test(text)) return;
    if (pagesFallback && /status of 404/.test(text) && APP_DOCUMENT_PATH.test(source)) return;
    problems.push(`console.error: ${text}`);
  });
  return problems;
}

export function expectNoPageErrors(problems) {
  expect(problems, 'the page must not log errors').toEqual([]);
}

/**
 * Wait until the document is truly isolated. This only happens after coi-serviceworker.js
 * has claimed the page and main.jsx reloaded once; `page.evaluate` throws while that reload
 * replaces the execution context, so a throw means "not yet".
 */
export async function waitForIsolation(page) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => window.crossOriginIsolated === true);
        } catch {
          return false;
        }
      },
      { timeout: 60_000, intervals: [250, 500, 1000] }
    )
    .toBe(true);
}

/** The sidebar entry is a real button; the hook names the view, not the copy. */
export async function openView(page, view) {
  await page.getByTestId(`nav-${view}`).click();
}

/** The incident id of the routed detail screen, straight from the address bar. */
export function incidentIdFromUrl(page) {
  return decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
}

/** Every incident in the Live feed, in render order. */
export function incidentCards(page) {
  return page.getByTestId('incident-card');
}

/**
 * The first incident the browser engine produced in this session. The card carries
 * `data-local`; fixture cards never do, so this selects on a fact, not on the word "local".
 */
export function firstLocalIncident(page) {
  return page.locator('[data-testid="incident-card"][data-local="true"]').first();
}

/** The engine's own status chip: `data-engine-status` is the machine-readable state. */
export function engineStatus(page) {
  return page.getByTestId('engine-status');
}

/**
 * Start the browser engine and wait until the worker really reports frames. The status
 * flips to `running` on the first processed result, so this waits for work, not for a timer.
 */
export async function startEngine(page) {
  await page.getByTestId('engine-start').click();
  await expect(engineStatus(page)).toHaveAttribute('data-engine-status', 'running', {
    timeout: ENGINE_START_TIMEOUT_MS,
  });
}

/** One statistic of the "Date locale" panel in Sistem & Audit. */
export function localStat(page, name) {
  return page.getByTestId(`local-${name}`);
}
