import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  readStoredTheme,
  storeTheme,
  nextTheme,
  initialTheme,
} from './themePreference.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

test('a stored theme is read back', () => {
  assert.equal(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'light' })), 'light');
  assert.equal(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })), 'dark');
});

test('an unknown or missing value falls back to null, not to a guess', () => {
  assert.equal(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'neon' })), null);
  assert.equal(readStoredTheme(memoryStorage()), null);
  assert.equal(readStoredTheme(null), null);
  assert.equal(readStoredTheme({}), null);
});

test('a storage that throws is treated as empty', () => {
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readStoredTheme(hostile), null);
  assert.doesNotThrow(() => storeTheme(hostile, 'light'));
});

test('the initial theme is the stored one or the product default', () => {
  assert.equal(initialTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'light' })), 'light');
  assert.equal(initialTheme(memoryStorage()), DEFAULT_THEME);
  assert.equal(DEFAULT_THEME, 'dark');
});

test('storing writes a valid theme and never an arbitrary string', () => {
  const storage = memoryStorage();
  storeTheme(storage, 'light');
  assert.equal(storage.data[THEME_STORAGE_KEY], 'light');
  storeTheme(storage, 'neon');
  assert.equal(storage.data[THEME_STORAGE_KEY], DEFAULT_THEME);
});

test('the toggle alternates between the only two themes', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});
