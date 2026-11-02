import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_LIMITS,
  readStoredEnum,
  readStoredJson,
  readStoredText,
} from './storage.js';

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
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
}

test('missing, empty and unreadable storage yield no value', () => {
  assert.equal(readStoredText(null, 'key'), null);
  assert.equal(readStoredText(undefined, 'key'), null);
  assert.equal(readStoredText({}, 'key'), null);
  assert.equal(readStoredText(memoryStorage(), 'key'), null);
  assert.equal(readStoredText(memoryStorage({ key: '' }), 'key'), null);
  assert.equal(readStoredText(throwingStorage(), 'key'), null);
  assert.equal(readStoredEnum(null, 'key', ['a']), null);
  assert.equal(readStoredJson(null, 'key'), null);
});

test('text is returned as stored until the cap, then truncated', () => {
  const storage = memoryStorage({ name: '  Ana  ' });
  assert.equal(readStoredText(storage, 'name'), '  Ana  ');
  assert.equal(readStoredText(storage, 'name', { maxChars: 3 }), '  A');
  assert.equal(STORAGE_LIMITS.operatorName, 256);
});

test('a planted oversized name is capped instead of being returned whole', () => {
  const huge = 'A'.repeat(10_000);
  const name = readStoredText(memoryStorage({ name: huge }), 'name', {
    maxChars: STORAGE_LIMITS.operatorName,
  });
  assert.equal(name.length, STORAGE_LIMITS.operatorName);
});

test('an enum accepts only the exact stored member', () => {
  assert.equal(readStoredEnum(memoryStorage({ theme: 'light' }), 'theme', ['dark', 'light']), 'light');
  assert.equal(readStoredEnum(memoryStorage({ theme: 'light' }), 'theme', new Set(['dark'])), null);
  assert.equal(readStoredEnum(memoryStorage({ theme: 'LIGHT' }), 'theme', ['light']), null);
  assert.equal(readStoredEnum(memoryStorage({ theme: 'neon' }), 'theme', ['dark', 'light']), null);
  assert.equal(
    readStoredEnum(memoryStorage({ theme: 'x'.repeat(STORAGE_LIMITS.enum + 1) }), 'theme', ['light']),
    null
  );
});

test('JSON is parsed only under the size cap', () => {
  const settings = { wasmThreads: 4, safetyBlur: false };
  assert.deepEqual(readStoredJson(memoryStorage({ settings: JSON.stringify(settings) }), 'settings'), settings);
  assert.deepEqual(readStoredJson(memoryStorage({ runs: '[1,2]' }), 'runs'), [1, 2]);
  assert.equal(readStoredJson(memoryStorage({ runs: '[1,2' }), 'runs'), null);
  assert.equal(readStoredJson(memoryStorage({ runs: 'null' }), 'runs'), null);
  assert.equal(
    readStoredJson(memoryStorage({ runs: `"${'x'.repeat(STORAGE_LIMITS.engineSettings)}"` }), 'runs'),
    null
  );
});

test('JSON can use its own cap', () => {
  const raw = JSON.stringify({ run: 'x'.repeat(100) });
  assert.deepEqual(readStoredJson(memoryStorage({ runs: raw }), 'runs', { maxChars: 1024 }), {
    run: 'x'.repeat(100),
  });
  assert.equal(readStoredJson(memoryStorage({ runs: raw }), 'runs', { maxChars: 32 }), null);
});
