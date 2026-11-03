import { expect, test } from '@playwright/test';
import { PAGES_BASE as BASE, waitForIsolation } from '../helpers.mjs';

// The reported bug: on Firefox on a phone the browser engine never started on the static
// demo clips, while it worked on the webcam.
//
// The asymmetry is the browser's, not the detector's. Firefox for Android blocks autoplay
// for every media element (muted clips included), so the clip arrives `paused` and never
// presents a frame; a `MediaStream` camera is exempt from that policy. The engine is paced
// by the element, so it waits forever — and before this suite existed it either froze on
// one frame at 0 fps or sat at "se încarcă" without saying why.
//
// This test holds the two halves of the fix: the refusal is named (not blamed on the model
// or on COOP/COEP), and the tap the policy asks for is enough to start the clip and the
// engine. The preference that blocks playback is set in playwright.firefox.config.js.
test('a clip blocked by the autoplay policy is named, and one tap starts the engine', async ({
  page,
}) => {
  test.setTimeout(300_000);

  // The engine was enabled on a previous visit: no start button, so no gesture before the
  // first frame. This is the exact state a returning visitor on a phone lands in.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('localsight.liveEngine', '1');
    } catch {
      // Storage can be unavailable; the test then relies on the button below.
    }
  });

  await page.goto(BASE);
  // Start isolated, like a demo visitor after the worker's one automatic reload.
  await waitForIsolation(page);

  const status = page.getByTestId('engine-status');
  const card = page.getByTestId('engine-card');

  // The browser refused playback, and the card says so in the browser's own terms.
  await expect(card).toContainText('politica de autoplay', { timeout: 60_000 });
  await expect(status).toHaveAttribute('data-engine-status', 'error');
  // The card must not blame the engine stack while the element is simply stopped.
  await expect(card).not.toContainText('COOP/COEP');
  // The clip really is stopped: the engine cannot be processing frames.
  expect(await page.evaluate(() => document.querySelector('video')?.paused)).toBe(true);

  // One tap anywhere is the permission the policy wants (a pointerdown listener resumes
  // the source; the operator is not asked to find a specific control).
  await page.touchscreen.tap(195, 420);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.paused), { timeout: 30_000 })
    .toBe(false);

  // From here the engine is a normal run: the worker's first result flips the status.
  await expect(status).toHaveAttribute('data-engine-status', 'running', { timeout: 180_000 });
  const fpsChip = page.getByTestId('engine-fps');
  await expect(fpsChip).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => Number(await fpsChip.getAttribute('data-fps')), { timeout: 60_000 })
    .toBeGreaterThan(0);
  // The policy sentence is withdrawn once frames flow.
  await expect(card).not.toContainText('politica de autoplay');
});
