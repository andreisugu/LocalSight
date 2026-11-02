import test from 'node:test';
import assert from 'node:assert/strict';
import { formatConfidence } from './confidence.js';

test('formats the contract shape exactly', () => {
  const out = formatConfidence({ detector: 0.93, temporal: { seen: 14, window: 15 } });
  assert.equal(out.score, '0.93');
  assert.equal(out.temporal, '14/15');
  assert.equal(out.hasData, true);
});

test('never invents a score when the field is missing', () => {
  const out = formatConfidence({ temporal: { seen: 5, window: 5 } });
  assert.equal(out.score, null);
  assert.equal(out.temporal, '5/5');
  assert.equal(out.hasData, true);
});

test('never invents a temporal window when it is missing', () => {
  const out = formatConfidence({ detector: 0.6 });
  assert.equal(out.score, '0.60');
  assert.equal(out.temporal, null);
  assert.equal(out.hasData, true);
});

test('empty or invalid confidence has no data at all', () => {
  for (const value of [null, undefined, {}, '   ', 42, { detector: 7 }, { detector: Number.NaN }]) {
    const out = formatConfidence(value);
    assert.equal(out.hasData, false, `for ${JSON.stringify(value)}`);
    assert.equal(out.score, null);
    assert.equal(out.temporal, null);
  }
});

test('window zero or fractional is rejected instead of printed', () => {
  assert.equal(formatConfidence({ temporal: { seen: 3, window: 0 } }).temporal, null);
  assert.equal(formatConfidence({ temporal: { seen: 3, window: 4.5 } }).temporal, null);
  assert.equal(formatConfidence({ temporal: { seen: -1, window: 15 } }).temporal, null);
});

test('legacy string events stay readable', () => {
  const out = formatConfidence('0.91');
  assert.equal(out.score, '0.91');
  assert.equal(out.temporal, null);
  assert.equal(out.hasData, true);
});
