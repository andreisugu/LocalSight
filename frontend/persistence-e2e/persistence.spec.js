import { expect, test } from '@playwright/test';
import {
  PAGES_BASE as BASE,
  INCIDENT_TIMEOUT_MS,
  expectNoPageErrors,
  feedMode,
  firstLocalIncident,
  localStat,
  openView,
  setDemoData,
  startEngine,
  waitForIsolation,
  watchPageErrors,
} from '../e2e/helpers.mjs';

// Browser evidence for the durable store: a real engine incident, its snapshot and its ack
// survive a full document load; retention prunes old rows; "delete local data" empties the
// database without touching the fixtures; a browser without IndexedDB still boots.
//
// Run with its own config (see `playwright.persistence.config.js`):
//   PW_PORT=4352 npx playwright test --config=playwright.persistence.config.js
//
// Only the first test starts the engine: it is the one that proves a real captured blob
// survives a reload. The others seed the documented schema directly, so they never pay for
// model download or for a rule to fire.

/** True when the incident-detail screen shows the record with this id. */
async function expectIncidentDetail(page, eventId, { restored = false } = {}) {
  await expect(page.getByTestId('incident-id')).toHaveText(eventId, {
    timeout: restored ? 90_000 : 30_000,
  });
}

/**
 * Write incidents straight into the app's database, the way an earlier session would have.
 *
 * This seeds the schema the store documents (`events`/`evidence`+`acks`, `schema: 1`); the
 * test does not import app code, because a test hook in the build would be worse than a
 * hand-written seed. Returns the ids so assertions can name them.
 */
async function seedStoredIncidents(page, { count, staleCount = 0 }) {
  return page.evaluate(async ({ count: freshCount, staleCount: oldCount }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('localsight-evidence', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of ['events', 'evidence', 'acks']) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: 'event_id' });
          }
        }
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    const base = String(now);
    const fresh = [];
    const stale = [];
    const tx = db.transaction(['events', 'evidence', 'meta'], 'readwrite');
    const events = tx.objectStore('events');
    const evidence = tx.objectStore('evidence');
    tx.objectStore('meta').put({ key: 'schema_version', value: 1 });

    const write = (id, detectedMs, track, isStale) => {
      const detected = new Date(detectedMs).toISOString();
      events.put({
        event_id: id,
        schema: 1,
        stored_at: detectedMs,
        event: {
          event_id: id,
          type: 'RESTRICTED_ZONE',
          severity: 'WARNING',
          status: 'open',
          camera_id: 'stand12',
          zone_id: 'engine-left',
          track_id: track,
          confidence: { detector: 0.8, temporal: { seen: 3, window: 5 } },
          duration_s: 1.2,
          context: { engine_on: true },
          snapshot_url: `blob:http://localhost/${id}`,
          model: 'efficientdet-lite0',
          detected_at: detected,
          received_at: detected,
          notified_at: null,
          escalated_at: null,
          acked_at: null,
          acked_by: null,
          escalate_after_s: null,
          report: {
            what: 'Persoană în zona restricționată engine-left.',
            where: 'Stand 12 • engine-left',
            when: detected,
            severity_reason: 'Test de retenție.',
            recommended_action: 'Verifică zona.',
            source: 'template',
          },
          local: true,
        },
      });
      evidence.put({
        event_id: id,
        schema: 1,
        stored_at: detectedMs,
        size: 67,
        type: 'image/png',
        // A real 1x1 PNG, so the restored <img> decodes instead of logging a load error.
        blob: new Blob([new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ])], { type: 'image/png' }),
      });
      (isStale ? stale : fresh).push(id);
    };

    for (let index = 0; index < freshCount; index += 1) {
      write(`evt_seed_${base}_${index}`, now - index * 60_000, index, false);
    }
    for (let index = 0; index < oldCount; index += 1) {
      write(`evt_seedold_${base}_${index}`, now - 8 * 24 * 60 * 60 * 1000 - index * 1000, 100 + index, true);
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { fresh, stale };
  }, { count, staleCount });
}

/** The snapshot <img> of the detail screen, once the evidence panel is mounted. */
const snapshotImage = (page) => page.getByTestId('incident-snapshot').locator('img');

