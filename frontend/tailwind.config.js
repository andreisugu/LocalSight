// Tailwind reads its colors from the same palette the runtime tokens use, so a utility and
// an inline style can never drift. The generated class names stay exactly as before
// (`bg-safesight-lemon`, `bg-dark-panel`, `text-light-bg`, ...).
import { ACCENT, BRAND, SURFACE } from './src/theme/palette.js';

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
          bg: SURFACE.dark.app,
          panel: SURFACE.dark.panel,
          card: SURFACE.dark.card,
          border: 'rgba(255, 255, 255, 0.10)',
          accent: ACCENT.base,
          accentHover: ACCENT.hover,
        },
        light: {
          bg: SURFACE.light.app,
          panel: SURFACE.light.panel,
          card: SURFACE.light.card,
          border: '#E5E7EB',
          accent: ACCENT.base,
          accentHover: ACCENT.hover,
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
