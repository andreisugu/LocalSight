import { expect, test } from '@playwright/test';

// Browser evidence for the durable store: a real engine incident, its snapshot and its ack
// survive a full document load; retention prunes old rows; "delete local data" empties the
// database without touching the fixtures; a browser without IndexedDB still boots.
//
// Run with its own config (see `playwright.persistence.config.js`):
//   PW_PORT=4352 npx playwright test --config=playwright.persistence.config.js

const BASE = '/LocalSight/';

function watchPageErrors(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location()?.url || '';
    if (/images\.unsplash\.com/.test(source) || /images\.unsplash\.com/.test(message.text())) return;
    // ONNX Runtime prints shape verifications through console.error while the model warms
    // up. They are known and do not describe a page failure.
    if (/VerifyOutputSizes|Expected shape from model/.test(message.text())) return;
    // GitHub Pages answers any app route (a deep link, /settings) with 404.html and status
    // 404 by design; the app then renders it. Only those document paths are skipped, so a
    // missing asset still counts.
    if (
      /status of 404/.test(message.text())
      && /\/LocalSight\/(?:incidents|settings|zones|reports|live|lab|bench)(?:\/|$)/.test(source)
    ) return;
    problems.push(`console.error: ${message.text()}`);
  });
  return problems;
}

/**
 * Wait until the document is isolated. The service worker reloads the tab once when it
 * claims the page; `page.evaluate` throws during that reload, which simply means "not yet".
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

async function openView(page, name) {
  await page.getByRole('complementary').getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

const localPanel = (page) => page.getByRole('region', { name: /date locale/i });

/** The `<dd>` under one `<dt>` label of the local-data panel. */
const statValue = (panel, label) => panel
  .locator('dt', { hasText: new RegExp(`^${label}$`) })
  .locator('..')
  .locator('dd');

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
          model: 'yolo26n',
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

