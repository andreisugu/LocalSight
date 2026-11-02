import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENGINE_SETTINGS,
  DETECTOR_CHOICES,
  ENGINE_SETTINGS_KEY,
  WASM_THREAD_CHOICES,
  normalizeDetector,
  normalizeWasmThreads,
  readEngineSettings,
  resolveWasmThreads,
  storeDetector,
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

test('defaults are auto threads, safety blur ON and EfficientDet-Lite0', () => {
  const expected = { wasmThreads: 'auto', safetyBlur: true, detector: 'efficientdet' };
  assert.deepEqual(readEngineSettings(memoryStorage()), expected);
  assert.deepEqual(readEngineSettings(null), expected);
  assert.deepEqual(readEngineSettings({}), expected);
  assert.deepEqual(readEngineSettings(memoryStorage()), DEFAULT_ENGINE_SETTINGS);
  assert.equal(DEFAULT_ENGINE_SETTINGS.safetyBlur, true);
  assert.equal(DEFAULT_ENGINE_SETTINGS.detector, 'efficientdet');
});

test('the two detector choices are the only ones offered', () => {
  assert.deepEqual([...DETECTOR_CHOICES], ['efficientdet', 'efficientdet-lite2']);
  assert.equal(normalizeDetector('efficientdet'), 'efficientdet');
  assert.equal(normalizeDetector('efficientdet-lite2'), 'efficientdet-lite2');
  for (const value of ['yolo', 'yolo26n', 'efficientdet-lite0', 'EfficientDet', '', null, undefined, 0, true]) {
    assert.equal(normalizeDetector(value), null, `value ${String(value)}`);
  }
});

test('a stored Lite2 choice is read back and the default is Lite0', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ detector: 'efficientdet-lite2' }) });
  assert.deepEqual(readEngineSettings(storage), {
    wasmThreads: 'auto',
    safetyBlur: true,
    detector: 'efficientdet-lite2',
  });
  // A stored blob from the old build (no detector field, e.g. the spike) keeps the default.
  const legacy = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 4, safetyBlur: false }) });
  assert.deepEqual(readEngineSettings(legacy), {
    wasmThreads: 4,
    safetyBlur: false,
    detector: 'efficientdet',
  });
  const unknown = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ detector: 'yolo' }) });
  assert.equal(readEngineSettings(unknown).detector, 'efficientdet');
});

test('a stored pair is read back unchanged', () => {
  const storage = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 4, safetyBlur: false }),
  });
  assert.deepEqual(readEngineSettings(storage), {
    wasmThreads: 4,
    safetyBlur: false,
    detector: 'efficientdet',
  });
  assert.deepEqual(
    readEngineSettings(memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 'auto', safetyBlur: true }) })),
    { wasmThreads: 'auto', safetyBlur: true, detector: 'efficientdet' },
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

test('an oversized settings blob falls back to the defaults', () => {
  const raw = JSON.stringify({ wasmThreads: 4, safetyBlur: false, padding: 'x'.repeat(8192) });
  assert.deepEqual(readEngineSettings(memoryStorage({ [ENGINE_SETTINGS_KEY]: raw })), DEFAULT_ENGINE_SETTINGS);
});

test('each invalid field falls back on its own, the valid one survives', () => {
  const invalidThreads = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 3, safetyBlur: false }),
  });
  assert.deepEqual(readEngineSettings(invalidThreads), {
    wasmThreads: 'auto',
    safetyBlur: false,
    detector: 'efficientdet',
  });

  const invalidBlur = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 6, safetyBlur: 'false' }),
  });
  assert.deepEqual(readEngineSettings(invalidBlur), {
    wasmThreads: 6,
    safetyBlur: true,
    detector: 'efficientdet',
  });

  const stringThreads = memoryStorage({
    [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: '4', safetyBlur: true }),
  });
  assert.deepEqual(readEngineSettings(stringThreads), {
    wasmThreads: 'auto',
    safetyBlur: true,
    detector: 'efficientdet',
  });
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
  const expected = { wasmThreads: 6, safetyBlur: true, detector: 'efficientdet' };
  assert.deepEqual(storeWasmThreads(6, storage), expected);
  assert.deepEqual(JSON.parse(storage.data[ENGINE_SETTINGS_KEY]), expected);
  assert.deepEqual(readEngineSettings(storage), expected);
});

test('storeSafetyBlur persists a boolean and keeps the thread choice', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 2, safetyBlur: true }) });
  assert.deepEqual(storeSafetyBlur(false, storage), {
    wasmThreads: 2,
    safetyBlur: false,
    detector: 'efficientdet',
  });
  assert.deepEqual(readEngineSettings(storage), {
    wasmThreads: 2,
    safetyBlur: false,
    detector: 'efficientdet',
  });
  assert.deepEqual(storeSafetyBlur(true, storage), {
    wasmThreads: 2,
    safetyBlur: true,
    detector: 'efficientdet',
  });
});

test('invalid values are ignored, not written over a good setting', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: JSON.stringify({ wasmThreads: 4, safetyBlur: false }) });
  const kept = { wasmThreads: 4, safetyBlur: false, detector: 'efficientdet' };
  assert.deepEqual(storeWasmThreads(7, storage), kept);
  assert.deepEqual(storeWasmThreads('many', storage), kept);
  assert.deepEqual(storeSafetyBlur('off', storage), kept);
  // Same rule for the model: an unknown value never overwrites a good choice.
  assert.deepEqual(storeDetector('yolo', storage), kept);
  assert.deepEqual(storeDetector('efficientdet-lite1', storage), kept);
  assert.deepEqual(readEngineSettings(storage), kept);
  // ... and a valid one does, leaving the other fields alone.
  assert.deepEqual(storeDetector('efficientdet-lite2', storage), {
    wasmThreads: 4,
    safetyBlur: false,
    detector: 'efficientdet-lite2',
  });
  assert.equal(readEngineSettings(storage).detector, 'efficientdet-lite2');
});

test('a corrupt store is repaired by the first valid write', () => {
  const storage = memoryStorage({ [ENGINE_SETTINGS_KEY]: '{oops' });
  const expected = { wasmThreads: 8, safetyBlur: true, detector: 'efficientdet' };
  assert.deepEqual(storeWasmThreads(8, storage), expected);
  assert.deepEqual(JSON.parse(storage.data[ENGINE_SETTINGS_KEY]), expected);
  assert.deepEqual(readEngineSettings(storage), expected);
});

test('storeEngineSettings merges every field and survives a blocked storage', () => {
  assert.deepEqual(
    storeEngineSettings({ wasmThreads: 4, safetyBlur: false, detector: 'efficientdet-lite2' }, throwingStorage()),
    { wasmThreads: 4, safetyBlur: false, detector: 'efficientdet-lite2' },
  );
  const storage = memoryStorage();
  storeEngineSettings({ wasmThreads: 1 }, storage);
  assert.deepEqual(storeEngineSettings({ safetyBlur: false }, storage), {
    wasmThreads: 1,
    safetyBlur: false,
    detector: 'efficientdet',
  });
  assert.deepEqual(storeEngineSettings({ detector: 'efficientdet-lite2' }, storage), {
    wasmThreads: 1,
    safetyBlur: false,
    detector: 'efficientdet-lite2',
  });
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
