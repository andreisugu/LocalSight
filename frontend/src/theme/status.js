// Severity and status tokens (canonical decision N06). Every chip in the product renders
// `bg`/`text`/`border` on light surfaces and `bgDark`/`textDark`/`borderDark` in dark mode,
// so both halves of each token must exist together.

import { BRAND, CONFIRM } from './palette.js';

const SCARLET = BRAND.scarletRush;
const LEMON = BRAND.brightLemon;
const SLATE = '#64748B';

export const STATUS_TOKENS = {
  // Severity — only CRITICAL or WARNING exists.
  CRITICAL: {
    color: SCARLET,
    bg: '#FEF2F2',
    bgDark: 'rgba(215, 56, 51, 0.22)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: SCARLET,
    borderDark: 'rgba(215, 56, 51, 0.60)',
    dot: SCARLET,
    label: 'CRITICAL',
  },
  WARNING: {
    color: LEMON,
    bg: '#FFFBEB',
    bgDark: 'rgba(255, 235, 51, 0.18)',
    text: BRAND.carbonBlack,
    textDark: LEMON,
    border: LEMON,
    borderDark: 'rgba(255, 235, 51, 0.60)',
    dot: LEMON,
    label: 'WARNING',
  },

  // Status — the operator's decision.
  open: {
    color: SCARLET,
    bg: '#FEF2F2',
    bgDark: 'rgba(215, 56, 51, 0.20)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: SCARLET,
    label: 'Deschis',
  },
  acknowledged: {
    color: CONFIRM,
    bg: '#F0FDF4',
    bgDark: 'rgba(56, 142, 60, 0.18)',
    text: '#1B5E20',
    textDark: '#81C784',
    border: '#A7F3D0',
    label: 'Confirmat',
  },
  false_positive: {
    color: SLATE,
    bg: '#F1F5F9',
    bgDark: 'rgba(100, 116, 139, 0.18)',
    text: '#334155',
    textDark: '#94A3B8',
    border: '#CBD5E1',
    label: 'Fals Pozitiv',
  },
  escalated: {
    color: SCARLET,
    bg: '#FEE2E2',
    bgDark: 'rgba(215, 56, 51, 0.30)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: SCARLET,
    label: 'Escaladat (Urgență)',
  },
  resolved: {
    color: CONFIRM,
    bg: '#F0FDF4',
    bgDark: 'rgba(56, 142, 60, 0.18)',
    text: '#1B5E20',
    textDark: '#81C784',
    border: '#86EFAC',
    label: 'Rezolvat',
  },
};

export default STATUS_TOKENS;
