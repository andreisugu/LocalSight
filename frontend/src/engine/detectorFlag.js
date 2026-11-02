// Spike-only person-detector flag (`?detector=`).
//
// Two places describe the running graph: LiveView selects it for the worker, and the
// sidebar footer names what runs in the tab. Reading it through one helper keeps the two
// from disagreeing, and keeps YOLO26n the answer for an absent flag or a typo.
//
// The router rewrites the path to `/live` after the first render, which drops the query
// string; callers that must survive that read the flag once at module/first-render time.

export const PERSON_DETECTOR_LABELS = Object.freeze({
  yolo: 'YOLO26n',
  efficientdet: 'EfficientDet-Lite0',
  'efficientdet-lite2': 'EfficientDet-Lite2',
});

/**
 * @param {string} [search] `location.search` override; empty in Node tests.
 * @returns {'yolo'|'efficientdet'|'efficientdet-lite2'}
 */
export function readDetectorFlag(search) {
  const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const value = new URLSearchParams(query).get('detector');
  return value === 'efficientdet' || value === 'efficientdet-lite2' ? value : 'yolo';
}
