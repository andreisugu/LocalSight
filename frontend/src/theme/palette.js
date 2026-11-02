// The raw design palette. Every token file in this folder reads its colors from here, so a
// rebrand is one edit and no hex value is duplicated across themes, signals and statuses.

export const BRAND = {
  carbonBlack: '#1F1F1F',
  scarletRush: '#D73833',
  brightLemon: '#FFEB33',
  frostedBlue: '#7EDEED',
  whiteSmoke: '#F5F5F5',
};

// Neutral steps the two themes are built from. Dark mode is a true neutral grey ramp with
// no blue tint; light mode is plain white with slate borders.
export const SURFACE = {
  dark: {
    app: BRAND.carbonBlack,
    panel: '#282828',
    nav: '#181818',
    card: '#2D2D2D',
    cardHover: '#363636',
    input: '#1C1C1C',
    muted: '#9E9E9E',
  },
  light: {
    app: '#FFFFFF',
    panel: '#FFFFFF',
    nav: '#FFFFFF',
    card: '#FFFFFF',
    cardHover: '#F8FAFC',
    input: '#FFFFFF',
    muted: '#64748B',
  },
};

// Primary actions in both themes; the light theme keeps the same yellow accent.
export const ACCENT = {
  base: BRAND.brightLemon,
  hover: '#FDD835',
};

// Confirmations, first aid and "safe" conditions. Not part of the brand set.
export const CONFIRM = '#388E3C';
