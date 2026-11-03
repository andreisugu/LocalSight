import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  PAGES_BASE as BASE,
  expectNoPageErrors,
  openView,
  waitForIsolation,
  watchPageErrors,
} from '../e2e/helpers.mjs';

// The local archive, end to end: what the browser remembers becomes one JSON file and the
// file becomes the browser's data again. No backend, no upload.
//
// Run with its own config (the deployed Pages shape, one worker):
//   PW_PORT=4352 npx playwright test --config=playwright.persistence.config.js
//
// The incident is seeded straight into the documented schema (as the persistence suite
// does) instead of waiting minutes for the engine: this suite is about the file, not about
// detection. Every write goes through the real UI button, and the download is the real
// browser download.

/** A real 1x1 PNG, so the restored <img> decodes instead of logging a load error. */
const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/**
 * Open the app's database with the documented shape. Both helpers close their connection,
 * so the app's own adapter stays authoritative.
 */
async function withDatabase(page, run) {
  return page.evaluate(async ({ bytes, mode }) => {
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
    const eventId = `evt_archive_${now}_1`;
    const detected = new Date(now).toISOString();
    const tx = db.transaction(['events', 'evidence', 'acks', 'meta'], 'readwrite');
    if (mode === 'seed') {
      const event = {
        event_id: eventId,
        type: 'RESTRICTED_ZONE',
        severity: 'WARNING',
        status: 'open',
        camera_id: 'stand12',
        zone_id: 'engine-left',
        track_id: 1,
        confidence: { detector: 0.8, temporal: { seen: 3, window: 5 } },
        duration_s: 1.2,
        context: { engine_on: true },
        snapshot_url: `blob:http://localhost/${eventId}`,
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
          severity_reason: 'Test pentru arhiva locală.',
          recommended_action: 'Verifică zona.',
          source: 'template',
        },
        local: true,
      };
      tx.objectStore('events').put({ event_id: eventId, schema: 1, stored_at: now, event });
      tx.objectStore('evidence').put({
        event_id: eventId,
        schema: 1,
        stored_at: now,
        size: bytes.length,
        type: 'image/png',
        blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      });
      tx.objectStore('acks').put({
        event_id: eventId,
        schema: 1,
        updated_at: now,
        override: {
          status: 'acknowledged',
          acked_at: detected,
          acked_by: 'Ana',
          escalated_at: null,
        },
      });
      tx.objectStore('meta').put({ key: 'schema_version', value: 1 });
    } else {
      for (const name of ['events', 'evidence', 'acks', 'meta']) {
        tx.objectStore(name).clear();
      }
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return eventId;
  }, { bytes: PNG_BYTES, mode: run });
}

const seedIncident = (page) => withDatabase(page, 'seed');
const clearStoredData = (page) => withDatabase(page, 'clear');

const localCount = (page, name) => page.getByTestId(`archive-count-${name}`);

