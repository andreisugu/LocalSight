// Tailwind utilities are generated from the same tokens the runtime uses, so a utility
// and an inline style cannot drift. `THEME_CONFIG` owns the surfaces and accents; BRAND
// owns the fixed palette. Class names stay exactly as before (`bg-safesight-lemon`,
// `bg-dark-panel`, `text-light-bg`, ...).
//
// The animation strings below stay literal: there is no motion token module under
// src/theme/, and inventing one here would change the module shape rather than derive a
// value. They are keyframe names and Tailwind's own pulse/ping timings, not colours.
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
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        scanline: 'scanline 8s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        },
      },
    },
  },
  plugins: [],
};
