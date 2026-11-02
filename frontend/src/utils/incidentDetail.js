// Pure logic for the incident detail screen.
//
// The component used to own the time formatting, the timeline, the action matrix and the
// report labels inline, which made every rule untestable. They live here instead, so the
// view renders values and the behaviour can be checked with `node --test`.

// `.js` extensions keep this file loadable by Node's test runner as well as Vite.
import { STATUS_TOKENS } from '../constants/theme.js';
import { canDo } from '../constants/eventActions.js';
import { TYPE_LABELS } from '../data/labels.js';
import { formatTime } from './time.js';

// The snapshot URL the in-browser engine writes when it has no frame yet. It is a marker,
// not a loadable resource, so it must never power a download link.
const PENDING_SNAPSHOT = 'blob:pending';

const UNKNOWN_STATUS_TOKEN = {
  bg: '#EEEEEE',
  text: '#222222',
  border: '#DDDDDD',
  label: 'Necunoscut',
};

// Same five timestamps the operator walks through after a detection. The last two carry a
// tone because escalation is bad news and an ack is the good ending.
const TIMELINE_STEPS = [
  { id: 'detected', label: 'Detecție', field: 'detected_at', tone: 'neutral' },
  { id: 'received', label: 'Primit', field: 'received_at', tone: 'neutral' },
  { id: 'notified', label: 'Notificat', field: 'notified_at', tone: 'neutral' },
  { id: 'escalated', label: 'Escaladat', field: 'escalated_at', tone: 'alert' },
  { id: 'acked', label: 'Confirmat', field: 'acked_at', tone: 'ok' },
];

const REPORT_FIELDS = [
  { key: 'what', label: 'CE:' },
  { key: 'where', label: 'UNDE:' },
  { key: 'when', label: 'CÂND:' },
  { key: 'severity_reason', label: 'SEVERITATE & RISC:' },
  { key: 'recommended_action', label: 'ACȚIUNE RECOMANDATĂ:' },
];

/**
 * The five timeline steps, in order, with their already-formatted times.
 *
 * @param {object|null|undefined} event
 * @returns {Array<{id: string, position: number, label: string, at: string|null,
 *   time: string, reached: boolean, tone: 'neutral'|'alert'|'ok'}>}
 */
export function buildTimeline(event) {
  const source = event || {};
  return TIMELINE_STEPS.map((step, index) => {
    const at = source[step.field] || null;
    return {
      id: step.id,
      position: index + 1,
      label: step.label,
      at,
      time: formatTime(at),
      reached: Boolean(at),
      // A tone only applies once that step actually happened; a pending ack is not green.
      tone: at ? step.tone : 'neutral',
    };
  });
}

/**
 * Which operator actions the backend accepts from this status, and which ones are
 * already in effect. Mirrors `canDo` in constants/eventActions.js.
 *
 * @param {object|null|undefined} event
 * @returns {{ack: boolean, falsePositive: boolean, reopen: boolean,
 *   acked: boolean, markedFalsePositive: boolean}}
 */
export function actionState(event) {
  const status = event?.status;
  return {
    ack: canDo('ack', status),
    falsePositive: canDo('false_positive', status),
    reopen: canDo('reopen', status),
    acked: status === 'acknowledged',
    markedFalsePositive: status === 'false_positive',
  };
}

/**
 * The report header says where the text came from: a real AI pass, the AI of the mock
 * fixtures, or the template written from the event itself. The browser has no LLM, so a
 * template report must never be labelled `AI`.
 *
 * @param {{source?: string}|null|undefined} report
 * @param {{mock?: boolean}} [options]
 * @returns {'AI'|'AI · demo'|'șablon'}
 */
export function reportSourceLabel(report, { mock = false } = {}) {
  if (report?.source !== 'llm') return 'șablon';
  return mock ? 'AI · demo' : 'AI';
}

/**
 * The one visible sentence under the report heading. The chip says who wrote the text; this
 * line says when, so `AI · demo` cannot be read as "a model ran just now". The static build
 * has no LLM at all, so a template report says so.
 *
 * @param {{source?: string}|null|undefined} report
 * @param {{mock?: boolean}} [options]
 * @returns {string}
 */
export function reportSourceNote(report, { mock = false } = {}) {
  const label = reportSourceLabel(report, { mock });
  if (label === 'AI · demo') {
    return 'Scris în avans pentru demo, în backendul de referință; nu a fost generat acum și niciun LLM nu rulează în browser.';
  }
  if (label === 'AI') return 'Raport scris de un model AI la ingest.';
  return 'Text compus din șablonul incidentului; în browser nu rulează niciun LLM.';
}

