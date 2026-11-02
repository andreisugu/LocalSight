import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENGINE_SETTINGS,
  ENGINE_SETTINGS_KEY,
  WASM_THREAD_CHOICES,
  normalizeWasmThreads,
  readEngineSettings,
  resolveWasmThreads,
  storeEngineSettings,
  storeSafetyBlur,
  storeWasmThreads,
} from './engineSettings.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

function throwingStorage() {
  return {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
}

test('defaults are auto threads and safety blur ON', () => {
  assert.deepEqual(readEngineSettings(memoryStorage()), { wasmThreads: 'auto', safetyBlur: true });
  assert.deepEqual(readEngineSettings(null), DEFAULT_ENGINE_SETTINGS);
  assert.deepEqual(readEngineSettings({}), DEFAULT_ENGINE_SETTINGS);
  assert.equal(DEFAULT_ENGINE_SETTINGS.safetyBlur, true);
});

test('a stored pair is read back unchanged', () => {
  const storage = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 4, safetyBlur: false }),
  });
  assert.deepEqual(readEngineSettings(storage), { wasmThreads: 4, safetyBlur: false });
  assert.deepEqual(
    readEngineSettings(memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 'auto', safetyBlur: true }) })),
    { wasmThreads: 'auto', safetyBlur: true },
  );
});

test('corrupt JSON falls back to the defaults', () => {
  for (const raw of ['{not json', '', 'null', '42', '"auto"', '[]']) {
    assert.deepEqual(
      readEngineSettings(memoryStorage({ [ENGINE_SETTINGS_KEY]: raw })),
      DEFAULT_ENGINE_SETTINGS,
      `raw value ${raw}`,
    );
  }
});

test('each invalid field falls back on its own, the valid one survives', () => {
  const invalidThreads = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 3, safetyBlur: false }),
  });
  assert.deepEqual(readEngineSettings(invalidThreads), { wasmThreads: 'auto', safetyBlur: false });

  const invalidBlur = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 6, safetyBlur: 'false' }),
  });
  assert.deepEqual(readEngineSettings(invalidBlur), { wasmThreads: 6, safetyBlur: true });

  const stringThreads = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: '4', safetyBlur: true }),
  });
  assert.deepEqual(readEngineSettings(stringThreads), { wasmThreads: 'auto', safetyBlur: true });
});

test('a storage that throws is treated as empty', () => {
  assert.deepEqual(readEngineSettings(throwingStorage()), DEFAULT_ENGINE_SETTINGS);
});

test('only the offered thread choices normalize', () => {
  assert.equal(normalizeWasmThreads('auto'), 'auto');
  assert.equal(normalizeWasmThreads(1), 1);
  assert.equal(normalizeWasmThreads(2), 2);
  assert.equal(normalizeWasmThreads(4), 4);
  assert.equal(normalizeWasmThreads(6), 6);
  assert.equal(normalizeWasmThreads(8), 8);
  for (const value of [0, 3, 5, 7, 9, -4, 4.5, 'auto ', '2', true, null, undefined]) {
    assert.equal(normalizeWasmThreads(value), null, `value ${String(value)}`);
  }
  assert.deepEqual([...WASM_THREAD_CHOICES], ['auto', 1, 2, 4, 6, 8]);
});

test('without isolation the answer is always one thread', () => {
  const env = { crossOriginIsolated: false, hardwareConcurrency: 16 };
  for (const setting of WASM_THREAD_CHOICES) {
    assert.equal(resolveWasmThreads(setting, env), 1, `setting ${setting}`);
  }
});

test('auto is min(4, cores) when isolated', () => {
  assert.equal(resolveWasmThreads('auto', { crossOriginIsolated: true, hardwareConcurrency: 16 }), 4);
  assert.equal(resolveWasmThreads('auto', { crossOriginIsolated: true, hardwareConcurrency: 8 }), 4);
  assert.equal(resolveWasmThreads('auto', { crossOriginIsolated: true, hardwareConcurrency: 2 }), 2);
  assert.equal(resolveWasmThreads('auto', { crossOriginIsolated: true, hardwareConcurrency: 1 }), 1);
});

