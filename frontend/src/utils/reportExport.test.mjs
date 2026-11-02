import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_SOURCE,
  buildReportCsv,
  describeAckSeconds,
  formatReportDate,
  incidentsForExport,
  maxHourEvents,
  reportCsvRows,
  reportFileBase,
  sharePercent,
} from './reportExport.js';
import { buildShiftReport } from '../constants/shiftReport.js';

const SHIFT = 'Tura 2 (Prânz: 14:00 - 22:00)';

const event = (overrides = {}) => ({
  event_id: 'evt_stand12_1793356933120_17',
  type: 'RESTRICTED_ZONE',
  severity: 'CRITICAL',
  status: 'open',
  camera_id: 'stand12',
  zone_id: 'engine-left',
  detected_at: '2026-11-02T16:00:00.000Z',
  acked_at: null,
  report: null,
  ...overrides,
});

const report = (events) =>
  buildShiftReport(events, {
    now: new Date('2026-11-02T14:30:00.000Z'),
    shiftLabel: SHIFT,
    operationalDate: '2026-11-02',
  });

test('an ISO contract date renders as one Romanian format', () => {
  assert.equal(formatReportDate('2026-11-02'), '02.11.2026');
});

test('a missing or malformed date renders as a dash, never a guess', () => {
  assert.equal(formatReportDate(null), '—');
  assert.equal(formatReportDate(''), '—');
  assert.equal(formatReportDate('2026-11'), '—');
  assert.equal(formatReportDate('02.11.2026'), '—');
});

test('the average acknowledgement time is shown in seconds', () => {
  assert.equal(describeAckSeconds(43), '43 sec');
  assert.equal(describeAckSeconds(42.6), '43 sec');
});

test('no acknowledgement shows a dash instead of zero seconds', () => {
  assert.equal(describeAckSeconds(null), '—');
  assert.equal(describeAckSeconds(undefined), '—');
  assert.equal(describeAckSeconds(Number.NaN), '—');
});

test('the hour chart scales to its tallest bucket, with 1 as the floor', () => {
  assert.equal(maxHourEvents([]), 1);
  assert.equal(maxHourEvents(undefined), 1);
  assert.equal(maxHourEvents([{ hour: '15:00', events: 2 }, { hour: '16:00', events: 5 }]), 5);
});

test('a type bar is its share of the total and never exceeds the track', () => {
  assert.equal(sharePercent(4, 8), 50);
  assert.equal(sharePercent(8, 8), 100);
  assert.equal(sharePercent(0, 8), 0);
  assert.equal(sharePercent(4, 0), 0);
  assert.equal(sharePercent(4, Number.NaN), 0);
});

test('the export file name keeps the report date and shift, nothing else', () => {
  assert.equal(
    reportFileBase({ date: '2026-11-02', shift: SHIFT }),
    'LocalSight_raport_2026-11-02_Tura_2_Pr_nz_14_00_-_22_00_'
  );
  assert.equal(reportFileBase({}), 'LocalSight_raport__');
});

test('the export lists incidents only, newest detection first', () => {
  const rows = incidentsForExport([
    event({ event_id: 'old', detected_at: '2026-11-02T15:00:00.000Z' }),
    null,
    'not an event',
    event({ event_id: 'new', detected_at: '2026-11-02T17:00:00.000Z' }),
  ]);
  assert.deepEqual(rows.map((row) => row.event_id), ['new', 'old']);
});

test('the CSV starts with the report header and its KPI block', () => {
  const csv = buildReportCsv(report([event({ status: 'open' })]), [event({ status: 'open' })]);
  const header = csv.split('\n').slice(0, 15);

  assert.deepEqual(header.slice(0, 3), ['"Tură","Tura 2 (Prânz: 14:00 - 22:00)"', '"Dată","2026-11-02"', '"Sursă","șablon"']);
  assert.equal(REPORT_SOURCE, 'șablon');
  assert.equal(header[3], '"Total evenimente","1"');
  assert.equal(header[12], '"Timp mediu confirmare (s)","—"');
  assert.equal(header[14], '');
});

test('the CSV sections list every type, zone, hour and incident that the report counted', () => {
  const events = [
    event({ event_id: 'a', type: 'RESTRICTED_ZONE', detected_at: '2026-11-02T15:10:00.000Z' }),
    event({
      event_id: 'b',
      type: 'NO_PPE',
      severity: 'WARNING',
      status: 'acknowledged',
      zone_id: 'apron',
      detected_at: '2026-11-02T16:20:00.000Z',
      acked_at: '2026-11-02T16:20:30.000Z',
      report: { source: 'șablon' },
    }),
  ];
  const shiftReport = report(events);
  const rows = reportCsvRows(shiftReport, events);

  assert.deepEqual(rows[15], ['Tip', 'Critice', 'Avertizări', 'Total']);
  assert.deepEqual(rows[16], ['Zonă restricționată', 1, 0, 1]);
  assert.deepEqual(rows[17], ['Echipament lipsă', 0, 1, 1]);

  const zoneHeader = rows.findIndex((row) => row[0] === 'Zonă');
  const zoneRows = rows.slice(zoneHeader + 1, zoneHeader + 3);
  assert.deepEqual(zoneRows, [
    ['apron', 0, 1, 30],
    ['engine-left', 1, 0, '—'],
  ]);

  // 15:10Z and 16:20Z are 17:10 and 18:20 in Bucharest, so the hours are 17:00 and 18:00.
  const hourHeader = rows.findIndex((row) => row[0] === 'Oră');
  assert.deepEqual(rows.slice(hourHeader + 1, hourHeader + 3), [
    ['17:00', 1],
    ['18:00', 1],
  ]);

  const incidentHeader = rows.findIndex((row) => row[0] === 'ID');
  assert.deepEqual(rows[incidentHeader + 1], [
    'b', 'NO_PPE', 'WARNING', 'acknowledged', 'apron', 'stand12',
    '2026-11-02T16:20:00.000Z', '2026-11-02T16:20:30.000Z', 'șablon',
  ]);
  assert.equal(rows.at(-1)[8], '—');
});

test('every CSV cell is quoted and inner quotes are doubled', () => {
  const csv = buildReportCsv(report([]), [
    event({ zone_id: 'zona "A", stand 12' }),
  ]);
  const incidentLine = csv.split('\n').find((line) => line.includes('zona ""A""'));
  assert.ok(incidentLine, 'the zone name must survive with its comma inside one cell');
  assert.equal(incidentLine.split('","').length, 9);
});

test('an empty report still exports the header with zero counts', () => {
  const rows = reportCsvRows(report([]), []);
  assert.equal(rows[3][1], 0);
  assert.equal(rows[12][1], '—');
  assert.deepEqual(rows.at(-1), [
    'ID', 'Tip', 'Severitate', 'Status', 'Zonă', 'Cameră', 'Detectat la', 'Confirmat la', 'Sursă raport',
  ]);
});
