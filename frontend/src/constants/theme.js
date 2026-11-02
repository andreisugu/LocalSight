// Public design-token barrel. Components keep importing `constants/theme`; the tokens
// themselves live in `src/theme/`. The exported names, shapes and values are unchanged.
export { THEME_CONFIG } from '../theme/themes.js';
export { SIGNAL_COLORS } from '../theme/signals.js';
export { STATUS_TOKENS } from '../theme/status.js';
