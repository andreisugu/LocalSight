// Theme preference: one key, one fallback. Kept pure so the storage rules are testable
// without a DOM. The product defaults to dark; an explicit choice survives a reload.

export const THEME_STORAGE_KEY = 'localsight.theme';
export const DEFAULT_THEME = 'dark';

const THEMES = new Set(['dark', 'light']);

/**
 * @param {{getItem(key: string): string|null}|null|undefined} storage
 * @returns {'dark'|'light'|null}
 */
export function readStoredTheme(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return THEMES.has(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {{setItem(key: string, value: string): void}|null|undefined} storage
 * @param {'dark'|'light'} theme
 */
export function storeTheme(storage, theme) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(THEME_STORAGE_KEY, THEMES.has(theme) ? theme : DEFAULT_THEME);
  } catch {
    // A blocked/full storage must not break the toggle.
  }
}

export function nextTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}

/** The initial theme: a stored choice, otherwise the product default. */
export function initialTheme(storage) {
  return readStoredTheme(storage) || DEFAULT_THEME;
}
