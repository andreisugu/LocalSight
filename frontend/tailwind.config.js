// Tailwind utilities come from the same tokens the runtime uses, so a utility and an inline
// style cannot drift apart. THEME_CONFIG owns the surfaces and accents, BRAND owns the fixed
// palette, and `surfacePalette` maps one token bag onto the utilities of one theme. Class
// names stay exactly as before (`bg-safesight-lemon`, `bg-dark-panel`, `text-light-bg`, ...).
import { BRAND } from './src/theme/palette.js';
import { THEME_CONFIG } from './src/theme/themes.js';

const brandColors = {
  carbon: BRAND.carbonBlack,
  scarlet: BRAND.scarletRush,
  lemon: BRAND.brightLemon,
  frosted: BRAND.frostedBlue,
  smoke: BRAND.whiteSmoke,
};

/** Utilities for a single theme, named after the token keys they stand for. */
function surfacePalette(tokens) {
  return {
    bg: tokens.appBg,
    card: tokens.cardBg,
    panel: tokens.panelBg,
    border: tokens.panelBorder,
    accent: tokens.accentColor,
    accentHover: tokens.accentHover,
  };
}

const utilityColors = {
  safesight: brandColors,
  dark: surfacePalette(THEME_CONFIG.dark),
  light: surfacePalette(THEME_CONFIG.light),
};

/** @type {import('tailwindcss').Config} */
const tailwindConfig = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // ThemeContext toggles `.dark` on <html>
  theme: { extend: { colors: utilityColors } },
  plugins: [], // no plugins: these utilities are all the app needs
};

export default tailwindConfig;
