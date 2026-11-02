import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  Clock,
  Eye,
  FileDown,
  FileText,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { printAsPdf } from '../../utils/print';
import { buildShiftReport } from '../../constants/shiftReport';
import { OPERATIONAL_DATE, OPERATIONAL_SHIFT_ID } from '../../constants/mockData';
import { Panel } from '../ui';
import { ProvenanceChip, SourceChip } from '../incidents/Chips';
import CoverageRibbon from '../reports/CoverageRibbon';
import { coverageFor } from '../../utils/coverage';
import { formatDate, formatDuration } from '../../utils/time';
import {
  REPORT_SOURCE,
  buildReportCsv,
  maxHourEvents,
  reportFileBase,
  sharePercent,
} from '../../utils/reportExport';

// Shift report screen.
//
// Every number on this page comes from `buildShiftReport(events)` — the incident list,
// not a fixture — so acknowledging an incident or letting the browser engine raise one
// updates the page without a reload. The pure values the screen prints (bar shares, the
// CSV, dates and durations through `utils/time.js`) live in `utils/reportExport.js` and are
// tested there; this file decides layout and copy only.
//
// What is deliberately absent: PPE compliance. It is measured over every person
// detection in the shift, which this incident list does not carry, so the screen says so
// instead of deriving a percentage from something else.

const SHIFTS = [
  { id: 'shift_1', label: 'Tura 1 (Dimineață: 06:00 - 14:00)' },
  { id: 'shift_2', label: 'Tura 2 (Prânz: 14:00 - 22:00)' },
  { id: 'shift_3', label: 'Tura 3 (Noapte: 22:00 - 06:00)' },
];

const VALUE_TONE = {
  neutral: 'text-[#1F1F1F] dark:text-[#F5F5F5]',
  critical: 'text-red-700 dark:text-[#FF8A80]',
  accent: 'text-[#B91C1C] dark:text-[#FF8A80]',
  warning: 'text-amber-700 dark:text-[#FFEB33]',
  safe: 'text-emerald-700 dark:text-emerald-400',
};

/** Section headings: scarlet darkened for AA on both surfaces, never a decorative red. */
const HEADING_TONE = 'text-[#B91C1C] dark:text-[#FF8A80]';

/** Panel title row: icon, uppercase label, optional right-hand slot. */
function PanelTitle({ icon: Icon, children, aside = null, tone = HEADING_TONE }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
        <Icon size={15} className={`shrink-0 ${tone}`} aria-hidden="true" />
        {children}
      </h3>
      {aside}
    </div>
  );
}

function ExportButtons({ onCsv, onPdf }) {
  // One primary action per screen: printing the report is the deliverable, the CSV is the
  // secondary export. The old pair was two equal filled buttons (green + red).
  const button =
    'no-print inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCsv}
        className={`${button} border border-[#E5E7EB] text-[#1F1F1F] hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10`}
      >
        <FileDown size={15} aria-hidden="true" /> Export CSV
      </button>
      {/* Export PDF is the browser print dialog; index.css carries the print rules. */}
      <button
        type="button"
        onClick={onPdf}
        className={`${button} bg-[#D73833] text-white shadow hover:bg-[#B91C1C]`}
      >
        <FileDown size={15} aria-hidden="true" /> Export PDF
      </button>
    </div>
  );
}

function ReportHeader({ report, hasEvents, onCsv, onPdf }) {
  const { themeStyles } = useTheme();
  return (
    <header
      className="flex flex-wrap items-end justify-between gap-3 border-b pb-4"
      style={{ borderColor: themeStyles.panelBorder }}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
          <FileText size={20} className="shrink-0 text-[#D73833]" aria-hidden="true" />
          Raport de tură
        </h2>
        <p className="text-xs" style={{ color: themeStyles.textMuted }}>
          Incidente, timpi de reacție și distribuția pe tipuri, pe tură
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 font-mono text-[11px] font-bold">
          <span className="break-words">{report.shift}</span>
          <span aria-hidden="true" style={{ color: themeStyles.textMuted }}>
            ·
          </span>
          <time dateTime={report.date}>{formatDate(report.date)}</time>
          <span aria-hidden="true" style={{ color: themeStyles.textMuted }}>
            ·
          </span>
          <SourceChip title="Sumarul și cifrele sunt compuse din incidentele din listă; niciun model AI nu a scris acest raport.">
            sursă: {REPORT_SOURCE}
          </SourceChip>
        </p>
      </div>
      {hasEvents && <ExportButtons onCsv={onCsv} onPdf={onPdf} />}
    </header>
  );
}

