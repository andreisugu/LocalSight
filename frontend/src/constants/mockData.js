// Date demo pentru build-ul static (VITE_USE_MOCK=true) și pentru `npm run dev`.
// Nimic nu vine din backend: totul e generat relativ la momentul încărcării paginii,
// ca lista de incidente și raportul de tură să arate ca o tură reală oricând e deschis linkul.
//
// Imagini demo (fără fețe identificabile):
// - Unsplash, photo-1542296332-2e4473faf563 — apron cu aeronavă la poartă.
// - Wikimedia Commons, "Aircraft on taxiway, Heathrow airport" — Derek Harper, CC BY-SA 2.0
//   (https://www.geograph.org.uk/photo/5646419).
// - Wikimedia Commons, "Airport Conveyor" — djedj, CC0.

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const TIME_ZONE = 'Europe/Bucharest';

const pad2 = (value) => String(value).padStart(2, '0');
const roDecimal = (value) => String(value).replace('.', ',');

// Ora României, ca în UI: API-ul trimite UTC, ecranele afișează Europe/Bucharest.
function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
}

function roTime(date) {
  const { hour, minute, second } = zonedParts(date);
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

const NOW = new Date();
const currentParts = zonedParts(NOW);

const SHIFT_LABELS = {
  shift_1: 'Tura 1 (Dimineață: 06:00 - 14:00)',
  shift_2: 'Tura 2 (Prânz: 14:00 - 22:00)',
  shift_3: 'Tura 3 (Noapte: 22:00 - 06:00)',
};
const SHIFT_START_HOURS = { shift_1: 6, shift_2: 14, shift_3: 22 };

// Tura care conține ora curentă, ca în backend (06–14, 14–22, 22–06).
const currentShiftId =
  currentParts.hour >= 22 || currentParts.hour < 6
    ? 'shift_3'
    : currentParts.hour < 14
      ? 'shift_1'
      : 'shift_2';

// Tura curentă a datelor demo, ca selectorul din Rapoarte să indice exact ce descrie
// raportul, nu o tură fixă.
export const OPERATIONAL_SHIFT_ID = currentShiftId;

const minutesIntoShift =
  ((currentParts.hour - SHIFT_START_HOURS[currentShiftId] + 24) % 24) * 60 + currentParts.minute;

// Evenimentele stau în tura curentă: fereastra se întinde pe până la ~3 ore, dar se
// comprimă dacă tura tocmai a început, ca by_hour să nu sară în tura anterioară.
// 4 minute e pragul minim care lasă loc de escaladare (30 s) și confirmare (până la 64 s).
const spreadMinutes = Math.min(168, Math.max(minutesIntoShift, 4));
const ageAt = (fraction) => new Date(NOW.getTime() - fraction * spreadMinutes * MINUTE_MS);
// Cel mai recent incident e „acum”: 45 s în mod normal, mai puțin dacă tura tocmai a început.
const newestAgeMs = Math.min(45 * SECOND_MS, 0.1 * spreadMinutes * MINUTE_MS);
const newestDetectedAt = new Date(NOW.getTime() - newestAgeMs);

// Ziua operațională: înainte de 06:00, tura aparține zilei anterioare.
function operationalDate(parts) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < 6) day.setUTCDate(day.getUTCDate() - 1);
  return `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
}

// Ziua operațională a datelor demo: aceeași valoare pe care o afișează raportul de tură.
export const OPERATIONAL_DATE = operationalDate(currentParts);

const SNAPSHOTS = {
  stand12:
    'https://images.unsplash.com/photo-1542296332-2e4473faf563?w=800&auto=format&fit=crop&q=60',
  'taxiway-b':
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Aircraft_on_taxiway%2C_Heathrow_airport_-_geograph.org.uk_-_5646419.jpg/960px-Aircraft_on_taxiway%2C_Heathrow_airport_-_geograph.org.uk_-_5646419.jpg',
  'baggage-area':
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Airport_Conveyor.jpg/960px-Airport_Conveyor.jpg',
};

// Conformitatea PPE se măsoară pe toate detecțiile de persoane din tură, nu doar pe
// incidentele din listă; 93,8% înseamnă 8 abateri la ~129 de verificări.
const PPE_COMPLIANCE_PCT = 93.8;

export const INITIAL_CAMERAS = [
  {
    id: 'stand12',
    code: 'CAM-01',
    name: 'CAM-01 • Stand 12 — apron',
    subtitle: 'Alimentare & Întreținere (Zonă Motor Apron)',
    category: 'Alimentare & Rampă',
    zone_id: 'engine-left',
    rtsp_url: 'rtsp://edge.airport.local/live/stand12',
    status: 'online',
    engine_on: true,
    fps: 30,
    resolution: '4K (3840x2160)',
    previewBg: 'from-[#1F1F1F] via-[#282828] to-[#181818]',
    boxes: [
      {
        id: 'box-stand12-1',
        label: 'Persoană #17 în zona motorului',
        type: 'critical',
        coords: { top: '46%', left: '22%', width: '11%', height: '30%' },
        trackingId: 'track_17',
        details: 'Persoană în raza motorului stâng, cu motorul pornit (2,6 s)',
      },
      {
        id: 'box-stand12-2',
        label: 'Zonă motor stâng (engine-left)',
        type: 'warning',
        coords: { top: '44%', left: '3%', width: '59%', height: '43%' },
        trackingId: 'engine-left',
        details: 'active_when: engine_on = true',
      },
    ],
  },
  {
    id: 'taxiway-b',
    code: 'CAM-02',
    name: 'CAM-02 • Taxiway B',
    subtitle: 'Cale de rulare & linia de așteptare 08R',
    category: 'Pistă & Căi Rulare',
    zone_id: 'taxiway-b',
    rtsp_url: 'rtsp://edge.airport.local/live/taxiway-b',
    status: 'online',
    engine_on: false,
    fps: 30,
    resolution: '1080p 30FPS',
    previewBg: 'from-zinc-900 to-neutral-800',
    boxes: [
      {
        id: 'box-taxiway-b-1',
        label: 'Persoană #23 la linia de așteptare',
        type: 'critical',
        coords: { top: '58%', left: '57%', width: '8%', height: '22%' },
        trackingId: 'track_23',
        details: 'Traversare peste banda de siguranță, aeronavă în rulare',
      },
      {
        id: 'box-taxiway-b-2',
        label: 'Aeronavă în rulare YR-BMA',
        type: 'warning',
        coords: { top: '34%', left: '24%', width: '32%', height: '24%' },
        trackingId: 'ac_08r',
        details: 'Viteză redusă, motor pornit, direcție 08R',
      },
    ],
  },
  {
    id: 'baggage-area',
    code: 'CAM-03',
    name: 'CAM-03 • Bagaje — poarta',
    subtitle: 'Triere & Încărcare Bagaje (Rampă Sud)',
    category: 'Terminal & Porți',
    zone_id: 'baggage-area',
    rtsp_url: 'rtsp://edge.airport.local/live/baggage-area',
    status: 'online',
    engine_on: false,
    fps: 25,
    resolution: '1080p 25FPS',
    previewBg: 'from-[#222222] to-[#181818]',
    boxes: [
      {
        id: 'box-baggage-1',
        label: 'Persoană #41 fără vestă hi-vis',
        type: 'warning',
        coords: { top: '48%', left: '38%', width: '10%', height: '26%' },
        trackingId: 'track_41',
        details: 'Operator pe banda 2 de triere, fără echipament vizibil',
      },
    ],
  },
];

export const AVAILABLE_OPERATORS = [
  // Roles, not people: the operator types their own name (kept in this browser only).
  { id: 'dispatcher', name: 'Dispecer', role: 'Dispecer siguranță airside', badge: 'DISPECER' },
  { id: 'shift-lead', name: 'Șef tură', role: 'Șef tură rampă & apron', badge: 'SEF TURA' },
  { id: 'inspector', name: 'Inspector', role: 'Inspector siguranță sol', badge: 'INSPECTOR' },
];

// Tura demo: 8 incidente pe 3 camere, de la cel mai recent (încă deschis) până la
// primele minute ale turei. `report.when` se compune din detected_at, ca să nu
// rămână niciodată ore scrise de mână.
const eventSpecs = [
  {
    cameraId: 'stand12',
    zoneId: 'engine-left',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    trackId: 17,
    detectedAt: newestDetectedAt,
    durationS: 2.6,
    engineOn: true,
    status: 'open',
    escalateAfterS: 120,
    detector: 0.93,
    seen: 14,
    report: {
      what: 'Un tehnician a intrat în raza motorului stâng cu motorul pornit și a rămas în zonă 2,6 s, la circa 4 m de nacelă.',
      where: 'Stand 12, zona engine-left, între motorul stâng și roata din față.',
      severity_reason: 'Motorul funcționa în idle; risc de ingestie și jet blast în raza de 7 m.',
      recommended_action:
        'Contactează imediat echipa de la sol pe canalul TETRA 3 și oprește accesul la Stand 12 până la confirmarea zonei libere.',
    },
  },
  {
    cameraId: 'taxiway-b',
    zoneId: 'taxiway-b',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    trackId: 23,
    detectedAt: ageAt(0.14),
    durationS: 6.2,
    engineOn: false,
    status: 'escalated',
    escalateAfterS: 30,
    detector: 0.91,
    seen: 15,
    report: {
      what: 'Un muncitor de rampă a traversat banda de siguranță a Taxiway B în timp ce o aeronavă se afla în rulare spre 08R.',
      where: 'Taxiway B, segmentul de lângă linia de așteptare a pistei 08R.',
      severity_reason:
        'Traversare neautorizată în fața unei aeronave în rulare; risc de coliziune la sol.',
      recommended_action:
        'Verifică înregistrarea cu turnul și instruiește echipa de rampă; zona rămâne închisă până la sosirea supraveghetorului.',
    },
  },
  {
    cameraId: 'baggage-area',
    zoneId: 'baggage-area',
    type: 'NO_PPE',
    severity: 'WARNING',
    trackId: 41,
    detectedAt: ageAt(0.26),
    durationS: 12.4,
    engineOn: false,
    status: 'open',
    escalateAfterS: null,
    detector: 0.89,
    seen: 13,
    report: {
      what: 'Un operator de bandă a lucrat la conveyor fără vestă hi-vis, cu spatele la culoarul de întoarcere al remorcii.',
      where: 'Zona bagaje, banda 2 de triere, lângă poarta de încărcare.',
      severity_reason:
        'Operatorul nu e vizibil pentru șoferii de GSE care intră pe banda de triere.',
      recommended_action:
        'Cheamă operatorul la punctul de control și reia procedura de echipare înainte de a reveni la bandă.',
    },
  },
  {
    cameraId: 'stand12',
    zoneId: 'apron-stand12',
    type: 'NO_PPE',
    severity: 'WARNING',
    trackId: 12,
    detectedAt: ageAt(0.39),
    durationS: 8.1,
    engineOn: true,
    status: 'acknowledged',
    escalateAfterS: 60,
    ackSeconds: 34,
    ackedBy: 'Dispecer',
    detector: 0.87,
    seen: 12,
    report: {
      what: 'Un tehnician de mentenanță a intrat pe platforma Stand 12 fără cască de protecție, având doar vestă hi-vis.',
      where: 'Stand 12, platforma de deservire (zona apron-stand12).',
      severity_reason: 'În zonă circulă GSE și se lucrează la înălțime; casca este obligatorie.',
      recommended_action:
        'Trimite un reminder pe radio și notează abaterea pentru briefing-ul de la schimbul de tură.',
    },
  },
  {
    cameraId: 'taxiway-b',
    zoneId: 'taxiway-b',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    trackId: 28,
    detectedAt: ageAt(0.52),
    durationS: 3.8,
    engineOn: false,
    status: 'resolved',
    escalateAfterS: 30,
    ackSeconds: 22,
    ackedBy: 'Șef tură',
    detector: 0.95,
    seen: 15,
    report: {
      what: 'Un agent de handling a pășit peste linia de așteptare în timp ce aeronava YR-BMA se pregătea de rulare.',
      where: 'Taxiway B, intersecția cu banda de deservire a standurilor 10–14.',
      severity_reason: 'Aeronava se afla la circa 30 m de zona de conflict, cu motorul pornit.',
      recommended_action:
        'Oprește rularea până la eliberarea benzii și confirmă cu turnul că traseul e liber.',
    },
  },
  {
    cameraId: 'stand12',
    zoneId: 'apron-stand12',
    type: 'NO_PPE',
    severity: 'WARNING',
    trackId: 9,
    detectedAt: ageAt(0.66),
    durationS: 6.5,
    engineOn: true,
    status: 'acknowledged',
    escalateAfterS: 60,
    ackSeconds: 51,
    ackedBy: 'Șef tură',
    detector: 0.9,
    seen: 14,
    report: {
      what: 'Doi lucrători au descărcat bagaje la Stand 12 fără apărători auditive, la 12 m de APU pornit.',
      where: 'Stand 12, platforma de deservire, în spatele aripii drepte.',
      severity_reason: 'Nivel sonor peste 105 dB la APU pornit; expunerea prelungită afectează auzul.',
      recommended_action:
        'Avertizează echipa și distribuie apărători auditive din trusa de la poarta 12.',
    },
  },
  {
    cameraId: 'baggage-area',
    zoneId: 'baggage-area',
    type: 'NO_PPE',
    severity: 'WARNING',
    trackId: 55,
    detectedAt: ageAt(0.82),
    durationS: 9.7,
    engineOn: false,
    status: 'acknowledged',
    escalateAfterS: null,
    ackSeconds: 64,
    ackedBy: 'Dispecer',
    detector: 0.86,
    seen: 12,
    report: {
      what: 'Un operator a intrat în zona benzii de triere fără vestă hi-vis, în timp ce tractorul de bagaje se apropia.',
      where: 'Zona bagaje, culoarul dintre banda 1 și rampa de încărcare.',
      severity_reason: 'Operatorul nu era vizibil pentru șoferul tractorului; risc de accident pietonal.',
      recommended_action:
        'Oprește tractorul, verifică echiparea și reia ciclul de încărcare după confirmarea vestei.',
    },
  },
  {
    cameraId: 'stand12',
    zoneId: 'engine-left',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    trackId: 14,
    detectedAt: ageAt(1),
    durationS: 4.9,
    engineOn: true,
    status: 'escalated',
    escalateAfterS: 120,
    detector: 0.94,
    seen: 15,
    report: {
      what: 'Un muncitor a intrat în zona motorului stâng pentru a recupera un con de semnalizare, cu motorul pornit.',
      where: 'Stand 12, zona engine-left, la 3 m de admisia turbinei.',
      severity_reason: 'Recuperarea unui con din raza de aspirație, cu motorul în funcțiune.',
      recommended_action:
        'Oprește APU-ul, recuperează conul doar cu motorul oprit și instruiește echipa de rampă.',
    },
  },
];

function buildEvent(spec) {
  const detectedMs = spec.detectedAt.getTime();
  const receivedAt = new Date(detectedMs + 180 + (spec.trackId % 6) * 25);
  const notifiedAt = new Date(receivedAt.getTime() + 800 + (spec.trackId % 7) * 90);
  const ackedAt = spec.ackSeconds == null ? null : new Date(detectedMs + spec.ackSeconds * SECOND_MS);
  const escalatedAt =
    spec.status === 'escalated' && spec.escalateAfterS != null
      ? new Date(detectedMs + spec.escalateAfterS * SECOND_MS)
      : null;

  return {
    event_id: `evt_${spec.cameraId}_${detectedMs}_${spec.trackId}`,
    type: spec.type,
    severity: spec.severity,
    camera_id: spec.cameraId,
    zone_id: spec.zoneId,
    track_id: spec.trackId,
    confidence: { detector: spec.detector, temporal: { seen: spec.seen, window: 15 } },
    duration_s: spec.durationS,
    context: { engine_on: spec.engineOn },
    snapshot_url: SNAPSHOTS[spec.cameraId],
    model: 'person-ppe-v1',
    detected_at: spec.detectedAt.toISOString(),
    status: spec.status,
    received_at: receivedAt.toISOString(),
    notified_at: notifiedAt.toISOString(),
    escalated_at: escalatedAt ? escalatedAt.toISOString() : null,
    escalate_after_s: spec.escalateAfterS,
    acked_at: ackedAt ? ackedAt.toISOString() : null,
    acked_by: spec.ackedBy || null,
    report: {
      what: spec.report.what,
      where: spec.report.where,
      when: `${roTime(spec.detectedAt)}, timp în zonă ${roDecimal(spec.durationS)} s.`,
      severity_reason: spec.report.severity_reason,
      recommended_action: spec.report.recommended_action,
      source: 'llm',
    },
  };
}

export const INITIAL_EVENTS = eventSpecs
  .map(buildEvent)
  .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)));

export const INITIAL_ZONES = [
  {
    zone_id: 'engine-left',
    camera_id: 'stand12',
    name: 'Stand 12 — motor stâng',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    required_ppe: ['ear_defenders', 'hi_vis_vest'],
    severity: 'CRITICAL',
    debounce_s: 0.5,
    notify_channel: 'slack',
    escalate_after_s: 120,
    // Calibrat pe clipul cam01: motorul stâng și zona de siguranță până la roata din față.
    polygon: [
      { x: 0.02, y: 0.48 },
      { x: 0.4, y: 0.48 },
      { x: 0.62, y: 0.6 },
      { x: 0.64, y: 0.86 },
      { x: 0.2, y: 0.86 },
      { x: 0.02, y: 0.7 },
    ],
  },
  {
    zone_id: 'apron-stand12',
    camera_id: 'stand12',
    name: 'Platformă Stand 12',
    rule_type: 'PPE_REQUIRED',
    active_when: 'always',
    required_ppe: ['hi_vis_vest', 'hard_hat', 'ear_defenders'],
    severity: 'WARNING',
    debounce_s: 2.0,
    notify_channel: 'slack',
    escalate_after_s: 60,
    polygon: [
      { x: 0.04, y: 0.22 },
      { x: 0.42, y: 0.22 },
      { x: 0.42, y: 0.72 },
      { x: 0.04, y: 0.72 },
    ],
  },
  {
    zone_id: 'taxiway-b',
    camera_id: 'taxiway-b',
    name: 'Taxiway B — linie de așteptare',
    rule_type: 'RESTRICTED',
    active_when: 'always',
    required_ppe: [],
    severity: 'CRITICAL',
    debounce_s: 1.0,
    notify_channel: 'slack',
    escalate_after_s: 30,
    polygon: [
      { x: 0.0, y: 0.62 },
      { x: 1.0, y: 0.62 },
      { x: 1.0, y: 0.9 },
      { x: 0.0, y: 0.9 },
    ],
  },
  {
    zone_id: 'baggage-area',
    camera_id: 'baggage-area',
    name: 'Zona bagaje — banda 2',
    rule_type: 'PPE_REQUIRED',
    active_when: 'always',
    required_ppe: ['hi_vis_vest'],
    severity: 'WARNING',
    debounce_s: 2.0,
    notify_channel: 'slack',
    // Rampa de bagaje nu are escaladare automată: rămâne în lista operatorului până la confirmare.
    escalate_after_s: null,
    polygon: [
      { x: 0.08, y: 0.3 },
      { x: 0.92, y: 0.3 },
      { x: 0.92, y: 0.86 },
      { x: 0.08, y: 0.86 },
    ],
  },
];

const openIncidents = INITIAL_EVENTS.filter((event) => event.status === 'open').length;
const escalatedIncidents = INITIAL_EVENTS.filter((event) => event.status === 'escalated').length;
const criticalEvents = INITIAL_EVENTS.filter((event) => event.severity === 'CRITICAL').length;
const warningEvents = INITIAL_EVENTS.filter((event) => event.severity === 'WARNING').length;

const latencies = INITIAL_EVENTS.map(
  (event) => (Date.parse(event.notified_at) - Date.parse(event.detected_at)) / SECOND_MS
);
const avgLatency = Math.round((latencies.reduce((sum, value) => sum + value, 0) / latencies.length) * 10) / 10;

const ackSeconds = INITIAL_EVENTS.filter((event) => event.acked_at).map(
  (event) => (Date.parse(event.acked_at) - Date.parse(event.detected_at)) / SECOND_MS
);
const avgAckSeconds = Math.round(ackSeconds.reduce((sum, value) => sum + value, 0) / ackSeconds.length);

export const INITIAL_KPIS = {
  ppe_compliance_pct: PPE_COMPLIANCE_PCT,
  // Deschise + escaladate, exact ca în SecurityContext (mock recalculează din events).
  open_incidents_count: openIncidents + escalatedIncidents,
  detection_to_alert_latency_s: avgLatency,
  escalated_incidents_count: escalatedIncidents,
};

const TYPE_LABELS = {
  RESTRICTED_ZONE: 'Zonă restricționată',
  NO_PPE: 'Echipament lipsă',
};

const zoneName = (zoneId) =>
  INITIAL_ZONES.find((zone) => zone.zone_id === zoneId)?.name || zoneId;

const byType = [...new Set(INITIAL_EVENTS.map((event) => event.type))].map((type) => {
  const rows = INITIAL_EVENTS.filter((event) => event.type === type);
  return {
    type,
    label: TYPE_LABELS[type] || type,
    count: rows.length,
    critical: rows.filter((event) => event.severity === 'CRITICAL').length,
    warning: rows.filter((event) => event.severity === 'WARNING').length,
    false_positive: 0,
  };
});

// Zonele păstrează ordinea după numărul de evenimente, ca tabelul din raport să fie util.
const byZone = [...new Set(INITIAL_EVENTS.map((event) => event.zone_id))]
  .map((zoneId) => {
    const rows = INITIAL_EVENTS.filter((event) => event.zone_id === zoneId);
    const zoneAcks = rows
      .filter((event) => event.acked_at)
      .map((event) => (Date.parse(event.acked_at) - Date.parse(event.detected_at)) / SECOND_MS);
    return {
      zone: zoneName(zoneId),
      critical: rows.filter((event) => event.severity === 'CRITICAL').length,
      warning: rows.filter((event) => event.severity === 'WARNING').length,
      false_positive: 0,
      // Fără nicio confirmare în zonă, media turei e referința cea mai onestă pentru demo.
      avg_ack_s: zoneAcks.length
        ? Math.round(zoneAcks.reduce((sum, value) => sum + value, 0) / zoneAcks.length)
        : avgAckSeconds,
    };
  })
  .sort((a, b) => b.critical + b.warning - (a.critical + a.warning));

const hourBuckets = new Map();
INITIAL_EVENTS.forEach((event) => {
  const detected = new Date(event.detected_at);
  const { hour } = zonedParts(detected);
  const key = `${pad2(hour)}:00`;
  const bucket = hourBuckets.get(key) || { hour: key, events: 0, firstMs: detected.getTime() };
  bucket.events += 1;
  bucket.firstMs = Math.min(bucket.firstMs, detected.getTime());
  hourBuckets.set(key, bucket);
});
const byHour = [...hourBuckets.values()]
  .sort((a, b) => a.firstMs - b.firstMs)
  .map(({ hour, events }) => ({ hour, events }));

// Acoperirea în tură: minutele în care camerele nu au transmis nu sunt incidente.
const coveredMinutes = Math.max(minutesIntoShift, 1);
const offlineMinutes = Math.min(4, Math.floor(coveredMinutes / 60));

const summary =
  `${SHIFT_LABELS[currentShiftId].split(' (')[0]}: ${INITIAL_EVENTS.length} evenimente, ` +
  `${criticalEvents} critice și ${warningEvents} avertismente. ` +
  `${openIncidents} incidente sunt încă deschise, iar ${escalatedIncidents} au escaladat după ` +
  `termenul de confirmare. Timpul mediu de confirmare a fost ${avgAckSeconds} s, ` +
  `conformitatea PPE ${roDecimal(PPE_COMPLIANCE_PCT)}%, iar cele mai frecvente abateri ` +
  `rămân traversarea Taxiway B și lipsa vestei hi-vis la trierea bagajelor.`;

export const INITIAL_SHIFT_REPORT = {
  shift: SHIFT_LABELS[currentShiftId],
  date: OPERATIONAL_DATE,
  kpi: {
    total_events: INITIAL_EVENTS.length,
    critical_events: criticalEvents,
    warning_events: warningEvents,
    avg_ack_time_s: avgAckSeconds,
    ppe_compliance_pct: PPE_COMPLIANCE_PCT,
  },
  summary,
  by_type: byType,
  by_zone: byZone,
  by_hour: byHour,
  coverage: {
    coverage: Math.round((1 - offlineMinutes / coveredMinutes) * 1000) / 1000,
    offline_minutes: offlineMinutes,
  },
  total_events: INITIAL_EVENTS.length,
  false_positives: 0,
};
