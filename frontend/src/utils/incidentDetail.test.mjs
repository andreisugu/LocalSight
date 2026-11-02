import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionState,
  buildTimeline,
  copyIncidentLink,
  detectionSummary,
  incidentTitle,
  reportFields,
  reportSourceLabel,
  reportSourceNote,
  severityToken,
  shouldOfferReportRetry,
  snapshotAlt,
  snapshotCaption,
  snapshotDownload,
  sourceChips,
  statusToken,
} from './incidentDetail.js';

const event = {
  event_id: 'evt_stand12_1_14',
  status: 'acknowledged',
  severity: 'CRITICAL',
  model: 'person-ppe-v1',
  track_id: 14,
  snapshot_url: 'blob:http://localhost/abc',
  detected_at: '2026-11-02T10:00:00Z',
  received_at: '2026-11-02T10:00:00.200Z',
  notified_at: '2026-11-02T10:00:01Z',
  escalated_at: null,
  acked_at: '2026-11-02T10:01:00Z',
  report: { source: 'llm', what: 'Persoană în zona motorului' },
};

test('the timeline has five ordered steps with formatted times', () => {
  const steps = buildTimeline(event);
  assert.deepEqual(steps.map((step) => step.label), [
    'Detecție',
    'Primit',
    'Notificat',
    'Escaladat',
    'Confirmat',
  ]);
  assert.deepEqual(steps.map((step) => step.position), [1, 2, 3, 4, 5]);
  assert.equal(steps[0].time, '12:00:00');
  assert.equal(steps[1].time, '12:00:00');
  assert.equal(steps[2].time, '12:00:01');
  assert.equal(steps[3].time, 'În așteptare');
  assert.equal(steps[4].time, '12:01:00');
});

test('a timeline tone only applies after the step happened', () => {
  const steps = buildTimeline(event);
  assert.equal(steps[3].reached, false);
  assert.equal(steps[3].tone, 'neutral');
  assert.equal(steps[4].reached, true);
  assert.equal(steps[4].tone, 'ok');

  const escalated = buildTimeline({ escalated_at: '2026-11-02T10:02:00Z' });
  assert.equal(escalated[3].tone, 'alert');
  assert.equal(escalated[3].reached, true);
});

test('the timeline survives a missing event', () => {
  const steps = buildTimeline(null);
  assert.equal(steps.length, 5);
  assert.ok(steps.every((step) => step.time === 'În așteptare'));
});

test('the action matrix follows the status, not the button', () => {
  assert.deepEqual(actionState({ status: 'open' }), {
    ack: true,
    falsePositive: true,
    reopen: false,
    acked: false,
    markedFalsePositive: false,
  });
  assert.deepEqual(actionState({ status: 'escalated' }), {
    ack: true,
    falsePositive: true,
    reopen: true,
    acked: false,
    markedFalsePositive: false,
  });
  assert.deepEqual(actionState({ status: 'acknowledged' }), {
    ack: false,
    falsePositive: true,
    reopen: true,
    acked: true,
    markedFalsePositive: false,
  });
  assert.deepEqual(actionState({ status: 'false_positive' }), {
    ack: false,
    falsePositive: false,
    reopen: true,
    acked: false,
    markedFalsePositive: true,
  });
  assert.deepEqual(actionState({ status: 'resolved' }), {
    ack: false,
    falsePositive: false,
    reopen: true,
    acked: false,
    markedFalsePositive: false,
  });
});

test('an unknown or missing status enables nothing', () => {
  for (const status of ['verifying', undefined, null]) {
    const state = actionState({ status });
    assert.equal(state.ack, false);
    assert.equal(state.falsePositive, false);
    assert.equal(state.reopen, false);
  }
});

test('status and severity labels come from the tokens', () => {
  assert.equal(statusToken('acknowledged').label, 'Confirmat');
  assert.equal(statusToken('open').label, 'Deschis');
  assert.equal(statusToken('false_positive').label, 'Fals Pozitiv');
  assert.equal(severityToken('CRITICAL').label, 'CRITICAL');
  assert.equal(severityToken('WARNING').label, 'WARNING');
});

test('an unknown status keeps its raw value and a neutral style', () => {
  const token = statusToken('verifying');
  assert.equal(token.label, 'verifying');
  assert.equal(token.bg, '#EEEEEE');
  assert.equal(statusToken(null).label, 'Necunoscut');
});

test('report source is AI only when an AI actually wrote it', () => {
  assert.equal(reportSourceLabel({ source: 'llm' }), 'AI');
  assert.equal(reportSourceLabel({ source: 'llm' }, { mock: true }), 'AI · demo');
  assert.equal(reportSourceLabel({ source: 'template' }), 'șablon');
  assert.equal(reportSourceLabel(null), 'șablon');
  assert.equal(reportSourceLabel({}, { mock: true }), 'șablon');
});

test('the retry button is hidden in the static build and for AI reports', () => {
  assert.equal(shouldOfferReportRetry({ report: { source: 'template' } }), true);
  assert.equal(shouldOfferReportRetry({ report: null }), true);
  assert.equal(shouldOfferReportRetry({}), true);
  assert.equal(shouldOfferReportRetry({ report: { source: 'llm' } }), false);
  assert.equal(shouldOfferReportRetry({ report: { source: 'template' } }, { mock: true }), false);
});

