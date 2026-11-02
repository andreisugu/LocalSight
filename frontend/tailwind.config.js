// Tailwind utilities are generated from the same tokens the runtime uses, so a utility
// and an inline style cannot drift. `THEME_CONFIG` owns the surfaces and accents; BRAND
// owns the fixed palette. Class names stay exactly as before (`bg-safesight-lemon`,
// `bg-dark-panel`, `text-light-bg`, ...).
import { BRAND } from './src/theme/palette.js';
import { THEME_CONFIG } from './src/theme/themes.js';

const dark = THEME_CONFIG.dark;
const light = THEME_CONFIG.light;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        safesight: {
          carbon: BRAND.carbonBlack,
          scarlet: BRAND.scarletRush,
          lemon: BRAND.brightLemon,
          frosted: BRAND.frostedBlue,
          smoke: BRAND.whiteSmoke,
        },
        dark: {
          bg: dark.appBg,
          panel: dark.panelBg,
          card: dark.cardBg,
          border: dark.panelBorder,
          accent: dark.accentColor,
          accentHover: dark.accentHover,
        },
        light: {
          bg: light.appBg,
          panel: light.panelBg,
          card: light.cardBg,
          border: light.panelBorder,
          accent: light.accentColor,
          accentHover: light.accentHover,
        },
      },
    },
  },
  plugins: [],
};