test('an engine incident, its snapshot and its ack survive a reload', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  await page.goto(BASE);
  await waitForIsolation(page);

  // With no engine started and the demo fixtures off, the shift report is empty: that is
  // the baseline the restored incidents must add to.
  await openView(page, 'reports');
  const baselineTotal = Number(await page.getByTestId('report-total').innerText());
  expect(baselineTotal).toBe(0);

  await openView(page, 'live');
  // The default list has no fixture cards at all; the demo toggle is never touched here.
  await expect(page.getByTestId('incident-card')).toHaveCount(0);
  await startEngine(page);
  // An open incident makes the queue the default; this test is about the card's durable
  // snapshot, so pin the Flux list before waiting for it.
  await feedMode(page, 'flux');

  // A card tagged `local` is a real engine incident; fixture cards never carry the badge.
  const localCard = firstLocalIncident(page);
  await expect(localCard).toBeVisible({ timeout: INCIDENT_TIMEOUT_MS });
  const eventId = await localCard.getAttribute('data-event-id');
  expect(eventId).toMatch(/^evt_/);

  await localCard.getByTestId('incident-open').click();
  await expectIncidentDetail(page, eventId);

  // The live snapshot is a page-owned blob URL and it really renders.
  await expect(snapshotImage(page)).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => snapshotImage(page).evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

  const ack = page.getByTestId('decision-ack');
  await ack.click();
  await expect(ack).toHaveAttribute('data-acked', 'true');

  // Wait until the store reports the incident and the ack, so the reload cannot race a write.
  await openView(page, 'settings');
  await expect(localStat(page, 'incidents')).toHaveText(/[1-9]\d* \/ 200/, {
    timeout: 30_000,
  });
  await expect(localStat(page, 'acks')).toHaveText(/[1-9]\d*/, { timeout: 30_000 });
  await expect(localStat(page, 'snapshots')).toHaveText(/^[1-9]\d* snapshot/);

  // A full document load of the deep link: the incident, its snapshot and its ack come back.
  await page.goto(`${BASE}incidents/${eventId}`);
  await expectIncidentDetail(page, eventId, { restored: true });
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');
  await expect(snapshotImage(page)).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => snapshotImage(page).evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

  // No duplicate row after hydration, and the shift report counts the restored incident.
  await openView(page, 'incidents');
  await expect(
    page.locator(`[data-testid="incident-row"][data-event-id="${eventId}"]`)
  ).toHaveCount(1);
  await openView(page, 'reports');
  const restoredTotal = Number(await page.getByTestId('report-total').innerText());
  expect(restoredTotal).toBeGreaterThan(baselineTotal);

  expectNoPageErrors(problems);
});

test('retention prunes by count and age, and clearing leaves the fixtures', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  await page.goto(BASE);
  // The isolation service worker reloads the tab once; seed after that, or the evaluate
  // dies with the old document.
  await waitForIsolation(page);

  // A demo fixture is never stored as an incident, but its confirmation is still an
  // operator decision: seed the override before the retention check, then prove it returns.
  // The fixtures are off by default, so the toggle is what puts a fixture row on screen.
  await setDemoData(page, true);
  await openView(page, 'incidents');
  const fixtureRow = page.getByTestId('incident-row').first();
  await expect(fixtureRow).toBeVisible();
  const fixtureId = await fixtureRow.getAttribute('data-event-id');
  await fixtureRow.click();
  await expect(page.getByTestId('decision-ack')).toBeVisible();
  await page.getByTestId('decision-ack').click();
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');

  // The override write is fire-and-forget; wait for the store to report it before reloading.
  await openView(page, 'settings');
  await expect(localStat(page, 'acks')).toHaveText('1', { timeout: 30_000 });

  const { fresh, stale } = await seedStoredIncidents(page, { count: 204, staleCount: 1 });
  expect(stale).toHaveLength(1);

  // Prune runs during hydration: 205 rows in, 200 newest out, the 8-day-old one gone.
  await page.reload();
  await openView(page, 'settings');
  await expect(localStat(page, 'incidents')).toHaveText('200 / 200', { timeout: 90_000 });

  // The fixture override was not tied to a stored incident; prune must not drop it.
  await page.goto(`${BASE}incidents/${fixtureId}`);
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');

  await page.goto(`${BASE}incidents/${stale[0]}`);
  await expect(page.getByTestId('incident-empty')).toBeVisible();

  // The oldest fresh rows also fell outside the count budget.
  await page.goto(`${BASE}incidents/${fresh[fresh.length - 1]}`);
  await expect(page.getByTestId('incident-empty')).toBeVisible();

  // Delete local data: the store empties, the seeded incidents leave the list, fixtures stay.
  await openView(page, 'settings');
  await page.getByTestId('local-clear').click();
  await expect(page.getByTestId('local-clear-warning')).toBeVisible();
  await page.getByTestId('local-clear-confirm').click();
  await expect(localStat(page, 'incidents')).toHaveText('0 / 200', { timeout: 30_000 });
  await expect(localStat(page, 'snapshots')).toHaveText(/^0 snapshot/);

  await openView(page, 'incidents');
  await expect(
    page.locator(`[data-testid="incident-row"][data-event-id="${fresh[0]}"]`)
  ).toHaveCount(0);
  await expect(page.getByTestId('incident-row').first()).toBeVisible();

  // The deletion is durable: a deep link to a cleared incident stays empty after a reload.
  await page.goto(`${BASE}incidents/${fresh[0]}`);
  await expect(page.getByTestId('incident-empty')).toBeVisible();

  expectNoPageErrors(problems);
});

test('a blocked or private IndexedDB does not break boot', async ({ page }) => {
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  // What private modes and storage policies do: the global is simply not usable.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    } catch {
      // A hardened browser without the property behaves the same way.
    }
  });

  await page.goto(BASE);
  await expect(page.getByTestId('app-title')).toBeVisible();

  await openView(page, 'settings');
  const panel = page.getByTestId('local-data');
  await expect(panel).toHaveAttribute('data-supported', 'false');
  await expect(localStat(page, 'storage')).toHaveText(/IndexedDB indisponibil/);
  await expect(page.getByTestId('local-storage-note')).toContainText(/Mod privat, stocare blocată/);
  await expect(localStat(page, 'incidents')).toHaveText('0 / 200');

  // The demo fixtures still drive the product with no durable store at all — but only
  // when they are asked for; the default list stays real-detection-only.
  await openView(page, 'incidents');
  await expect(page.getByTestId('incidents-empty')).toBeVisible();
  await expect(page.getByTestId('incident-row')).toHaveCount(0);

  await setDemoData(page, true);
  await openView(page, 'incidents');
  await expect(page.getByTestId('incident-row').first()).toBeVisible();

  expectNoPageErrors(problems);
});
