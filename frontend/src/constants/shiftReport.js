// Raportul de tură, compus din incidentele pe care operatorul le vede în listă.
//
// Nimic aici nu vine din fixtures: fiecare cifră se numără din `events`. Ce nu poate fi
// dedus din incidente (de exemplu conformitatea PPE, care se măsoară pe toate detecțiile
// de persoane) nu este inventat — vezi `ppe` și nota din `ReportsView`.
//
// Tura și ziua operațională se primesc ca argumente: modulul rămâne pur, deci poate fi
// testat cu un ceas fix. Orele se grupează în Europe/Bucharest, ca în restul UI-ului.

const TIME_ZONE = 'Europe/Bucharest';
const SHIFT_START_HOUR = 6;
const KNOWN_TYPE_ORDER = ['RESTRICTED_ZONE', 'NO_PPE', 'SMOKING', 'CAMERA_OFFLINE'];
const UNKNOWN_TYPE = 'UNKNOWN';

// Etichetele românești deja folosite în UI (`services/api.js` TYPE_LABELS).
const TYPE_LABELS = {
  RESTRICTED_ZONE: 'Zonă restricționată',
  NO_PPE: 'Echipament lipsă',
  SMOKING: 'Fumat',
  CAMERA_OFFLINE: 'Cameră offline',
  [UNKNOWN_TYPE]: 'Tip necunoscut',
};

const pad2 = (value) => String(value).padStart(2, '0');

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

const zonedParts = (ms) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
};

