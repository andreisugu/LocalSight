import { useState } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { SourceChip } from './Chips';
import {
  reportFields,
  reportSourceLabel,
  reportSourceNote,
  shouldOfferReportRetry,
} from '../../utils/incidentDetail';

function ReportSkeleton() {
  return (
    <div className="space-y-2 py-4 animate-pulse" aria-label="Se regenerează raportul">
      <div className="h-4 bg-white/20 rounded w-3/4" />
      <div className="h-4 bg-white/20 rounded w-1/2" />
      <div className="h-10 bg-white/20 rounded w-full" />
    </div>
  );
}

// Right column, top: the five contract fields and the honest label of who wrote them. The
// chip names the source and the line under it says when it was written, so `AI · demo`
// cannot be read as "a model ran now" — and the browser never claims an LLM it does not run.
export default function ReportPanel({ event, mock, onRetry }) {
  const { themeStyles, isDarkMode } = useTheme();
  const [retrying, setRetrying] = useState(false);
  const source = reportSourceLabel(event.report, { mock });
  const note = reportSourceNote(event.report, { mock });
  const offerRetry = shouldOfferReportRetry(event, { mock });
  const fields = reportFields(event.report);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry(event.event_id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section
      aria-label="Raport incident"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border p-4 shadow-lg space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 pb-2 border-b border-white/10">
        <div className="min-w-0 space-y-1">
          <h3 className="font-bold text-sm uppercase tracking-wider flex flex-wrap items-center gap-2 min-w-0">
            <Info size={16} className="text-[#D73833] shrink-0" aria-hidden="true" />
            <span>Raport incident</span>{' '}
            <SourceChip title={note}>sursă: {source}</SourceChip>
          </h3>
          <p className="text-[11px] leading-snug" style={{ color: themeStyles.textMuted }}>
            {note}
          </p>
        </div>
        {offerRetry && (
          <button
            type="button"
            onClick={retry}
            title="Raportul a fost scris din șablon (AI indisponibil); încearcă din nou cu AI"
            className="no-print text-xs text-[#B91C1C] dark:text-[#FF8A80] hover:underline flex items-center gap-1 font-semibold shrink-0"
          >
            <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
            Reîncearcă cu AI
          </button>
        )}
      </div>

      {retrying ? (
        <ReportSkeleton />
      ) : (
        <dl className="space-y-2.5 text-xs">
          {fields.map((field) => (
            <div
              key={field.key}
              className={
                field.key === 'recommended_action'
                  ? 'p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30'
                  : undefined
              }
            >
              <dt
                className={`font-bold block text-[11px] ${
                  field.key === 'severity_reason'
                    ? 'text-red-700 dark:text-red-300'
                    : field.key === 'recommended_action'
                      ? 'text-amber-800 dark:text-amber-200'
                      : ''
                }`}
                style={
                  field.key === 'severity_reason' || field.key === 'recommended_action'
                    ? undefined
                    : { color: themeStyles.textMuted }
                }
              >
                {field.label}
              </dt>
              <dd
                className={
                  field.key === 'recommended_action'
                    ? `font-bold mt-0.5 ${isDarkMode ? 'text-amber-200' : 'text-amber-800'}`
                    : field.key === 'severity_reason'
                      ? `font-semibold ${isDarkMode ? 'text-red-200' : 'text-red-700'}`
                      : field.key === 'when'
                        ? 'font-semibold font-mono'
                        : 'font-semibold'
                }
                style={
                  field.key === 'severity_reason' || field.key === 'recommended_action'
                    ? undefined
                    : { color: themeStyles.textColor }
                }
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
