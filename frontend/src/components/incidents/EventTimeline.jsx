import React from 'react';
import { Clock } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { buildTimeline } from '../../utils/incidentDetail';

// The five timestamps of the contract, in the order an operator lives them. The step that
// escalated is red, the ack is green, and a step that has not happened stays neutral
// instead of claiming a colour it did not earn.
const TONE_CLASS = {
  neutral: {
    dark: 'bg-black/25 text-slate-200',
    light: 'bg-slate-100 text-slate-700 border border-slate-200',
  },
  alert: {
    dark: 'bg-red-950 text-red-300 border border-red-500/30',
    light: 'bg-red-50 text-red-700 border border-red-200',
  },
  ok: {
    dark: 'bg-emerald-950 text-emerald-300 border border-emerald-500/30',
    light: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
};

export default function EventTimeline({ event }) {
  const { themeStyles, isDarkMode } = useTheme();
  const steps = buildTimeline(event);

  return (
    <section
      aria-label="Cronologie eveniment"
      style={{ backgroundColor: themeStyles.cardBg }}
      className="rounded-lg border border-white/10 p-3 space-y-2"
    >
      <h4 className="text-xs font-bold uppercase tracking-wider text-[#D73833] flex items-center gap-1">
        <Clock size={13} /> Cronologie eveniment (5 pași)
      </h4>
      <ol className="flex flex-col gap-1 sm:grid sm:grid-cols-5 sm:gap-1.5 sm:text-center font-mono text-[10px]">
        {steps.map((step) => (
          <li
            key={step.id}
            title={step.at || 'Nu s-a întâmplat încă'}
            className={`min-w-0 p-1 rounded flex items-center justify-between gap-2 sm:block ${
              TONE_CLASS[step.tone][isDarkMode ? 'dark' : 'light']
            }`}
          >
            <span className="block opacity-70 leading-tight">
              {step.position}. {step.label}
            </span>
            <span className="block font-bold leading-tight whitespace-nowrap">{step.time}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
