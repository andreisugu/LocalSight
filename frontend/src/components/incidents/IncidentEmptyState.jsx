import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Shown when the route names an incident the store does not have (a stale Slack link, or
// the detail screen opened without a selection). The way out is always the list.
export default function IncidentEmptyState({ onBack }) {
  const { themeStyles } = useTheme();

  return (
    <div className="flex-1 h-full flex items-center justify-center p-6">
      <div
        data-testid="incident-empty"
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="w-full max-w-sm rounded-xl border p-6 text-center space-y-3 shadow-lg"
      >
        <p className="font-black text-base uppercase tracking-tight">Niciun incident selectat</p>
        <p style={{ color: themeStyles.textMuted }} className="text-xs leading-relaxed">
          Deschide un incident din listă ca să vezi dovada, cronologia și raportul lui.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white text-sm font-bold"
        >
          <ArrowLeft size={16} /> Vezi lista de incidente
        </button>
      </div>
    </div>
  );
}
