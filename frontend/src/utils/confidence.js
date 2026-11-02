// Formatting for the incident confidence badge. Kept pure so the rule is testable:
// the badge shows what the event actually carries and never fills a missing number with
// a plausible default (the inherited component printed 0.90 / 14 of 15 when data was
// missing, which is indistinguishable from a real measurement).

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * @param {{detector?: unknown, temporal?: {seen?: unknown, window?: unknown}}|string|null} confidence
 * @returns {{score: string|null, temporal: string|null, hasData: boolean, title: string}}
 */
export function formatConfidence(confidence) {
  // Legacy events (the pre-v2 contract) carried a single string; keep them readable
  // without pretending it is the new shape.
  if (typeof confidence === 'string') {
    const text = confidence.trim();
    return {
      score: text || null,
      temporal: null,
      hasData: Boolean(text),
      title: 'Încredere din contractul vechi (valoare unică).',
    };
  }

  if (!confidence || typeof confidence !== 'object') {
    return {
      score: null,
      temporal: null,
      hasData: false,
      title: 'Evenimentul nu are date de încredere.',
    };
  }

  const detector = isFiniteNumber(confidence.detector)
    && confidence.detector >= 0
    && confidence.detector <= 1
    ? confidence.detector.toFixed(2)
    : null;

  const seen = confidence.temporal?.seen;
  const window = confidence.temporal?.window;
  const temporal = Number.isInteger(seen) && Number.isInteger(window) && window > 0 && seen >= 0
    ? `${seen}/${window}`
    : null;

  return {
    score: detector,
    temporal,
    hasData: Boolean(detector || temporal),
    title: temporal
      ? 'Scorul detectorului și câte cadre din fereastră au susținut decizia.'
      : 'Scorul detectorului; fereastra temporală lipsește din eveniment.',
  };
}
