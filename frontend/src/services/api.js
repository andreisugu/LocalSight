import {
  INITIAL_CAMERAS,
  INITIAL_EVENTS,
  INITIAL_ZONES,
  INITIAL_KPIS,
  INITIAL_SHIFT_REPORT,
} from '../constants/mockData';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'false').toLowerCase() === 'true';

const PALETTES = [
  'from-[#1F1F1F] via-[#282828] to-[#181818]',
  'from-zinc-900 to-neutral-800',
  'from-[#1F1F1F] to-[#282828]',
  'from-[#222222] to-[#181818]',
];

const SHIFT_TO_API = {
  shift_1: 'morning',
  shift_2: 'afternoon',
  shift_3: 'night',
};

const SHIFT_LABELS = {
  morning: 'Tura 1 (Dimineață: 06:00 - 14:00)',
  afternoon: 'Tura 2 (Prânz: 14:00 - 22:00)',
  night: 'Tura 3 (Noapte: 22:00 - 06:00)',
};

export const TYPE_LABELS = {
  RESTRICTED_ZONE: 'Zonă restricționată',
  NO_PPE: 'Echipament lipsă',
  PPE_VIOLATION: 'Echipament lipsă',
  SMOKING: 'Fumat',
  CAMERA_OFFLINE: 'Cameră offline',
  UNATTENDED_BAGGAGE: 'Bagaj abandonat',
};

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

function apiPath(path) {
  return `${API_BASE_URL}${path}`;
}

const SHIFT_TIME_ZONE = 'Europe/Bucharest';

function zonedDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHIFT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
  return { year: values.year, month: values.month, day: values.day, hour: values.hour };
}

function dateStringFromParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localDateString(date = new Date()) {
  return dateStringFromParts(zonedDateParts(date));
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function resolveAsset(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function http(path, options = {}) {
  const headers = { ...(options.body ? (options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) : {}), ...(options.headers || {}) };
  const response = await fetch(apiPath(path), { ...options, headers });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload.detail || JSON.stringify(payload);
    } catch {
      detail = await response.text();
    }
    throw new Error(`${response.status} ${detail || response.statusText}`);
  }
  // 204 No Content (DELETE /zones/{id}) has no body to parse.
  if (response.status === 204) return null;
  return response.json();
}

// dev.py demo --webcam: the laptop camera runs on a seeded camera id (no contract change);
// only its label changes here.
const WEBCAM_CAMERA = import.meta.env.VITE_WEBCAM_CAMERA || '';
const WEBCAM_METADATA = {
  code: 'WEBCAM',
  name: 'WEBCAM • Camera laptopului',
  subtitle: 'Verificare vestă în timp real (experimental)',
  category: 'Webcam',
};

