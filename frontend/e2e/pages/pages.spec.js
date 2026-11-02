import { expect, test } from '@playwright/test';

// What this suite adds over the default-base smoke test: the app is served exactly like
// GitHub Pages serves it (base /LocalSight/, 404.html fallback, no COOP/COEP headers), and
// the product's core — the browser engine — is actually started and measured. A green
// default-base run no longer proves the deployed shape works.

const BASE = '/LocalSight/';

/**
 * Wait until the document is truly isolated. This can only happen after
 * coi-serviceworker.js has claimed the page and main.jsx reloaded once; `page.evaluate`
 * throws while that reload replaces the execution context, so a throw means "not yet".
 */
async function waitForIsolation(page) {
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

test('the deploy base serves / and the sidebar says which build it is', async ({ page }) => {
  const response = await page.goto(BASE);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { level: 1, name: /localsight/i })).toBeVisible();
  await expect(page.getByRole('complementary')).toBeVisible();

  // The footer stamp is the release identifier. When the build got VITE_BUILD_SHA (CI
  // does that, like pages.yml), it must show that exact commit; a plain local build
  // says `dev` instead of a fabricated commit. Found by its visible text, so the
  // production markup carries no test-only attribute.
  const expectedBuild = process.env.VITE_BUILD_SHA
    ? process.env.VITE_BUILD_SHA.slice(0, 7)
    : 'dev';
  await expect(page.getByText(`build ${expectedBuild}`, { exact: true })).toBeVisible();

  // The notices file the deploy ships is reachable from the same footer.
  await expect(page.getByRole('link', { name: /^licențe$/i })).toHaveAttribute(
    'href',
    `${BASE}NOTICE`
  );
});

test('a deep link loads through the Pages 404 fallback', async ({ page }) => {
  // The id comes from the running app, so this does not hardcode fixture data.
  await page.goto(`${BASE}incidents`);
  await page.getByRole('listitem').first().getByRole('button').click();
  const deepLink = new URL(page.url()).pathname;
  expect(deepLink).toMatch(/^\/LocalSight\/incidents\/[^/]+$/);
  const incidentId = decodeURIComponent(deepLink.split('/').pop());

  // A full load of the deep link, exactly like a link opened from Slack. Pages answers
  // with 404.html; the point is that the app boots and renders that incident anyway.
  const response = await page.goto(deepLink);
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(`^incident: ${incidentId}$`, 'i') })
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^raport incident/i })).toBeVisible();
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
    /\/LocalSight\/coi-serviceworker\.js$/
  );
});

test('the engine starts on the clip and produces frames', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(BASE);
  // Start isolated, like a demo visitor after the automatic reload, so the engine gets its
  // 4-thread WASM path instead of the single-thread fallback.
  await waitForIsolation(page);

  await page.getByRole('button', { name: /pornește motorul în browser/i }).click();

  const card = page.getByRole('region', { name: 'Motor și senzori' });
  await expect(card.getByText('rulează', { exact: true })).toBeVisible({ timeout: 120_000 });

  // A real processed frame is drawn: the canvas exists and is larger than an empty
  // default (300x150). Both the intrinsic frame and the rendered box are checked.
  const canvas = page.locator('canvas');
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
  // arrive, and the value must be a positive number.
  const fpsChip = card.getByText(/procesat local · [0-9.]+ fps/);
  await expect(fpsChip).toBeVisible({ timeout: 60_000 });
  const label = (await fpsChip.textContent()) || '';
  const fps = Number(/procesat local · ([0-9.]+) fps/.exec(label)?.[1]);
  expect(Number.isFinite(fps)).toBe(true);
  expect(fps).toBeGreaterThan(0);
});
