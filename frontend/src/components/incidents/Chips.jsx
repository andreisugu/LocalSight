import { useTheme } from '../../context/ThemeContext';
import { STATUS_TOKENS } from '../../constants/theme';
import Pill from '../ui/Pill';

// One chip system for the incident surfaces (list, detail, shift report): the same size,
// the same border, and the contract tokens for severity and status. Before this module the
// list built its chip from `STATUS_TOKENS`, the detail header printed the light tokens in
// both themes, and the report invented a third style for the same kind of fact.
//
// A chip is text first: the colour is a hint, the label is the fact. Tones come from
// `Pill`'s soft variants (a class string that Tailwind can see) instead of overriding a
// solid background with another utility — the winner of two background utilities is the
// generated CSS order, not the order in `className`.
const CHIP = 'rounded border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap';

// A value outside the contract keeps its raw text and a neutral style instead of hiding.
const UNKNOWN = {
  bg: '#F1F5F9',
  bgDark: 'rgba(148, 163, 184, 0.18)',
  text: '#334155',
  textDark: '#CBD5E1',
  border: '#CBD5E1',
  borderDark: 'rgba(148, 163, 184, 0.40)',
};

/** Severity (`CRITICAL`/`WARNING`) and status chips, drawn from `STATUS_TOKENS`. */
export function StatusChip({ value, strong = false }) {
  const { isDarkMode } = useTheme();
  const token = STATUS_TOKENS[value] || UNKNOWN;
  const label = STATUS_TOKENS[value]?.label || value || 'Necunoscut';

  return (
    <Pill
      shape="plain"
      className={`${CHIP} ${strong ? 'font-black uppercase' : ''}`.trim()}
      style={{
        backgroundColor: (isDarkMode ? token.bgDark : token.bg) || UNKNOWN.bg,
        color: (isDarkMode ? token.textDark : token.text) || UNKNOWN.text,
        borderColor: (isDarkMode ? token.borderDark || token.border : token.border) || UNKNOWN.border,
      }}
    >
      {label}
    </Pill>
  );
}

// Provenance is exclusive: a fixture is not local, and a local detection is not demo.
const PROVENANCE = {
  local: { tone: 'accent', border: 'border-[#7EDEED]/60' },
  demo: { tone: 'warning', border: 'border-[#FFEB33]/60' },
};

/** `date demo` / `local`: where the event came from, explained in a visible line nearby. */
export function ProvenanceChip({ tone = 'demo', title, children }) {
  const style = PROVENANCE[tone] || PROVENANCE.demo;
  return (
    <Pill
      shape="plain"
      variant="soft"
      tone={style.tone}
      title={title}
      className={`${CHIP} ${style.border}`}
    >
      {children}
    </Pill>
  );
}

/** Who wrote a report: `sursă: șablon` / `sursă: AI · demo`. Never a bare model claim. */
export function SourceChip({ title, children }) {
  return (
    <Pill
      shape="plain"
      variant="soft"
      mono
      title={title}
      className={`${CHIP} border-slate-300 dark:border-white/20`}
    >
      {children}
    </Pill>
  );
}
