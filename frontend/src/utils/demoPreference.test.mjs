import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHOW_DEMO_DATA,
  DEMO_DATA_KEY,
  initialShowDemoData,
  readStoredShowDemoData,
  storeShowDemoData,
} from './demoPreference.js';

/** A minimal stand-in for `localStorage`, plus the ways it can misbehave. */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('the default is "real detections only"', () => {
  assert.equal(DEFAULT_SHOW_DEMO_DATA, false);
  assert.equal(initialShowDemoData(memoryStorage()), false);
});

test('a stored choice survives, in both directions', () => {
  assert.equal(initialShowDemoData(memoryStorage({ [DEMO_DATA_KEY]: 'true' })), true);
  assert.equal(initialShowDemoData(memoryStorage({ [DEMO_DATA_KEY]: 'false' })), false);
});

test('a planted or legacy value is rejected, never guessed at', () => {
  for (const raw of ['1', 'yes', 'TRUE', 'demo', '{"on":true}', 'true ']) {
    const storage = memoryStorage({ [DEMO_DATA_KEY]: raw });
    assert.equal(readStoredShowDemoData(storage), null);
    assert.equal(initialShowDemoData(storage), false);
  }
});

test('the toggle writes exactly the two literals this module reads', () => {
  const storage = memoryStorage();
  storeShowDemoData(true, storage);
  assert.equal(storage.values.get(DEMO_DATA_KEY), 'true');
  assert.equal(readStoredShowDemoData(storage), true);

  storeShowDemoData(false, storage);
  assert.equal(storage.values.get(DEMO_DATA_KEY), 'false');
  assert.equal(readStoredShowDemoData(storage), false);
});

test('a missing or broken storage falls back instead of throwing', () => {
  assert.equal(initialShowDemoData(null), false);
  assert.equal(readStoredShowDemoData(undefined), null);

  const hostile = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(initialShowDemoData(hostile), false);
  assert.doesNotThrow(() => storeShowDemoData(true, hostile));
  assert.doesNotThrow(() => storeShowDemoData(true, null));
});
