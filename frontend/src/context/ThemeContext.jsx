import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { THEME_CONFIG } from '../constants/theme';
import { initialTheme, nextTheme, storeTheme } from '../utils/themePreference';

// The provider owns three things: the current theme name, the `<html class="dark">` flag
// Tailwind's `dark:` variants read, and the matching surface palette for inline styles.
// The storage rules (key, default, validation) live in utils/themePreference.js.

const ThemeContext = createContext(null);

/** Palette for the active theme; anything that is not `dark` renders light. */
function paletteFor(theme) {
  return theme === 'dark' ? THEME_CONFIG.dark : THEME_CONFIG.light;
}

export function ThemeProvider({ children }) {
  // Lazy initialiser: the stored choice is read during the first render, so the first
  // paint is already in the right theme instead of flashing the default.
  const [theme, setTheme] = useState(() =>
    initialTheme(typeof window === 'undefined' ? null : window.localStorage)
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    storeTheme(window.localStorage, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => nextTheme(current));
  }, []);

  const isDarkMode = theme === 'dark';
  const value = useMemo(
    () => ({ isDarkMode, toggleTheme, themeStyles: paletteFor(theme) }),
    [isDarkMode, toggleTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return value;
}
