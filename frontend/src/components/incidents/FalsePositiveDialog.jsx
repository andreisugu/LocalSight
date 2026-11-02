import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';

// The note is the only part of a false-positive decision the model can learn from, so the
// dialog asks for it before the action is sent. It is mounted only while open, so the
// textarea starts empty for every incident.
export default function FalsePositiveDialog({ onSubmit, onCancel }) {
  const { themeStyles } = useTheme();
  const [note, setNote] = useState('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="false-positive-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    >
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4"
      >
        <h3 id="false-positive-title" className="font-bold text-sm uppercase">
          Feedback fals pozitiv pentru echipa AI
        </h3>
        <p style={{ color: themeStyles.textMuted }} className="text-xs">
          Explică de ce detecția a fost eronată, pentru antrenarea viitoare a modelului:
        </p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ex: Tehnicianul purta dopuri interne de urechi, nu căști externe..."
          aria-label="Motivul falsului pozitiv"
          rows={3}
          className="w-full p-2.5 rounded-lg bg-black/30 border border-white/20 text-xs focus:ring-2 focus:ring-[#FFEB33] focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg border border-white/20 text-xs"
          >
            Anulează
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note)}
            className="px-4 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs"
          >
            Trimite Feedback
          </button>
        </div>
      </div>
    </div>
  );
}
