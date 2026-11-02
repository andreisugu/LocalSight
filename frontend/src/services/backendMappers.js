// Backend payloads → the shapes the screens render.
//
// This is the boundary between the API contract and the UI: field names, snapshot URLs,
// polygons and shift labels are normalised here once, so no component has to know that
// the API says `reference_frame` while the editor says `reference_frame_url`.

import { TYPE_LABELS } from '../data/labels.js';
import { shiftLabelForApi } from '../data/shift.js';
import { API_BASE_URL, WEBCAM_CAMERA_ID } from './config.js';
import { resolveAsset } from './http.js';

const PALETTES = [
  'from-[#1F1F1F] via-[#282828] to-[#181818]',
  'from-zinc-900 to-neutral-800',
  'from-[#1F1F1F] to-[#282828]',
  'from-[#222222] to-[#181818]',
];

const CAMERA_METADATA = {
  stand12: {
    code: 'CAM-01',
    name: 'CAM-01 • Stand 12 Avion B777',
    subtitle: 'Alimentare & Întreținere (Zonă Motor Apron)',
    category: 'Alimentare & Rampă',
    zone_id: 'engine-left',
  },
  'taxiway-b': {
    code: 'CAM-02',
    name: 'CAM-02 • Taxiway B Cale Rulare',
    subtitle: 'Cale de Rulare & Axa Intersecție Pistă',
    category: 'Pistă & Căi Rulare',
    zone_id: 'taxiway-b',
  },
  'baggage-area': {
    code: 'CAM-03',
    name: 'CAM-03 • Triere & Încărcare Bagaje',
    subtitle: 'Rampa Sud & Bandă Conveior Cală',
    category: 'Terminal & Porți',
    zone_id: 'baggage-area',
  },
};

// `dev.py demo --webcam` runs the laptop camera on a seeded camera id; only the label
// changes, the contract keeps the same fields.
const WEBCAM_METADATA = {
  code: 'WEBCAM',
  name: 'WEBCAM • Camera laptopului',
  subtitle: 'Verificare vestă în timp real (experimental)',
  category: 'Webcam',
};

/** Camera row from `GET /cameras`, with the presentation fields Live expects. */
export function mapCamera(camera, index = 0) {
  const isWebcam = WEBCAM_CAMERA_ID && camera.id === WEBCAM_CAMERA_ID;
  const meta = isWebcam
    ? { ...CAMERA_METADATA[camera.id], ...WEBCAM_METADATA }
    : CAMERA_METADATA[camera.id] || {};

  return {
    ...camera,
    code: meta.code || `CAM-0${index + 1}`,
    name: (isWebcam && meta.name) || camera.name || meta.name || `CAM-${camera.id}`,
    subtitle: meta.subtitle || (camera.name ? `Zonă ${camera.name}` : 'Flux Video Monitorizat'),
    category: meta.category || 'Alimentare & Rampă',
    zone_id: meta.zone_id || camera.id,
    status: camera.online ? 'online' : 'offline',
    engine_on: Boolean(camera.engine_on),
    zone: '',
    fps: camera.online ? 30 : 0,
    resolution: camera.online ? 'LIVE MJPEG' : 'SEMNAL PIERDUT',
    previewBg: PALETTES[index % PALETTES.length],
    boxes: [],
    stream_url: `${API_BASE_URL}/stream/${encodeURIComponent(camera.id)}.mjpg`,
  };
}

/** Snapshot URLs are relative to the API; `<img>` needs an absolute one. */
export function mapEvent(event) {
  return { ...event, snapshot_url: resolveAsset(event.snapshot_url) };
}

/** Zone row from the API: polygon points become objects and the frame gets a full URL. */
export function mapZone(zone) {
  const reference = zone.reference_frame;
  return {
    ...zone,
    zone_id: zone.id,
    polygon: (zone.polygon || []).map((point) =>
      Array.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y }
    ),
    // The edge uploads the (blurred) frame the zone is drawn on; the editor uses it as
    // the background of the canvas.
    reference_frame_url: reference
      ? resolveAsset(reference)
      : null,
  };
}

