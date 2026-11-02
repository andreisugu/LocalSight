// The demo shift: eight incidents across three camera feeds.
//
// Two are still open, two escalated, three were confirmed and one was resolved — the mix
// the Live feed, the incident list and the shift report are built to show. Times are
// relative to the page load (`FIXTURE_WINDOW`); identifiers are not (`fixtureEventId`).
// The prose is written per incident so the detail screen has a real report to show, and
// `report.when` is composed from `detected_at` instead of being typed by hand.

import { formatTime } from '../utils/time.js';
import { roDecimal, SECOND_MS } from './clock.js';
import { fixtureEventId } from './eventIds.js';
import { DEMO_STILLS } from './media.js';
import { FIXTURE_WINDOW } from './shift.js';

/** Receipt and notification are a few hundred ms after detection, as on the edge. */
const RECEIVE_BASE_MS = 180;
const RECEIVE_STEP_MS = 25;
const NOTIFY_BASE_MS = 800;
const NOTIFY_STEP_MS = 90;

/** The temporal confidence window the detector reports with every event. */
const TEMPORAL_WINDOW = 15;

// `age` is the fraction of the shift window before now; `null` means "the newest one",
// anchored just before the page load. Order matters: it fixes the stable id suffix.
const SHIFT_INCIDENTS = [
  {
    age: null,
    camera: 'stand12',
    zone: 'engine-left',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    track: 17,
    durationS: 2.6,
    engineOn: true,
    status: 'open',
    escalateAfterS: 120,
    detector: 0.93,
    seen: 14,
    ackedBy: null,
    ackSeconds: null,
    narrative: {
      what: 'Un tehnician a intrat în raza motorului stâng cu motorul pornit și a rămas în zonă 2,6 s, la circa 4 m de nacelă.',
      where: 'Stand 12, zona engine-left, între motorul stâng și roata din față.',
      severityReason: 'Motorul funcționa în idle; risc de ingestie și jet blast în raza de 7 m.',
      recommendedAction:
        'Contactează imediat echipa de la sol pe canalul TETRA 3 și oprește accesul la Stand 12 până la confirmarea zonei libere.',
    },
  },
  {
    age: 0.14,
    camera: 'taxiway-b',
    zone: 'taxiway-b',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    track: 23,
    durationS: 6.2,
    engineOn: false,
    status: 'escalated',
    escalateAfterS: 30,
    detector: 0.91,
    seen: 15,
    ackedBy: null,
    ackSeconds: null,
    narrative: {
      what: 'Un muncitor de rampă a traversat banda de siguranță a Taxiway B în timp ce o aeronavă se afla în rulare spre 08R.',
      where: 'Taxiway B, segmentul de lângă linia de așteptare a pistei 08R.',
      severityReason:
        'Traversare neautorizată în fața unei aeronave în rulare; risc de coliziune la sol.',
      recommendedAction:
        'Verifică înregistrarea cu turnul și instruiește echipa de rampă; zona rămâne închisă până la sosirea supraveghetorului.',
    },
  },
  {
    age: 0.26,
    camera: 'baggage-area',
    zone: 'baggage-area',
    type: 'NO_PPE',
    severity: 'WARNING',
    track: 41,
    durationS: 12.4,
    engineOn: false,
    status: 'open',
    escalateAfterS: null,
    detector: 0.89,
    seen: 13,
    ackedBy: null,
    ackSeconds: null,
    narrative: {
      what: 'Un operator de bandă a lucrat la conveyor fără vestă hi-vis, cu spatele la culoarul de întoarcere al remorcii.',
      where: 'Zona bagaje, banda 2 de triere, lângă poarta de încărcare.',
      severityReason:
        'Operatorul nu e vizibil pentru șoferii de GSE care intră pe banda de triere.',
      recommendedAction:
        'Cheamă operatorul la punctul de control și reia procedura de echipare înainte de a reveni la bandă.',
    },
  },
  {
    age: 0.39,
    camera: 'stand12',
    zone: 'apron-stand12',
    type: 'NO_PPE',
    severity: 'WARNING',
    track: 12,
    durationS: 8.1,
    engineOn: true,
    status: 'acknowledged',
    escalateAfterS: 60,
    detector: 0.87,
    seen: 12,
    ackedBy: 'Dispecer',
    ackSeconds: 34,
    narrative: {
      what: 'Un tehnician de mentenanță a intrat pe platforma Stand 12 fără cască de protecție, având doar vestă hi-vis.',
      where: 'Stand 12, platforma de deservire (zona apron-stand12).',
      severityReason: 'În zonă circulă GSE și se lucrează la înălțime; casca este obligatorie.',
      recommendedAction:
        'Trimite un reminder pe radio și notează abaterea pentru briefing-ul de la schimbul de tură.',
    },
  },
  {
    age: 0.52,
    camera: 'taxiway-b',
    zone: 'taxiway-b',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    track: 28,
    durationS: 3.8,
    engineOn: false,
    status: 'resolved',
    escalateAfterS: 30,
    detector: 0.95,
    seen: 15,
    ackedBy: 'Șef tură',
    ackSeconds: 22,
    narrative: {
      what: 'Un agent de handling a pășit peste linia de așteptare în timp ce aeronava YR-BMA se pregătea de rulare.',
      where: 'Taxiway B, intersecția cu banda de deservire a standurilor 10–14.',
      severityReason: 'Aeronava se afla la circa 30 m de zona de conflict, cu motorul pornit.',
      recommendedAction:
        'Oprește rularea până la eliberarea benzii și confirmă cu turnul că traseul e liber.',
    },
  },
  {
    age: 0.66,
    camera: 'stand12',
    zone: 'apron-stand12',
    type: 'NO_PPE',
    severity: 'WARNING',
    track: 9,
    durationS: 6.5,
    engineOn: true,
    status: 'acknowledged',
    escalateAfterS: 60,
    detector: 0.9,
    seen: 14,
    ackedBy: 'Șef tură',
    ackSeconds: 51,
    narrative: {
      what: 'Doi lucrători au descărcat bagaje la Stand 12 fără apărători auditive, la 12 m de APU pornit.',
      where: 'Stand 12, platforma de deservire, în spatele aripii drepte.',
      severityReason:
        'Nivel sonor peste 105 dB la APU pornit; expunerea prelungită afectează auzul.',
      recommendedAction:
        'Avertizează echipa și distribuie apărători auditive din trusa de la poarta 12.',
    },
  },
  {
    age: 0.82,
    camera: 'baggage-area',
    zone: 'baggage-area',
    type: 'NO_PPE',
    severity: 'WARNING',
    track: 55,
    durationS: 9.7,
    engineOn: false,
    status: 'acknowledged',
    escalateAfterS: null,
    detector: 0.86,
    seen: 12,
    ackedBy: 'Dispecer',
    ackSeconds: 64,
    narrative: {
      what: 'Un operator a intrat în zona benzii de triere fără vestă hi-vis, în timp ce tractorul de bagaje se apropia.',
      where: 'Zona bagaje, culoarul dintre banda 1 și rampa de încărcare.',
      severityReason:
        'Operatorul nu era vizibil pentru șoferul tractorului; risc de accident pietonal.',
      recommendedAction:
        'Oprește tractorul, verifică echiparea și reia ciclul de încărcare după confirmarea vestei.',
    },
  },
  {
    age: 1,
    camera: 'stand12',
    zone: 'engine-left',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    track: 14,
    durationS: 4.9,
    engineOn: true,
    status: 'escalated',
    escalateAfterS: 120,
    detector: 0.94,
    seen: 15,
    ackedBy: null,
    ackSeconds: null,
    narrative: {
      what: 'Un muncitor a intrat în zona motorului stâng pentru a recupera un con de semnalizare, cu motorul pornit.',
      where: 'Stand 12, zona engine-left, la 3 m de admisia turbinei.',
      severityReason: 'Recuperarea unui con din raza de aspirație, cu motorul în funcțiune.',
      recommendedAction:
        'Oprește APU-ul, recuperează conul doar cu motorul oprit și instruiește echipa de rampă.',
    },
  },
];