test('export writes a JSON archive and import restores the incident, snapshot and ack', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  await page.goto(BASE);
  // The isolation worker reloads the tab once; seed only after that, or the evaluate dies
  // with the old document.
  await waitForIsolation(page);
  const eventId = await seedIncident(page);

  // The rail entry reaches the route; the address bar carries the same screen.
  await openView(page, 'archive');
  await expect(page).toHaveURL(new RegExp(`/LocalSight/archive$`));
  await expect(page.getByTestId('archive-export')).toBeVisible();
  await expect(page.getByTestId('archive-import')).toBeVisible();

  // Counts come from the store, not from the UI's memory: the seeded row was never loaded
  // into the incident list of this document.
  await expect(localCount(page, 'events')).toHaveText('1 / 200', { timeout: 30_000 });
  await expect(localCount(page, 'evidence')).toHaveText('1');
  await expect(localCount(page, 'acks')).toHaveText('1');

  // The download is the real browser download, not a blob inspected in-page.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('archive-export').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^localsight-archive-\d{8}-\d{6}\.json$/);
  await expect(page.getByTestId('archive-status')).toContainText(/Arhivă descărcată/);
  await expect(page.getByTestId('archive-status')).toHaveAttribute('data-tone', 'ok');

  const filePath = await download.path();
  const archive = JSON.parse(await readFile(filePath, 'utf8'));
  expect(archive.app).toBe('LocalSight');
  expect(archive.schema).toBe(1);
  expect(archive.counts).toEqual({ events: 1, evidence: 1, acks: 1 });
  expect(archive.events.map((event) => event.event_id)).toEqual([eventId]);
  expect(archive.evidence).toHaveLength(1);
  expect(archive.evidence[0]).toMatchObject({ event_id: eventId, mime: 'image/png' });
  // The file carries the real bytes, not a reference to a page-owned blob URL.
  expect([...Buffer.from(archive.evidence[0].base64, 'base64').subarray(0, 8)]).toEqual(
    PNG_BYTES.slice(0, 8)
  );
  expect(archive.acks).toEqual([{
    event_id: eventId,
    override: expect.objectContaining({ status: 'acknowledged', acked_by: 'Ana' }),
  }]);

  // Wipe the browser's copy, exactly like a cleared profile, then import the file back.
  await clearStoredData(page);
  await page.reload();
  await waitForIsolation(page);
  await openView(page, 'archive');
  await expect(localCount(page, 'events')).toHaveText('0 / 200', { timeout: 30_000 });
  await expect(localCount(page, 'evidence')).toHaveText('0');
  await expect(localCount(page, 'acks')).toHaveText('0');

  await page.getByTestId('archive-file').setInputFiles(filePath);
  const summary = page.getByTestId('archive-summary');
  await expect(summary).toBeVisible();
  // Choosing a file moves focus to the consequence: the operator reads the summary and the
  // replacement warning before the destructive button.
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('1 incident în fișier');
  await expect(summary).toContainText('1 nou');
  await expect(summary).toContainText('0 identice');
  // The warning names what the replacement would remove, before the destructive click.
  await expect(page.getByTestId('archive-replace')).toBeVisible();

  const reloaded = page.waitForEvent('load');
  await page.getByTestId('archive-replace').click();
  await reloaded;
  await waitForIsolation(page);

  // The provider hydrated the imported rows: the deep link renders the incident, its
  // snapshot comes back as a fresh object URL and the operator's ack is still applied.
  await page.goto(`${BASE}incidents/${eventId}`);
  await expect(page.getByTestId('incident-id')).toHaveText(eventId, { timeout: 90_000 });
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');

  const snapshot = page.getByTestId('incident-snapshot').locator('img');
  await expect(snapshot).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => snapshot.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);

  // A full reload keeps the restored store (it is IndexedDB, not this render's state).
  await page.reload();
  await expect(page.getByTestId('incident-id')).toHaveText(eventId, { timeout: 90_000 });
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');

  expectNoPageErrors(problems);
});

