import React, { useState } from 'react';
import { Check, FileDown, RotateCcw, XCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import FalsePositiveDialog from './FalsePositiveDialog';
import { actionState } from '../../utils/incidentDetail';

// The button states come from the action matrix, never from a local guess: a disabled
// button means the backend would answer 409. Print CSS hides this whole panel because it
// is the operator's workspace, not part of the exported incident.
const ENABLED = {
  ack: 'bg-emerald-600 hover:bg-emerald-500 text-white hover:scale-[1.02]',
  quiet: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600',
  danger: 'bg-[#D73833]/20 hover:bg-[#D73833]/30 text-[#D73833] border border-[#D73833]/40',
};

export default function DecisionPanel({ event, onAck, onFalsePositive, onReopen, onExport }) {
  const { themeStyles } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const actions = actionState(event);

  const submitFalsePositive = (note) => {
    setDialogOpen(false);
    onFalsePositive(note);
  };

  return (
    <>
      <section
        aria-label="Decizia operatorului"
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="no-print rounded-xl border p-4 shadow-lg space-y-3"
      >
        <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-500 flex items-center gap-1.5">
          <Check size={15} /> Decizia operatorului
        </h4>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            disabled={!actions.ack}
            onClick={(clickEvent) => onAck(clickEvent)}
            className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${
              actions.ack
                ? ENABLED.ack
                : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
            }`}
          >
            <Check size={16} />
            <span>{actions.acked ? 'Confirmat' : 'Confirmă'}</span>
          </button>

          <button
            type="button"
            disabled={!actions.falsePositive}
            onClick={() => setDialogOpen(true)}
            className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 border border-slate-600 transition-all ${
              actions.falsePositive
                ? ENABLED.quiet
                : 'bg-slate-900 text-slate-500 cursor-not-allowed'
            }`}
          >
            <XCircle size={16} />
            <span>{actions.markedFalsePositive ? 'Marcat Fals Pozitiv' : 'Fals Pozitiv'}</span>
          </button>

          <button
            type="button"
            disabled={!actions.reopen}
            onClick={onReopen}
            className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 ${
              actions.reopen ? ENABLED.quiet : 'bg-slate-900 text-slate-500 cursor-not-allowed'
            }`}
          >
            <RotateCcw size={15} />
            <span>Redeschide</span>
          </button>

          <button
            type="button"
            onClick={onExport}
            className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 ${ENABLED.danger}`}
          >
            <FileDown size={15} />
            <span>Export PDF</span>
          </button>
        </div>
      </section>

      {dialogOpen && (
        <FalsePositiveDialog
          onSubmit={submitFalsePositive}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
