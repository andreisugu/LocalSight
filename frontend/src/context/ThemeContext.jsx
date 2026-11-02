import React, { createContext, useContext, useEffect, useState } from 'react';
import { THEME_CONFIG } from '../constants/theme';
import { initialTheme, nextTheme, storeTheme } from '../utils/themePreference';

const ThemeContext = createContext();

// Rewritten: the inherited provider always started dark and forgot the choice on reload.
// The preference now lives in localStorage; the initial value is read lazily so the first
// paint uses the stored theme, and every toggle updates the <html class="dark"> contract
// Tailwind already relies on.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return initialTheme(window.localStorage);
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    storeTheme(window.localStorage, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => nextTheme(current));
  const isDarkMode = theme === 'dark';
  const themeStyles = isDarkMode ? THEME_CONFIG.dark : THEME_CONFIG.light;

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme, themeStyles }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
