// Pure rules behind the coverage sample store: the accepted shape and the memory cap.
// The provider wiring itself is exercised by the browser acceptance run, not here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_COVERAGE_SAMPLES,
  appendCoverageSample,
  normalizeCoverageSample,
} from './useCoverageSamples.js';

describe('coverage samples', () => {
  it('accepts the local and the contract camera key, and trims the id', () => {
    assert.deepEqual(normalizeCoverageSample({ cameraId: ' stand12 ', at: 5, status: 'LIVE' }), {
      cameraId: 'stand12',
      at: 5,
      status: 'live',
    });
    assert.deepEqual(normalizeCoverageSample({ camera_id: 'taxiway-b', at: 6, status: 'hidden' }), {
      cameraId: 'taxiway-b',
      at: 6,
      status: 'hidden',
    });
  });

  it('rejects everything the coverage model cannot read', () => {
    for (const sample of [
      null,
      [],
      {},
      { cameraId: '', at: 1, status: 'live' },
      { cameraId: 'stand12', at: '1', status: 'live' },
      { cameraId: 'stand12', at: NaN, status: 'live' },
      { cameraId: 'stand12', at: 1, status: 'verifying' },
      { cameraId: 'stand12', at: 1 },
    ]) {
      assert.equal(normalizeCoverageSample(sample), null);
    }
  });

  it('appends valid samples and leaves the list untouched on invalid input', () => {
    const base = [{ cameraId: 'stand12', at: 1, status: 'live' }];
    assert.equal(appendCoverageSample(base, { cameraId: '', at: 2, status: 'live' }), base);
    const next = appendCoverageSample(base, { cameraId: 'stand12', at: 2, status: 'hidden' });
    assert.equal(next.length, 2);
    assert.deepEqual(next[1], { cameraId: 'stand12', at: 2, status: 'hidden' });
    assert.equal(base.length, 1, 'the input list is never mutated');
  });

  it('caps at the documented bound and keeps the newest sample', () => {
    const samples = Array.from({ length: MAX_COVERAGE_SAMPLES }, (_, index) => ({
      cameraId: 'stand12',
      at: index,
      status: 'live',
    }));
    const capped = appendCoverageSample(samples, { cameraId: 'stand12', at: 999_999, status: 'live' });
    assert.equal(capped.length, MAX_COVERAGE_SAMPLES);
    assert.equal(capped[0].at, 1, 'the oldest sample is the one that goes');
    assert.equal(capped[capped.length - 1].at, 999_999);
  });
});