test('copying the deep link reports success and every failure', async () => {
  const written = [];
  const ok = await copyIncidentLink('https://example.test/incidents/evt_1', async (text) => {
    written.push(text);
  });
  assert.equal(ok, true);
  assert.deepEqual(written, ['https://example.test/incidents/evt_1']);

  assert.equal(
    await copyIncidentLink('https://example.test', async () => {
      throw new Error('permission denied');
    }),
    false
  );
  // No Clipboard API at all: the getter itself throws before a promise exists.
  assert.equal(
    await copyIncidentLink('https://example.test', () => {
      throw new Error('clipboard is undefined');
    }),
    false
  );
});

test('a blob snapshot downloads, the pending marker does not', () => {
  const real = snapshotDownload(event);
  assert.equal(real.downloadable, true);
  assert.equal(real.fileName, 'evt_stand12_1_14.jpg');
  assert.equal(real.url, event.snapshot_url);

  assert.equal(snapshotDownload({ snapshot_url: 'blob:pending' }).downloadable, false);
  assert.equal(snapshotDownload({ snapshot_url: '' }).downloadable, false);
  assert.equal(snapshotDownload({}).downloadable, false);
  assert.equal(snapshotDownload({}).fileName, 'incident.jpg');
  assert.equal(snapshotDownload({ snapshot_url: '/media/stills/stand12.jpg' }).downloadable, true);
});

test('local and demo chips are exclusive', () => {
  assert.deepEqual(sourceChips({ local: true }, { mock: true }), { local: true, demo: false });
  assert.deepEqual(sourceChips({}, { mock: true }), { local: false, demo: true });
  assert.deepEqual(sourceChips({}, { mock: false }), { local: false, demo: false });
});

test('the five report fields keep their labels and fall back honestly', () => {
  const fields = reportFields({
    what: 'Persoană în zona motorului',
    where: 'Stand 12',
    when: '12:00:00',
    severity_reason: 'Motor pornit',
    recommended_action: 'Oprește APU-ul',
  });
  assert.deepEqual(fields.map((field) => field.label), [
    'CE:',
    'UNDE:',
    'CÂND:',
    'SEVERITATE & RISC:',
    'ACȚIUNE RECOMANDATĂ:',
  ]);
  assert.deepEqual(fields.map((field) => field.value), [
    'Persoană în zona motorului',
    'Stand 12',
    '12:00:00',
    'Motor pornit',
    'Oprește APU-ul',
  ]);
});

test('a missing report field is shown as unknown, not invented', () => {
  const fields = reportFields(null);
  assert.ok(fields.every((field) => field.value === 'necunoscut'));
  assert.equal(reportFields({ what: '' })[0].value, 'necunoscut');
});

test('the detection summary keeps model and track, with an honest fallback', () => {
  assert.equal(detectionSummary(event), 'Model detecție: person-ppe-v1 • Track ID: #14');
  assert.equal(detectionSummary({}), 'Model detecție: — • Track ID: #—');
});

test('the detail title is the human incident type, never the synthetic id', () => {
  assert.equal(incidentTitle({ type: 'RESTRICTED_ZONE', event_id: 'evt_1' }), 'Zonă restricționată');
  assert.equal(incidentTitle({ type: 'PPE_VIOLATION' }), 'Echipament lipsă');
  assert.equal(incidentTitle({ type: 'NEW_RULE' }), 'NEW_RULE');
  assert.equal(incidentTitle(null), 'Incident');
});

test('the report note never claims a model ran in the browser', () => {
  const demo = reportSourceNote({ source: 'llm' }, { mock: true });
  assert.match(demo, /în avans pentru demo/);
  assert.match(demo, /nu a fost generat acum/);
  assert.match(reportSourceNote({ source: 'template' }, { mock: true }), /șablon/);
  assert.match(reportSourceNote({ source: 'template' }), /șablon/);
  assert.match(reportSourceNote({ source: 'llm' }), /model AI la ingest/);
});

test('the evidence frame has a text alternative with camera, zone and blur', () => {
  assert.equal(
    snapshotAlt({ camera_id: 'stand12', zone_id: 'engine-left' }),
    'Cadru din momentul incidentului: camera stand12, zona engine-left; fețele sunt blurate.'
  );
  assert.match(snapshotAlt({}), /camera necunoscută/);
});

test('the snapshot caption differs only for a local detection', () => {
  assert.equal(snapshotCaption({ local: true }), 'Momentul incidentului • fețe blurate în browser');
  assert.equal(snapshotCaption({}), 'Momentul incidentului • fețe blurate');
});

test('the evidence caption reflects the safety blur setting', () => {
  const event = { local: true };
  assert.match(snapshotCaption(event), /fețe blurate în browser/);
  assert.match(snapshotCaption(event, { safetyBlur: false }), /blur de siguranță oprit/);
  assert.equal(snapshotCaption({ local: false }, { safetyBlur: false }), 'Momentul incidentului • fețe blurate');
  assert.match(snapshotAlt(event, { safetyBlur: false }), /blurul de siguranță pe cap este oprit/);
});
