import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_OPERATOR_STORAGE_KEY,
  OPERATOR_NAME_LIMIT,
  OPERATOR_STORAGE_KEY,
  normalizeOperatorName,
  readStoredOperatorName,
  writeStoredOperatorName,
} from './operatorName.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    data,
    writes,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
      writes.push([key, String(value)]);
    },
    removeItem: (key) => data.delete(key),
  };
}

test('names are trimmed and non-strings become empty', () => {
  assert.equal(normalizeOperatorName('  I. Popescu  '), 'I. Popescu');
  assert.equal(normalizeOperatorName('   '), '');
  assert.equal(normalizeOperatorName(null), '');
  assert.equal(normalizeOperatorName(undefined), '');
  assert.equal(normalizeOperatorName(42), '');
});

test('a current name is read back without touching the legacy key', () => {
  const storage = fakeStorage({ [OPERATOR_STORAGE_KEY]: '  Ana  ' });
  assert.equal(readStoredOperatorName(storage), 'Ana');
  assert.deepEqual(storage.writes, []);
});

test('a legacy name is migrated to the current key on first read', () => {
  const storage = fakeStorage({ [LEGACY_OPERATOR_STORAGE_KEY]: ' Vechi ' });
  assert.equal(readStoredOperatorName(storage), 'Vechi');
  assert.equal(storage.getItem(OPERATOR_STORAGE_KEY), 'Vechi');
});

test('the current key wins over a legacy one', () => {
  const storage = fakeStorage({
    [OPERATOR_STORAGE_KEY]: 'Nou',
    [LEGACY_OPERATOR_STORAGE_KEY]: 'Vechi',
  });
  assert.equal(readStoredOperatorName(storage), 'Nou');
});

test('an empty or whitespace legacy name is not migrated', () => {
  const storage = fakeStorage({ [LEGACY_OPERATOR_STORAGE_KEY]: '   ' });
  assert.equal(readStoredOperatorName(storage), '');
  assert.equal(storage.getItem(OPERATOR_STORAGE_KEY), null);
  assert.deepEqual(storage.writes, []);
});

test('missing storage and throwing storage both yield no name', () => {
  assert.equal(readStoredOperatorName(null), '');
  assert.equal(readStoredOperatorName(undefined), '');
  const broken = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  assert.equal(readStoredOperatorName(broken), '');
});

test('a failed migration does not resurrect the legacy value', () => {
  const storage = {
    getItem: (key) => (key === LEGACY_OPERATOR_STORAGE_KEY ? 'Vechi' : null),
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.equal(readStoredOperatorName(storage), '');
});

test('an overlong stored name is capped on read', () => {
  const storage = fakeStorage({ [OPERATOR_STORAGE_KEY]: 'A'.repeat(10_000) });
  const name = readStoredOperatorName(storage);
  assert.equal(name.length, OPERATOR_NAME_LIMIT);
  assert.equal(name, 'A'.repeat(OPERATOR_NAME_LIMIT));
});

test('writing trims, stores and returns the name', () => {
  const storage = fakeStorage();
  assert.equal(writeStoredOperatorName(storage, '  I. Popescu '), 'I. Popescu');
  assert.equal(storage.getItem(OPERATOR_STORAGE_KEY), 'I. Popescu');
});

test('writing an empty name clears the key', () => {
  const storage = fakeStorage({ [OPERATOR_STORAGE_KEY]: 'Ana' });
  assert.equal(writeStoredOperatorName(storage, '   '), '');
  assert.equal(storage.getItem(OPERATOR_STORAGE_KEY), null);
});

test('a storage failure still returns the typed name for the session', () => {
  const storage = {
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('QuotaExceededError'); },
  };
  assert.equal(writeStoredOperatorName(storage, ' Ana '), 'Ana');
  assert.equal(writeStoredOperatorName(storage, ''), '');
});
