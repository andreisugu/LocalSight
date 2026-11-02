import { expect, test } from '@playwright/test';
import {
  PAGES_BASE as BASE,
  incidentIdFromUrl,
  incidentRows,
  openView,
  setDemoData,
  startEngine,
  waitForIsolation,
} from '../helpers.mjs';

// What this suite adds over the default-base smoke test: the app is served exactly like
// GitHub Pages serves it (base /LocalSight/, 404.html fallback, no COOP/COEP headers), and
// the product's core — the browser engine — is actually started and measured. A green
// default-base run no longer proves the deployed shape works.

test('the deploy base serves / and the sidebar says which build it is', async ({ page }) => {
  const response = await page.goto(BASE);
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId('app-title')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // The footer stamp is the release identifier. When the build got VITE_BUILD_SHA (CI
  // does that, like pages.yml), it must show that exact commit; a plain local build
  // says `dev` instead of a fabricated commit. The hook carries the same value as an
  // attribute, so the assertion no longer parses the visible sentence.
  const expectedBuild = process.env.VITE_BUILD_SHA
    ? process.env.VITE_BUILD_SHA.slice(0, 7)
    : 'dev';
  await expect(page.getByTestId('build-sha')).toHaveAttribute('data-sha', expectedBuild);

  // The notices file the deploy ships is reachable from the same footer.
  await expect(page.getByTestId('notice-link')).toHaveAttribute('href', `${BASE}NOTICE`);
});

test('a deep link loads through the Pages 404 fallback', async ({ page }) => {
  // A Slack link points at one incident; the default build lists no fixtures, so ask for
  // them first. The id comes from the running app, never from hardcoded fixture data.
  await page.goto(`${BASE}incidents`);
  await setDemoData(page, true);
  await openView(page, 'incidents');
  const row = incidentRows(page).first();
  await expect(row).toBeVisible();
  await row.click();
  const deepLink = new URL(page.url()).pathname;
  expect(deepLink).toMatch(/^\/LocalSight\/incidents\/[^/]+$/);
  const incidentId = incidentIdFromUrl(page);

  // A full load of the deep link, exactly like a link opened from Slack. Pages answers
  // with 404.html; the point is that the app boots and renders that incident anyway.
  const response = await page.goto(deepLink);
  expect(response?.status()).toBe(404);

  await expect(page.getByTestId('incident-id')).toHaveText(incidentId);
  await expect(page.getByTestId('incident-report')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(deepLink);
});

test('the COOP/COEP worker is served from the subpath', async ({ request }) => {
  const response = await request.get(`${BASE}coi-serviceworker.js`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/javascript/);
  // Without these two strings the worker cannot isolate the document at all.
  const body = await response.text();
  expect(body).toContain('Cross-Origin-Opener-Policy');
  expect(body).toContain('Cross-Origin-Embedder-Policy');
});

test('the page becomes crossOriginIsolated after the worker reloads it once', async ({ page }) => {
  await page.goto(BASE);
  // First load is not isolated: Pages sends no headers. main.jsx registers the worker,
  // and the worker's `controllerchange` reloads the tab exactly once, guarded by
  // sessionStorage. Waiting for the flag also waits through that reload; issuing a
  // `page.reload()` here would race it and detach the page.
  await waitForIsolation(page);

  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Isolation is what enables more than one WASM thread; without it the engine still runs,
  // just slower, which is why this is asserted separately from the engine test.
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toMatch(
    /\/LocalSight\/coi-serviceworker\.js\?v=.+$/
  );
});

test('the engine starts on the clip and produces frames', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(BASE);
  // Start isolated, like a demo visitor after the automatic reload, so the engine gets its
  // 4-thread WASM path instead of the single-thread fallback.
  await waitForIsolation(page);

  // Waits for the worker's first processed result, not for a fixed delay.
  await startEngine(page);

  // A real processed frame is drawn: the canvas exists and is larger than an empty
  // default (300x150). Both the intrinsic frame and the rendered box are checked.
  const canvas = page.getByTestId('engine-canvas');
  await expect(canvas).toHaveCount(1);
  const intrinsic = await canvas.evaluate((node) => ({
    width: node.width,
    height: node.height,
  }));
  expect(intrinsic.width).toBeGreaterThan(300);
  expect(intrinsic.height).toBeGreaterThan(150);
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);
  expect(box?.height ?? 0).toBeGreaterThan(150);

  // fps is measured by the worker, never invented: the chip only renders while frames
  // arrive, and the value it carries must be a positive number. The first render can carry
  // 0 before the worker's first measurement, so poll for the measurement, not for paint.
  const fpsChip = page.getByTestId('engine-fps');
  await expect(fpsChip).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => Number(await fpsChip.getAttribute('data-fps')), { timeout: 60_000 })
    .toBeGreaterThan(0);

  // The card names the graph that really loaded. With no setting stored, that must be the
  // shipped default: EfficientDet-Lite0 (320 px, Apache-2.0). Nothing YOLO is shipped.
  await expect(page.getByTestId('engine-card')).toContainText('EfficientDet-Lite0');
  await expect(page.getByTestId('engine-card')).not.toContainText('YOLO');
});

test('Settings offers both EfficientDet models and persists the choice', async ({ page }) => {
  await page.goto(BASE);
  await openView(page, 'settings');

  const panel = page.getByTestId('detector-panel');
  await expect(panel).toBeVisible();
  // Both choices are Apache-2.0 and the card says the AGPL model is gone.
  await expect(panel).toContainText('Apache-2.0');
  await expect(panel).toContainText('Fără AGPL');

  const lite0 = page.getByTestId('detector-efficientdet');
  const lite2 = page.getByTestId('detector-efficientdet-lite2');
  await expect(lite0).toBeChecked();
  await expect(panel).toContainText('320 px');
  await expect(panel).toContainText('448 px');

  await lite2.check();
  await expect(lite2).toBeChecked();
  await expect
    .poll(async () => page.evaluate(
      () => JSON.parse(localStorage.getItem('localsight.engineSettings') || '{}').detector
    ))
    .toBe('efficientdet-lite2');
  // A full reload keeps the choice: it is the engine's setting, not this render's state.
  await page.reload();
  await openView(page, 'settings');
  await expect(page.getByTestId('detector-efficientdet-lite2')).toBeChecked();

  // Back to the default, so a later test in this file sees the shipped configuration.
  await page.getByTestId('detector-efficientdet').check();
  await expect(page.getByTestId('detector-efficientdet')).toBeChecked();
});
