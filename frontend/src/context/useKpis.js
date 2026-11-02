// The four KPI tiles.
//
// The two counts an operator can change are recomputed from the visible incident list after
// every change, so acknowledging moves the number at once. The real build loads and keeps
// the API's numbers; this hook only stores them.
//
// The mock build also owns two supplied numbers (PPE compliance, detection-to-alert
// latency) that no incident list can produce. They belong to the demo shift, so they are
// shown only while the demo data is on; otherwise the tiles say "—" instead of repeating a
// fixture value as if it were measured here.

import { useEffect, useState } from 'react';
import { INITIAL_KPIS } from '../constants/mockData.js';
import { USE_MOCK } from '../services/api.js';
import { applyKpiVisibility, EMPTY_KPIS } from '../utils/kpi.js';

export function useKpis(events, { showDemoData = false } = {}) {
  const [kpis, setKpis] = useState(() => {
    if (!USE_MOCK) return EMPTY_KPIS;
    // First paint must already agree with the preference: a flash of 93.8% before the
    // effect runs would be exactly the fixture number this change removes.
    return showDemoData ? INITIAL_KPIS : applyKpiVisibility(INITIAL_KPIS, [], { showDemoData });
  });

  // Mock only: in production `/kpi` is authoritative, and overriding it here would make a
  // real acknowledge fight the backend. `INITIAL_KPIS` carries the two supplied demo values
  // so switching the fixtures back on restores them instead of leaving "—".
  useEffect(() => {
    if (!USE_MOCK) return;
    setKpis((prev) => applyKpiVisibility(prev, events, { showDemoData, demoKpis: INITIAL_KPIS }));
  }, [events, showDemoData]);

  return { kpis, setKpis };
}
