import { AlertTriangle, Clock, HardHat, ShieldAlert } from 'lucide-react';
import { USE_MOCK } from '../../services/api';
import DemoDataChip from './DemoDataChip';

// The four KPIs of the shift. Values come from the context in both modes; the mock build
// gets one chip because those values are fixtures, not detection.
const KPI_ITEMS = [
  {
    id: 'ppe',
    label: 'Conformitate PPE Sol',
    icon: HardHat,
    valueClass: 'text-emerald-600 dark:text-emerald-400',
    iconClass: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    value: (kpis) =>
      kpis.ppe_compliance_pct === '—' ? '—' : `${kpis.ppe_compliance_pct}%`,
  },
  {
    id: 'open',
    label: 'Incidente Deschise',
    icon: AlertTriangle,
    valueClass: 'text-[#FFEB33] dark:text-[#FFEB33] text-amber-500',
    iconClass: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
    value: (kpis) => kpis.open_incidents_count,
  },
  {
    id: 'latency',
    label: 'Detecție → Alertă',
    icon: Clock,
    valueClass: 'text-amber-500 dark:text-[#FFEB33]',
    iconClass: 'bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15',
    iconColor: 'text-amber-500 dark:text-[#FFEB33]',
    value: (kpis) =>
      kpis.detection_to_alert_latency_s === '—' ? '—' : `${kpis.detection_to_alert_latency_s}s`,
  },
  {
    id: 'escalated',
    label: 'Escaladate la Turn',
    icon: ShieldAlert,
    valueClass: 'text-[#D73833]',
    iconClass: 'bg-red-500/10',
    iconColor: 'text-[#D73833] animate-pulse',
    value: (kpis) => kpis.escalated_incidents_count,
  },
];

export default function KpiStrip({ kpis, themeStyles }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
      {/* The row is static in the mock build, so it produces no shift: it only says that
          the numbers below come from fixtures, not from detection. */}
      {USE_MOCK && (
        <div className="col-span-full flex justify-end">
          <DemoDataChip title="Cifrele KPI vin din fixtures (date demo), nu din detecția live." />
        </div>
      )}
      {KPI_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.id}
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
          >
            <div>
              <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
                {item.label}
              </p>
              <p className={`text-xl md:text-2xl font-black font-mono ${item.valueClass}`}>
                {item.value(kpis)}
              </p>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.iconClass}`}>
              <Icon size={22} className={item.iconColor} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
