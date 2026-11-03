import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { THEME_CONFIG } from '../constants/theme.js';
import { initialTheme, nextTheme, storeTheme } from '../utils/themePreference';
// The provider owns three things: the current theme name, the `<html class="dark">` flag
// Tailwind's `dark:` variants read, and the matching surface palette for inline styles.
// The storage rules (key, default, validation) live in utils/themePreference.js.
const ThemeContext = createContext(null);
const DARK = 'dark';
/** Palette for the active theme; anything that is not `dark` renders light. */
const paletteFor = (theme) => (theme === DARK ? THEME_CONFIG.dark : THEME_CONFIG.light);
/** Lazy initialiser: the stored choice is read during the first render, so the first paint
 * is already in the right theme instead of flashing the default. */
const readInitialTheme = () =>
  initialTheme(typeof window === 'undefined' ? null : window.localStorage);
const buildThemeApi = (theme, toggleTheme) => ({
  isDarkMode: theme === DARK,
  toggleTheme,
  themeStyles: paletteFor(theme),
});
const applyThemeToDocument = (theme) => {
  document.documentElement.classList.toggle('dark', theme === DARK);
  storeTheme(window.localStorage, theme);
};
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(readInitialTheme);
  useEffect(() => applyThemeToDocument(theme), [theme]);
  const toggleTheme = useCallback(() => setTheme((current) => nextTheme(current)), []);
  const value = useMemo(() => buildThemeApi(theme, toggleTheme), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used within a ThemeProvider');
  return value;
};
