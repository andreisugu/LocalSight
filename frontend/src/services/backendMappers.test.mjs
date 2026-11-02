import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCamera,
  mapEvent,
  mapKpi,
  mapShiftReport,
  mapZone,
  toZonePayload,
} from './backendMappers.js';

const BASE = 'http://localhost:8000';

test('KPI rows become the four tiles, with a dash for an unknown value', () => {
  assert.deepEqual(
    mapKpi({
      ppe_compliance: 0.938,
      open_incidents: 4,
      avg_detection_to_alert_s: 1.3,
      escalated: 2,
    }),
    {
      ppe_compliance_pct: 93.8,
      open_incidents_count: 4,
      detection_to_alert_latency_s: 1.3,
      escalated_incidents_count: 2,
    }
  );

  assert.deepEqual(
    mapKpi({ ppe_compliance: null, open_incidents: 0, avg_detection_to_alert_s: null, escalated: 0 }),
    {
      ppe_compliance_pct: '—',
      open_incidents_count: 0,
      detection_to_alert_latency_s: '—',
      escalated_incidents_count: 0,
    }
  );
});

test('the shift report is reshaped without losing the backend numbers', () => {
  const report = mapShiftReport({
    shift: 'night',
    date: '2026-11-01',
    by_type: [
      { type: 'RESTRICTED_ZONE', critical: 2, warning: 1, false_positive: 1 },
      { type: 'NO_PPE', critical: 1, warning: 0 },
    ],
    avg_ack_s: null,
    kpi: { ppe_compliance: 0.9 },
    summary: 'sumar',
    by_zone: [
      { zone_id: 'engine-left', critical: 2, warning: 1, avg_ack_s: 12 },
      { zone_id: 'taxiway-b', critical: 1, warning: 0 },
    ],
    by_hour: [{ hour: '08', count: 3 }],
    coverage: { coverage: 0.99, offline_minutes: 1 },
    total_events: 9,
    false_positives: 1,
  });

  assert.equal(report.shift, 'Tura 3 (Noapte: 22:00 - 06:00)');
  assert.equal(report.date, '2026-11-01');
  assert.deepEqual(report.kpi, {
    total_events: 4,
    critical_events: 3,
    warning_events: 1,
    avg_ack_time_s: '—',
    ppe_compliance_pct: 90,
  });
  assert.equal(report.by_type[0].label, 'Zonă restricționată');
  assert.equal(report.by_type[0].count, 3);
  assert.equal(report.by_type[1].label, 'Echipament lipsă');
  assert.deepEqual(report.by_zone, [
    { zone: 'engine-left', critical: 2, warning: 1, false_positive: 0, avg_ack_s: 12 },
    { zone: 'taxiway-b', critical: 1, warning: 0, false_positive: 0, avg_ack_s: '—' },
  ]);
  assert.deepEqual(report.by_hour, [{ hour: '08:00', events: 3 }]);
  assert.equal(report.summary, 'sumar');
  assert.deepEqual(report.coverage, { coverage: 0.99, offline_minutes: 1 });
  assert.equal(report.total_events, 9);
  assert.equal(report.false_positives, 1);
});

test('a report without totals derives them and reports no false positives', () => {
  const report = mapShiftReport({ shift: 'morning', by_type: [{ type: 'SMOKING', critical: 1 }] });
  assert.equal(report.total_events, 1);
  assert.equal(report.false_positives, 0);
  assert.equal(report.coverage, null);
  assert.equal(report.kpi.ppe_compliance_pct, '—');
});

test('a zone payload clamps the polygon and normalises the switches', () => {
  const payload = toZonePayload('my-zone', {
    camera_id: 'stand12',
    name: '',
    zone_id: 'my-zone',
    rule_type: 'RESTRICTED',
    active_when: 'ENGINE_ON',
    required_ppe: ['hi_vis_vest'],
    severity: 'CRITICAL',
    debounce_s: '2.5',
    escalate_after_s: '30.6',
    reference_frame: '/snapshots/frame.jpg',
    polygon: [{ x: -0.2, y: 0.5 }, { x: 1.4, y: '0.3' }, [0.2, 0.2]],
  });

  assert.deepEqual(payload, {
    id: 'my-zone',
    camera_id: 'stand12',
    name: 'my-zone',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    required_ppe: ['hi_vis_vest'],
    severity: 'CRITICAL',
    debounce_s: 2.5,
    escalate_after_s: 31,
    notify_channel: 'slack',
    polygon: [[0, 0.5], [1, 0.3], [0.2, 0.2]],
    reference_frame: '/snapshots/frame.jpg',
  });
});

