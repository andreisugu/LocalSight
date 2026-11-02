import test from 'node:test';
import assert from 'node:assert/strict';
import { templateReport } from './report.js';

const EVENT = {
  type: 'RESTRICTED_ZONE',
  duration_s: 2.635,
  detected_at: '2026-11-02T15:04:05.000Z',
  camera_id: 'stand12',
  zone_id: 'engine-left',
};

test('writes a complete report from the event fields', () => {
  const report = templateReport(EVENT, { cameraName: 'CAM-01 • stand12', zoneName: 'Motor stâng' });
  assert.equal(report.source, 'template');
  assert.equal(report.what, 'Persoană în zona restricționată Motor stâng.');
  assert.equal(report.where, 'CAM-01 • stand12 • Motor stâng');
  assert.match(report.when, /2\.63 s în zonă/);
  assert.match(report.severity_reason, /Prezență continuă 2\.63 s/);
  assert.match(report.recommended_action, /Verifică zona/);
});

test('never claims an AI wrote it', () => {
  assert.equal(templateReport(EVENT).source, 'template');
});

test('NO_PPE copy names the missing vest and the duration', () => {
  const report = templateReport({ ...EVENT, type: 'NO_PPE' }, { zoneName: 'Zona bagaje' });
  assert.match(report.what, /fără vestă hi-vis în Zona bagaje/);
  assert.match(report.severity_reason, /2\.63 s/);
  assert.match(report.recommended_action, /echipamentului/);
});

test('falls back to the ids when the UI has no name for them', () => {
  const report = templateReport(EVENT);
  assert.match(report.what, /engine-left/);
  assert.match(report.where, /^stand12 • engine-left$/);
});

test('unknown rule types still produce an honest report', () => {
  const report = templateReport({ ...EVENT, type: 'SOMETHING_NEW' }, { zoneName: 'Zona X' });
  assert.match(report.what, /Eveniment de siguranță în Zona X/);
  assert.match(report.severity_reason, /2\.63 s/);
});

test('a missing duration is printed as an em dash, not NaN', () => {
  const report = templateReport({ ...EVENT, duration_s: undefined });
  assert.match(report.when, /—/);
  assert.doesNotMatch(report.when, /NaN/);
  assert.doesNotMatch(report.severity_reason, /NaN/);
});

test('an invalid event returns null instead of a fake report', () => {
  assert.equal(templateReport(null), null);
  assert.equal(templateReport('nope'), null);
});

test('the time is formatted in Romanian 24h style', () => {
  const report = templateReport(EVENT);
  assert.match(report.when, /^\d{2}:\d{2}:\d{2};/);
});