test('an engine incident, its snapshot and its ack survive a reload', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watchPageErrors(page);

  await page.goto(BASE);
  await waitForIsolation(page);

  // The fixture-only shift report is the baseline; restored incidents must add to it.
  await openView(page, 'Rapoarte Tură');
  const baselineTotal = Number(await page.getByTestId('report-total').innerText());
  expect(Number.isFinite(baselineTotal)).toBe(true);

  await openView(page, 'Live');
  await page.getByRole('button', { name: /pornește motorul în browser/i }).click();

  // The engine card only says "rulează" after real frames arrived.
  const engineCard = page.getByRole('region', { name: 'Motor și senzori' });
  await expect(engineCard.getByText('rulează', { exact: true })).toBeVisible({ timeout: 120_000 });

  // A card tagged `local` is a real engine incident; fixture cards never carry the badge.
  // `hasText` sees concatenated textContent ("Deschislocal…"), so the badge is matched as
  // its own element instead of with a word boundary.
  const localCard = page
    .locator('[aria-label^="Deschide incidentul evt_"]')
    .filter({ has: page.getByText('local', { exact: true }) })
    .first();
  await expect(localCard).toBeVisible({ timeout: 180_000 });
  const label = await localCard.getAttribute('aria-label');
  const eventId = (label || '').replace('Deschide incidentul ', '').trim();
  expect(eventId).toMatch(/^evt_/);

  await localCard.click();
  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(`^incident: ${eventId}$`, 'i') })
  ).toBeVisible();

  // The live snapshot is a page-owned blob URL and it really renders.
  const snapshot = page.getByRole('img', { name: 'Cadru incident blurat' });
  await expect(snapshot).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => snapshot.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Confirmă$/i }).click();
  await expect(page.getByRole('button', { name: /^Confirmat$/i })).toBeVisible();

  // Wait until the store reports the incident and the ack, so the reload cannot race a write.
  await openView(page, 'Sistem & Audit');
  const panel = localPanel(page);
  await expect(statValue(panel, 'Incidente salvate')).toHaveText(/[1-9]\d* \/ 200/, {
    timeout: 30_000,
  });
  await expect(statValue(panel, 'Confirmări salvate')).toHaveText(/[1-9]\d*/, {
    timeout: 30_000,
  });
  await expect(panel.getByText(/^[1-9]\d* snapshot/)).toBeVisible();

  // A full document load of the deep link: the incident, its snapshot and its ack come back.
  await page.goto(`${BASE}incidents/${eventId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(`^incident: ${eventId}$`, 'i') })
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: /^Confirmat$/i })).toBeVisible();
  const restored = page.getByRole('img', { name: 'Cadru incident blurat' });
  await expect(restored).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => restored.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

  // No duplicate row after hydration, and the shift report counts the restored incident.
  await openView(page, 'Incidente');
  await expect(page.locator(`[aria-label="Deschide incidentul ${eventId}"]`)).toHaveCount(1);
  await openView(page, 'Rapoarte Tură');
  const restoredTotal = Number(await page.getByTestId('report-total').innerText());
  expect(restoredTotal).toBeGreaterThan(baselineTotal);

  expect(problems, 'the page must not log errors').toEqual([]);
});

test('retention prunes by count and age, and clearing leaves the fixtures', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchPageErrors(page);

  await page.goto(BASE);
  // The isolation service worker reloads the tab once; seed after that, or the evaluate
  // dies with the old document.
  await waitForIsolation(page);

  // A demo fixture is never stored as an incident, but its confirmation is still an
  // operator decision: seed the override before the retention check, then prove it returns.
  await openView(page, 'Incidente');
  await page.getByRole('listitem').first().getByRole('button').click();
  const fixtureId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
  await page.getByRole('button', { name: /^Confirmă$/i }).click();
  await expect(page.getByRole('button', { name: /^Confirmat$/i })).toBeVisible();

  // The override write is fire-and-forget; wait for the store to report it before reloading.
  await openView(page, 'Sistem & Audit');
  await expect(statValue(localPanel(page), 'Confirmări salvate')).toHaveText('1', {
    timeout: 30_000,
  });

  const { fresh, stale } = await seedStoredIncidents(page, { count: 204, staleCount: 1 });
  expect(stale).toHaveLength(1);

  // Prune runs during hydration: 205 rows in, 200 newest out, the 8-day-old one gone.
  await page.reload();
  await openView(page, 'Sistem & Audit');
  const panel = localPanel(page);
  await expect(statValue(panel, 'Incidente salvate')).toHaveText('200 / 200', {
    timeout: 90_000,
  });

  // The fixture override was not tied to a stored incident; prune must not drop it.
  await page.goto(`${BASE}incidents/${fixtureId}`);
  await expect(page.getByRole('button', { name: /^Confirmat$/i })).toBeVisible();

  await page.goto(`${BASE}incidents/${stale[0]}`);
  await expect(page.getByText('Niciun incident selectat')).toBeVisible();

  // The oldest fresh rows also fell outside the count budget.
  await page.goto(`${BASE}incidents/${fresh[fresh.length - 1]}`);
  await expect(page.getByText('Niciun incident selectat')).toBeVisible();

  // Delete local data: the store empties, the seeded incidents leave the list, fixtures stay.
  await openView(page, 'Sistem & Audit');
  await page.getByRole('button', { name: /^Șterge datele locale$/ } ).click();
  await expect(page.getByRole('alert')).toContainText('Fixture-urile demo rămân');
  await page.getByRole('button', { name: /^Da, șterge$/ }).click();
  await expect(statValue(panel, 'Incidente salvate')).toHaveText('0 / 200', {
    timeout: 30_000,
  });
  await expect(panel.getByText(/^0 snapshot-uri/)).toBeVisible();

  await openView(page, 'Incidente');
  await expect(page.locator(`[aria-label="Deschide incidentul ${fresh[0]}"]`)).toHaveCount(0);
  await expect(page.getByRole('listitem').first()).toBeVisible();

  // The deletion is durable: a deep link to a cleared incident stays empty after a reload.
  await page.goto(`${BASE}incidents/${fresh[0]}`);
  await expect(page.getByText('Niciun incident selectat')).toBeVisible();

  expect(problems, 'the page must not log errors').toEqual([]);
});

test('a blocked or private IndexedDB does not break boot', async ({ page }) => {
  const problems = watchPageErrors(page);

  // What private modes and storage policies do: the global is simply not usable.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    } catch {
      // A hardened browser without the property behaves the same way.
    }
  });

  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1, name: /localsight/i })).toBeVisible();

  await openView(page, 'Sistem & Audit');
  const panel = localPanel(page);
  await expect(panel.getByText('IndexedDB indisponibil')).toBeVisible();
  await expect(panel.getByText(/Mod privat, stocare blocată/)).toBeVisible();
  await expect(panel.getByText(/incidentele nu supraviețuiesc reîncărcării/)).toBeVisible();
  await expect(statValue(panel, 'Incidente salvate')).toHaveText('0 / 200');

  // The demo fixtures still drive the product with no durable store at all.
  await openView(page, 'Incidente');
  await expect(page.getByRole('listitem').first()).toBeVisible();

  expect(problems, 'the page must not log errors').toEqual([]);
});
