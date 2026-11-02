// Tone tokens for the small shared primitives. Tailwind only generates a class it can see
// as a complete string in the source, so every variant is written out instead of being
// assembled at runtime. The colours are the product signals, not new design values.
export const PILL_TONES = ['neutral', 'accent', 'danger', 'warning', 'success'];
export const PILL_VARIANTS = ['solid', 'soft'];

const TONE_CLASSES = {
  neutral: {
    solid: 'bg-slate-600 text-white',
    soft: 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200',
  },
  accent: {
    solid: 'bg-[#7EDEED] text-[#1F1F1F]',
    soft: 'bg-[#7EDEED]/20 text-[#0E7490] dark:bg-[#7EDEED]/15 dark:text-[#7EDEED]',
  },
  danger: {
    solid: 'bg-[#D73833] text-white',
    soft: 'bg-[#D73833]/15 text-[#991B1B] dark:bg-[#D73833]/25 dark:text-[#FF8A80]',
  },
  warning: {
    solid: 'bg-[#FFEB33] text-[#1F1F1F]',
    soft: 'bg-[#FFEB33]/25 text-[#7A5A00] dark:bg-[#FFEB33]/15 dark:text-[#FFEB33]',
  },
  success: {
    solid: 'bg-emerald-600 text-white',
    soft: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
};

/** Resolve a tone/variant pair. Unknown values fall back instead of rendering unreadable. */
export function toneClass(tone, variant = 'solid') {
  const group = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
  return group[variant] || group.solid;
}
