import test from 'node:test';
import assert from 'node:assert/strict';
import { PILL_TONES, PILL_VARIANTS, toneClass } from './tone.js';

test('every declared tone has a solid and a soft class', () => {
  for (const tone of PILL_TONES) {
    for (const variant of PILL_VARIANTS) {
      const value = toneClass(tone, variant);
      assert.equal(typeof value, 'string', `${tone}/${variant} must be a string`);
      assert.ok(value.length > 0, `${tone}/${variant} must not be empty`);
    }
  }
});

test('unknown tones and variants fall back to readable neutral classes', () => {
  assert.equal(toneClass('not-a-tone'), toneClass('neutral'));
  assert.equal(toneClass('danger', 'not-a-variant'), toneClass('danger', 'solid'));
});

test('danger and warning keep the product signal colours', () => {
  assert.match(toneClass('danger'), /#D73833/);
  assert.match(toneClass('warning'), /#FFEB33/);
});
