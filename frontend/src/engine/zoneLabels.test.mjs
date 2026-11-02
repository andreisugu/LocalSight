// Tests for the zone label layout drawn on the processed frame.
//
// The module is pure: no canvas, no worker. Text width comes from a stub, which is what
// lets these tests pin the two QA findings without a browser:
// - the label must stay legible when the 1280 px frame is shown at ~349 px (QA F3);
// - two zones sharing a top vertex must not overprint (QA F4).
//
// The checks are geometric: font size for a given canvas width, the text budget and its
// ellipsis, the vertical collision ladder, and the frame clamp.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ZONE_LABEL_INACTIVE_SUFFIX,
  ZONE_LABEL_NAME_MAX_CHARS,
  ZONE_LABEL_PREFIX,
  ellipsizeText,
  layoutZoneLabels,
  rectanglesOverlap,
  topVertex,
  zoneLabelFontPx,
  zoneLabelName,
  zoneLabelText,
} from './zoneLabels.js';

const WIDTH = 1280;
const HEIGHT = 720;

/** Monospace-ish stub: 20 px per code point, independent of the font size. */
const measure = (text) => Array.from(text).length * 20;

function zone(topX, topY, overrides = {}) {
  return { id: 'zone', name: 'Platformă Stand 12', active: true, topX, topY, ...overrides };
}

function overlap(a, b) {
  return rectanglesOverlap(a, b);
}

describe('zoneLabelFontPx', () => {
  test('the processed 1280 px frame gets ~1/32 of its width', () => {
    // 40 px intrinsic → 10.9 px on a 375 px viewport (canvas displayed at ~349 px).
    assert.equal(zoneLabelFontPx(1280), 40);
    assert.equal(zoneLabelFontPx(1024), 32);
  });

  test('never smaller than the readable floor nor larger than the cap', () => {
    assert.equal(zoneLabelFontPx(320), 16);
    assert.equal(zoneLabelFontPx(2560), 56);
    assert.equal(zoneLabelFontPx(100), 16);
  });

  test('an unusable width returns 0 so nothing is drawn', () => {
    assert.equal(zoneLabelFontPx(0), 0);
    assert.equal(zoneLabelFontPx(-1280), 0);
    assert.equal(zoneLabelFontPx(Number.NaN), 0);
  });
});

describe('zoneLabelName', () => {
  test('prefers the name, falls back to the id and then to a placeholder', () => {
    assert.equal(zoneLabelName('  Motor stâng ', 'engine-left'), 'Motor stâng');
    assert.equal(zoneLabelName('', 'engine-left'), 'engine-left');
    assert.equal(zoneLabelName(undefined, undefined), '?');
    assert.equal(zoneLabelName('   ', '  '), '?');
  });

  test('accepts a numeric name instead of printing undefined', () => {
    assert.equal(zoneLabelName(12, 'zone-12'), '12');
  });
});

describe('ellipsizeText', () => {
  test('keeps a short text intact and cuts a long one with one ellipsis', () => {
    assert.equal(ellipsizeText('Stand 12', 26), 'Stand 12');
    const cut = ellipsizeText('x'.repeat(122), 26);
    assert.equal(Array.from(cut).length, 26);
    assert.ok(cut.endsWith('…'));
    assert.equal(cut.at(-2), 'x');
  });

  test('counts code points, never half a surrogate pair', () => {
    const cut = ellipsizeText('😀😀😀😀', 3);
    assert.equal(cut, '😀😀…');
  });

  test('a zero budget cannot throw', () => {
    assert.equal(ellipsizeText('abc', 0), '');
    assert.equal(ellipsizeText('', 0), '');
  });
});

describe('zoneLabelText', () => {
  test('prefixes the name and marks an inactive zone', () => {
    assert.equal(zoneLabelText({ name: 'Motor stâng' }), `${ZONE_LABEL_PREFIX}Motor stâng`);
    assert.equal(
      zoneLabelText({ name: 'Motor stâng', active: false }),
      `${ZONE_LABEL_PREFIX}Motor stâng${ZONE_LABEL_INACTIVE_SUFFIX}`,
    );
  });

  test('applies the character budget to the name, not to the state suffix', () => {
    const text = zoneLabelText({ name: 'z'.repeat(122), active: false });
    const name = text.slice(ZONE_LABEL_PREFIX.length, -ZONE_LABEL_INACTIVE_SUFFIX.length);
    assert.equal(Array.from(name).length, ZONE_LABEL_NAME_MAX_CHARS);
    assert.ok(name.endsWith('…'));
    assert.ok(text.endsWith(ZONE_LABEL_INACTIVE_SUFFIX));
  });

  test('the measured width can cut the name further but keeps the suffix', () => {
    // Room for ~30 code points at 20 px each, while prefix+name+suffix has 38.
    const text = zoneLabelText({
      name: 'Stand 12 — motor stâng',
      active: false,
      maxWidth: 620,
      measure,
    });
    assert.ok(measure(text) <= 620, `${measure(text)} px > 620 px`);
    assert.ok(text.startsWith(ZONE_LABEL_PREFIX));
    assert.ok(text.endsWith(ZONE_LABEL_INACTIVE_SUFFIX));
    assert.ok(text.includes('…'));
  });

  test('an empty name still yields a label', () => {
    assert.equal(zoneLabelText({}), `${ZONE_LABEL_PREFIX}?`);
    assert.equal(zoneLabelText({ id: 'engine-left' }), `${ZONE_LABEL_PREFIX}engine-left`);
  });
});

