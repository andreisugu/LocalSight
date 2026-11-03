// The shift-report screen.
//
// Every figure comes from `buildShiftReport(events)` — the incident list, never a
// fixture — so acknowledging an incident or letting the browser engine raise one
// redraws the page without a reload. The pure values the screen prints (bar shares, the
// CSV, dates and durations through `utils/time.js`) live in `utils/reportExport.js` and
// are tested there; this module owns layout and copy.
//
// PPE compliance is deliberately absent: it is measured over every person detection in
// the shift, and this incident list does not carry those, so the page says so instead of
// deriving a percentage from something else.
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, Clock, Eye, FileDown, FileText, ShieldCheck, TrendingUp } from 'lucide-react';
import CoverageRibbon from '../reports/CoverageRibbon';
import { Panel } from '../ui';
import { ProvenanceChip, SourceChip } from '../incidents/Chips';
import { useSecurity } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import { OPERATIONAL_DATE, OPERATIONAL_SHIFT_ID } from '../../constants/mockData';
import { buildShiftReport } from '../../constants/shiftReport';
import { SHIFT_LABELS } from '../../data/shift';
import { USE_MOCK } from '../../services/api';
import { coverageFor } from '../../utils/coverage';
import { printAsPdf } from '../../utils/print';
import {
  REPORT_SOURCE,
  buildReportCsv,
  maxHourEvents,
  reportFileBase,
  sharePercent,
} from '../../utils/reportExport';
import { formatDate, formatDuration } from '../../utils/time';
// One entry per shift, in display order; the label text is the same constant the API
// mappers and the fixtures use, so the selector cannot drift from the report.
const SHIFT_SLOTS = Object.entries(SHIFT_LABELS).map(([id, label]) => ({ id, label }));
// Value ink per KPI tone. The scarlet is darkened for AA on both surfaces and is never
// used as decoration.
const VALUE_TONE = {
  neutral: 'text-[#1F1F1F] dark:text-[#F5F5F5]',
  critical: 'text-red-700 dark:text-[#FF8A80]',
  accent: 'text-[#B91C1C] dark:text-[#FF8A80]',
  warning: 'text-amber-700 dark:text-[#FFEB33]',
  safe: 'text-emerald-700 dark:text-emerald-400',
};

/** Section headings: scarlet darkened for AA on both surfaces, never a decorative red. */
const HEADING_INK = 'text-[#B91C1C] dark:text-[#FF8A80]';

/** Page title, shared by the heading and the print/CSV filename. */
const REPORT_TITLE = 'Raport de tură';

/** Panel title row: glyph, uppercase label, optional right-hand slot. */
function SectionHeading({ glyph: Glyph, label, aside = null, ink = HEADING_INK }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
        <Glyph size={15} className={`shrink-0 ${ink}`} aria-hidden="true" />
        {label}
      </h3>
      {aside}
    </div>
  );
}
/**
 * The two export buttons. Printing the report is the deliverable, so it stays the
 * primary filled action; the CSV is the secondary export. The old pair was two equal
 * filled buttons (green + red).
 */
function ExportActions({ onCsv, onPdf }) {
  const shape =
    'no-print inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCsv}
        className={`${shape} border border-[#E5E7EB] text-[#1F1F1F] hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10`}
      >
        <FileDown size={15} aria-hidden="true" /> Export CSV
      </button>
      {/* Export PDF is the browser print dialog; index.css carries the print rules. */}
      <button
        type="button"
        onClick={onPdf}
        className={`${shape} bg-[#D73833] text-white shadow hover:bg-[#B91C1C]`}
      >
        <FileDown size={15} aria-hidden="true" /> Export PDF
      </button>
    </div>
  );
}

/** The `·` between the shift name, the date and the source chip. */
function MetaDot() {
  const { themeStyles } = useTheme();
  return (
    <span aria-hidden="true" style={{ color: themeStyles.textMuted }}>
      ·
    </span>
  );
}