/**
 * The retry button only exists where an AI could answer. The static build has no backend,
 * so it stays hidden there; elsewhere it shows when the ingest wrote a template report.
 *
 * @param {object|null|undefined} event
 * @param {{mock?: boolean}} [options]
 * @returns {boolean}
 */
export function shouldOfferReportRetry(event, { mock = false } = {}) {
  if (mock) return false;
  return !event?.report || event.report.source !== 'llm';
}

/**
 * Copy the deep link, reporting whether the clipboard accepted it. The writer is injected
 * so the failure path (no permission, insecure context, no Clipboard API) is testable.
 *
 * @param {string} url
 * @param {(text: string) => Promise<void>} write
 * @returns {Promise<boolean>}
 */
export async function copyIncidentLink(url, write) {
  try {
    await write(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the evidence can be downloaded. `blob:pending` is a marker, not a picture, and
 * mock fixtures use same-origin stills the browser can save like any other URL.
 *
 * @param {object|null|undefined} event
 * @returns {{url: string, fileName: string, downloadable: boolean}}
 */
export function snapshotDownload(event) {
  const url = event?.snapshot_url || '';
  return {
    url,
    fileName: `${event?.event_id || 'incident'}.jpg`,
    downloadable: Boolean(url) && url !== PENDING_SNAPSHOT,
  };
}

/**
 * Which provenance chips the header shows: a local engine detection, a simulated event, a
 * demo fixture, or none. They are exclusive: a fixture is not local and not simulated, and
 * an event the Simulare menu created is demo data, not a camera.
 *
 * @param {object|null|undefined} event
 * @param {{mock?: boolean}} [options]
 * @returns {{local: boolean, simulated: boolean, demo: boolean}}
 */
export function sourceChips(event, { mock = false } = {}) {
  const local = Boolean(event?.local);
  const simulated = event?.simulated === true;
  return { local, simulated, demo: Boolean(mock) && !local && !simulated };
}

// Status and severity share one token table (`theme/status.js`) and one fallback: a value
// outside the contract keeps its raw text and a neutral style instead of hiding the row.
function contractToken(value) {
  return STATUS_TOKENS[value] || { ...UNKNOWN_STATUS_TOKEN, label: value || UNKNOWN_STATUS_TOKEN.label };
}

/** Status token (colours and Romanian label), with the neutral fallback above. */
export const statusToken = contractToken;

/** Severity token (the same table), with the same fallback. */
export const severityToken = contractToken;

/**
 * The five report fields in reading order, with the honest fallback for a missing value.
 *
 * @param {{[key: string]: unknown}|null|undefined} report
 * @returns {Array<{key: string, label: string, value: string}>}
 */
export function reportFields(report) {
  return REPORT_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: report?.[field.key] || 'necunoscut',
  }));
}

/** The model and track line under the incident id. */
export function detectionSummary(event) {
  const model = event?.model || '—';
  const track = event?.track_id ?? '—';
  return `Model detecție: ${model} • Track ID: #${track}`;
}

/**
 * The human title of the detail screen: the incident type the contract defines, never the
 * synthetic event id (that stays visible as the mono meta line).
 *
 * @param {object|null|undefined} event
 * @returns {string}
 */
export function incidentTitle(event) {
  return TYPE_LABELS[event?.type] || event?.type || 'Incident';
}

/**
 * Text alternative for the evidence frame (A20): what the picture is, which camera and zone
 * it belongs to, and that the faces were blurred.
 *
 * @param {object|null|undefined} event
 * @returns {string}
 */
export function snapshotAlt(event, { safetyBlur = true } = {}) {
  const camera = event?.camera_id || 'camera necunoscută';
  const zone = event?.zone_id || 'zonă necunoscută';
  const blur = safetyBlur
    ? 'fețele sunt blurate.'
    : 'fețele detectate sunt blurate; blurul de siguranță pe cap este oprit.';
  return `Cadru din momentul incidentului: camera ${camera}, zona ${zone}; ${blur}`;
}

/** Caption on the evidence frame; the blur happened in the tab only for engine incidents. */
export function snapshotCaption(event, { safetyBlur = true } = {}) {
  if (!event?.local) return 'Momentul incidentului • fețe blurate';
  return safetyBlur
    ? 'Momentul incidentului • fețe blurate în browser'
    : 'Momentul incidentului • fețe detectate blurate · blur de siguranță oprit';
}