test('a zone payload drops an invalid escalation and defaults the rest', () => {
  const payload = toZonePayload('z', { escalate_after_s: 0, polygon: [] });
  assert.equal(payload.escalate_after_s, null);
  assert.equal(payload.name, 'z');
  assert.equal(payload.active_when, 'always');
  assert.equal(payload.debounce_s, 0);
  assert.deepEqual(payload.required_ppe, []);
  assert.deepEqual(payload.polygon, []);
  assert.equal(payload.reference_frame, null);
});

test('zone rows get object points and an absolute reference frame', () => {
  const zone = mapZone({
    id: 'z1',
    polygon: [[0.1, 0.2], { x: 0.3, y: 0.4 }],
    reference_frame: '/snapshots/frame.jpg',
  });

  assert.equal(zone.zone_id, 'z1');
  assert.deepEqual(zone.polygon, [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]);
  assert.equal(zone.reference_frame_url, `${BASE}/snapshots/frame.jpg`);

  assert.equal(
    mapZone({ id: 'z2', reference_frame: 'https://cdn.local/frame.jpg' }).reference_frame_url,
    'https://cdn.local/frame.jpg'
  );
  assert.deepEqual(mapZone({ id: 'z3' }).polygon, []);
  assert.equal(mapZone({ id: 'z3' }).reference_frame_url, null);
});

test('event snapshots become absolute URLs, other URLs are left alone', () => {
  assert.equal(mapEvent({ snapshot_url: '/snapshots/a.jpg' }).snapshot_url, `${BASE}/snapshots/a.jpg`);
  assert.equal(
    mapEvent({ snapshot_url: 'https://cdn.local/a.jpg' }).snapshot_url,
    'https://cdn.local/a.jpg'
  );
  assert.equal(mapEvent({ snapshot_url: 'blob:pending' }).snapshot_url, 'blob:pending');
  assert.equal(mapEvent({ snapshot_url: 'data:image/png;base64,AA' }).snapshot_url, 'data:image/png;base64,AA');
  assert.equal(mapEvent({ snapshot_url: '' }).snapshot_url, '');
});

test('camera rows carry the Live presentation fields', () => {
  const online = mapCamera({ id: 'stand12', name: 'Stand 12', online: true, engine_on: 1 }, 0);
  assert.equal(online.code, 'CAM-01');
  assert.equal(online.name, 'Stand 12');
  assert.equal(online.subtitle, 'Alimentare & Întreținere (Zonă Motor Apron)');
  assert.equal(online.zone_id, 'engine-left');
  assert.equal(online.status, 'online');
  assert.equal(online.engine_on, true);
  assert.equal(online.fps, 30);
  assert.equal(online.resolution, 'LIVE MJPEG');
  assert.equal(online.stream_url, `${BASE}/stream/stand12.mjpg`);
  assert.deepEqual(online.boxes, []);

  const offline = mapCamera({ id: 'taxiway-b', online: false, engine_on: false }, 1);
  assert.equal(offline.status, 'offline');
  assert.equal(offline.fps, 0);
  assert.equal(offline.resolution, 'SEMNAL PIERDUT');

  const unknown = mapCamera({ id: 'new-camera', online: true }, 1);
  assert.equal(unknown.code, 'CAM-02');
  assert.equal(unknown.name, 'CAM-new-camera');
  assert.equal(unknown.zone_id, 'new-camera');
  assert.equal(unknown.subtitle, 'Flux Video Monitorizat');
  assert.equal(unknown.previewBg, 'from-zinc-900 to-neutral-800');
});
