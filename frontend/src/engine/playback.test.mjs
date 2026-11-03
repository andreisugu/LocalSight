// The frame source must be advancing: a stopped <video> feeds the worker once and then
// nothing, which looks exactly like a wedged model. Firefox for Android blocks autoplay
// for muted clips too, so the demo clip can arrive paused while the webcam never does.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOPLAY_BLOCKED_MESSAGE,
  SOURCE_STOPPED_AFTER_MS,
  SOURCE_STOPPED_MESSAGE,
  isAutoplayBlocked,
  sourceStallNote,
} from './playback.js';

test('a refused play() is recognised by name, not by message', () => {
  assert.equal(isAutoplayBlocked({ name: 'NotAllowedError' }), true);
  assert.equal(isAutoplayBlocked('NotAllowedError'), true);
  assert.equal(isAutoplayBlocked({ name: 'AbortError' }), false);
  assert.equal(isAutoplayBlocked({ name: 'NotSupportedError' }), false);
  assert.equal(isAutoplayBlocked(null), false);
  assert.equal(isAutoplayBlocked(undefined), false);
  assert.equal(isAutoplayBlocked({}), false);
});

test('a playing source never reports a problem', () => {
  assert.equal(
    sourceStallNote({ paused: false, playErrorName: 'NotAllowedError', pausedMs: 60000, readyState: 4 }),
    null
  );
  assert.equal(sourceStallNote({}), null);
  assert.equal(sourceStallNote(), null);
});

test('a blocked autoplay is named immediately, even before a frame is buffered', () => {
  assert.equal(
    sourceStallNote({ paused: true, playErrorName: 'NotAllowedError', pausedMs: 0, readyState: 1 }),
    AUTOPLAY_BLOCKED_MESSAGE
  );
});

test('a stopped element is only reported once it has a frame and stays stopped', () => {
  // Still loading: the element has metadata but nothing decodable yet.
  assert.equal(sourceStallNote({ paused: true, pausedMs: 10000, readyState: 1 }), null);
  // A short pause (the moment between the gesture and the first played frame) is normal.
  assert.equal(
    sourceStallNote({
      paused: true,
      pausedMs: SOURCE_STOPPED_AFTER_MS - 1,
      readyState: 4,
    }),
    null
  );
  assert.equal(
    sourceStallNote({ paused: true, pausedMs: SOURCE_STOPPED_AFTER_MS, readyState: 4 }),
    SOURCE_STOPPED_MESSAGE
  );
});

test('an unrelated play() failure does not claim the autoplay policy', () => {
  assert.equal(
    sourceStallNote({ paused: true, playErrorName: 'AbortError', pausedMs: 0, readyState: 4 }),
    null
  );
  assert.equal(
    sourceStallNote({
      paused: true,
      playErrorName: 'AbortError',
      pausedMs: SOURCE_STOPPED_AFTER_MS,
      readyState: 4,
    }),
    SOURCE_STOPPED_MESSAGE
  );
});

test('the copy names the policy and the way out instead of blaming the engine', () => {
  assert.match(AUTOPLAY_BLOCKED_MESSAGE, /autoplay/);
  assert.match(AUTOPLAY_BLOCKED_MESSAGE, /Atinge/);
  assert.match(AUTOPLAY_BLOCKED_MESSAGE, /Android/);
  assert.match(SOURCE_STOPPED_MESSAGE, /Atinge/);
  // Neither message may pretend the model is the problem.
  assert.doesNotMatch(AUTOPLAY_BLOCKED_MESSAGE, /COOP|COEP|WASM|model/i);
  assert.doesNotMatch(SOURCE_STOPPED_MESSAGE, /COOP|COEP|WASM|model/i);
});
