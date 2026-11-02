import React, { useMemo } from 'react';
import { FileText, FileDown, Calendar, Clock, BarChart3, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { printAsPdf } from '../../utils/print';
import { buildShiftReport } from '../../constants/shiftReport';
import { OPERATIONAL_DATE, OPERATIONAL_SHIFT_ID } from '../../constants/mockData';

// Contractul păstrează data ISO (YYYY-MM-DD). Aici e doar afișare: un singur format
// românesc, zi.lună.an, ca input-ul și raportul să nu mai arate două date diferite.
function formatDisplayDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
}

const SHIFTS = [
  { id: 'shift_1', label: 'Tura 1 (Dimineață: 06:00 - 14:00)' },
  { id: 'shift_2', label: 'Tura 2 (Prânz: 14:00 - 22:00)' },
  { id: 'shift_3', label: 'Tura 3 (Noapte: 22:00 - 06:00)' }
];

const describeAck = (value) => (value == null ? '—' : `${value} sec`);

export default function ReportsView() {
  const { themeStyles } = useTheme();
  const { events, selectedShift, setSelectedShift, selectedDate, setSelectedDate } = useSecurity();

  // Raportul se compune din evenimentele din listă, nu dintr-un fixture: confirmarea unui
  // incident și evenimentele motorului din browser schimbă cifrele imediat, fără reload.
  const shiftId = USE_MOCK ? OPERATIONAL_SHIFT_ID : selectedShift;
  const shiftLabel = SHIFTS.find((s) => s.id === shiftId)?.label || SHIFTS[0].label;
  const operationalDate = USE_MOCK ? OPERATIONAL_DATE : selectedDate;

  const report = useMemo(
    () => buildShiftReport(events, { now: Date.now(), shiftLabel, operationalDate }),
    [events, shiftLabel, operationalDate]
  );

  const hasEvents = report.kpi.total_events > 0;
  const maxHourEvents = Math.max(1, ...report.by_hour.map((h) => h.events));

  // În mock există un singur raport: selectorii arată exact ce descrie lista de incidente,
  // nu o valoare aleasă care nu poate fi servită.
  const shiftValue = USE_MOCK ? OPERATIONAL_SHIFT_ID : selectedShift;
  const shiftOptions = USE_MOCK
    ? SHIFTS.filter((s) => s.id === OPERATIONAL_SHIFT_ID)
    : SHIFTS;

  const fileBase = `LocalSight_raport_${report.date}_${report.shift}`.replace(/[^\w.-]+/g, '_');

  // Același raport, dar pentru Excel: fără dependențe, din cifrele calculate mai sus.
  // Ultima secțiune listează exact evenimentele numărate, ca totalul din CSV să fie verificabil.
  const downloadCsv = () => {
    const eventsForExport = (Array.isArray(events) ? events : [])
      .filter((event) => event && typeof event === 'object')
      .slice()
      .sort((a, b) => String(b.detected_at ?? '').localeCompare(String(a.detected_at ?? '')));

    const rows = [
      ['Tură', report.shift],
      ['Dată', report.date],
      ['Sursă', 'șablon'],
      ['Total evenimente', report.kpi.total_events],
      ['Critice', report.kpi.critical_events],
      ['Avertizări', report.kpi.warning_events],
      ['Deschise', report.kpi.open_events],
      ['Escalate', report.kpi.escalated_events],
      ['Confirmate', report.kpi.acknowledged_events],
      ['Cu confirmare', report.kpi.acked_events],
      ['Rezolvate', report.kpi.resolved_events],
      ['Fals pozitive', report.kpi.false_positive_events],
      ['Timp mediu confirmare (s)', report.kpi.avg_ack_time_s ?? '—'],
      ['Incidente fără PPE (NO_PPE)', report.kpi.no_ppe_events],
      [],
      ['Tip', 'Critice', 'Avertizări', 'Total'],
      ...report.by_type.map((t) => [t.label, t.critical, t.warning, t.count]),
      [],
      ['Zonă', 'Critice', 'Avertizări', 'Timp mediu confirmare (s)'],
      ...report.by_zone.map((z) => [z.zone, z.critical, z.warning, z.avg_ack_s ?? '—']),
      [],
      ['Oră', 'Incidente'],
      ...report.by_hour.map((h) => [h.hour, h.events]),
      [],
      ['ID', 'Tip', 'Severitate', 'Status', 'Zonă', 'Cameră', 'Detectat la', 'Confirmat la', 'Sursă raport'],
      ...eventsForExport.map((e) => [
        e.event_id,
        e.type,
        e.severity,
        e.status,
        e.zone_id,
        e.camera_id,
        e.detected_at,
        e.acked_at ?? '—',
        e.report?.source || '—',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileBase}.csv`;
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
            Incidente, timpi de reacție și distribuția pe tipuri, pe tură
          </p>
          <p className="text-[11px] font-mono font-bold text-slate-400 dark:text-slate-300 mt-0.5">
            {report.shift} · {formatDisplayDate(report.date)} ·{' '}
            <span
              title="Sumarul și cifrele sunt compuse din incidentele din listă; niciun model AI nu a scris acest raport."
              className="font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300 dark:bg-white/10 dark:text-slate-300 dark:border-white/20"
            >
              sursă: șablon
            </span>
          </p>
        </div>

        {hasEvents && (
          <div className="flex items-center gap-2">
          <button
            onClick={downloadCsv}
            className="no-print px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-2 shadow"
          >
            <FileDown size={15} /> Export CSV
          </button>
          {/* Export PDF: dialogul de tipărire al browserului */}
          <button
            onClick={() => printAsPdf(fileBase)}
            className="no-print px-3.5 py-2 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] text-white font-bold text-xs flex items-center gap-2 shadow"
          >
            <FileDown size={15} /> Export PDF
          </button>
          </div>
        )}
      </div>

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
            // data românească a raportului. Aici afișăm direct ziua operațională a listei.
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

      {!hasEvents && (
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-4 rounded-xl border shadow-sm space-y-1.5"
          data-testid="report-empty"
        >
          <p className="text-sm font-bold text-white">Nu există evenimente în tura curentă.</p>
          <p style={{ color: themeStyles.textMuted }} className="text-xs leading-relaxed">
            Cifrele sunt zero pentru că lista de incidente este goală; raportul nu inventează
            valori. Când apare primul eveniment (confirmat de operator sau produs de motorul
            din browser), cardurile și graficele se actualizează fără reîncărcare.
            {!USE_MOCK && ' Dacă pagina tocmai s-a încărcat, lista se poate completa după răspunsul API-ului.'}
          </p>
        </div>
      )}

      {/* 4 KPI pe Tură */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3.5 rounded-xl border shadow-sm space-y-1"
        >
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Total Evenimente</p>
          <p className="text-2xl font-black font-mono text-white" data-testid="report-total">{report.kpi.total_events}</p>
        </div>
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3.5 rounded-xl border shadow-sm space-y-1"
        >
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Evenimente Critice</p>
          <p className="text-2xl font-black font-mono text-red-500" data-testid="report-critical">{report.kpi.critical_events}</p>
        </div>
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3.5 rounded-xl border shadow-sm space-y-1"
        >
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Timp mediu de confirmare</p>
          <p className="text-2xl font-black font-mono text-[#D73833]" data-testid="report-avg-ack">
            {describeAck(report.kpi.avg_ack_time_s)}
          </p>
        </div>
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="p-3.5 rounded-xl border shadow-sm space-y-1"
          title="Doar incidentele cu status „open”. Cele escaladate sunt numărate separat, mai jos."
        >
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Incidente deschise</p>
          <p className="text-2xl font-black font-mono text-amber-400" data-testid="report-open">{report.kpi.open_events}</p>
        </div>
      </div>

      {/* Stări derivate din incidente. Conformitatea PPE nu apare: se măsoară pe toate
          detecțiile de persoane, iar din lista de incidente nu poate fi dedusă. */}
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="p-3.5 rounded-xl border shadow-sm flex items-start justify-between gap-3 flex-wrap"
      >
        <div>
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Incidente fără PPE (NO_PPE)</p>
          <p className="text-2xl font-black font-mono text-emerald-400" data-testid="report-no-ppe">
            {report.ppe.no_ppe_incidents}
          </p>
        </div>
        <div className="text-right">
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Escalate</p>
          <p className="text-lg font-black font-mono text-amber-400" data-testid="report-escalated">
            {report.kpi.escalated_events}
          </p>
        </div>
        <div className="text-right">
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-semibold">Cu confirmare</p>
          <p className="text-lg font-black font-mono text-emerald-400" data-testid="report-acknowledged">
            {report.kpi.acked_events}
          </p>
        </div>
        <p style={{ color: themeStyles.textMuted }} className="w-full text-[11px] leading-relaxed">
          Conformitatea PPE nu este afișată: procentul se calculează pe toate detecțiile de
          persoane din tură, nu pe incidente, deci nu poate fi dedus din această listă.
        </p>
      </div>

      {/* Rezumat Executiv: text determinist, compus din cifrele de mai sus */}
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="p-4 rounded-xl border shadow-sm space-y-1.5"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[#D73833] flex items-center gap-1.5">
          <ShieldCheck size={15} /> Rezumat Executiv Tură:
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300 dark:bg-white/10 dark:text-slate-300 dark:border-white/20">
            șablon
          </span>
        </span>
        <p className="text-xs leading-relaxed text-slate-200" data-testid="report-summary">
          {report.summary}
        </p>
        <p style={{ color: themeStyles.textMuted }} className="text-[10px] font-mono">
          Text compus din cifrele raportului; nu este generat de AI.
        </p>
      </div>

      {hasEvents && (
        <>
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
                  <div key={idx} className="space-y-1" data-testid={`report-type-${t.type}`}>
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>{t.label} ({t.type})</span>
                      <span className="font-mono font-bold" data-testid={`report-type-count-${t.type}`}>{t.count}</span>
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

            {/* Grafic pe Oră (by_hour): doar orele care apar în date */}
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
              <p style={{ color: themeStyles.textMuted }} className="text-[10px] font-mono">
                Orele în care există evenimente, în ordine cronologică (Europe/Bucharest).
              </p>
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
                      <td className="py-2 text-right text-emerald-400 font-bold">
                        {z.avg_ack_s == null ? '—' : `${z.avg_ack_s}s`}
                      </td>
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
