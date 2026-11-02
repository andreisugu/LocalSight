import { Layers, Save, Trash2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const inputClass =
  'w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]';

/**
 * The zone record that surrounds the polygon: identity, rule, activation and timing.
 * The id is locked once the zone exists because it is the key other modules store.
 */
export default function ZoneParameters({
  zoneId,
  idLocked,
  fields,
  zoneExists,
  saving,
  canSave,
  pointCount,
  onIdChange,
  onFieldChange,
  onSave,
  onDelete,
}) {
  const { themeStyles } = useTheme();

  return (
    <section
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border p-4 shadow-lg space-y-3 text-xs"
    >
      <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
        <Layers size={16} className="text-[#D73833] dark:text-[#FFEB33]" /> Parametri
      </h3>

      <div>
        <label htmlFor="zone-id" className="font-bold block mb-1">
          ID zonă
        </label>
        <input
          id="zone-id"
          type="text"
          value={zoneId}
          disabled={idLocked}
          onChange={(event) => onIdChange(event.target.value)}
          className={`${inputClass} font-mono disabled:opacity-60`}
          placeholder="engine-left"
          autoComplete="off"
          spellCheck={false}
        />
        {idLocked && (
          <p className="text-[10px] font-mono opacity-60 mt-1">
            ID-ul e cheia zonei; pentru alt nume folosește câmpul „Nume".
          </p>
        )}
      </div>

      <div>
        <label htmlFor="zone-name" className="font-bold block mb-1">
          Nume
        </label>
        <input
          id="zone-name"
          type="text"
          value={fields.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          className={inputClass}
          placeholder="Motor stâng"
        />
      </div>

      <div>
        <label htmlFor="zone-rule" className="font-bold block mb-1">
          Tip regulă
        </label>
        <select
          id="zone-rule"
          value={fields.rule_type}
          onChange={(event) => onFieldChange('rule_type', event.target.value)}
          className={inputClass}
        >
          <option value="RESTRICTED">RESTRICTED (zonă interzisă)</option>
          <option value="PPE_REQUIRED">PPE_REQUIRED (echipament obligatoriu)</option>
        </select>
      </div>

      <div>
        <label htmlFor="zone-active" className="font-bold block mb-1">
          Activă când
        </label>
        <select
          id="zone-active"
          value={fields.active_when}
          onChange={(event) => onFieldChange('active_when', event.target.value)}
          className={inputClass}
        >
          <option value="always">always — permanent</option>
          <option value="engine_on">engine_on — doar cu motorul pornit</option>
        </select>
      </div>

      {/* Two columns only where the label fits; below that the select would clip to "CRIT". */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor="zone-severity" className="font-bold block mb-1 whitespace-nowrap">
            Severitate
          </label>
          <select
            id="zone-severity"
            value={fields.severity}
            onChange={(event) => onFieldChange('severity', event.target.value)}
            className={inputClass}
          >
            <option value="CRITICAL">CRITICAL</option>
            <option value="WARNING">WARNING</option>
          </select>
        </div>
        <div>
          <label htmlFor="zone-debounce" className="font-bold block mb-1 whitespace-nowrap">
            Debounce (s)
          </label>
          <input
            id="zone-debounce"
            type="number"
            step="0.1"
            min="0"
            value={fields.debounce_s}
            onChange={(event) => onFieldChange('debounce_s', event.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="zone-escalate" className="font-bold block mb-1">
          Escaladează după
        </label>
        <select
          id="zone-escalate"
          value={fields.escalate_after_s ?? 'null'}
          onChange={(event) =>
            onFieldChange(
              'escalate_after_s',
              event.target.value === 'null' ? null : Number(event.target.value)
            )
          }
          className={`${inputClass} font-mono`}
        >
          <option value="30">30 s</option>
          <option value="60">60 s</option>
          <option value="120">120 s</option>
          <option value="null">niciodată</option>
        </select>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          data-testid="zone-save"
          onClick={onSave}
          disabled={!canSave || saving}
          className="flex-1 py-2.5 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-colors"
        >
          <Save size={15} /> {saving ? 'Se salvează…' : `Salvează (${pointCount} puncte)`}
        </button>
        <button
          onClick={onDelete}
          disabled={!zoneExists}
          className="p-2.5 rounded-lg border border-red-500/40 text-red-500 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
          title="Șterge zona"
          aria-label="Șterge zona"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </section>
  );
}
