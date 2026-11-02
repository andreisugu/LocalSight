// Shift report and the shift/date selection.
//
// Only the real build has a report endpoint. The mock build keeps the fixture report and
// the operational shift/date constants, so the selectors cannot contradict the incidents
// the screen shows. The real report is reloaded on selection change and every 30 s while
// the screen is open; "regenerate" forces a new summary even when the numbers did not move.

import { useEffect, useState } from 'react';
import {
  INITIAL_SHIFT_REPORT,
  OPERATIONAL_DATE,
  OPERATIONAL_SHIFT_ID,
} from '../constants/mockData.js';
import { localSightApi, USE_MOCK } from '../services/api.js';

const REPORT_REFRESH_MS = 30000;

/** Shape shown before the real report arrives. */
const EMPTY_SHIFT_REPORT = {
  shift: '—',
  date: '—',
  kpi: {
    total_events: 0,
    critical_events: 0,
    warning_events: 0,
    avg_ack_time_s: '—',
    ppe_compliance_pct: '—',
  },
  summary: 'Se încarcă raportul de tură...',
  by_type: [],
  by_zone: [],
  by_hour: [],
};

export function useShiftReport({ showToast }) {
  const [shiftReport, setShiftReport] = useState(USE_MOCK ? INITIAL_SHIFT_REPORT : EMPTY_SHIFT_REPORT);
  const [selectedShift, setSelectedShift] = useState(
    () => (USE_MOCK ? OPERATIONAL_SHIFT_ID : localSightApi.currentShiftId())
  );
  // The operational day changes at 06:00, not at midnight.
  const [selectedDate, setSelectedDate] = useState(
    () => (USE_MOCK ? OPERATIONAL_DATE : localSightApi.shiftDate())
  );

  useEffect(() => {
    if (USE_MOCK) return undefined;
    let cancelled = false;
    const load = (refresh = false) => localSightApi
      .getShiftReport(localSightApi.shiftToApi(selectedShift), selectedDate, { refresh })
      .then((report) => { if (!cancelled) setShiftReport(report); })
      .catch(() => { if (!cancelled) showToast('Raportul de tură nu a putut fi încărcat.'); });

    load();
    const interval = setInterval(() => load(), REPORT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedShift, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const regenerateShiftSummary = () => {
    if (USE_MOCK) return;
    localSightApi
      .getShiftReport(localSightApi.shiftToApi(selectedShift), selectedDate, { refresh: true })
      .then((report) => setShiftReport(report))
      .catch(() => showToast('Sumarul nu a putut fi regenerat.'));
  };

  return {
    shiftReport,
    selectedShift,
    setSelectedShift,
    selectedDate,
    setSelectedDate,
    regenerateShiftSummary,
  };
}
