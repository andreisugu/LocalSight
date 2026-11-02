// Display names for the shipped person detectors: EfficientDet-Lite0 (default) or Lite2.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DETECTOR, PERSON_DETECTOR_LABELS, detectorLabel } from './detectorFlag.js';

test('the default names EfficientDet-Lite0', () => {
  assert.equal(DEFAULT_DETECTOR, 'efficientdet');
  assert.equal(detectorLabel(DEFAULT_DETECTOR), 'EfficientDet-Lite0');
  assert.equal(detectorLabel(undefined), 'EfficientDet-Lite0');
  assert.equal(detectorLabel(null), 'EfficientDet-Lite0');
});

test('both choices have a truthful display name and no YOLO entry', () => {
  assert.deepEqual(Object.keys(PERSON_DETECTOR_LABELS).sort(), ['efficientdet', 'efficientdet-lite2']);
  assert.equal(PERSON_DETECTOR_LABELS.efficientdet, 'EfficientDet-Lite0');
  assert.equal(PERSON_DETECTOR_LABELS['efficientdet-lite2'], 'EfficientDet-Lite2');
  assert.equal(detectorLabel('efficientdet-lite2'), 'EfficientDet-Lite2');
});

test('an unknown value falls back to the default label instead of guessing', () => {
  for (const value of ['yolo', 'yolo26n', 'efficientdet-lite1', 'EfficientDet', 0, true]) {
    assert.equal(detectorLabel(value), 'EfficientDet-Lite0', `value ${String(value)}`);
  }
});
