import { Sparkles as SparklesIcon } from 'lucide-react';
import { formatConfidence } from '../../utils/confidence';
// Contract v2.2: `confidence` is `{ detector, temporal: { seen, window } }`. The badge prints
// those numbers and nothing else; a missing value is shown as missing, never as a plausible
// default (the inherited version displayed 0.90 / 14 of 15 when the event had no confidence).
const NO_DATA_LABEL = 'fără date de încredere';
const MISSING_PART = '—';
const readout = (score, temporal) =>
  temporal ? `${score ?? MISSING_PART} · ${temporal} cadre` : score ?? MISSING_PART;
const ConfidenceBadge = ({ confidence }) => {
  const summary = formatConfidence(confidence);
  if (!summary.hasData) {
    return <span className="font-mono text-xs opacity-60" title={summary.title}>{NO_DATA_LABEL}</span>;
  }
  // "0.93 · 14/15 cadre"; a half-filled event keeps the em dash instead of inventing the
  // missing half.
  return <span
    title={summary.title}
    className="inline-flex select-none items-center gap-1.5 rounded border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-xs font-bold"
  >
    <SparklesIcon size={11} aria-hidden="true" className="shrink-0 text-amber-400" />
    <span>{readout(summary.score, summary.temporal)}</span>
  </span>;
};
export default ConfidenceBadge;
