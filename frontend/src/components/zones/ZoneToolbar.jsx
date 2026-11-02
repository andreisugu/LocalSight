import React from 'react';
import { Code, Plus, Redo2, Shapes, Square, Triangle, Undo2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

function ruleShort(ruleType) {
  if (ruleType === 'PPE_REQUIRED') return 'PPE';
  if (ruleType === 'RESTRICTED') return 'ZONĂ';
  return ruleType;
}

/**
 * Everything that acts on the zone list or the draft as a whole: pick a saved zone,
 * start a new one, drop a shape preset, undo/redo and the JSON escape hatch.
 */
export default function ZoneToolbar({
  zones,
  zoneId,
  onSelectZone,
  onNewZone,
  onApplyShape,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  jsonOpen,
  onToggleJson,
  jsonText,
  onJsonTextChange,
  onApplyJson,
}) {
  const { isDarkMode, themeStyles } = useTheme();

  const chipClass = (selected) => {
    const base =
      'px-2.5 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 transition-colors';
    if (selected) {
      return `${base} ${
        isDarkMode
          ? 'bg-[#D73833] border-[#FFEB33] text-white shadow-md'
          : 'bg-[#7EDEED] border-[#7EDEED] text-[#1F1F1F] font-bold shadow-md'
      }`;
    }
    return `${base} ${
      isDarkMode
        ? 'bg-black/30 border-white/10 text-slate-300 hover:bg-white/10'
        : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
    }`;
  };

  const toolClass = (active = false) => {
    const base =
      'px-2 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition-colors';
    if (active) {
      return `${base} ${
        isDarkMode
          ? 'border-[#FFEB33] bg-[#FFEB33]/15 text-[#FFEB33]'
          : 'border-[#D73833] bg-[#D73833]/10 text-[#D73833]'
      }`;
    }
    return `${base} ${
      isDarkMode
        ? 'border-white/20 bg-black/20 text-slate-200 hover:bg-white/10'
        : 'border-slate-300 bg-white text-[#1F1F1F] hover:bg-slate-100'
    }`;
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold opacity-75 mr-1">Zone salvate:</span>
        {zones.length === 0 && (
          <span className="text-[11px] font-mono text-amber-500 dark:text-amber-300">
            niciuna pe camera asta — creează una
          </span>
        )}
        {zones.map((item) => (
          <button
            key={item.zone_id}
            data-testid={`zone-chip-${item.zone_id}`}
            onClick={() => onSelectZone(item.zone_id)}
            className={chipClass(item.zone_id === zoneId)}
            title={`${item.rule_type} · ${(item.polygon || []).length} puncte`}
          >
            {item.zone_id}
            <span className="opacity-70 font-semibold">{ruleShort(item.rule_type)}</span>
          </button>
        ))}
        <button
          data-testid="zone-new"
          onClick={onNewZone}
          className={`px-2.5 py-1 rounded border text-[11px] font-bold flex items-center gap-1 transition-colors ${
            isDarkMode
              ? 'border-[#FFEB33]/40 bg-[#FFEB33]/10 text-[#FFEB33] hover:bg-[#FFEB33]/20'
              : 'border-[#D73833]/40 bg-[#D73833]/10 text-[#D73833] hover:bg-[#D73833]/20'
          }`}
        >
          <Plus size={12} /> Zonă nouă
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold opacity-70 flex items-center gap-1 mr-1">
          <Shapes size={13} /> Forme
        </span>
        <button
          onClick={() => onApplyShape('rectangle')}
          className={toolClass()}
          title="Umple cadrul cu un dreptunghi pe care îl poți ajusta"
        >
          <Square size={13} /> Dreptunghi
        </button>
        <button
          onClick={() => onApplyShape('triangle')}
          className={toolClass()}
          title="Așază un triunghi pe cadru"
        >
          <Triangle size={13} /> Triunghi
        </button>

        <span className="w-px h-5 mx-1" style={{ backgroundColor: themeStyles.panelBorder }} />

        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`${toolClass()} disabled:opacity-30 disabled:cursor-not-allowed`}
          title="Anulează (Ctrl+Z)"
          aria-label="Anulează ultima modificare"
        >
          <Undo2 size={13} /> Anulează
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`${toolClass()} disabled:opacity-30 disabled:cursor-not-allowed`}
          title="Refă (Ctrl+Shift+Z)"
          aria-label="Refă ultima modificare"
        >
          <Redo2 size={13} /> Refă
        </button>

        <span className="w-px h-5 mx-1" style={{ backgroundColor: themeStyles.panelBorder }} />

        <button
          onClick={onToggleJson}
          aria-pressed={jsonOpen}
          className={toolClass(jsonOpen)}
          title="Arată sau ascunde coordonatele normalizate"
        >
          <Code size={13} /> JSON
        </button>
      </div>

      {jsonOpen && (
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3 rounded-xl border space-y-2 text-xs"
        >
          <div className="flex items-center justify-between font-bold font-mono text-[11px]">
            <span>Coordonate normalizate (JSON)</span>
            <button
              onClick={onApplyJson}
              className="px-2 py-0.5 bg-[#D73833] hover:bg-[#b82e2a] text-white rounded text-[10px] font-bold"
            >
              Aplică pe cadru
            </button>
          </div>
          <textarea
            value={jsonText}
            onChange={(event) => onJsonTextChange(event.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full p-2 rounded bg-white dark:bg-black/40 border border-slate-300 dark:border-white/10 font-mono text-[10px] text-[#1F1F1F] dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
          />
        </div>
      )}
    </div>
  );
}
