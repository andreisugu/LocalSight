import React from 'react';
import { FileText, FileDown, Calendar, Clock, BarChart3, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { printAsPdf } from '../../utils/print';

// Contractul păstrează data ISO (YYYY-MM-DD). Aici e doar afișare: un singur format
// românesc, zi.lună.an, ca input-ul și raportul să nu mai arate două date diferite.
function formatDisplayDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
}

export default function ReportsView() {
  const { themeStyles } = useTheme();
  const { shiftReport, selectedShift, setSelectedShift, selectedDate, setSelectedDate, regenerateShiftSummary } = useSecurity();

  const shifts = [
    { id: 'shift_1', label: 'Tura 1 (Dimineață: 06:00 - 14:00)' },
    { id: 'shift_2', label: 'Tura 2 (Prânz: 14:00 - 22:00)' },
    { id: 'shift_3', label: 'Tura 3 (Noapte: 22:00 - 06:00)' }
  ];

  // Raportul de tură există doar când are tură, dată și KPI. Un obiect gol sau
  // EMPTY_SHIFT_REPORT nu trebuie afișat ca un raport cu zerouri.
  const report = shiftReport && shiftReport.date && shiftReport.date !== '—' ? shiftReport : null;
  const hasReport = Boolean(report && report.kpi);

  // În mock există un singur raport: selectorii arată exact ce descrie fixture-ul,
  // nu o valoare aleasă care nu poate fi servită.
  const fixtureShift = report ? shifts.find((s) => s.label === report.shift) : null;
  const shiftValue = USE_MOCK ? fixtureShift?.id ?? '' : selectedShift;
  const shiftOptions = USE_MOCK && fixtureShift ? [fixtureShift] : shifts;

  const maxHourEvents = Math.max(...(report?.by_hour ?? []).map((h) => h.events), 1);

  // Același raport, dar pentru Excel: fără dependențe, din obiectul deja încărcat.
  const downloadCsv = () => {
    if (!report) return;
    const coveragePct = report.coverage?.coverage == null
      ? '—'
      : Math.round(report.coverage.coverage * 1000) / 10;
    const rows = [
      ['Tură', report.shift],
      ['Dată', report.date],
      ['Incidente', report.kpi.total_events],
      ['Critice', report.kpi.critical_events],
      ['Avertizări', report.kpi.warning_events],
      ['Fals pozitive', report.false_positives ?? 0],
      ['Timp mediu confirmare (s)', report.kpi.avg_ack_time_s],
      ['Conformitate PPE (%)', report.kpi.ppe_compliance_pct],
      ['Acoperire camere (%)', coveragePct],
      ['Minute camere oarbe', report.coverage?.offline_minutes ?? 0],
      [],
      ['Tip', 'Critice', 'Avertizări', 'Fals pozitive'],
      ...report.by_type.map((t) => [t.type, t.critical, t.warning, t.false_positive]),
      [],
      ['Zonă', 'Critice', 'Avertizări', 'Fals pozitive'],
      ...report.by_zone.map((z) => [z.zone, z.critical, z.warning, z.false_positive]),
      [],
      ['Oră', 'Incidente'],
      ...report.by_hour.map((h) => [h.hour, h.events]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LocalSight_raport_${report.date}_${report.shift}.csv`.replace(/[^\w.-]+/g, '_');
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-5 h-full select-none max-w-6xl mx-auto">
      {/* Header Raport */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3 flex-wrap gap-2">
        <div>
          <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
            <FileText size={20} className="text-[#D73833]" />
            Raport de tură
          </h2>
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-mono">
            Incidente, timpi de reacție și conformitate PPE pe tură
          </p>
          {hasReport && (
            <p className="text-[11px] font-mono font-bold text-slate-400 dark:text-slate-300 mt-0.5">
              {report.shift} · {formatDisplayDate(report.date)}
            </p>
          )}
        </div>

        {hasReport && (
          <div className="flex items-center gap-2">
          <button
            onClick={downloadCsv}
            className="no-print px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-2 shadow"
          >
            <FileDown size={15} /> Export CSV
          </button>
          {/* Export PDF: dialogul de tipărire al browserului */}
          <button
            onClick={() => printAsPdf(`LocalSight_raport_${report.date}_${report.shift}`.replace(/[^\w.-]+/g, '_'))}
            className="no-print px-3.5 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white font-bold text-xs flex items-center gap-2 shadow"
          >
            <FileDown size={15} /> Export PDF
          </button>
          </div>
        )}
      </div>

      {!hasReport ? (
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-4 rounded-xl border shadow-sm space-y-1.5"
          data-testid="report-empty"
        >
          <p className="text-sm font-bold text-white">Nu există raport de tură.</p>
          <p style={{ color: themeStyles.textMuted }} className="text-xs leading-relaxed">
            {USE_MOCK
              ? 'Datele demo nu conțin niciun raport de tură, deci nu sunt afișate cifre.'
              : 'Raportul nu este încărcat pentru tura și data selectate. Reîncarcă pagina după ce API-ul răspunde.'}
          </p>
        </div>
      ) : (
        <>
          {/* Selector Tură & Dată */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-3 rounded-xl border shadow-sm flex items-center justify-between gap-3 text-xs flex-wrap"
          >
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-[#D73833]" />
              <span className="font-bold">Selectează Tura:</span>
              <select
                value={shiftValue}
                onChange={(e) => setSelectedShift(e.target.value)}
                disabled={USE_MOCK}
                className="p-1.5 rounded bg-black/30 border border-white/20 text-xs text-white disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {shiftOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 font-mono text-slate-300">
              <span className="font-bold">Dată:</span>
              {USE_MOCK ? (
                // În mock există o singură zi: un input nativ ar arăta 11/02/2026 lângă
                // data românească a raportului. Aici afișăm direct data fixture-ului.
                <span className="font-bold text-white" data-testid="report-date-input">{formatDisplayDate(report.date)}</span>
              ) : (
                <>
                  <input
                    type="date"
                    value={selectedDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="p-1.5 rounded bg-black/30 border border-white/20 text-xs text-white font-mono"
                  />
                  <span className="font-bold text-white" data-testid="report-date-input">{formatDisplayDate(selectedDate)}</span>
                </>
              )}
            </div>
            {USE_MOCK && (
              <span
                title="Build-ul demo are un singur raport de tură; selectorii sunt dezactivați ca să nu promită altă dată sau altă tură."
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33] dark:border-[#FFEB33]/40"
              >
                demo: un singur raport disponibil
              </span>
            )}
          </div>

          {/* 4 KPI pe Tură */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-3.5 rounded-xl border shadow-sm space-y-1"
            >
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Total Evenimente</p>
              <p className="text-2xl font-black font-mono text-white">{report.kpi.total_events}</p>
            </div>
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-3.5 rounded-xl border shadow-sm space-y-1"
            >
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Evenimente Critice</p>
              <p className="text-2xl font-black font-mono text-red-500">{report.kpi.critical_events}</p>
            </div>
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-3.5 rounded-xl border shadow-sm space-y-1"
            >
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Timp mediu de confirmare</p>
              <p className="text-2xl font-black font-mono text-[#D73833]">
                {report.kpi.avg_ack_time_s === '—' ? '—' : `${report.kpi.avg_ack_time_s} sec`}
              </p>
            </div>
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-3.5 rounded-xl border shadow-sm space-y-1"
            >
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Conformitate PPE Tură</p>
              <p className="text-2xl font-black font-mono text-emerald-400">
                {report.kpi.ppe_compliance_pct === '—' ? '—' : `${report.kpi.ppe_compliance_pct}%`}
              </p>
            </div>
          </div>

          {/* Acoperire: minutele în care camerele nu au transmis nu sunt incidente */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-3.5 rounded-xl border shadow-sm flex items-center justify-between gap-3 flex-wrap"
          >
            <div>
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Acoperire camere în tură</p>
              <p className="text-2xl font-black font-mono text-emerald-400">
                {report.coverage?.coverage == null
                  ? '—'
                  : `${Math.round(report.coverage.coverage * 1000) / 10}%`}
              </p>
            </div>
            <div className="text-right">
              <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Minute cu camera oarbă</p>
              <p className="text-lg font-black font-mono text-amber-400">
                {report.coverage?.offline_minutes ?? 0} min
              </p>
            </div>
          </div>

          {/* Rezumat Executiv (2-3 Propoziții generate de D din cifrele lui B) */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-4 rounded-xl border shadow-sm space-y-1.5"
          >
            <span className="text-xs font-bold uppercase tracking-wider text-[#D73833] flex items-center gap-1.5">
              <ShieldCheck size={15} /> Rezumat Executiv Tură:
            </span>
            <p className="text-xs leading-relaxed text-slate-200" data-testid="report-summary">
              {report.summary || 'Sumarul nu este disponibil.'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={regenerateShiftSummary}
                disabled={USE_MOCK}
                className="no-print mt-1 px-2.5 py-1 rounded border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/40 text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title={USE_MOCK
                  ? 'Regenerarea sumarului necesită API-ul; build-ul demo are un singur sumar din fixtures.'
                  : 'Cere un text nou; reîncărcarea normală refoloseste sumarul cât timp cifrele nu se schimbă'}
              >
                Regenerează sumarul
              </button>
              {USE_MOCK && (
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  demo: regenerarea necesită API-ul
                </span>
              )}
            </div>
          </div>

          {/* Secțiunea Grafice: Bare pe Tip & Distribuție pe Ore (by_hour) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bare pe Tip Eveniment (by_type) */}
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-4 rounded-xl border shadow-sm space-y-3"
            >
              <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                <BarChart3 size={15} className="text-[#D73833]" />
                Distribuție pe Tipuri de Alertă (by_type)
              </h3>

              <div className="space-y-2.5 text-xs">
                {report.by_type.map((t, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>{t.label} ({t.type})</span>
                      <span className="font-mono font-bold">{t.count}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-black/30 overflow-hidden">
                      <div
                        style={{ width: `${(t.count / Math.max(report.kpi.total_events, 1)) * 100}%` }}
                        className="bg-[#D73833] h-full rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Grafic pe Oră (by_hour conform §5.4) */}
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-4 rounded-xl border shadow-sm space-y-3 flex flex-col justify-between"
            >
              <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                <TrendingUp size={15} className="text-[#D73833]" />
                Grafic Incidente pe Ore (by_hour)
              </h3>

              <div className="h-36 flex items-end justify-between gap-3 pt-4 px-2">
                {report.by_hour.map((h, idx) => {
                  const heightPct = (h.events / maxHourEvents) * 100;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <span className="font-mono text-[10px] font-bold text-[#D73833] dark:text-[#FFEB33] opacity-80 group-hover:opacity-100">
                        {h.events}
                      </span>
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full max-w-[28px] rounded-t-md bg-gradient-to-t from-[#D73833]/80 to-[#D73833] group-hover:from-[#D73833] group-hover:to-[#FFEB33] transition-all shadow"
                      />
                      <span className="font-mono text-[10px] text-slate-400">{h.hour}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tabel pe Zonă (by_zone: critice, warning, timp mediu) */}
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="p-4 rounded-xl border shadow-sm space-y-3"
          >
            <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
              <Clock size={15} className="text-[#D73833]" />
              Statistici de Confirmare pe Sector (by_zone)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/10 opacity-70">
                    <th className="pb-1.5">Zonă / Sector</th>
                    <th className="pb-1.5 text-red-400">Critice</th>
                    <th className="pb-1.5 text-amber-400">Warning</th>
                    <th className="pb-1.5 text-right">Timp mediu de confirmare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {report.by_zone.map((z, idx) => (
                    <tr key={idx} className="py-1">
                      <td className="py-2 font-sans font-medium">{z.zone}</td>
                      <td className="py-2 text-red-400 font-bold">{z.critical}</td>
                      <td className="py-2 text-amber-400 font-bold">{z.warning}</td>
                      <td className="py-2 text-right text-emerald-400 font-bold">{z.avg_ack_s}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
