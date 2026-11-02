// Industrial / airport signal colors. Used exclusively for status, actions and alerts —
// never for decoration.

import { BRAND, CONFIRM } from './palette.js';

export const SIGNAL_COLORS = {
  RED_CRITICAL: BRAND.scarletRush, // critical incident, major risk, stop
  AMBER_WARNING: BRAND.brightLemon, // warning, attention, engine active
  GREEN_SAFE: CONFIRM, // safe conditions, first aid, confirmations
  BLUE_MANDATORY: BRAND.frostedBlue, // mandatory actions, PPE, information
  FROSTED_BLUE: BRAND.frostedBlue,
};
