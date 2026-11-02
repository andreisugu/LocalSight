import { AlertTriangle, Clock, HardHat, ShieldAlert } from 'lucide-react';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { withoutDemoOnlyValues } from '../../utils/kpi';
import DemoDataChip from './DemoDataChip';

// The four KPIs of the shift.
//
// Two of them are counts over the incidents the operator can see right now, so they move
// with an acknowledge and they never count a hidden fixture. The other two (PPE
// compliance, detection to alert) cannot be derived from an incident list at all: they are
// supplied numbers from the demo shift. With the demo fixtures off, those two tiles say
// "no data" — a fixture percentage presented next to real detections would be a lie.
const NO_DEMO_NOTE = 'fără date demo';

const KPI_ITEMS = [
  {
    id: 'ppe',
    label: 'Conformitate PPE Sol',
    icon: HardHat,
    demoOnly: true,
    valueClass: 'text-emerald-700 dark:text-emerald-400',
    iconClass: 'bg-emerald-500/10',
    iconColor: 'text-emerald-700 dark:text-emerald-400',
    value: (kpis) =>
      kpis.ppe_compliance_pct === '—' ? '—' : `${kpis.ppe_compliance_pct}%`,
    hint:
      'Fără date demo: conformitatea PPE se măsoară pe toate detecțiile de persoane din tură, ' +
      'nu pe incidente, deci nu poate fi dedusă din detecțiile reale din browser. ' +
      'Activează datele demo din Setări pentru valoarea demo.',
  },
  {
    id: 'open',
    label: 'Incidente Deschise',
    icon: AlertTriangle,
    // amber-700 is 5.02:1 on white; amber-500 was 2.15:1, below even the large-text floor.
    valueClass: 'text-amber-700 dark:text-[#FFEB33]',
    iconClass: 'bg-amber-500/10',
    iconColor: 'text-amber-700 dark:text-[#FFEB33]',
    value: (kpis) => kpis.open_incidents_count,
    hint: 'Incidentele cu status „open” sau „escaladat” din lista vizibilă acum.',
  },
  {
    id: 'latency',
    label: 'Detecție → Alertă',
    icon: Clock,
    demoOnly: true,
    valueClass: 'text-amber-700 dark:text-[#FFEB33]',
    iconClass: 'bg-[#FFEB33]/25 dark:bg-[#FFEB33]/15',
    iconColor: 'text-amber-700 dark:text-[#FFEB33]',
    value: (kpis) =>
      kpis.detection_to_alert_latency_s === '—' ? '—' : `${kpis.detection_to_alert_latency_s}s`,
    hint:
      'Fără date demo: timpul detecție → alertă vine din notificarea măsurată de edge, ' +
      'nu din incidentele din browser. Activează datele demo din Setări pentru valoarea demo.',
  },
  {
    id: 'escalated',
    label: 'Escaladate la Turn',
    icon: ShieldAlert,
    valueClass: 'text-[#B91C1C] dark:text-[#FF8A80]',
    iconClass: 'bg-red-500/10',
    iconColor: 'text-[#B91C1C] dark:text-[#FF8A80]',
    value: (kpis) => kpis.escalated_incidents_count,
    hint: 'Incidentele escaladate din lista vizibilă acum.',
  },
];

export default function KpiStrip({ kpis, themeStyles }) {
  // The strip owns its own preference read: LiveView passes the tiles and the theme only,
  // and any screen that renders the strip must agree with the list it sits next to. A real
  // backend supplies genuine numbers, so the demo-only rule applies to the fixture build.
  const { showDemoData } = useSecurity();
  const demoOff = USE_MOCK && !showDemoData;
  // The hook already blanks these two tiles; the strip repeats the rule locally so a late
  // load can never paint a fixture percentage under a real-detection list.
  const shownKpis = demoOff ? withoutDemoOnlyValues(kpis) : kpis;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
      {/* The row is static in the mock build, so it produces no shift: it only says that
          the numbers below come from fixtures, not from detection. With the fixtures off
          there is nothing to label. */}
      {USE_MOCK && showDemoData && (
        <div className="col-span-full flex justify-end" data-testid="kpi-demo-note">
          <DemoDataChip title="Cifrele KPI vin din fixtures (date demo), nu din detecția live." />
        </div>
      )}
      {KPI_ITEMS.map((item) => {
        const Icon = item.icon;
        const unavailable = Boolean(item.demoOnly) && demoOff;
        return (
          <div
            key={item.id}
            data-testid={`kpi-${item.id}`}
            data-source={unavailable ? 'no-demo' : 'visible-events'}
            title={unavailable ? item.hint : undefined}
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-3 rounded-xl border shadow-sm flex items-center justify-between"
          >
            <div>
              <p style={{ color: themeStyles.textMuted }} className="text-[11px] font-semibold">
                {item.label}
              </p>
              <p className={`text-xl md:text-2xl font-black font-mono ${item.valueClass}`}>
                {item.value(shownKpis)}
              </p>
              {unavailable && (
                <p className="text-[9px] font-mono" style={{ color: themeStyles.textMuted }}>
                  {NO_DEMO_NOTE}
                </p>
              )}
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
