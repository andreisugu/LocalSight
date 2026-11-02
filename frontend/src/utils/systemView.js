// Pure logic for the "Sistem & Audit" screen. The page has no business logic of its
// own: it describes the build it is running in (static or backend-connected), the camera
// sources it actually has, and flattens incidents into a read-only audit trail. Keeping
// those transformations here means the component only renders and the rules are testable
// without a browser.

import { formatDateTime } from './time.js';
import { DEFAULT_DETECTOR, detectorLabel } from '../engine/detectorFlag.js';

export const AUDIT_LIMIT = 60;

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A demo clip carries an RTSP URL; the browser camera does not. */
function cameraKind(camera) {
  return camera?.rtsp_url ? 'clip' : 'local';
}

export function countCameraSources(cameras = []) {
  const clips = cameras.filter((camera) => cameraKind(camera) === 'clip').length;
  return { total: cameras.length, clips, local: cameras.length - clips };
}

/**
 * Source counts plus the sentence the summary cell shows. The wording depends on the
 * build: a fixture RTSP URL is a "clip demo" in the static build and a network feed when
 * a backend actually serves it.
 */
export function sourceSummary(cameras = [], { isMock = false } = {}) {
  const counts = countCameraSources(cameras);
  const parts = [];
  if (counts.clips > 0) {
    parts.push(isMock ? plural(counts.clips, 'clip demo', 'clipuri demo') : plural(counts.clips, 'flux de rețea', 'fluxuri de rețea'));
  }
  if (counts.local > 0) {
    parts.push(plural(counts.local, 'cameră locală', 'camere locale'));
  }
  const sources = parts.length > 0 ? parts.join(' + ') : 'nicio sursă configurată';
  return {
    ...counts,
    value: plural(counts.total, 'sursă', 'surse'),
    detail: isMock ? `${sources}; date demo` : sources,
  };
}

/**
 * The four summary cells. In the static build they describe what actually runs in the
 * tab; only the backend branch may talk about a backend or an edge box.
 */
export function buildSystemTiles({
  isMock = false,
  health,
  cameras = [],
  zones = [],
  latestModel,
  detector = DEFAULT_DETECTOR,
} = {}) {
  const sources = sourceSummary(cameras, { isMock });

  if (isMock) {
    return [
      { id: 'build', label: 'Build', value: 'STATIC', detail: 'fără backend, fără edge; totul rulează în tab', tone: 'neutral' },
      { id: 'engine', label: 'Motor browser', value: 'OPȚIONAL', detail: 'pornit din Live; WASM pe Firefox, WebGPU pe Chrome compatibil', tone: 'neutral' },
      { id: 'model', label: 'Model detecție', value: `${detectorLabel(detector)} + YuNet`, detail: 'ONNX servit din aplicație, rulat local; Apache-2.0 + MIT', tone: 'neutral' },
      { id: 'cameras', label: 'Camere', value: sources.value, detail: sources.detail, tone: 'neutral' },
    ];
  }

  const edgeSeen = health?.edge_last_seen_s;
  const online = cameras.filter((camera) => camera.status === 'online').length;

  return [
    {
      id: 'backend',
      label: 'Backend',
      value: health?.db ? 'ONLINE' : 'OFFLINE',
      detail: health?.db ? 'Baza de date răspunde' : 'Backend-ul sau baza de date nu răspund',
      tone: health?.db ? 'ok' : 'bad',
    },
    {
      id: 'edge',
      label: 'Edge AI',
      value: edgeSeen == null ? 'FĂRĂ DATE' : edgeSeen < 60 ? 'ACTIV' : 'ÎNTÂRZAT',
      detail: edgeSeen == null ? 'Niciun semnal de la edge' : `Ultimul semnal acum ${Math.round(edgeSeen)} s`,
      tone: edgeSeen == null ? 'warn' : edgeSeen < 60 ? 'ok' : 'warn',
    },
    {
      id: 'model',
      label: 'Model detecție',
      value: latestModel || '—',
      detail: 'Din ultimul eveniment primit',
      tone: 'neutral',
    },
    {
      id: 'cameras',
      label: 'Camere',
      value: `${online} / ${cameras.length} online`,
      detail: `${zones.length} zone configurate`,
      tone: cameras.length > 0 && online === cameras.length ? 'ok' : 'warn',
    },
  ];
}

