// Theme surfaces consumed through ThemeContext (`themeStyles`). The shape is part of the
// public API: components read these keys by name, so keys are never renamed on a hunch.

import { ACCENT, BRAND, SURFACE } from './palette.js';

export const THEME_CONFIG = {
  // Dark mode: neutral carbon backdrop, lemon accent, smoke text (WCAG > 10:1 on #1F1F1F).
  dark: {
    appBg: SURFACE.dark.app,
    panelBg: SURFACE.dark.panel,
    panelBorder: 'rgba(255, 255, 255, 0.10)',
    navBg: SURFACE.dark.nav,
    navBorder: 'rgba(255, 255, 255, 0.10)',
    accentColor: ACCENT.base,
    accentHover: ACCENT.hover,
    textColor: BRAND.whiteSmoke,
    textMuted: SURFACE.dark.muted,
    cardBg: SURFACE.dark.card,
    cardHover: SURFACE.dark.cardHover,
    inputBg: SURFACE.dark.input,
    badgeBg: 'rgba(255, 235, 51, 0.20)',
    modalOverlay: 'rgba(0, 0, 0, 0.85)',
  },
  // Light mode: white surfaces, carbon text, the same yellow accent.
  light: {
    appBg: SURFACE.light.app,
    panelBg: SURFACE.light.panel,
    panelBorder: '#E5E7EB',
    navBg: SURFACE.light.nav,
    navBorder: '#E5E7EB',
    accentColor: ACCENT.base,
    accentHover: ACCENT.hover,
    textColor: BRAND.carbonBlack,
    textMuted: SURFACE.light.muted,
    cardBg: SURFACE.light.card,
    cardHover: SURFACE.light.cardHover,
    inputBg: SURFACE.light.input,
    badgeBg: 'rgba(255, 235, 51, 0.25)',
    modalOverlay: 'rgba(15, 23, 42, 0.65)',
  },
};

export default THEME_CONFIG;
