import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Web Audio stand-in: records what the alert schedules.
function fakeAudioContext() {
  const calls = { contexts: 0, oscillators: 0, gains: 0, resumed: 0, started: [], stopped: [] };
  class Context {
    constructor() {
      calls.contexts += 1;
      this.currentTime = 10;
      // Autoplay policy: a fresh context starts suspended until a gesture resumes it.
      this.state = 'suspended';
      this.destination = { name: 'destination' };
    }

    resume() {
      calls.resumed += 1;
      this.state = 'running';
      return Promise.resolve();
    }

    createOscillator() {
      calls.oscillators += 1;
      const index = calls.oscillators;
      return {
        type: 'sine',
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: (at) => calls.started.push({ index, at }),
        stop: (at) => calls.stopped.push({ index, at }),
      };
    }

    createGain() {
      calls.gains += 1;
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      };
    }
  }
  return { Context, calls };
}

const { Context, calls } = fakeAudioContext();
globalThis.window = { AudioContext: Context };

const { playCriticalAlertSound } = await import('./sound.js');

test('one shared AudioContext is reused across alerts', () => {
  playCriticalAlertSound();
  playCriticalAlertSound();
  assert.equal(calls.contexts, 1);
});

test('the first alert resumes the suspended context exactly once', () => {
  assert.equal(calls.resumed, 1);
});

test('each alert schedules two tones with the expected offsets', () => {
  playCriticalAlertSound();
  assert.equal(calls.oscillators, 6);
  assert.equal(calls.gains, 6);
  assert.deepEqual(calls.started.slice(-2).map((item) => item.at), [10, 10.14]);
  const stopped = calls.stopped.slice(-2).map((item) => item.at);
  assert.ok(Math.abs(stopped[0] - 10.12) < 1e-9);
  assert.ok(Math.abs(stopped[1] - 10.28) < 1e-9);
});

test('a browser without Web Audio is a no-op, not a crash', () => {
  const saved = globalThis.window;
  globalThis.window = {};
  assert.doesNotThrow(() => playCriticalAlertSound());
  assert.equal(calls.oscillators, 6);
  globalThis.window = saved;
});