/**
 * One table row per camera. A fixture camera is never "ONLINE": in the static build its
 * row says DEMO, and the source column tells a demo clip from the browser camera.
 */
export function buildCameraRows(cameras = [], { isMock = false, zones = [] } = {}) {
  const zonesPerCamera = {};
  for (const zone of zones) {
    zonesPerCamera[zone.camera_id] = (zonesPerCamera[zone.camera_id] || 0) + 1;
  }

  return cameras.map((camera) => {
    const kind = cameraKind(camera);
    const online = camera.status === 'online';
    return {
      id: camera.id,
      code: camera.code || camera.id,
      name: camera.name || camera.id,
      kind,
      sourceLabel: kind === 'clip' ? (isMock ? 'Clip demo' : 'Flux de rețea') : 'Cameră locală',
      statusLabel: isMock ? 'DEMO' : online ? 'ONLINE' : 'OFFLINE',
      statusTone: isMock ? 'demo' : online ? 'ok' : 'bad',
      engineLabel: camera.engine_on ? 'pornit' : 'oprit',
      engineOn: Boolean(camera.engine_on),
      zoneCount: zonesPerCamera[camera.id] || 0,
    };
  });
}

/**
 * The audit trail prints the same `DD.MM, HH:MM:SS` the incident list does. The name is
 * kept because `SettingsView` imports it; the formatting itself lives in `utils/time.js`.
 */
export const formatAuditTime = (iso) => formatDateTime(iso);

/**
 * Flattens incidents into the steps they went through. The static build gets the demo
 * wording, so a fixture notification is never described as something that was sent.
 */
export function buildAuditRows(events = [], { typeLabels = {}, limit = AUDIT_LIMIT, isMock = false } = {}) {
  const rows = [];

  for (const event of events) {
    const what = `${typeLabels[event.type] || event.type} · ${event.camera_id}/${event.zone_id}`;
    const eventId = event.event_id;

    if (event.detected_at) {
      rows.push({
        at: event.detected_at,
        actor: isMock ? 'Detecție' : 'Edge',
        action: isMock ? `${what} (track #${event.track_id})` : `Detecție ${what} (track #${event.track_id})`,
        eventId,
      });
    }
    if (event.notified_at) {
      rows.push({
        at: event.notified_at,
        actor: 'Notificare',
        action: isMock ? `Alertă Slack demo: ${what}` : `Alertă Slack trimisă: ${what}`,
        eventId,
      });
    }
    if (event.escalated_at) {
      rows.push({
        at: event.escalated_at,
        actor: 'Escaladare',
        action: isMock ? `Escaladare demo: ${what}` : `Neconfirmat la timp: ${what}`,
        eventId,
      });
    }
    if (event.acked_at) {
      const verb =
        event.status === 'false_positive' ? 'Marcat fals pozitiv' : event.status === 'resolved' ? 'Rezolvat' : 'Confirmat';
      rows.push({
        at: event.acked_at,
        actor: 'Operator',
        action: `${verb}${event.acked_by ? ` de ${event.acked_by}` : ''}: ${what}`,
        eventId,
      });
    }
  }

  return rows
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.max(0, limit));
}

/** The model of the most recent event, the only place a non-mock build knows it from. */
export function latestDetectionModel(events = []) {
  const latest = [...events].sort((a, b) => String(b.detected_at || '').localeCompare(String(a.detected_at || '')))[0];
  return latest?.model || null;
}

