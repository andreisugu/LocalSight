// The four KPI tiles.
//
// In mock mode the two counts an operator can change are recomputed from the incident list
// after every change, so acknowledging moves the number at once. The real build loads and
// keeps the API's numbers; this hook only stores them.

import { useEffect, useState } from 'react';
import { INITIAL_KPIS } from '../constants/mockData.js';
import { USE_MOCK } from '../services/api.js';
import { applyActiveCounts, EMPTY_KPIS } from '../utils/kpi.js';

export function useKpis(events) {
  const [kpis, setKpis] = useState(USE_MOCK ? INITIAL_KPIS : EMPTY_KPIS);

  // Mock only: in production `/kpi` is authoritative, and overriding it here would make a
  // real acknowledge fight the backend.
  useEffect(() => {
    if (!USE_MOCK) return;
    setKpis((prev) => applyActiveCounts(prev, events));
  }, [events]);

  return { kpis, setKpis };
}