function ShiftScope({ shiftValue, shiftOptions, report, onShiftChange, showDemoData }) {
  const { themeStyles } = useTheme();
  const control = 'rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7EDEED]';
  const controlStyle = {
    backgroundColor: themeStyles.cardBg,
    borderColor: themeStyles.panelBorder,
    color: themeStyles.text,
  };

  return (
    <Panel as="section" size="card" aria-label="Tura și data raportului" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <Calendar size={15} className="shrink-0 text-[#D73833]" aria-hidden="true" />
        <label htmlFor="report-shift" className="shrink-0 font-bold">
          Selectează Tura:
        </label>
        <select
          id="report-shift"
          value={shiftValue}
          onChange={(event) => onShiftChange(event.target.value)}
          disabled={USE_MOCK}
          className={`${control} min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none`}
          style={controlStyle}
        >
          {shiftOptions.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {shift.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 font-mono">
        <span className="font-bold">Dată:</span>
        {USE_MOCK ? (
          // The mock build has one operational day; a native date input would show a
          // second, differently formatted date next to it.
          <span className="font-bold" data-testid="report-date-input">
            {formatDate(report.date)}
          </span>
        ) : (
          <MockableDateField />
        )}
      </div>

      {USE_MOCK && (
        <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          {showDemoData ? (
            <>
              <ProvenanceChip
                tone="demo"
                title="Build-ul demo are un singur raport de tură; selectorii sunt dezactivați ca să nu promită altă dată sau altă tură."
              >
                date demo
              </ProvenanceChip>
              <span className="text-[11px]" style={{ color: themeStyles.textMuted }}>
                un singur raport de tură; selectorii sunt dezactivați.
              </span>
            </>
          ) : (
            <span className="text-[11px]" style={{ color: themeStyles.textMuted }}>
              doar detecțiile reale din listă; fixture-urile demo sunt ascunse.
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Non-mock branch: the date picker and the same Romanian-formatted value beside it. */
function MockableDateField() {
  const { selectedDate, setSelectedDate } = useSecurity();
  const { themeStyles } = useTheme();
  return (
    <>
      <input
        type="date"
        aria-label="Data raportului"
        value={selectedDate}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(event) => setSelectedDate(event.target.value)}
        style={{
          backgroundColor: themeStyles.cardBg,
          borderColor: themeStyles.panelBorder,
          color: themeStyles.text,
        }}
        className="rounded-lg border px-2 py-1.5 font-mono text-xs"
      />
      <span className="font-bold" data-testid="report-date-input">
        {formatDate(selectedDate)}
      </span>
    </>
  );
}

function EmptyReport({ mock, showDemoData }) {
  const { themeStyles } = useTheme();
  return (
    <Panel as="section" size="card" data-testid="report-empty" className="space-y-1.5">
      <p className="text-sm font-bold">Nu există evenimente în tura curentă.</p>
      <p className="text-xs leading-relaxed" style={{ color: themeStyles.textMuted }}>
        Cifrele sunt zero pentru că lista de incidente este goală; raportul nu inventează
        valori. Când apare primul eveniment (confirmat de operator sau produs de motorul din
        browser), cardurile și graficele se actualizează fără reîncărcare.
        {!mock && ' Dacă pagina tocmai s-a încărcat, lista se poate completa după răspunsul API-ului.'}
      </p>
      {!showDemoData && (
        <p className="text-xs leading-relaxed" style={{ color: themeStyles.textMuted }}>
          Fixture-urile demo sunt ascunse, deci raportul nu le numără. Le poți porni din
          Setări → Date demo, pentru raportul de demonstrație.
        </p>
      )}
    </Panel>
  );
}

function KpiCard({ label, value, tone = 'neutral', testId, hint }) {
  const { themeStyles } = useTheme();
  return (
    <div
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="min-w-0 rounded-xl border p-3.5 shadow-sm"
      title={hint}
    >
      <dt className="text-xs font-semibold" style={{ color: themeStyles.textMuted }}>
        {label}
      </dt>
      <dd className={`mt-1 font-mono text-2xl font-black leading-none ${VALUE_TONE[tone]}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function ReportKpis({ kpi }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Total Evenimente" value={kpi.total_events} testId="report-total" />
      <KpiCard label="Evenimente Critice" value={kpi.critical_events} tone="critical" testId="report-critical" />
      <KpiCard
        label="Timp mediu de confirmare"
        value={formatDuration(kpi.avg_ack_time_s)}
        tone="accent"
        testId="report-avg-ack"
      />
      <KpiCard
        label="Incidente deschise"
        value={kpi.open_events}
        tone="warning"
        testId="report-open"
        hint="Doar incidentele cu status „open”. Cele escaladate sunt numărate separat, mai jos."
      />
    </dl>
  );
}

/** PPE and escalation states, plus the reason compliance is not on this page. */
function StatusStrip({ report }) {
  const { themeStyles } = useTheme();
  const cell = 'min-w-0 space-y-1';
  const label = 'text-xs font-semibold';
  const value = 'font-mono text-2xl font-black leading-none';
  return (
    <Panel as="section" size="card" className="grid grid-cols-3 gap-x-4 gap-y-3">
      <div className={cell}>
        <p className={label} style={{ color: themeStyles.textMuted }}>
          Incidente fără PPE (NO_PPE)
        </p>
        <p className={`${value} text-emerald-700 dark:text-emerald-400`} data-testid="report-no-ppe">
          {report.ppe.no_ppe_incidents}
        </p>
      </div>
      <div className={cell}>
        <p className={label} style={{ color: themeStyles.textMuted }}>
          Escalate
        </p>
        <p className={`${value} text-amber-700 dark:text-[#FFEB33]`} data-testid="report-escalated">
          {report.kpi.escalated_events}
        </p>
      </div>
      <div className={cell}>
        <p className={label} style={{ color: themeStyles.textMuted }}>
          Cu confirmare
        </p>
        <p className={`${value} text-emerald-700 dark:text-emerald-400`} data-testid="report-acknowledged">
          {report.kpi.acked_events}
        </p>
      </div>
      <p className="col-span-3 text-[11px] leading-relaxed" style={{ color: themeStyles.textMuted }}>
        Conformitatea PPE nu este afișată: procentul se calculează pe toate detecțiile de
        persoane din tură, nu pe incidente, deci nu poate fi dedus din această listă.
      </p>
    </Panel>
  );
}

function ReportSummary({ report }) {
  const { themeStyles } = useTheme();
  return (
    <Panel as="section" size="card" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={15} className={`shrink-0 ${HEADING_TONE}`} aria-hidden="true" />
        <h3 className={`text-xs font-bold uppercase tracking-wider ${HEADING_TONE}`}>
          Rezumat Executiv Tură:
        </h3>
        <SourceChip title="Text compus din cifrele raportului; nu este generat de AI.">
          sursă: șablon
        </SourceChip>
      </div>
      {/* A readable measure: 68 characters per line instead of a 1070 px paragraph (M2). */}
      <p className="max-w-[68ch] text-[13px] leading-relaxed" style={{ color: themeStyles.text }}>
        <span data-testid="report-summary">{report.summary}</span>
      </p>
      <p className="font-mono text-[10px]" style={{ color: themeStyles.textMuted }}>
        Text compus din cifrele raportului; nu este generat de AI.
      </p>
    </Panel>
  );
}

function TypeDistribution({ report }) {
  const { themeStyles } = useTheme();
  const total = report.kpi.total_events;
  return (
    <Panel as="section" size="card">
      <PanelTitle icon={BarChart3}>Distribuție pe Tipuri de Alertă (by_type)</PanelTitle>
      <ul className="space-y-2.5 text-xs">
        {report.by_type.map((type) => {
          const share = Math.round(sharePercent(type.count, total));
          return (
            <li key={type.type} className="space-y-1" data-testid={`report-type-${type.type}`}>
              <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold">
                <span className="min-w-0 break-words">
                  {type.label} ({type.type})
                </span>
                <span className="flex items-baseline gap-1 whitespace-nowrap font-mono font-bold">
                  <span data-testid={`report-type-count-${type.type}`}>{type.count}</span>
                  <span className="font-normal opacity-75">· {share}%</span>
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-[#D73833]"
                  style={{ width: `${sharePercent(type.count, total)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-mono text-[11px]" style={{ color: themeStyles.textMuted }}>
        Bara arată cota din totalul de {total} incidente (axă 0–{total}).
      </p>
    </Panel>
  );
}

function HourDistribution({ report }) {
  const { themeStyles } = useTheme();
  const peak = maxHourEvents(report.by_hour);
  return (
    <Panel as="section" size="card" className="flex flex-col">
      <PanelTitle icon={TrendingUp}>Grafic Incidente pe Ore (by_hour)</PanelTitle>
      <div className="flex h-36 items-end justify-between gap-3 border-b border-slate-200 px-2 pb-1 pt-4 dark:border-white/10">
        {report.by_hour.map((hour) => (
          <div key={hour.hour} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="font-mono text-[11px] font-bold text-[#B91C1C] opacity-80 group-hover:opacity-100 dark:text-[#FFEB33]">
              {hour.events}
            </span>
            <div
              className="w-full min-w-[24px] max-w-[64px] rounded-t-md bg-gradient-to-t from-[#D73833]/80 to-[#D73833] shadow transition-all group-hover:from-[#D73833] group-hover:to-[#FFEB33]"
              style={{ height: `${sharePercent(hour.events, peak)}%` }}
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{hour.hour}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px]" style={{ color: themeStyles.textMuted }}>
        Maxim {peak} incidente într-o oră (axă 0–{peak}); orele cu evenimente, în ordine
        cronologică (Europe/Bucharest).
      </p>
    </Panel>
  );
}

function ZoneTable({ rows }) {
  const head = 'pb-1.5 text-[10px] font-bold uppercase tracking-wider';
  return (
    <Panel as="section" size="card">
      <PanelTitle icon={Clock}>Statistici de Confirmare pe Sector (by_zone)</PanelTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <caption className="sr-only">Critice, avertismente și timp mediu de confirmare pe fiecare sector</caption>
          <thead>
            <tr className="border-b border-slate-200 opacity-80 dark:border-white/10">
              <th scope="col" className={head}>
                Zonă / Sector
              </th>
              <th scope="col" className={`${head} text-red-700 dark:text-[#FF8A80]`}>
                Critice
              </th>
              <th scope="col" className={`${head} text-amber-700 dark:text-[#FFEB33]`}>
                Warning
              </th>
              <th scope="col" className={`${head} text-right`}>
                Timp mediu de confirmare
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {rows.map((zone) => (
              <tr key={zone.zone}>
                <td className="py-2 font-sans font-medium">{zone.zone}</td>
                <td className="py-2 font-bold text-red-700 dark:text-[#FF8A80]">{zone.critical}</td>
                <td className="py-2 font-bold text-amber-700 dark:text-[#FFEB33]">{zone.warning}</td>
                <td className="py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">
                  {zone.avg_ack_s == null ? '—' : `${zone.avg_ack_s}s`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** A session shorter than this starts at its first sample; a longer one shows the last 30 min. */
const COVERAGE_WINDOW_MS = 30 * 60 * 1000;

/** Re-render the receipt once a second so a stopped engine's tail becomes a visible gap. */
function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Coverage receipt, mounted on Reports. It reads the session-only samples Live records
 * while the engine runs; with no samples it renders the ribbon's honest `noData` rows.
 * Nothing here is inferred from the number of incidents: a gap is only what the frame
 * samples prove.
 */
function CoveragePanel({ samples, events, cameras, now }) {
  const { themeStyles } = useTheme();
  const cameraIds = useMemo(
    () =>
      (Array.isArray(cameras) ? cameras : [])
        .map((camera) => camera?.id)
        .filter((id) => typeof id === 'string' && id !== ''),
    [cameras]
  );
  const cameraLabels = useMemo(() => {
    const labels = {};
    for (const camera of Array.isArray(cameras) ? cameras : []) {
      if (typeof camera?.id === 'string' && camera.id !== '') {
        labels[camera.id] = camera.name || camera.code || camera.id;
      }
    }
    return labels;
  }, [cameras]);

  // The ribbon reads `at`/`eventId`; the incident list carries `detected_at`/`event_id`.
  const ticks = useMemo(
    () =>
      (Array.isArray(events) ? events : [])
        .map((event) => ({
          eventId: event?.event_id,
          at: event?.detected_at,
          cameraId: event?.camera_id,
          severity: event?.severity,
        }))
        .filter((event) => typeof event.eventId === 'string' && event.eventId && event.at),
    [events]
  );

  const coverageWindow = useMemo(() => {
    const to = now;
    const first = (Array.isArray(samples) ? samples : []).reduce(
      (earliest, sample) =>
        typeof sample?.at === 'number' && sample.at < earliest ? sample.at : earliest,
      to
    );
    return { from: Math.max(first, to - COVERAGE_WINDOW_MS), to };
  }, [samples, now]);

  const coverage = useMemo(
    () => coverageFor(samples, ticks, coverageWindow, { expectedFrameMs: 1000, cameras: cameraIds }),
    [samples, ticks, coverageWindow, cameraIds]
  );

  return (
    <Panel as="section" size="card" className="space-y-2">
      <PanelTitle icon={Eye}>Acoperire cameră</PanelTitle>
      <CoverageRibbon
        coverage={coverage}
        window={coverageWindow}
        incidents={ticks}
        cameraLabel={cameraLabels}
      />
      <p className="text-[10px] leading-relaxed" style={{ color: themeStyles.textMuted }}>
        doar cât a rulat motorul în acest tab — un eșantion pe secundă din cadrele procesate,
        ținut doar în memorie; nu se salvează și nu pleacă din tab. Fereastra acoperă
        începutul sesiunii sau ultimele 30 de minute.
      </p>
    </Panel>
  );
}

export default function ReportsView() {
  const {
    events,
    selectedShift,
    setSelectedShift,
    selectedDate,
    showDemoData,
    coverageSamples,
    cameras,
  } = useSecurity();
  // A stopped engine stops producing samples, so the receipt needs its own clock to show
  // the tail as a gap instead of freezing on the last green segment.
  const now = useNow(1000);

  // The report is composed from the incidents the operator sees in the list, so an
  // acknowledgement or a browser-engine event changes the numbers immediately.
  const shiftId = USE_MOCK ? OPERATIONAL_SHIFT_ID : selectedShift;
  const shiftLabel = SHIFTS.find((shift) => shift.id === shiftId)?.label || SHIFTS[0].label;

  const report = useMemo(
    () =>
      buildShiftReport(events, {
        now: Date.now(),
        shiftLabel,
        operationalDate: USE_MOCK ? OPERATIONAL_DATE : selectedDate,
      }),
    [events, shiftLabel, selectedDate]
  );
  const hasEvents = report.kpi.total_events > 0;

  const downloadCsv = () => {
    const blob = new Blob([`\uFEFF${buildReportCsv(report, events)}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportFileBase(report)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto select-none">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
        <ReportHeader
          report={report}
          hasEvents={hasEvents}
          onCsv={downloadCsv}
          onPdf={() => printAsPdf(reportFileBase(report))}
        />
        <ShiftScope
          shiftValue={shiftId}
          shiftOptions={USE_MOCK ? SHIFTS.filter((shift) => shift.id === OPERATIONAL_SHIFT_ID) : SHIFTS}
          report={report}
          onShiftChange={setSelectedShift}
          showDemoData={showDemoData}
        />
        {!hasEvents && <EmptyReport mock={USE_MOCK} showDemoData={showDemoData} />}
        <ReportKpis kpi={report.kpi} />
        <StatusStrip report={report} />
        <CoveragePanel
          samples={coverageSamples}
          events={events}
          cameras={cameras}
          now={now}
        />
        <ReportSummary report={report} />
        {hasEvents && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TypeDistribution report={report} />
              <HourDistribution report={report} />
            </div>
            <ZoneTable rows={report.by_zone} />
          </>
        )}
      </div>
    </div>
  );
}