/** Epoch milliseconds from an ISO string, a Date or a number; null when unreadable. */
function parseMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Ziua operațională (schimbă la 06:00), în aceeași regulă ca backend-ul. */
function operationalDateAt(ms) {
  const parts = zonedParts(ms);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < SHIFT_START_HOUR) day.setUTCDate(day.getUTCDate() - 1);
  return `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
}

const plural = (count, one, many) => (count === 1 ? one : many);

const groupType = (type) => {
  if (typeof type !== 'string' || type.trim() === '') return UNKNOWN_TYPE;
  return type;
};

const labelForType = (type) => TYPE_LABELS[type] || type;

function shortShift(shiftLabel) {
  const label = typeof shiftLabel === 'string' && shiftLabel.trim() ? shiftLabel.trim() : 'Tură';
  return label.split(' (')[0];
}

function buildSummary({ shiftLabel, kpi, byType, ackedCount }) {
  const shift = shortShift(shiftLabel);

  if (kpi.total_events === 0) {
    return (
      `${shift}: nu există evenimente în tura curentă, deci toate cifrele sunt zero. ` +
      'Nu se poate calcula timpul mediu de confirmare și nu există distribuții pe tip sau pe oră.'
    );
  }

  const ackSentence =
    kpi.avg_ack_time_s == null
      ? 'Niciun eveniment nu are încă o confirmare, deci timpul mediu de confirmare nu poate fi calculat.'
      : `Timpul mediu până la confirmare a fost ${kpi.avg_ack_time_s} s, ` +
        `calculat pe ${ackedCount} ${plural(ackedCount, 'eveniment confirmat', 'evenimente confirmate')}.`;

  const typeList = byType
    .filter((row) => row.count > 0)
    .map((row) => `${row.label} ${row.count}`)
    .join(', ');

  return (
    `${shift}: ${kpi.total_events} ${plural(kpi.total_events, 'eveniment', 'evenimente')}, ` +
    `${kpi.critical_events} ${plural(kpi.critical_events, 'critic', 'critice')} și ` +
    `${kpi.warning_events} ${plural(kpi.warning_events, 'avertisment', 'avertismente')}. ` +
    `${kpi.open_events} ${plural(kpi.open_events, 'incident este încă deschis', 'incidente sunt încă deschise')}, ` +
    `${kpi.escalated_events} ${plural(kpi.escalated_events, 'a escaladat', 'au escaladat')}, ` +
    `${kpi.acknowledged_events} ${plural(kpi.acknowledged_events, 'este confirmat', 'sunt confirmate')} ` +
    `și ${kpi.resolved_events} ${plural(kpi.resolved_events, 'este rezolvat', 'sunt rezolvate')}. ` +
    `${ackSentence} ` +
    `Incidente fără echipament PPE (tip NO_PPE): ${kpi.no_ppe_events}. ` +
    'Conformitatea PPE se măsoară pe toate detecțiile de persoane, nu pe incidente, ' +
    'așa că nu este derivată din această listă. ' +
    `Distribuție pe tipuri: ${typeList}.`
  );
}

/**
 * Compune raportul de tură din incidente.
 *
 * @param {Array<object>} [events] Incidentele din listă (contract `EventOut`).
 * @param {object} [options]
 * @param {number|Date} [options.now=Date.now()] Ceasul de referință, pentru ziua operațională.
 * @param {string} [options.shiftLabel] Eticheta turei, ex. `Tura 2 (Prânz: 14:00 - 22:00)`.
 * @param {string} [options.operationalDate] `YYYY-MM-DD`; altfel se derivă din `now`.
 * @returns {object} Raport cu `kpi`, `ppe`, `by_type`, `by_hour`, `by_zone` și `summary`.
 */
export function buildShiftReport(events, { now = Date.now(), shiftLabel, operationalDate } = {}) {
  const list = Array.isArray(events) ? events : [];
  const nowMs = parseMs(now) ?? Date.now();
  const rows = list.filter((event) => event !== null && typeof event === 'object');

  const kpi = {
    total_events: rows.length,
    critical_events: 0,
    warning_events: 0,
    avg_ack_time_s: null,
    open_events: 0,
    escalated_events: 0,
    acknowledged_events: 0,
    acked_events: 0,
    resolved_events: 0,
    false_positive_events: 0,
    no_ppe_events: 0,
  };

  const ackSeconds = [];
  const typeCounts = new Map();
  const hourBuckets = new Map();
  const zoneBuckets = new Map();

  for (const event of rows) {
    const type = groupType(event.type);
    const severity = event.severity;

    if (severity === 'CRITICAL') kpi.critical_events += 1;
    else if (severity === 'WARNING') kpi.warning_events += 1;

    if (event.status === 'open') kpi.open_events += 1;
    else if (event.status === 'escalated') kpi.escalated_events += 1;
    else if (event.status === 'acknowledged') kpi.acknowledged_events += 1;
    else if (event.status === 'resolved') kpi.resolved_events += 1;
    else if (event.status === 'false_positive') kpi.false_positive_events += 1;

    if (type === 'NO_PPE') kpi.no_ppe_events += 1;

    const detectedMs = parseMs(event.detected_at);
    const ackedMs = parseMs(event.acked_at);
    // O confirmare înainte de detecție e ceas stricat, nu o latență: nu o punem în medie.
    const ackDelta = detectedMs != null && ackedMs != null ? (ackedMs - detectedMs) / 1000 : null;
    const validAck = ackDelta != null && Number.isFinite(ackDelta) && ackDelta >= 0;
    if (validAck) ackSeconds.push(ackDelta);

    const typeRow = typeCounts.get(type) || { type, label: labelForType(type), count: 0, critical: 0, warning: 0 };
    typeRow.count += 1;
    if (severity === 'CRITICAL') typeRow.critical += 1;
    if (severity === 'WARNING') typeRow.warning += 1;
    typeCounts.set(type, typeRow);

    const zoneId = typeof event.zone_id === 'string' && event.zone_id.trim() ? event.zone_id : '—';
    const zoneRow = zoneBuckets.get(zoneId) || { zone: zoneId, critical: 0, warning: 0, acks: [] };
    if (severity === 'CRITICAL') zoneRow.critical += 1;
    if (severity === 'WARNING') zoneRow.warning += 1;
    if (validAck) zoneRow.acks.push(ackDelta);
    zoneBuckets.set(zoneId, zoneRow);

    if (detectedMs != null) {
      const hour = Number(hourFormatter.format(new Date(detectedMs)));
      const key = `${pad2(hour)}:00`;
      const bucket = hourBuckets.get(key) || { hour: key, events: 0, firstMs: detectedMs };
      bucket.events += 1;
      bucket.firstMs = Math.min(bucket.firstMs, detectedMs);
      hourBuckets.set(key, bucket);
    }
  }

  if (ackSeconds.length > 0) {
    kpi.avg_ack_time_s = Math.round(ackSeconds.reduce((sum, value) => sum + value, 0) / ackSeconds.length);
  }
  // Câte evenimente au o confirmare înregistrată, indiferent de statusul de acum: baza mediei.
  kpi.acked_events = ackSeconds.length;

  const byType = [...typeCounts.values()].sort((a, b) => {
    const orderA = KNOWN_TYPE_ORDER.indexOf(a.type);
    const orderB = KNOWN_TYPE_ORDER.indexOf(b.type);
    if (orderA !== orderB) return (orderA === -1 ? KNOWN_TYPE_ORDER.length : orderA) - (orderB === -1 ? KNOWN_TYPE_ORDER.length : orderB);
    return a.type.localeCompare(b.type);
  });

  // Doar orele care apar în date, nu o fereastră fixă de 6 ore: evenimentele din afara
  // turei nu sunt inventate, iar un grafic cu ore goale ar sugera altceva. Ordinea e
  // cronologică după primul eveniment al orei, ca trecerea peste miezul nopții să iasă corect.
  const byHour = [...hourBuckets.values()]
    .sort((a, b) => a.firstMs - b.firstMs)
    .map(({ hour, events: count }) => ({ hour, events: count }));

  const byZone = [...zoneBuckets.values()]
    .map(({ zone, critical, warning, acks }) => ({
      zone,
      critical,
      warning,
      // Fără confirmări în zonă nu există medie: `null`, nu media globală a turei.
      avg_ack_s: acks.length
        ? Math.round(acks.reduce((sum, value) => sum + value, 0) / acks.length)
        : null,
    }))
    .sort((a, b) => b.critical + b.warning - (a.critical + a.warning) || a.zone.localeCompare(b.zone));

  return {
    shift: typeof shiftLabel === 'string' && shiftLabel.trim() ? shiftLabel : 'Tură',
    date: typeof operationalDate === 'string' && operationalDate.trim()
      ? operationalDate
      : operationalDateAt(nowMs),
    // Textul e compus din cifrele de mai sus: în UI e etichetat „șablon", niciodată „AI".
    source: 'template',
    kpi,
    ppe: {
      // Doar incidentele de tip NO_PPE se pot număra din listă. Un procent de
      // conformitate ar cere toate detecțiile de persoane, care nu sunt aici.
      no_ppe_incidents: kpi.no_ppe_events,
    },
    by_type: byType,
    by_hour: byHour,
    by_zone: byZone,
    summary: buildSummary({ shiftLabel, kpi, byType, ackedCount: ackSeconds.length }),
  };
}