describe('topVertex', () => {
  test('takes the top-most vertex and breaks a tie to the left', () => {
    assert.deepEqual(topVertex([[0.4, 0.5], [0.2, 0.3], [0.6, 0.3]]), [0.2, 0.3]);
    assert.deepEqual(topVertex([[0.6, 0.3], [0.2, 0.3], [0.4, 0.5]]), [0.2, 0.3]);
  });
});

describe('layoutZoneLabels', () => {
  test('draws above the top vertex and inside the frame', () => {
    const [label] = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.5, 0.5)],
      measure,
    });
    assert.equal(label.text, `${ZONE_LABEL_PREFIX}Platformă Stand 12`);
    assert.equal(label.fontPx, 40);
    // The whole box sits above the vertex, with a small gap.
    assert.ok(label.y + label.height <= 0.5 * HEIGHT);
    // And inside the frame.
    assert.ok(label.x >= 0 && label.x + label.width <= WIDTH);
    assert.ok(label.y >= 0 && label.y + label.height <= HEIGHT);
  });

  test('clamps a label anchored at the right and top edges', () => {
    const [label] = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(1, 0)],
      measure,
    });
    assert.ok(label.x + label.width <= WIDTH);
    assert.ok(label.y >= 0);
    // No room above the vertex, so the box goes below it instead of off-frame.
    assert.ok(label.y >= 0 && label.y <= HEIGHT - label.height);
  });

  test('clamps a label anchored at the bottom edge', () => {
    const [label] = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.4, 1)],
      measure,
    });
    assert.ok(label.y >= 0 && label.y + label.height <= HEIGHT);
  });

  test('staggers two labels that share a top vertex instead of overprinting', () => {
    const labels = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.2, 0.5, { name: 'Suprapunere A' }), zone(0.2, 0.5, { name: 'Suprapunere B' })],
      measure,
    });
    assert.equal(labels.length, 2);
    assert.equal(overlap(labels[0], labels[1]), false);
    // One label height apart, both on the same side of the vertex.
    assert.ok(Math.abs(labels[0].y - labels[1].y) >= labels[0].height);
  });

  test('keeps three coincident labels apart', () => {
    const labels = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.3, 0.6), zone(0.3, 0.6), zone(0.3, 0.6)],
      measure,
    });
    assert.equal(labels.length, 3);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        assert.equal(overlap(labels[i], labels[j]), false, `labels ${i} and ${j} overlap`);
      }
    }
  });

  test('labels that do not touch keep their own row', () => {
    const labels = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.05, 0.5), zone(0.75, 0.5)],
      measure,
    });
    assert.equal(labels[0].y, labels[1].y);
  });

  test('keeps a very long name inside the frame with an ellipsis', () => {
    const [label] = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.1, 0.4, { name: 'Zonă cu un nume extrem de lung '.repeat(4) })],
      measure,
    });
    assert.ok(label.text.endsWith('…'));
    assert.ok(label.text.length < 60);
    assert.ok(label.x + label.width <= WIDTH);
  });

  test('an inactive label keeps its dimmed state in the returned geometry', () => {
    const labels = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.2, 0.5, { active: false })],
      measure,
    });
    assert.equal(labels[0].active, false);
    assert.ok(labels[0].text.endsWith(ZONE_LABEL_INACTIVE_SUFFIX));
  });

  test('no zones or an unusable canvas draws nothing', () => {
    assert.deepEqual(layoutZoneLabels({ width: WIDTH, height: HEIGHT, zones: [], measure }), []);
    assert.deepEqual(layoutZoneLabels({ width: 0, height: HEIGHT, zones: [zone(0.5, 0.5)], measure }), []);
    assert.deepEqual(layoutZoneLabels({ width: WIDTH, height: 0, zones: [zone(0.5, 0.5)], measure }), []);
    assert.deepEqual(layoutZoneLabels({ width: WIDTH, height: HEIGHT, zones: null, measure }), []);
  });

  test('a missing measure falls back to an approximate monospace width', () => {
    const [label] = layoutZoneLabels({ width: WIDTH, height: HEIGHT, zones: [zone(0.5, 0.5)] });
    assert.ok(label.width > 0);
    assert.ok(label.x + label.width <= WIDTH);
  });

  test('a valid zone beside a broken one still gets a label', () => {
    const labels = layoutZoneLabels({
      width: WIDTH,
      height: HEIGHT,
      zones: [zone(0.5, Number.NaN), zone(0.2, 0.5)],
      measure,
    });
    assert.equal(labels.length, 2);
    // NaN coordinates fall back to the top-centre anchor, still inside the frame.
    assert.ok(labels[0].x >= 0 && labels[0].x + labels[0].width <= WIDTH);
    assert.ok(labels[0].y >= 0 && labels[0].y + labels[0].height <= HEIGHT);
  });
});

describe('rectanglesOverlap', () => {
  test('detects touching and separate boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    assert.equal(rectanglesOverlap(a, { x: 5, y: 5, width: 10, height: 10 }), true);
    assert.equal(rectanglesOverlap(a, { x: 10, y: 0, width: 10, height: 10 }), false);
    assert.equal(rectanglesOverlap(a, { x: 0, y: 10, width: 10, height: 10 }), false);
    // A margin makes near boxes count as overlapping.
    assert.equal(rectanglesOverlap(a, { x: 11, y: 0, width: 10, height: 10 }, 2), true);
  });
});