test('a corrupt, empty or foreign file is rejected without touching local data', async ({ page }) => {
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  await page.goto(BASE);
  await waitForIsolation(page);
  const eventId = await seedIncident(page);
  await openView(page, 'archive');
  await expect(localCount(page, 'events')).toHaveText('1 / 200', { timeout: 30_000 });

  const status = page.getByTestId('archive-status');
  const fileInput = page.getByTestId('archive-file');
  const badFiles = [
    {
      name: 'future-schema.json',
      buffer: Buffer.from(JSON.stringify({ app: 'LocalSight', schema: 2 })),
      error: /schema/i,
    },
    { name: 'empty.json', buffer: Buffer.from('   '), error: /gol/i },
    { name: 'broken.json', buffer: Buffer.from('{not json'), error: /JSON valid/i },
    {
      name: 'foreign.json',
      buffer: Buffer.from(JSON.stringify({ app: 'OtherSight', schema: 1 })),
      error: /creat de LocalSight/i,
    },
    {
      name: 'bad-evidence.json',
      buffer: Buffer.from(JSON.stringify({
        app: 'LocalSight',
        schema: 1,
        events: [],
        evidence: [{ event_id: 'evt_x_1_1', mime: 'image/png', base64: 'AAA' }],
      })),
      error: /base64/i,
    },
  ];

  for (const file of badFiles) {
    await fileInput.setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.buffer });
    await expect(status).toHaveAttribute('data-tone', 'error');
    await expect(status).toContainText(file.error);
    // Nothing to confirm and nothing written: the summary and the destructive button stay
    // absent, and the counts did not move.
    await expect(page.getByTestId('archive-summary')).toHaveCount(0);
    await expect(page.getByTestId('archive-replace')).toHaveCount(0);
    await expect(localCount(page, 'events')).toHaveText('1 / 200');
    await expect(localCount(page, 'evidence')).toHaveText('1');
    await expect(localCount(page, 'acks')).toHaveText('1');
  }

  // A reload proves the rows are really still in IndexedDB, not only in the screen's state.
  await page.reload();
  await waitForIsolation(page);
  await page.goto(`${BASE}incidents/${eventId}`);
  await expect(page.getByTestId('incident-id')).toHaveText(eventId, { timeout: 90_000 });
  await expect(page.getByTestId('decision-ack')).toHaveAttribute('data-acked', 'true');

  expectNoPageErrors(problems);
});

test('the archive route is a deep link and is reachable from the rail', async ({ page }) => {
  const problems = watchPageErrors(page, { onnxNoise: true, pagesFallback: true });

  // Pages answers an unknown path with 404.html; the app still routes it.
  await page.goto(`${BASE}archive`);
  await expect(page.getByTestId('archive-export')).toBeVisible();
  await expect(page.getByTestId('archive-import')).toBeVisible();
  await expect(page.getByTestId('archive-status')).toHaveAttribute('aria-live', 'polite');

  // The rail entry is a real button carrying the route id, like every other module.
  await expect(page.getByTestId('nav-archive')).toBeVisible();
  await openView(page, 'incidents');
  await expect(page).toHaveURL(new RegExp(`/LocalSight/incidents$`));
  await openView(page, 'archive');
  await expect(page).toHaveURL(new RegExp(`/LocalSight/archive$`));

  expectNoPageErrors(problems);
});

test('without IndexedDB the screen says so instead of printing zeroes', async ({ page }) => {
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
  await waitForIsolation(page);
  await openView(page, 'archive');

  // No invented zero: an unavailable store has no counts at all.
  await expect(localCount(page, 'events')).toHaveText('—');
  await expect(localCount(page, 'evidence')).toHaveText('—');
  await expect(localCount(page, 'acks')).toHaveText('—');
  await expect(page.getByText(/IndexedDB este indisponibil/)).toBeVisible();
  // Export is disabled; the picker stays reachable but would refuse to write.
  await expect(page.getByTestId('archive-export')).toBeDisabled();
  await expect(page.getByTestId('archive-import')).toBeVisible();
  await expect(page.getByTestId('nav-archive')).toBeVisible();

  expectNoPageErrors(problems);
});

test('the archive screen fits a phone, a laptop and a wide screen', async ({ page }) => {
  await page.goto(`${BASE}archive`);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    // Both actions stay reachable at every width; the rail starts collapsed on a phone.
    await expect(page.getByTestId('archive-export')).toBeVisible();
    await expect(page.getByTestId('archive-import')).toBeVisible();
    await expect(page.getByTestId('archive-status')).toBeVisible();
    // No horizontal scrollbar: the counts grid and the wide button rows wrap instead.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
  }

  // The hidden picker is still labelled, so a keyboard or screen-reader user hears a name.
  await expect(page.getByLabel('Alege fișier JSON…')).toHaveCount(1);
  await expect(page.getByTestId('archive-status')).toHaveAttribute('aria-live', 'polite');
});
