// Why the frame source is not advancing, in the words the operator needs.
//
// The engine is paced by the media element: `requestVideoFrameCallback` fires only for
// frames the element actually presents, so a stopped element feeds the worker once and
// then nothing. That is not a slow model and not a missing COOP/COEP header, so it must
// not be reported as either. Firefox for Android blocks the autoplay of *every* media
// element — muted clips included, because its `media.autoplay.default` is 5 ("block audio
// and video") — while a `MediaStream` (the local camera) is exempt. The same page can
// therefore run the engine on the webcam and sit forever on the demo clip.
//
// This module is pure so the decision can be checked with `node --test`; the playback
// attempt itself lives in useEngine.js.

/** A refusal to start playback is the browser's autoplay policy unless it says otherwise. */
export const AUTOPLAY_ERROR_NAMES = Object.freeze(['NotAllowedError']);

/**
 * A refused `play()` is a definitive answer: the element will keep presenting nothing
 * until the page gets the gesture the policy asks for.
 */
export const AUTOPLAY_BLOCKED_MESSAGE =
  'Browserul blochează pornirea automată a clipului (politica de autoplay; pe Firefox '
  + 'pentru Android include clipurile fără sunet). Atinge o dată fluxul: motorul pornește '
  + 'singur după aceea.';

/** The element is stopped for another reason (a pause, a decoder that gave up). */
export const SOURCE_STOPPED_MESSAGE =
  'Clipul nu rulează, iar motorul primește cadre doar cât timp fluxul rulează. Atinge '
  + 'fluxul pentru a reporni redarea.';

/** How long a stopped element with a decoded frame is tolerated before it is reported. */
export const SOURCE_STOPPED_AFTER_MS = 3000;

/** @param {unknown} error a `play()` rejection, or its `name`. */
export function isAutoplayBlocked(error) {
  const name = typeof error === 'string' ? error : error?.name;
  return AUTOPLAY_ERROR_NAMES.includes(name);
}

/**
 * The sentence to show while the source produces no frames, or `null` when the element is
 * playing (the engine is only waiting for the model) or still legitimately loading.
 *
 * @param {{ paused?: boolean, playErrorName?: string|null, pausedMs?: number,
 *           readyState?: number }} state
 * @returns {string|null}
 */
export function sourceStallNote({
  paused = false,
  playErrorName = null,
  pausedMs = 0,
  readyState = 0,
} = {}) {
  if (!paused) return null;
  // A refusal is the answer itself, whatever the element has buffered: asking again
  // without a gesture cannot succeed.
  if (isAutoplayBlocked(playErrorName)) return AUTOPLAY_BLOCKED_MESSAGE;
  // A paused element that has nothing decoded yet may simply be loading on a slow
  // connection; saying "it is stopped" there would be a guess.
  if (readyState >= 2 && pausedMs >= SOURCE_STOPPED_AFTER_MS) return SOURCE_STOPPED_MESSAGE;
  return null;
}
