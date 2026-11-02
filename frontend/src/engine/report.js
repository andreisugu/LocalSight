// Template report for an incident produced by the in-tab engine.
//
// The browser has no LLM and no backend, so the report is written from the event's own
// fields as the reference backend does when the AI pass is unavailable. The incident detail
// labels it `șablon` (see `IncidentDetailView`), never `AI`: it explains what the rule saw,
// it does not invent a narrative.

const TYPE_COPY = {
  RESTRICTED_ZONE: {
    what: (zone) => `Persoană în zona restricționată ${zone}.`,
    reason: (event, zone) =>
      `Prezență continuă ${seconds(event.duration_s)} în ${zone}, peste fereastra regulii.`,
    action: 'Verifică zona și îndepărtează persoana dacă nu are autorizare.',
  },
  NO_PPE: {
    what: (zone) => `Persoană fără vestă hi-vis în ${zone}.`,
    reason: (event) => `Vesta hi-vis nu a fost detectată timp de ${seconds(event.duration_s)}.`,
    action: 'Oprește activitatea până la confirmarea echipamentului de protecție.',
  },
  SMOKING: {
    what: (zone) => `Fumat detectat în ${zone}.`,
    reason: (event) => `Gestul de fumat a persistat ${seconds(event.duration_s)}.`,
    action: 'Intervine imediat; zona este interzisă fumatului.',
  },
  CAMERA_OFFLINE: {
    what: (zone) => `Cameră offline pentru ${zone}.`,
    reason: () => 'Fluxul video nu a mai produs cadre în fereastra regulii.',
    action: 'Verifică sursa video și reluați streamul.',
  },
};

const FALLBACK = {
  what: (zone) => `Eveniment de siguranță în ${zone}.`,
  reason: (event) => `Regula a fost îndeplinită timp de ${seconds(event.duration_s)}.`,
  action: 'Verifică zona în fluxul camerei.',
};

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} s` : '—';
}

function timeOf(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * @param {object} event pipeline event (`type`, `duration_s`, `detected_at`, ids…)
 * @param {{ cameraName?: string, zoneName?: string }} [names] resolved from the UI lists
 * @returns {object|null} report shaped like the contract's `report` field
 */
export function templateReport(event, { cameraName, zoneName } = {}) {
  if (!event || typeof event !== 'object') return null;
  const copy = TYPE_COPY[event.type] || FALLBACK;
  const zone = zoneName || event.zone_id || 'zona configurată';
  const camera = cameraName || event.camera_id || 'camera';
  return {
    what: copy.what(zone),
    where: `${camera} • ${zone}`,
    when: `${timeOf(event.detected_at)}; ${seconds(event.duration_s)} în zonă.`,
    severity_reason: copy.reason(event, zone),
    recommended_action: copy.action,
    source: 'template',
  };
}
