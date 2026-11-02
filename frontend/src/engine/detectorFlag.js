// Display names for the two shipped person detectors.
//
// The choice lives in browser settings (`engineSettings.js`); this module only turns the
// stored value into the label every surface prints, so the Live card, the sidebar footer
// and the System screen cannot disagree about which graph is running. Pure: no storage, no
// DOM, checked with `node --test`.
//
// Both graphs are the Apache-2.0 EfficientDet-Lite ONNX export; no other detector has a
// label or ships in this build.

export const PERSON_DETECTOR_LABELS = Object.freeze({
  efficientdet: 'EfficientDet-Lite0',
  'efficientdet-lite2': 'EfficientDet-Lite2',
});

/** Lite0 is the fast default; anything unknown reads as the default. */
export const DEFAULT_DETECTOR = 'efficientdet';

/**
 * @param {unknown} value stored detector id
 * @returns {string} the label of that detector, or the default's label when unknown
 */
export function detectorLabel(value) {
  return PERSON_DETECTOR_LABELS[value] ?? PERSON_DETECTOR_LABELS[DEFAULT_DETECTOR];
}
