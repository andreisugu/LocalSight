import { expect, test } from '@playwright/test';
import {
  expectNoPageErrors,
  fixtureRows,
  incidentIdFromUrl,
  incidentRows,
  openView,
  setDemoData,
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

test('the incident surfaces show no fixtures until demo data is turned on', async ({ page }) => {
  const problems = watchPageErrors(page);

  // Default: real detections only. The eight SafeSight fixtures are demo data, so the list
  // is empty and says why instead of showing a shift that never happened.
  await page.goto('/incidents');
  await expect(page.getByTestId('incidents-empty')).toBeVisible();
  await expect(incidentRows(page)).toHaveCount(0);
  await expect(fixtureRows(page)).toHaveCount(0);

  // The Live feed and the KPI strip agree: no fixture number is dressed as telemetry.
  await openView(page, 'live');
  await expect(page.getByTestId('feed-empty')).toBeVisible();
  await expect(page.getByTestId('kpi-ppe')).toHaveAttribute('data-source', 'no-demo');
  await expect(page.getByTestId('kpi-ppe')).toContainText('—');
  await expect(page.getByTestId('kpi-latency')).toHaveAttribute('data-source', 'no-demo');
  await expect(page.getByTestId('kpi-open')).toContainText('0');

  // The explicit Simulare action still works with the fixtures off, and says so.
  await page.getByRole('button', { name: /Simulare/ }).click();
  await page.getByRole('menuitem', { name: /Persoană în Zonă Motor/ }).click();
  await expect(page.getByTestId('incident-card')).toHaveCount(1);
  await expect(page.getByTestId('incident-simulated-chip')).toBeVisible();
  await openView(page, 'incidents');
  await expect(page.locator('[data-testid="incident-row"][data-source="simulated"]')).toHaveCount(1);

  // Asking for the fixtures is one persisted toggle: eight labelled rows join the list.
  await setDemoData(page, true);
  await openView(page, 'incidents');
  await expect(fixtureRows(page)).toHaveCount(8);
  await expect(incidentRows(page)).toHaveCount(9);
  // Severity is part of the contract: CRITICAL or WARNING, never anything else.
  await expect(fixtureRows(page).first()).toHaveAttribute('data-severity', /^(CRITICAL|WARNING)$/);

  // With the fixtures on, the supplied demo numbers are back and labelled as demo.
  await openView(page, 'live');
  await expect(page.getByTestId('kpi-demo-note')).toBeVisible();
  await expect(page.getByTestId('kpi-ppe')).toContainText('93.8%');
  await expect(page.getByTestId('kpi-latency')).toContainText('1.3s');
  // The report counts the visible list too: eight fixtures plus the simulated event.
  await openView(page, 'reports');
  await expect(page.getByTestId('report-total')).toHaveText('9');

  // The choice survives a reload; the simulated event does not (it was never stored).
  await page.reload();
  await openView(page, 'incidents');
  await expect(fixtureRows(page)).toHaveCount(8);
  await expect(incidentRows(page)).toHaveCount(8);
  await openView(page, 'reports');
  await expect(page.getByTestId('report-total')).toHaveText('8');

  expectNoPageErrors(problems);
});

test('opening an incident from the list shows the report section', async ({ page }) => {
  const problems = watchPageErrors(page);

  await page.goto('/incidents');
  // The fixtures are the demo list; ask for them before opening one.
  await setDemoData(page, true);
  await openView(page, 'incidents');
  const row = incidentRows(page).first();
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

test('a deep link to a hidden fixture still opens, labelled as demo', async ({ page }) => {
  const problems = watchPageErrors(page);

  // No clock freeze is needed: fixture ids come from EVENT_ID_ANCHOR_MS, not from
  // Date.now(), so a second document load resolves the same incident. That is the
  // property the deep-link contract depends on, so the test exercises it directly.
  await page.goto('/incidents');
  await setDemoData(page, true);
  await openView(page, 'incidents');
  const row = incidentRows(page).first();
  await expect(row).toBeVisible();
  await row.click();
  const deepLink = new URL(page.url()).pathname;
  expect(deepLink).toMatch(/^\/incidents\/[^/]+$/);
  const incidentId = incidentIdFromUrl(page);

  // Hide the fixtures again, then open the link the way a Slack message would. A row that
  // is not listed must still render, with the chip that says it is demo data.
  await setDemoData(page, false);
  await page.goto(deepLink);

  await expect(page.getByTestId('incident-id')).toHaveText(incidentId);
  await expect(page.getByTestId('incident-demo-chip')).toBeVisible();
  await expect(page.getByTestId('incident-report')).toBeVisible();
  await expect(page.getByTestId('decision-ack')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(deepLink);

  expectNoPageErrors(problems);
});

/** Escape a value used inside a RegExp (`evt_...` ids are safe, but be explicit). */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