function mapCamera(camera, index = 0) {
  const webcam = WEBCAM_CAMERA && camera.id === WEBCAM_CAMERA;
  const meta = webcam ? { ...CAMERA_METADATA[camera.id], ...WEBCAM_METADATA } : CAMERA_METADATA[camera.id] || {};
  return {
    ...camera,
    code: meta.code || `CAM-0${index + 1}`,
    name: (webcam && meta.name) || camera.name || meta.name || `CAM-${camera.id}`,
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

function mapEvent(event) {
  return { ...event, snapshot_url: resolveAsset(event.snapshot_url) };
}

function mapZone(zone) {
  const reference = zone.reference_frame;
  return {
    ...zone,
    zone_id: zone.id,
    polygon: (zone.polygon || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y })),
    // The edge uploads the (blurred) frame the zone is drawn on; the editor uses it as background.
    reference_frame_url: reference ? (/^https?:\/\//.test(reference) ? reference : `${API_BASE_URL}${reference}`) : null,
  };
}

function toZonePayload(zoneId, zoneData) {
  const escalateAfter =
    zoneData.escalate_after_s != null &&
    zoneData.escalate_after_s !== '' &&
    Number(zoneData.escalate_after_s) >= 1
      ? Math.round(Number(zoneData.escalate_after_s))
      : null;

  return {
    id: zoneId,
    camera_id: zoneData.camera_id,
    name: zoneData.name || zoneData.zone_id || zoneId,
    rule_type: zoneData.rule_type,
    active_when: String(zoneData.active_when || 'always').toLowerCase() === 'engine_on' ? 'engine_on' : 'always',
    required_ppe: zoneData.required_ppe || [],
    severity: zoneData.severity,
    debounce_s: Number(zoneData.debounce_s) || 0,
    escalate_after_s: escalateAfter,
    notify_channel: 'slack',
    polygon: (zoneData.polygon || []).map((point) => [
      Math.max(0, Math.min(1, Number(point.x != null ? point.x : (Array.isArray(point) ? point[0] : 0)))),
      Math.max(0, Math.min(1, Number(point.y != null ? point.y : (Array.isArray(point) ? point[1] : 0)))),
    ]),
    reference_frame: zoneData.reference_frame || null,
  };
}

function mapKpi(kpi) {
  return {
    ppe_compliance_pct: kpi.ppe_compliance == null ? '—' : Math.round(kpi.ppe_compliance * 1000) / 10,
    open_incidents_count: kpi.open_incidents,
    detection_to_alert_latency_s: kpi.avg_detection_to_alert_s == null ? '—' : kpi.avg_detection_to_alert_s,
    escalated_incidents_count: kpi.escalated,
  };
}

function mapShiftReport(report) {
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
  // Media globală vine din backend, calculată pe toate evenimentele confirmate din tură.
  const avgAck = report.avg_ack_s;

  return {
    shift: SHIFT_LABELS[report.shift] || report.shift,
    date: report.date,
    kpi: {
      total_events: total,
      critical_events: critical,
      warning_events: warning,
      avg_ack_time_s: avgAck == null ? '—' : avgAck,
      ppe_compliance_pct: report.kpi?.ppe_compliance == null
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
    // Câte minute din tură au fost camerele oarbe; `null` dacă backend-ul nu știe încă.
    coverage: report.coverage || null,
    total_events: report.total_events ?? total,
    false_positives: report.false_positives ?? 0,
  };
}

export const localSightApi = {
  async getHealth() {
    if (USE_MOCK) return { status: 'ok', db: true, edge_last_seen_s: 0, mock: true };
    return http('/health');
  },

  async getCameras() {
    if (USE_MOCK) return INITIAL_CAMERAS;
    const cameras = await http('/cameras');
    return cameras.map(mapCamera);
  },

  async setEngineState(cameraId, on) {
    if (USE_MOCK) return { id: cameraId, camera_id: cameraId, engine_on: on, status: 'online' };
    try {
      const camera = await http(`/cameras/${encodeURIComponent(cameraId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ on }),
      });
      return {
        id: camera.id,
        camera_id: camera.id,
        engine_on: Boolean(camera.engine_on),
        status: camera.online ? 'online' : 'offline',
      };
    } catch {
      return { id: cameraId, camera_id: cameraId, engine_on: on, status: 'online' };
    }
  },

  async getZones(cameraId) {
    if (USE_MOCK) {
      return cameraId
        ? INITIAL_ZONES.filter((zone) => zone.camera_id === cameraId)
        : INITIAL_ZONES;
    }
    const zones = await http(`/zones${queryString({ camera_id: cameraId })}`);
    return zones.map(mapZone);
  },

  async saveZone(zoneId, zoneData) {
    if (USE_MOCK) return { ...zoneData, zone_id: zoneId, saved: true };
    const zone = await http(`/zones/${encodeURIComponent(zoneId)}`, {
      method: 'PUT',
      body: JSON.stringify(toZonePayload(zoneId, zoneData)),
    });
    return mapZone(zone);
  },

  async captureReferenceFrame(zoneId, file) {
    if (USE_MOCK) return { zone_id: zoneId, captured_at: new Date().toISOString() };
    const form = new FormData();
    form.append('zone_id', zoneId);
    form.append('file', file);
    const zone = await http('/zones/reference-frame', { method: 'POST', body: form });
    return mapZone(zone);
  },

  async captureReferenceFromLive(zoneId) {
    if (USE_MOCK) return { zone_id: zoneId, reference_frame: null };
    const zone = await http(`/zones/${encodeURIComponent(zoneId)}/reference-frame/from-live`, {
      method: 'POST',
    });
    return mapZone(zone);
  },

  async deleteZone(zoneId) {
    if (USE_MOCK) return true;
    await http(`/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' });
    return true;
  },

  async deleteReferenceFrame(zoneId) {
    if (USE_MOCK) return { zone_id: zoneId, reference_frame: null };
    const zone = await http(`/zones/${encodeURIComponent(zoneId)}/reference-frame`, { method: 'DELETE' });
    return mapZone(zone);
  },

  async getEvents({ status = '', severity = '', camera_id = '' } = {}) {
    if (USE_MOCK) {
      let filtered = [...INITIAL_EVENTS];
      if (status && status !== 'all') filtered = filtered.filter((event) => event.status === status);
      if (severity && severity !== 'all') filtered = filtered.filter((event) => event.severity === severity);
      if (camera_id && camera_id !== 'all') filtered = filtered.filter((event) => event.camera_id === camera_id);
      return filtered;
    }
    const events = await http(`/events${queryString({ status, severity, camera_id, limit: 200 })}`);
    return events.map(mapEvent);
  },

  async getEventById(eventId) {
    if (USE_MOCK) return INITIAL_EVENTS.find((event) => event.event_id === eventId) || null;
    return mapEvent(await http(`/events/${encodeURIComponent(eventId)}`));
  },

  async acknowledgeEvent(eventId, operator = 'Operator') {
    if (USE_MOCK) return { event_id: eventId, status: 'acknowledged', acked_by: operator };
    return mapEvent(await http(`/events/${encodeURIComponent(eventId)}/ack`, {
      method: 'POST',
      body: JSON.stringify({ operator }),
    }));
  },

  async markFalsePositive(eventId, operator = 'Operator', note = '') {
    if (USE_MOCK) return { event_id: eventId, status: 'false_positive', note };
    return mapEvent(await http(`/events/${encodeURIComponent(eventId)}/false-positive`, {
      method: 'POST',
      body: JSON.stringify({ operator, note }),
    }));
  },

  async reopenEvent(eventId, operator = 'Operator') {
    if (USE_MOCK) return { event_id: eventId, status: 'open' };
    return mapEvent(await http(`/events/${encodeURIComponent(eventId)}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ operator }),
    }));
  },

  async regenerateReport(eventId) {
    if (USE_MOCK) {
      const fallback = INITIAL_EVENTS.find((event) => event.event_id === eventId);
      return {
        event_id: eventId,
        report: {
          what: fallback?.report?.what || 'Persoană în zona motorului.',
          where: fallback?.report?.where || 'Stand 12, zona motorului stâng.',
          when: fallback?.report?.when || new Date().toISOString(),
          severity_reason: fallback?.report?.severity_reason || 'Motorul este pornit.',
          recommended_action: fallback?.report?.recommended_action || 'Îndepărtează persoana și confirmă zona.',
          source: 'llm',
        },
      };
    }
    return mapEvent(await http(`/events/${encodeURIComponent(eventId)}/regenerate-report`, { method: 'POST' }));
  },

  async getKPIs(date = '', shift = '') {
    if (USE_MOCK) return { ...INITIAL_KPIS };
    return mapKpi(await http(`/kpi${queryString({ date, shift })}`));
  },

  async getShiftReport(shift = 'morning', date = localDateString(), { refresh = false } = {}) {
    if (USE_MOCK) return { ...INITIAL_SHIFT_REPORT };
    const forced = refresh ? '&refresh=true' : '';
    return mapShiftReport(await http(`/reports${queryString({ shift, date })}${forced}`));
  },

  connectEventsSocket(onMessage, onError, onOpen) {
    if (USE_MOCK) {
      // Fără tick periodic de KPI în mock: cifrele (deschise/escaladate) se recalculează
      // din `events` în SecurityContext, altfel un ack ar fi anulat după 4 secunde.
      return () => {};
    }

    const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/ws/events`;
    let socket;
    let stopped = false;
    let retryTimer;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      // React StrictMode mounts, cleans up and mounts again; events from the
      // first socket must not mark the second connection as lost.
      socket.onopen = () => {
        if (!stopped) onOpen?.();
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (message?.data && (message.type === 'event.created' || message.type === 'event.updated')) {
            message.data = mapEvent(message.data);
          }
          onMessage(message);
        } catch (error) {
          console.error('WS parse error', error);
        }
      };
      socket.onerror = () => {
        if (!stopped) onError?.();
      };
      socket.onclose = () => {
        if (stopped) return;
        onError?.();
        retryTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  },

  shiftToApi(shiftId) {
    return SHIFT_TO_API[shiftId] || 'morning';
  },

  // Tura care conține acum ora României (06–14, 14–22, 22–06), ca în backend.
  currentShiftId(now = new Date()) {
    const { hour } = zonedDateParts(now);
    if (hour >= 6 && hour < 14) return 'shift_1';
    if (hour >= 14 && hour < 22) return 'shift_2';
    return 'shift_3';
  },

  // Înainte de 06:00, ziua operațională este ziua anterioară pentru toate turele.
  shiftDate(_shiftId, now = new Date()) {
    const { year, month, day, hour } = zonedDateParts(now);
    if (hour >= 6) {
      return dateStringFromParts({ year, month, day });
    }
    const previous = new Date(Date.UTC(year, month - 1, day));
    previous.setUTCDate(previous.getUTCDate() - 1);
    return dateStringFromParts({
      year: previous.getUTCFullYear(),
      month: previous.getUTCMonth() + 1,
      day: previous.getUTCDate(),
    });
  },
};
