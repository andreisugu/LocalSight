import React from 'react';
import { Sparkles } from 'lucide-react';
import { formatConfidence } from '../../utils/confidence';

// Contract v2.2: `confidence` is `{ detector, temporal: { seen, window } }`. The badge
// prints those numbers and nothing else; a missing value is shown as missing, not as a
// plausible default (the inherited version displayed 0.90 / 14 of 15 when the event had
// no confidence at all).
export default function ConfidenceBadge({ confidence }) {
  const { score, temporal, hasData, title } = formatConfidence(confidence);

  if (!hasData) {
    return (
      <span className="font-mono text-xs opacity-60" title={title}>
        fără date de încredere
      </span>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/20 text-xs font-mono font-bold border border-white/10 select-none"
      title={title}
    >
      <Sparkles size={11} className="text-amber-400 shrink-0" />
      <span>
        {score ?? '—'}
        {temporal && <> · {temporal} cadre</>}
      </span>
    </div>
  );
}
