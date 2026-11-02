import { useState } from 'react';
import { Check, FileDown, RotateCcw, XCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import FalsePositiveDialog from './FalsePositiveDialog';
import { actionState } from '../../utils/incidentDetail';

// The button states come from the action matrix, never from a local guess: a disabled
// button means the backend would answer 409. Print CSS hides this whole panel because it
// is the operator's workspace, not part of the exported incident.
//
// One primary: `Confirmă` is the action the operator is expected to take, so it is the
// only filled button. Fals Pozitiv, Redeschide and Export PDF are outlined and share the
// theme's neutral border, instead of the four different fills this panel used to have.
const PRIMARY = 'bg-emerald-700 hover:bg-emerald-600 text-white';
const SECONDARY =
  'border border-[#E5E7EB] text-[#1F1F1F] hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10';
const DISABLED =
  'border border-[#E5E7EB] text-slate-400 cursor-not-allowed dark:border-white/10 dark:text-slate-500';
const BASE = 'py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors';

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
        data-testid="incident-decision"
        aria-label="Decizia operatorului"
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="no-print rounded-xl border p-4 shadow-lg space-y-3"
      >
        <h3 className="font-bold text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <Check size={15} aria-hidden="true" /> Decizia operatorului
        </h3>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            data-testid="decision-ack"
            data-acked={actions.acked ? 'true' : 'false'}
            disabled={!actions.ack}
            onClick={(clickEvent) => onAck(clickEvent)}
            className={`${BASE} ${actions.ack ? PRIMARY : DISABLED}`}
          >
            <Check size={16} aria-hidden="true" />
            <span>{actions.acked ? 'Confirmat' : 'Confirmă'}</span>
          </button>

          <button
            type="button"
            data-testid="decision-false-positive"
            data-marked={actions.markedFalsePositive ? 'true' : 'false'}
            disabled={!actions.falsePositive}
            onClick={() => setDialogOpen(true)}
            className={`${BASE} ${actions.falsePositive ? SECONDARY : DISABLED}`}
          >
            <XCircle size={16} aria-hidden="true" />
            <span>{actions.markedFalsePositive ? 'Marcat Fals Pozitiv' : 'Fals Pozitiv'}</span>
          </button>

          <button
            type="button"
            data-testid="decision-reopen"
            disabled={!actions.reopen}
            onClick={onReopen}
            className={`${BASE} ${actions.reopen ? SECONDARY : DISABLED}`}
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>Redeschide</span>
          </button>

          <button type="button" data-testid="decision-export" onClick={onExport} className={`${BASE} ${SECONDARY}`}>
            <FileDown size={15} aria-hidden="true" />
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