/** Title block: what the page is, the operational day and where the numbers come from. */
function ReportMasthead({ report, hasEvents, onCsv, onPdf }) {
  const { themeStyles } = useTheme();
  const metaSkin = { color: themeStyles.textMuted };
  return <header
    className="flex flex-wrap items-end justify-between gap-3 border-b pb-4"
    style={{ borderColor: themeStyles.panelBorder }}
  >
    <div className="min-w-0 space-y-1">
      <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
        <FileText size={20} className="shrink-0 text-[#D73833]" aria-hidden="true" />
        {REPORT_TITLE}</h2>
      <p className="text-xs" style={metaSkin}>
        Incidente, timpi de reacție și distribuția pe tipuri, pe tură</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 font-mono text-[11px] font-bold">
        <span className="break-words">{report.shift}</span>
        <MetaDot />
        <time dateTime={report.date}>{formatDate(report.date)}</time>
        <MetaDot />
        <SourceChip title="Sumarul și cifrele sunt compuse din incidentele din listă; niciun model AI nu a scris acest raport.">
          sursă: {REPORT_SOURCE}
        </SourceChip></p>
    </div>{hasEvents ? <ExportActions onCsv={onCsv} onPdf={onPdf} /> : null}
  </header>;
}
/** Shift selector; disabled in the mock build, which has exactly one shift. */
function ShiftSelect({ value, options, onChange }) {
  const { themeStyles } = useTheme();
  const control =
    'rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7EDEED]';
  const controlSkin = {
    backgroundColor: themeStyles.cardBg,
    borderColor: themeStyles.panelBorder,
    color: themeStyles.text,
  };
  const choices = options.map((slot) => (
    <option key={slot.id} value={slot.id}>
      {slot.label}
    </option>
  ));

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <Calendar size={15} className="shrink-0 text-[#D73833]" aria-hidden="true" />
      <label htmlFor="report-shift" className="shrink-0 font-bold">
        Selectează Tura:
      </label>
      <select id="report-shift"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={USE_MOCK}
        className={`${control} min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none`}
        style={controlSkin}>
        {choices}</select></div>
  );
}
/** Non-mock branch: the date picker and the same Romanian-formatted value beside it. */
function DatePickerField() {
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

/** The demo/fixture hint shown only by the static build. */
function DemoScopeNote({ showDemoData }) {
  const { themeStyles } = useTheme();
  if (!showDemoData) {
    return (
      <span className="text-[11px]" style={{ color: themeStyles.textMuted }}>
        doar detecțiile reale din listă; fixture-urile demo sunt ascunse.
      </span>
    );
  }
  return (
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
  );
}

function ShiftAndDate({ shiftValue, shiftOptions, report, onShiftChange, showDemoData }) {
  const { themeStyles } = useTheme();
  return (
    <Panel as="section" size="card" aria-label="Tura și data raportului" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
      <ShiftSelect value={shiftValue} options={shiftOptions} onChange={onShiftChange} />

      <div className="flex items-center gap-2 font-mono">
        <span className="font-bold">Dată:</span>
        {USE_MOCK ? (
          // The mock build has one operational day; a native date input would show a
          // second, differently formatted date next to it.
          <span className="font-bold" data-testid="report-date-input">
            {formatDate(report.date)}
          </span>
        ) : (
          <DatePickerField />
        )}
      </div>

      {USE_MOCK && (
        <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <DemoScopeNote showDemoData={showDemoData} />
        </div>
      )}
    </Panel>
  );
}

function EmptyShiftReport({ mock, showDemoData }) {
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

function MetricCard({ caption, figure, tone = 'neutral', testId, note }) {
  const { themeStyles } = useTheme();
  const skin = { backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder };
  return <div style={skin} className="min-w-0 rounded-xl border p-3.5 shadow-sm" title={note}>
    <dt className="text-xs font-semibold" style={{ color: themeStyles.textMuted }}>
      {caption}
    </dt>
    <dd className={`mt-1 font-mono text-2xl font-black leading-none ${VALUE_TONE[tone]}`} data-testid={testId}>
      {figure}
    </dd>
  </div>;
}
function MetricGrid({ kpi }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard caption="Total Evenimente" figure={kpi.total_events} testId="report-total" />
      <MetricCard caption="Evenimente Critice" figure={kpi.critical_events} tone="critical" testId="report-critical" />
      <MetricCard
        caption="Timp mediu de confirmare"
        figure={formatDuration(kpi.avg_ack_time_s)}
        tone="accent"
        testId="report-avg-ack"
      />
      <MetricCard
        caption="Incidente deschise"
        figure={kpi.open_events}
        tone="warning"
        testId="report-open"
        note="Doar incidentele cu status „open”. Cele escaladate sunt numărate separat, mai jos."
      />
    </dl>
  );
}

/** PPE and escalation states, plus the reason compliance is not on this page. */
function ComplianceStrip({ report }) {
  const { themeStyles } = useTheme();
  const cells = [
    {
      testId: 'report-no-ppe',
      caption: 'Incidente fără PPE (NO_PPE)',
      figure: report.ppe.no_ppe_incidents,
      ink: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      testId: 'report-escalated',
      caption: 'Escalate',
      figure: report.kpi.escalated_events,
      ink: 'text-amber-700 dark:text-[#FFEB33]',
    },
    {
      testId: 'report-acknowledged',
      caption: 'Cu confirmare',
      figure: report.kpi.acked_events,
      ink: 'text-emerald-700 dark:text-emerald-400',
    },
  ];

  return (
    <Panel as="section" size="card" className="grid grid-cols-3 gap-x-4 gap-y-3">
      {cells.map((cell) => (
        <div key={cell.testId} className="min-w-0 space-y-1">
          <p className="text-xs font-semibold" style={{ color: themeStyles.textMuted }}>
            {cell.caption}
          </p>
          <p className={`font-mono text-2xl font-black leading-none ${cell.ink}`} data-testid={cell.testId}>
            {cell.figure}
          </p>
        </div>
      ))}
      <p className="col-span-3 text-[11px] leading-relaxed" style={{ color: themeStyles.textMuted }}>
        Conformitatea PPE nu este afișată: procentul se calculează pe toate detecțiile de
        persoane din tură, nu pe incidente, deci nu poate fi dedus din această listă.
      </p>
    </Panel>
  );
}

function ExecutiveSummary({ report }) {
  const { themeStyles } = useTheme();
  const muted = { color: themeStyles.textMuted };
  return (
    <Panel as="section" size="card" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={15} className={`shrink-0 ${HEADING_INK}`} aria-hidden="true" />
        <h3 className={`text-xs font-bold uppercase tracking-wider ${HEADING_INK}`}>
          Rezumat Executiv Tură:</h3>
        <SourceChip title="Text compus din cifrele raportului; nu este generat de AI.">
          sursă: șablon
        </SourceChip>
      </div>
      {/* A readable measure: 68 characters per line instead of a 1070 px paragraph (M2). */}
      <p className="max-w-[68ch] text-[13px] leading-relaxed" style={{ color: themeStyles.text }}>
        <span data-testid="report-summary">{report.summary}</span></p>
      <p className="font-mono text-[10px]" style={muted}>Text compus din cifrele raportului; nu este generat de AI.</p>
    </Panel>
  );
}
/** One alert type: label, count, share and its bar. */
function TypeRow({ entry, total }) {
  const share = Math.round(sharePercent(entry.count, total));
  return (
    <li className="space-y-1" data-testid={`report-type-${entry.type}`}>
      <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold">
        <span className="min-w-0 break-words">
          {entry.label} ({entry.type})
        </span>
        <span className="flex items-baseline gap-1 whitespace-nowrap font-mono font-bold">
          <span data-testid={`report-type-count-${entry.type}`}>{entry.count}</span>
          <span className="font-normal opacity-75">· {share}%</span>
        </span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" aria-hidden="true"><div className="h-full rounded-full bg-[#D73833]" style={{ width: `${sharePercent(entry.count, total)}%` }} /></div>
    </li>
  );
}

function TypeBreakdown({ report }) {
  const { themeStyles } = useTheme();
  const total = report.kpi.total_events;
  return (
    <Panel as="section" size="card">
      <SectionHeading glyph={BarChart3} label="Distribuție pe Tipuri de Alertă (by_type)" />
      <ul className="space-y-2.5 text-xs">
        {report.by_type.map((entry) => (
          <TypeRow key={entry.type} entry={entry} total={total} />
        ))}
      </ul>
      <p className="mt-3 font-mono text-[11px]" style={{ color: themeStyles.textMuted }}>
        Bara arată cota din totalul de {total} incidente (axă 0–{total}).
      </p>
    </Panel>
  );
}
/** One hour of the histogram: count on top, bar, clock label underneath. */
function HourColumn({ hour, peak }) {
  const barHeight = { height: `${sharePercent(hour.events, peak)}%` };
  return <div className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
    <span className="font-mono text-[11px] font-bold text-[#B91C1C] opacity-80 group-hover:opacity-100 dark:text-[#FFEB33]">
      {hour.events}</span>
    <div className="w-full min-w-[24px] max-w-[64px] rounded-t-md bg-gradient-to-t from-[#D73833]/80 to-[#D73833] shadow transition-all group-hover:from-[#D73833] group-hover:to-[#FFEB33]" style={barHeight} aria-hidden="true" />
    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{hour.hour}</span>
  </div>;
}

function HourHistogram({ report }) {
  const { themeStyles } = useTheme();
  const peak = maxHourEvents(report.by_hour);
  const columns = report.by_hour.map((hour) => <HourColumn key={hour.hour} hour={hour} peak={peak} />);
  return (
    <Panel as="section" size="card" className="flex flex-col">
      <SectionHeading glyph={TrendingUp} label="Grafic Incidente pe Ore (by_hour)" />
      <div className="flex h-36 items-end justify-between gap-3 border-b border-slate-200 px-2 pb-1 pt-4 dark:border-white/10">{columns}</div>
      <p className="mt-3 font-mono text-[11px]" style={{ color: themeStyles.textMuted }}>
        Maxim {peak} incidente într-o oră (axă 0–{peak}); orele cu evenimente, în ordine
        cronologică (Europe/Bucharest).
      </p>
    </Panel>
  );
}
// Column labels for the zone table; the last one is right-aligned like its cells.
const ZONE_COLUMNS = [
  { key: 'zone', label: 'Zonă / Sector', ink: '' },
  { key: 'critical', label: 'Critice', ink: 'text-red-700 dark:text-[#FF8A80]' },
  { key: 'warning', label: 'Warning', ink: 'text-amber-700 dark:text-[#FFEB33]' },
  { key: 'ack', label: 'Timp mediu de confirmare', ink: 'text-right' },
];

function ZoneRow({ zone }) {
  const ack = zone.avg_ack_s == null ? '—' : `${zone.avg_ack_s}s`;
  return (
    <tr key={zone.zone}>
      <td className="py-2 font-sans font-medium">{zone.zone}</td>
      <td className="py-2 font-bold text-red-700 dark:text-[#FF8A80]">{zone.critical}</td>
      <td className="py-2 font-bold text-amber-700 dark:text-[#FFEB33]">{zone.warning}</td>
      <td className="py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">{ack}</td>
    </tr>
  );
}

function ZoneAckTable({ rows }) {
  const head = 'pb-1.5 text-[10px] font-bold uppercase tracking-wider';
  const columns = ZONE_COLUMNS.map((column) => (
    <th key={column.key} scope="col" className={`${head} ${column.ink}`}>
      {column.label}
    </th>
  ));
  const body = rows.map((zone) => <ZoneRow key={zone.zone} zone={zone} />);
  return (
    <Panel as="section" size="card">
      <SectionHeading glyph={Clock} label="Statistici de Confirmare pe Sector (by_zone)" />
      <div className="overflow-x-auto"><table className="w-full text-left text-xs font-mono">
        <caption className="sr-only">Critice, avertismente și timp mediu de confirmare pe fiecare sector</caption>
        <thead><tr className="border-b border-slate-200 opacity-80 dark:border-white/10">
          {columns}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {body}</tbody>
      </table></div>
    </Panel>
  );
}

/** A session shorter than this starts at its first sample; a longer one shows the last 30 min. */
const COVERAGE_WINDOW_MS = 30 * 60 * 1000;

/** Re-render the receipt once a second so a stopped engine's tail becomes a visible gap. */
function useClock(intervalMs) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/** Camera ids that can appear on the ribbon, in list order and without duplicates. */
function useCameraIds(cameras) {
  return useMemo(
    () =>
      (Array.isArray(cameras) ? cameras : [])
        .map((camera) => camera?.id)
        .filter((id) => typeof id === 'string' && id !== ''),
    [cameras]
  );
}

/** id → human label for the ribbon; a camera without name or code falls back to its id. */
function useCameraLabels(cameras) {
  return useMemo(() => {
    const labels = {};
    for (const camera of Array.isArray(cameras) ? cameras : []) {
      if (typeof camera?.id === 'string' && camera.id !== '') {
        labels[camera.id] = camera.name || camera.code || camera.id;
      }
    }
    // The WHEP source is synthetic and not in the store; coverage samples still carry its id.
    labels['cam-net'] = 'CAM-NET • Cameră de rețea';
    return labels;
  }, [cameras]);
}

/** The ribbon reads `at`/`eventId`; the incident list carries `detected_at`/`event_id`. */
function useIncidentTicks(events) {
  return useMemo(
    () =>
      (Array.isArray(events) ? events : [])
        .map((event) => ({
          eventId: event?.event_id,
          at: event?.detected_at,
          cameraId: event?.camera_id,
          severity: event?.severity,
        }))
        .filter((tick) => typeof tick.eventId === 'string' && tick.eventId && tick.at),
    [events]
  );
}

/**
 * Coverage receipt, mounted on Reports. It reads the session-only samples Live records
 * while the engine runs; with no samples it renders the ribbon's honest `noData` rows.
 * Nothing here is inferred from the number of incidents: a gap is only what the frame
 * samples prove.
 */
function CoverageReceipt({ samples, events, cameras, now }) {
  const { themeStyles } = useTheme();
  const cameraIds = useCameraIds(cameras);
  const cameraLabels = useCameraLabels(cameras);
  const ticks = useIncidentTicks(events);

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
      <SectionHeading glyph={Eye} label="Acoperire cameră" />
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

const ReportsView = () => {
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
  const now = useClock(1000);

  // Which shift the page is showing, and the label the report builder receives.
  const activeShiftId = USE_MOCK ? OPERATIONAL_SHIFT_ID : selectedShift;
  const shiftChoices = USE_MOCK
    ? SHIFT_SLOTS.filter((slot) => slot.id === OPERATIONAL_SHIFT_ID)
    : SHIFT_SLOTS;
  const activeSlot = SHIFT_SLOTS.find((slot) => slot.id === activeShiftId) || SHIFT_SLOTS[0];

  // The report is composed from the incidents the operator sees in the list, so an
  // acknowledgement or a browser-engine event changes the numbers immediately.
  const report = useMemo(
    () =>
      buildShiftReport(events, {
        now: Date.now(),
        shiftLabel: activeSlot.label,
        operationalDate: USE_MOCK ? OPERATIONAL_DATE : selectedDate,
      }),
    [events, activeSlot, selectedDate]
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

  return <div className="h-full overflow-y-auto select-none"><div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
        <ReportMasthead
          report={report}
          hasEvents={hasEvents}
          onCsv={downloadCsv}
          onPdf={() => printAsPdf(reportFileBase(report))}
        />
        <ShiftAndDate
          shiftValue={activeShiftId}
          shiftOptions={shiftChoices}
          report={report}
          onShiftChange={setSelectedShift}
          showDemoData={showDemoData}
        />
        {!hasEvents && <EmptyShiftReport mock={USE_MOCK} showDemoData={showDemoData} />}
        <MetricGrid kpi={report.kpi} />
        <ComplianceStrip report={report} />
        <CoverageReceipt
          samples={coverageSamples}
          events={events}
          cameras={cameras}
          now={now}
        />
        <ExecutiveSummary report={report} />
        {hasEvents && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TypeBreakdown report={report} />
              <HourHistogram report={report} /></div>
            <ZoneAckTable rows={report.by_zone} />
          </>
        )}
      </div></div>;
};

export default ReportsView;
