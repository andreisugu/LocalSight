// The `?detector=` spike flag: YOLO26n unless one of the two EfficientDet values is given.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PERSON_DETECTOR_LABELS, readDetectorFlag } from './detectorFlag.js';

test('readDetectorFlag keeps YOLO for absent, unknown and malformed values', () => {
  assert.equal(readDetectorFlag(''), 'yolo');
  assert.equal(readDetectorFlag('?'), 'yolo');
  assert.equal(readDetectorFlag('?detector='), 'yolo');
  assert.equal(readDetectorFlag('?detector=yolo'), 'yolo');
  assert.equal(readDetectorFlag('?detector=EfficientDet'), 'yolo');
  assert.equal(readDetectorFlag('?detector=efficientdet-lite1'), 'yolo');
});

test('readDetectorFlag accepts the two EfficientDet flags', () => {
  assert.equal(readDetectorFlag('?detector=efficientdet'), 'efficientdet');
  assert.equal(readDetectorFlag('?a=1&detector=efficientdet-lite2'), 'efficientdet-lite2');
});

test('every detector has a truthful display name', () => {
  assert.equal(PERSON_DETECTOR_LABELS.yolo, 'YOLO26n');
  assert.equal(PERSON_DETECTOR_LABELS.efficientdet, 'EfficientDet-Lite0');
  assert.equal(PERSON_DETECTOR_LABELS['efficientdet-lite2'], 'EfficientDet-Lite2');
});