test('an explicit choice is clamped to 1..min(8, cores)', () => {
  const env = { crossOriginIsolated: true, hardwareConcurrency: 16 };
  assert.equal(resolveWasmThreads(1, env), 1);
  assert.equal(resolveWasmThreads(2, env), 2);
  assert.equal(resolveWasmThreads(4, env), 4);
  assert.equal(resolveWasmThreads(6, env), 6);
  assert.equal(resolveWasmThreads(8, env), 8);

  assert.equal(resolveWasmThreads(8, { crossOriginIsolated: true, hardwareConcurrency: 4 }), 4);
  assert.equal(resolveWasmThreads(6, { crossOriginIsolated: true, hardwareConcurrency: 3 }), 3);
  assert.equal(resolveWasmThreads(4, { crossOriginIsolated: true, hardwareConcurrency: 1 }), 1);
});

test('a missing or nonsense core count falls back to the old default of 4', () => {
  for (const hardwareConcurrency of [undefined, null, 0, -2, Number.NaN, '16']) {
    assert.equal(
      resolveWasmThreads('auto', { crossOriginIsolated: true, hardwareConcurrency }),
      4,
      `value ${String(hardwareConcurrency)}`,
    );
    assert.equal(
      resolveWasmThreads(8, { crossOriginIsolated: true, hardwareConcurrency }),
      4,
      `value ${String(hardwareConcurrency)}`,
    );
  }
});

test('an invalid stored setting behaves like auto instead of guessing', () => {
  const env = { crossOriginIsolated: true, hardwareConcurrency: 16 };
  assert.equal(resolveWasmThreads(3, env), 4);
  assert.equal(resolveWasmThreads('4', env), 4);
  assert.equal(resolveWasmThreads(undefined, env), 4);
});

test('storeWasmThreads persists a valid choice and returns the merged settings', () => {
  const storage = memoryStorage();
  assert.deepEqual(storeWasmThreads(6, storage), { wasmThreads: 6, safetyBlur: true });
  assert.deepEqual(JSON.parse(storage.data[ENGINE_SETTINGS_KEY]), { wasmThreads: 6, safetyBlur: true });
  assert.deepEqual(readEngineSettings(storage), { wasmThreads: 6, safetyBlur: true });
});

test('storeSafetyBlur persists a boolean and keeps the thread choice', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 2, safetyBlur: true }) });
  assert.deepEqual(storeSafetyBlur(false, storage), { wasmThreads: 2, safetyBlur: false });
  assert.deepEqual(readEngineSettings(storage), { wasmThreads: 2, safetyBlur: false });
  assert.deepEqual(storeSafetyBlur(true, storage), { wasmThreads: 2, safetyBlur: true });
});

test('invalid values are ignored, not written over a good setting', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 4, safetyBlur: false }) });
  assert.deepEqual(storeWasmThreads(7, storage), { wasmThreads: 4, safetyBlur: false });
  assert.deepEqual(storeWasmThreads('many', storage), { wasmThreads: 4, safetyBlur: false });
  assert.deepEqual(storeSafetyBlur('off', storage), { wasmThreads: 4, safetyBlur: false });
  assert.deepEqual(readEngineSettings(storage), { wasmThreads: 4, safetyBlur: false });
});

test('a corrupt store is repaired by the first valid write', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: '{oops' });
  assert.deepEqual(storeWasmThreads(8, storage), { wasmThreads: 8, safetyBlur: true });
  assert.deepEqual(JSON.parse(storage.data[ENGINE_SETTINGS_KEY]), { wasmThreads: 8, safetyBlur: true });
  assert.deepEqual(readEngineSettings(storage), { wasmThreads: 8, safetyBlur: true });
});

test('storeEngineSettings merges both fields and survives a blocked storage', () => {
  assert.deepEqual(
    storeEngineSettings({ wasmThreads: 4, safetyBlur: false }, throwingStorage()),
    { wasmThreads: 4, safetyBlur: false },
  );
  const storage = memoryStorage();
  storeEngineSettings({ wasmThreads: 1 }, storage);
  assert.deepEqual(storeEngineSettings({ safetyBlur: false }, storage), { wasmThreads: 1, safetyBlur: false });
  assert.doesNotThrow(() => storeEngineSettings({}, throttledStorage()));
});

function throttledStorage() {
  return {
    getItem: () => null,
    setItem() {
      throw new Error('quota');
    },
  };
}
