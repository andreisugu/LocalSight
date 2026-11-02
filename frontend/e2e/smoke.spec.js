import { expect, test } from '@playwright/test';

// The mock build runs on timers (1 s escalation tick, 30 s sidebar refresh), so
// a test that only looks at the first paint would miss errors thrown by them.
const SETTLE_MS = 500;

const MODULES = ['Live', 'Incidente', 'Configurare Zone', 'Rapoarte Tură', 'Sistem & Audit'];

/**
 * Collects everything the page reports as a problem. Only real errors count:
 * failed loads of the mock snapshot CDN are skipped because they say nothing
 * about the build and would make CI depend on a third-party image host.
 */
function watchPageErrors(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location()?.url || '';
    if (/images\.unsplash\.com/.test(source) || /images\.unsplash\.com/.test(message.text())) return;
    problems.push(`console.error: ${message.text()}`);
  });
  return problems;
}

function expectNoPageErrors(problems) {
  expect(problems, 'the page must not log errors').toEqual([]);
}

test('app boots with zero console errors and shows the sidebar', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /localsight/i })).toBeVisible();

  const sidebar = page.getByRole('complementary');
  await expect(sidebar).toBeVisible();
  for (const label of MODULES) {
    await expect(sidebar.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  await page.waitForTimeout(SETTLE_MS);
  expectNoPageErrors(problems);
});

test('incidents view lists at least one mock incident', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/incidents');

  await expect(page.getByRole('heading', { level: 2, name: /^incidente$/i })).toBeVisible();

  const rows = page.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(1);
  // Severity is part of the contract: CRITICAL or WARNING, never anything else.
  await expect(rows.first()).toContainText(/CRITICAL|WARNING/);

  expectNoPageErrors(problems);
});

test('opening an incident from the list shows the report section', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/incidents');
  await page.getByRole('listitem').first().getByRole('button').click();

  // The detail screen must show the incident that was opened, not any incident.
  await expect(page).toHaveURL(/\/incidents\/[^/]+$/);
  const incidentId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());

  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(`^incident: ${incidentId}$`, 'i') })
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^raport incident/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(confirmă|confirmat)$/i })).toBeVisible();
  await expect(page.getByText('CE:', { exact: true })).toBeVisible();
  await expect(page.getByText('ACȚIUNE RECOMANDATĂ:', { exact: true })).toBeVisible();

  expectNoPageErrors(problems);
});

test('zone editor renders the drawing canvas', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/zones');

  await expect(page.getByRole('heading', { level: 2, name: /^configurare zone$/i })).toBeVisible();

  const canvas = page.getByTestId('zone-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // The seed zone is loaded with its polygon already drawable.
  expect(await page.locator('[data-testid^="zone-point-"]').count()).toBeGreaterThanOrEqual(3);

  expectNoPageErrors(problems);
});

test('a deep link to an incident loads the detail view directly', async ({ page }) => {
  const problems = watchPageErrors(page);

  // Mock event ids embed the load time (mockData builds them from Date.now()), so
  // a second full load would invent new ids and the captured link would point at
  // nothing. Freezing Date makes the static build deterministic for this test;
  // timers keep running because only the clock is fixed, not the scheduler.
  await page.clock.setFixedTime(new Date('2026-11-02T09:00:00Z'));

  // The id comes from the running app, so the test does not hardcode mock data.
  await page.goto('/incidents');
  await page.getByRole('listitem').first().getByRole('button').click();
  const deepLink = new URL(page.url()).pathname;
  expect(deepLink).toMatch(/^\/incidents\/[^/]+$/);
  const incidentId = decodeURIComponent(deepLink.split('/').pop());

  // A full page load, exactly like a link opened from Slack after the Pages deploy.
  await page.goto(deepLink);

  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(`^incident: ${incidentId}$`, 'i') })
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^raport incident/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(confirmă|confirmat)$/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(deepLink);

  expectNoPageErrors(problems);
});
