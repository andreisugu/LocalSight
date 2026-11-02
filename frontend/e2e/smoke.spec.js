import { expect, test } from '@playwright/test';
import {
  expectNoPageErrors,
  incidentIdFromUrl,
  watchPageErrors,
} from './helpers.mjs';

const MODULES = ['live', 'incidents', 'zones', 'reports', 'settings'];

/** The five contract fields the report must always render. */
const REPORT_FIELDS = ['what', 'where', 'when', 'severity_reason', 'recommended_action'];

test('app boots with zero console errors and shows the sidebar', async ({ page }) => {
  const problems = watchPageErrors(page);

  // The mock build runs on timers (1 s escalation tick, 30 s sidebar refresh), so the boot
  // check must let them fire. A fixed sleep proves nothing about the tick actually running
  // and always costs its full length; the fake clock advances exactly two ticks, instantly.
  await page.clock.install();
  await page.goto('/');

  await expect(page.getByTestId('app-title')).toBeVisible();

  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible();
  for (const view of MODULES) {
    await expect(page.getByTestId(`nav-${view}`)).toBeVisible();
  }

  await page.clock.runFor(2_000);
  // A round trip flushes anything the ticks reported to the driver before the assertion.
  await page.evaluate(() => document.readyState);
  expectNoPageErrors(problems);
});

test('incidents view lists at least one mock incident', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/incidents');

  const rows = page.getByTestId('incident-row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(1);
  // Severity is part of the contract: CRITICAL or WARNING, never anything else.
  await expect(rows.first()).toHaveAttribute('data-severity', /^(CRITICAL|WARNING)$/);

  expectNoPageErrors(problems);
});

test('opening an incident from the list shows the report section', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/incidents');
  const row = page.getByTestId('incident-row').first();
  await expect(row).toBeVisible();
  const incidentId = await row.getAttribute('data-event-id');
  await row.click();

  // The detail screen must show the incident that was opened, not any incident.
  await expect(page).toHaveURL(new RegExp(`/incidents/${escapeRegExp(incidentId)}$`));
  expect(incidentIdFromUrl(page)).toBe(incidentId);

  await expect(page.getByTestId('incident-id')).toHaveText(incidentId);
  await expect(page.getByTestId('incident-title')).toBeVisible();
  await expect(page.getByTestId('incident-snapshot')).toBeVisible();
  await expect(page.getByTestId('incident-report')).toBeVisible();
  await expect(page.getByTestId('decision-ack')).toBeVisible();

  // The report carries exactly the five contract fields, and each has a value.
  const reportFields = page.locator('[data-testid^="report-field-"]');
  await expect(reportFields).toHaveCount(REPORT_FIELDS.length);
  for (const field of REPORT_FIELDS) {
    await expect(page.getByTestId(`report-field-${field}`)).toContainText(/\S/);
  }

  expectNoPageErrors(problems);
});

test('zone editor renders the drawing canvas', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/zones');

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

  // No clock freeze is needed: fixture ids come from EVENT_ID_ANCHOR_MS, not from
  // Date.now(), so a second document load resolves the same incident. That is the
  // property the deep-link contract depends on, so the test exercises it directly.
  await page.goto('/incidents');
  const row = page.getByTestId('incident-row').first();
  await expect(row).toBeVisible();
  await row.click();
  const deepLink = new URL(page.url()).pathname;
  expect(deepLink).toMatch(/^\/incidents\/[^/]+$/);
  const incidentId = incidentIdFromUrl(page);

  // A full page load, exactly like a link opened from Slack after the Pages deploy.
  await page.goto(deepLink);

  await expect(page.getByTestId('incident-id')).toHaveText(incidentId);
  await expect(page.getByTestId('incident-report')).toBeVisible();
  await expect(page.getByTestId('decision-ack')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(deepLink);

  expectNoPageErrors(problems);
});

/** Escape a value used inside a RegExp (`evt_...` ids are safe, but be explicit). */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