/**
 * Turn one incident spec into the event envelope the UI reads.
 *
 * `index` only feeds the stable id; the timestamps come from the shift window, so the
 * list looks like a live shift whenever the page is opened.
 */
function buildEvent(spec, index) {
  const detectedAt =
    spec.age == null ? FIXTURE_WINDOW.newestDetectedAt : FIXTURE_WINDOW.ageAt(spec.age);
  const detectedMs = detectedAt.getTime();
  const receivedMs = detectedMs + RECEIVE_BASE_MS + (spec.track % 6) * RECEIVE_STEP_MS;
  const notifiedMs = receivedMs + NOTIFY_BASE_MS + (spec.track % 7) * NOTIFY_STEP_MS;
  const ackedMs = spec.ackSeconds == null ? null : detectedMs + spec.ackSeconds * SECOND_MS;
  const escalatedMs =
    spec.status === 'escalated' && spec.escalateAfterS != null
      ? detectedMs + spec.escalateAfterS * SECOND_MS
      : null;

  return {
    event_id: fixtureEventId(spec.camera, index, spec.track),
    type: spec.type,
    severity: spec.severity,
    camera_id: spec.camera,
    zone_id: spec.zone,
    track_id: spec.track,
    confidence: {
      detector: spec.detector,
      temporal: { seen: spec.seen, window: TEMPORAL_WINDOW },
    },
    duration_s: spec.durationS,
    context: { engine_on: spec.engineOn },
    snapshot_url: DEMO_STILLS[spec.camera],
    model: 'person-ppe-v1',
    detected_at: detectedAt.toISOString(),
    status: spec.status,
    received_at: new Date(receivedMs).toISOString(),
    notified_at: new Date(notifiedMs).toISOString(),
    escalated_at: escalatedMs == null ? null : new Date(escalatedMs).toISOString(),
    escalate_after_s: spec.escalateAfterS,
    acked_at: ackedMs == null ? null : new Date(ackedMs).toISOString(),
    acked_by: spec.ackedBy,
    report: {
      what: spec.narrative.what,
      where: spec.narrative.where,
      when: `${formatTime(detectedAt)}, timp în zonă ${roDecimal(spec.durationS)} s.`,
      severity_reason: spec.narrative.severityReason,
      recommended_action: spec.narrative.recommendedAction,
      source: 'llm',
    },
  };
}

/** Newest first, the order the Live feed and the incident list show. */
export const INITIAL_EVENTS = SHIFT_INCIDENTS.map(buildEvent).sort(
  (a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at)
);