/** Zone editor draft → `PUT /zones/{id}` body, clamped to the contract's ranges. */
export function toZonePayload(zoneId, zoneData) {
  const rawEscalation = zoneData.escalate_after_s;
  const hasEscalation = rawEscalation != null && rawEscalation !== '' && Number(rawEscalation) >= 1;

  const clampUnit = (value) => Math.max(0, Math.min(1, Number(value)));

  return {
    id: zoneId,
    camera_id: zoneData.camera_id,
    name: zoneData.name || zoneData.zone_id || zoneId,
    rule_type: zoneData.rule_type,
    active_when: String(zoneData.active_when || 'always').toLowerCase() === 'engine_on'
      ? 'engine_on'
      : 'always',
    required_ppe: zoneData.required_ppe || [],
    severity: zoneData.severity,
    debounce_s: Number(zoneData.debounce_s) || 0,
    escalate_after_s: hasEscalation ? Math.round(Number(rawEscalation)) : null,
    notify_channel: 'slack',
    polygon: (zoneData.polygon || []).map((point) => [
      clampUnit(point.x != null ? point.x : Array.isArray(point) ? point[0] : 0),
      clampUnit(point.y != null ? point.y : Array.isArray(point) ? point[1] : 0),
    ]),
    reference_frame: zoneData.reference_frame || null,
  };
}

/** `GET /kpi` → the four tiles of the Live strip. */
export function mapKpi(kpi) {
  return {
    ppe_compliance_pct:
      kpi.ppe_compliance == null ? '—' : Math.round(kpi.ppe_compliance * 1000) / 10,
    open_incidents_count: kpi.open_incidents,
    detection_to_alert_latency_s:
      kpi.avg_detection_to_alert_s == null ? '—' : kpi.avg_detection_to_alert_s,
    escalated_incidents_count: kpi.escalated,
  };
}

/** `GET /reports` → the shift report screen. */
export function mapShiftReport(report) {
  const byType = (report.by_type || []).map((row) => ({
    type: row.type,
    label: TYPE_LABELS[row.type] || row.type,
    count: (row.critical || 0) + (row.warning || 0),
    critical: row.critical || 0,
    warning: row.warning || 0,
    false_positive: row.false_positive || 0,
  }));
  const total = byType.reduce((sum, row) => sum + row.count, 0);
  const critical = (report.by_type || []).reduce((sum, row) => sum + (row.critical || 0), 0);
  const warning = (report.by_type || []).reduce((sum, row) => sum + (row.warning || 0), 0);
  // The global average comes from the backend, over every confirmed incident of the shift.
  const avgAck = report.avg_ack_s;

  return {
    shift: shiftLabelForApi(report.shift),
    date: report.date,
    kpi: {
      total_events: total,
      critical_events: critical,
      warning_events: warning,
      avg_ack_time_s: avgAck == null ? '—' : avgAck,
      ppe_compliance_pct:
        report.kpi?.ppe_compliance == null
          ? '—'
          : Math.round(report.kpi.ppe_compliance * 1000) / 10,
    },
    summary: report.summary,
    by_type: byType,
    by_zone: (report.by_zone || []).map((zone) => ({
      zone: zone.zone_id,
      critical: zone.critical,
      warning: zone.warning,
      false_positive: zone.false_positive || 0,
      avg_ack_s: zone.avg_ack_s == null ? '—' : zone.avg_ack_s,
    })),
    by_hour: (report.by_hour || []).map((row) => ({
      hour: `${row.hour}:00`,
      events: row.count,
    })),
    // Minutes of the shift with blind cameras; `null` while the backend does not know.
    coverage: report.coverage || null,
    total_events: report.total_events ?? total,
    false_positives: report.false_positives ?? 0,
  };
}
