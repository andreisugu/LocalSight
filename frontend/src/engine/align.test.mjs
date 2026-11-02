// Tests for the zone aligner. Every case is synthetic and deterministic: a textured scene is
// generated from a seeded PRNG, warped with a known homography through a bilinear sampler,
// and the recovered polygons are compared with the ground truth in pixels at 640 px width.
//
// What can actually go wrong here, and is therefore tested:
// - a subpixel-inaccurate homography (corner error, not "looks aligned");
// - a wrong answer on an untextured or unrelated frame (must be `null`, never a guess);
// - a degenerate matrix accepted as a camera move;
// - the cadence drifting, so the frame budget is blown or a lost view is silently reused;
// - state that reset or a camera change does not clear.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ZoneAligner, invertHomography, isPlausibleHomography } from './align.js';

const WIDTH = 640;
const HEIGHT = 360;

/** Deterministic PRNG for the fixture images (mulberry32, same family as the module's). */
function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An apron-like texture: gradient background, rectangles, circles, a coarse grid and light
 * per-pixel noise. Corners are spread over the whole frame, which is what a homography
 * needs to be accurate at the frame edges.
 */
function makeScene(width, height, seed) {
  const data = new Uint8ClampedArray(width * height * 4);
  const random = createRandom(seed);
  const put = (x, y, value) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  };

  for (let y = 0; y < height; y += 1) {
    const base = 88 + Math.round((y / height) * 56);
    for (let x = 0; x < width; x += 1) {
      put(x, y, base + Math.round((random() - 0.5) * 10));
    }
  }
  for (let index = 0; index < 150; index += 1) {
    const left = Math.floor(random() * width);
    const top = Math.floor(random() * height);
    const boxWidth = 7 + Math.floor(random() * 44);
    const boxHeight = 7 + Math.floor(random() * 44);
    const value = 28 + Math.floor(random() * 196);
    for (let y = 0; y < boxHeight; y += 1) {
      for (let x = 0; x < boxWidth; x += 1) put(left + x, top + y, value);
    }
  }
  for (let index = 0; index < 70; index += 1) {
    const centerX = Math.floor(random() * width);
    const centerY = Math.floor(random() * height);
    const radius = 3 + Math.floor(random() * 7);
    const value = 24 + Math.floor(random() * 200);
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (x * x + y * y <= radius * radius) put(centerX + x, centerY + y, value);
      }
    }
  }
  for (let x = 13; x < width; x += 48) {
    for (let y = 0; y < height; y += 1) put(x, y, 232);
    for (let y = 0; y < height; y += 1) put(x + 1, y, 232);
  }
  for (let y = 11; y < height; y += 48) {
    for (let x = 0; x < width; x += 1) put(x, y, 232);
    for (let x = 0; x < width; x += 1) put(x, y + 1, 232);
  }
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = data[offset] + Math.round((random() - 0.5) * 12);
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
  return { data, width, height };
}

/** Flat RGBA frame with one luminance, for the "no features" cases. */
function makeSolid(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

/** Uniform noise: lots of corners, no structure, so no correct homography exists. */
function makeNoise(width, height, seed) {
  const random = createRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = Math.floor(random() * 256);
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

/** Row-major 3x3 product, independent of the module under test. */
function multiply(a, b) {
  const out = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        out[row * 3 + column] += a[row * 3 + inner] * b[inner * 3 + column];
      }
    }
  }
  return out;
}

/** Row-major 3x3 inverse via the adjugate, independent of the module under test. */
function invertMatrix(h) {
  const [a, b, c, d, e, f, g, i, j] = h;
  const determinant = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  assert.ok(Math.abs(determinant) > 1e-12, 'test fixture homography must be invertible');
  return [
    (e * j - f * i) / determinant,
    (c * i - b * j) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * j) / determinant,
    (a * j - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * i - e * g) / determinant,
    (b * g - a * i) / determinant,
    (a * e - b * d) / determinant,
  ];
}

function translationPixels(tx, ty) {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

function scaleAboutPixels(scale, centerX, centerY) {
  return [
    scale, 0, centerX - scale * centerX,
    0, scale, centerY - scale * centerY,
    0, 0, 1,
  ];
}

function rotationAboutPixels(angle, centerX, centerY) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Clockwise in screen coordinates (y grows downwards).
  return [
    cos, -sin, centerX - cos * centerX + sin * centerY,
    sin, cos, centerY - sin * centerX - cos * centerY,
    0, 0, 1,
  ];
}

/** Pixel-space homography -> normalized-space homography (both axes 0..1). */
function normalizedFromPixels(h, width, height) {
  const toPixels = [width, 0, 0, 0, height, 0, 0, 0, 1];
  const toNormalized = [1 / width, 0, 0, 0, 1 / height, 0, 0, 0, 1];
  return multiply(multiply(toNormalized, h), toPixels);
}

/** Apply a homography to one normalized point. */
function applyHomography(h, [x, y]) {
  const denominator = h[6] * x + h[7] * y + h[8];
  return [
    (h[0] * x + h[1] * y + h[2]) / denominator,
    (h[3] * x + h[4] * y + h[5]) / denominator,
  ];
}

/**
 * Render `source` through one pixel-space homography with bilinear sampling. Pixels that
 * map outside the source become a near-black apron edge, like a real pan would show.
 */
function warp(source, h, width, height) {
  const inverse = invertMatrix(h);
  const out = new Uint8ClampedArray(width * height * 4);
  const data = source.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = inverse[6] * x + inverse[7] * y + inverse[8];
      const u = (inverse[0] * x + inverse[1] * y + inverse[2]) / denominator;
      const v = (inverse[3] * x + inverse[4] * y + inverse[5]) / denominator;
      const offset = (y * width + x) * 4;
      if (!(u >= 0 && v >= 0 && u <= width - 1.001 && v <= height - 1.001)) {
        out[offset] = 8;
        out[offset + 1] = 8;
        out[offset + 2] = 8;
        out[offset + 3] = 255;
        continue;
      }
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const fx = u - x0;
      const fy = v - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const topLeft = data[(y0 * width + x0) * 4 + channel];
        const topRight = data[(y0 * width + x1) * 4 + channel];
        const bottomLeft = data[(y1 * width + x0) * 4 + channel];
        const bottomRight = data[(y1 * width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * fx;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
        out[offset + channel] = top + (bottom - top) * fy;
      }
      out[offset + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** One zone drawn on the reference frame, in normalized coordinates. */
const ZONE = {
  id: 'engine-zone',
  camera_id: 'cam-1',
  name: 'Motor',
  rule_type: 'RESTRICTED',
  active_when: 'always',
  severity: 'WARNING',
  debounce_s: 1.0,
  polygon: [
    [0.08, 0.12],
    [0.92, 0.1],
    [0.9, 0.88],
    [0.1, 0.9],
  ],
};

/** The synthetic reference frame, built once: every case reuses it. */
const SCENE = makeScene(WIDTH, HEIGHT, 0x51ce);

/**
 * Align one warped frame and compare every zone corner with the ground truth.
 *
 * @param {string} name
 * @param {number[]} homographyPixels Reference -> current, in pixels.
 * @param {number} [limitPx] Accepted corner error at 640 px width.
 * @returns {{ polygon: number[][] }}
 */
function alignedZoneFor(name, homographyPixels, limitPx = 2) {
  const current = warp(SCENE, homographyPixels, WIDTH, HEIGHT);
  const aligner = new ZoneAligner({ reference: SCENE });
  assert.equal(aligner.update(current), true, `${name}: the frame must align`);
  assert.equal(aligner.lostUpdates, 0, `${name}: a successful update is not a loss`);

  const aligned = aligner.alignZones([ZONE]);
  assert.ok(aligned, `${name}: aligned zones must not be null`);
  const expectedHomography = normalizedFromPixels(homographyPixels, WIDTH, HEIGHT);
  ZONE.polygon.forEach((point, index) => {
    const expected = applyHomography(expectedHomography, point);
    const [x, y] = aligned[0].polygon[index];
    const error = Math.hypot((x - expected[0]) * WIDTH, (y - expected[1]) * HEIGHT);
    assert.ok(error <= limitPx, `${name}: corner ${index} off by ${error.toFixed(2)} px`);
  });
  return aligned[0];
}

describe('zone alignment on synthetic cameras', () => {
  test('an unchanged frame yields a near-identity view', () => {
    const aligned = alignedZoneFor('identity', [1, 0, 0, 0, 1, 0, 0, 0, 1], 1);
    ZONE.polygon.forEach((point, index) => {
      assert.ok(Math.abs(aligned.polygon[index][0] - point[0]) < 1 / WIDTH);
      assert.ok(Math.abs(aligned.polygon[index][1] - point[1]) < 1 / HEIGHT);
    });
  });

  test('follows a pan (pure translation)', () => {
    const aligned = alignedZoneFor('translation', translationPixels(17, -9));
    // The zone must actually move with the camera, not stay put.
    assert.ok(aligned.polygon[0][0] - ZONE.polygon[0][0] > 12 / WIDTH);
    assert.ok(aligned.polygon[0][1] - ZONE.polygon[0][1] < -4 / HEIGHT);
  });

  test('follows a zoom (uniform scale about the frame centre)', () => {
    alignedZoneFor('scale', scaleAboutPixels(1.15, WIDTH / 2, HEIGHT / 2));
  });

  test('survives a larger 1.3x zoom through the scale pyramid', () => {
    alignedZoneFor('large scale', scaleAboutPixels(1.3, WIDTH / 2, HEIGHT / 2));
  });

  test('follows a mild tilt (perspective)', () => {
    alignedZoneFor('perspective', [1.03, 0.02, -6, -0.01, 0.99, 5, 8e-5, 2e-5, 1]);
  });

  test('follows a combined pan, zoom, roll and perspective move', () => {
    const combined = multiply(
      multiply(
        translationPixels(11, -7),
        rotationAboutPixels(0.035, WIDTH / 2, HEIGHT / 2),
      ),
      multiply(
        scaleAboutPixels(1.08, WIDTH / 2, HEIGHT / 2),
        [1, 0.02, 0, -0.01, 1, 0, 6e-5, -3e-5, 1],
      ),
    );
    alignedZoneFor('combined', combined);
  });

  test('maps every zone and never mutates the input polygons', () => {
    const secondZone = {
      ...ZONE,
      id: 'ppe-zone',
      polygon: [
        [0.2, 0.2],
        [0.4, 0.2],
        [0.4, 0.4],
        [0.2, 0.4],
      ],
    };
    const before = JSON.stringify([ZONE, secondZone]);
    const current = warp(SCENE, translationPixels(-12, 6), WIDTH, HEIGHT);
    const aligner = new ZoneAligner({ reference: SCENE });
    assert.equal(aligner.update(current), true);

    const aligned = aligner.alignZones([ZONE, secondZone]);
    assert.ok(aligned);
    assert.equal(aligned.length, 2);
    assert.equal(aligned[0].id, 'engine-zone');
    assert.equal(aligned[1].id, 'ppe-zone');
    assert.notEqual(aligned[0], ZONE);
    assert.notEqual(aligned[0].polygon, ZONE.polygon);
    assert.equal(JSON.stringify([ZONE, secondZone]), before);
  });

  test('is deterministic: the same frame yields the same polygons', () => {
    const current = warp(SCENE, translationPixels(6, 5), WIDTH, HEIGHT);
    const first = new ZoneAligner({ reference: SCENE });
    const second = new ZoneAligner({ reference: SCENE });
    assert.equal(first.update(current), true);
    assert.equal(second.update(current), true);
    assert.deepEqual(first.alignZones([ZONE]), second.alignZones([ZONE]));
  });
});

describe('lost views', () => {
  test('an untextured frame is lost, never a guessed polygon', () => {
    const aligner = new ZoneAligner({ reference: SCENE });
    const blank = makeSolid(WIDTH, HEIGHT, 128);
    assert.equal(aligner.update(blank), false);
    assert.equal(aligner.alignZones([ZONE]), null);
    assert.equal(aligner.lostUpdates, 1);
  });

  test('an untextured reference makes every update lost', () => {
    const blank = makeSolid(WIDTH, HEIGHT, 96);
    const aligner = new ZoneAligner({ reference: blank });
    assert.equal(aligner.referenceFeatureCount, 0);
    assert.equal(aligner.update(SCENE), false);
    assert.equal(aligner.alignZones([ZONE]), null);
  });

  test('an unrelated scene is lost', () => {
    const other = makeScene(WIDTH, HEIGHT, 0xbadc0de);
    const aligner = new ZoneAligner({ reference: SCENE });
    assert.equal(aligner.update(other), false);
    assert.equal(aligner.alignZones([ZONE]), null);
  });

  test('uniform noise is lost', () => {
    const noise = makeNoise(WIDTH, HEIGHT, 0x1234);
    const aligner = new ZoneAligner({ reference: SCENE });
    assert.equal(aligner.update(noise), false);
    assert.equal(aligner.alignZones([ZONE]), null);
  });

  test('an unreachable inlier floor is lost even on a good frame', () => {
    const current = warp(SCENE, translationPixels(9, 4), WIDTH, HEIGHT);
    const aligner = new ZoneAligner({ reference: SCENE, minInliers: 1000 });
    assert.equal(aligner.update(current), false);
    assert.equal(aligner.alignZones([ZONE]), null);
  });
});

describe('cadence and state', () => {
  test('re-estimates only every everyN calls and keeps the last view in between', () => {
    const current = warp(SCENE, translationPixels(14, -6), WIDTH, HEIGHT);
    const blank = makeSolid(WIDTH, HEIGHT, 128);
    const aligner = new ZoneAligner({ reference: SCENE, everyN: 3 });

    assert.equal(aligner.update(current), true); // call 1: aligns
    assert.equal(aligner.update(blank), true); // call 2: cached, frame ignored
    assert.equal(aligner.update(blank), true); // call 3: cached, frame ignored
    assert.equal(aligner.lostUpdates, 0);

    assert.equal(aligner.update(blank), false); // call 4: attempts, blank -> lost
    assert.equal(aligner.lostUpdates, 1);
    assert.equal(aligner.alignZones([ZONE]), null);

    assert.equal(aligner.update(current), false); // call 5: lost, not due yet
    assert.equal(aligner.update(current), false); // call 6: lost, not due yet
    assert.equal(aligner.lostUpdates, 1, 'only match attempts count as losses');

    assert.equal(aligner.update(current), true); // call 7: due, recovers
    assert.ok(aligner.alignZones([ZONE]));
  });

  test('reset forgets the transform, the cadence and the loss count', () => {
    const current = warp(SCENE, translationPixels(-8, 12), WIDTH, HEIGHT);
    const blank = makeSolid(WIDTH, HEIGHT, 40);
    const aligner = new ZoneAligner({ reference: SCENE, everyN: 3 });
    assert.equal(aligner.update(current), true); // call 1: aligns
    assert.equal(aligner.update(blank), true); // call 2: cached
    assert.equal(aligner.update(blank), true); // call 3: cached
    assert.equal(aligner.update(blank), false); // call 4: due, blank -> lost
    assert.equal(aligner.lostUpdates, 1);

    aligner.reset();
    assert.equal(aligner.lostUpdates, 0);
    assert.equal(aligner.alignZones([ZONE]), null);

    // The next call is attempt number one again, whatever the cadence.
    assert.equal(aligner.update(current), true);
    assert.ok(aligner.alignZones([ZONE]));
  });

  test('a lost view is not revived by a non-cadence call', () => {
    const aligner = new ZoneAligner({ reference: SCENE, everyN: 5 });
    assert.equal(aligner.update(makeSolid(WIDTH, HEIGHT, 200)), false);
    assert.equal(aligner.update(makeScene(WIDTH, HEIGHT, 7)), false);
  });
});

describe('degenerate homographies', () => {
  test('accepts a normal camera move', () => {
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 0, 0, 1]), true);
    assert.equal(isPlausibleHomography([1.1, 0.01, 3, -0.01, 0.98, -2, 0.05, -0.03, 1]), true);
  });

  test('rejects non-finite and zero-h33 matrices', () => {
    assert.equal(isPlausibleHomography([Number.NaN, 0, 0, 0, 1, 0, 0, 0, 1]), false);
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 0, 0, 0]), false);
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 0, 0, 1e-12]), false);
    assert.equal(isPlausibleHomography(null), false);
    assert.equal(isPlausibleHomography([1, 0, 0]), false);
  });

  test('rejects implausible scale changes', () => {
    // Determinant 100, above MAX_SCALE_CHANGE^2.
    assert.equal(isPlausibleHomography([10, 0, 0, 0, 10, 0, 0, 0, 1]), false);
    // Determinant 0.01, below 1 / MAX_SCALE_CHANGE^2.
    assert.equal(isPlausibleHomography([0.1, 0, 0, 0, 0.1, 0, 0, 0, 1]), false);
    // A mirror is not a camera move either.
    assert.equal(isPlausibleHomography([-1, 0, 0, 0, 1, 0, 0, 0, 1]), false);
  });

  test('rejects strong perspective terms', () => {
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 2, 0, 1]), false);
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 0, -2.5, 1]), false);
    // Just inside the limit: a steep but real view still passes.
    assert.equal(isPlausibleHomography([1, 0, 0, 0, 1, 0, 1.5, 0, 1]), true);
  });

  test('inverts a valid matrix and refuses a singular one', () => {
    const identity = invertHomography([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    assert.ok(identity);
    assert.deepEqual(Array.from(identity), [1, 0, 0, 0, 1, 0, 0, 0, 1]);

    const inverse = invertHomography([1, 0, 7, 0, 1, -3, 0, 0, 1]);
    assert.ok(inverse);
    const point = applyHomography(inverse, applyHomography([1, 0, 7, 0, 1, -3, 0, 0, 1], [0.3, 0.6]));
    assert.ok(Math.abs(point[0] - 0.3) < 1e-12);
    assert.ok(Math.abs(point[1] - 0.6) < 1e-12);

    assert.equal(invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
    assert.equal(invertHomography([1, 1, 1, 1, 1, 1, 1, 1, 1]), null);
    assert.equal(invertHomography([1, 0, 0, 0, 1, 0, 0, 0, Number.POSITIVE_INFINITY]), null);
  });
});

describe('input validation', () => {
  const aligner = () => {
    const instance = new ZoneAligner({ reference: SCENE });
    instance.update(SCENE);
    return instance;
  };

  test('rejects a missing or malformed reference', () => {
    assert.throws(() => new ZoneAligner(), TypeError);
    assert.throws(
      () => new ZoneAligner({ reference: { data: new Uint8ClampedArray(4), width: 2, height: 2 } }),
      TypeError,
    );
    assert.throws(
      () => new ZoneAligner({ reference: { data: new Uint8ClampedArray(16), width: 0, height: 0 } }),
      TypeError,
    );
  });

  test('rejects a bad cadence or inlier floor', () => {
    assert.throws(() => new ZoneAligner({ reference: SCENE, everyN: 0 }), RangeError);
    assert.throws(() => new ZoneAligner({ reference: SCENE, everyN: 2.5 }), RangeError);
    assert.throws(() => new ZoneAligner({ reference: SCENE, minInliers: 3 }), RangeError);
  });

  test('rejects a malformed frame', () => {
    const instance = aligner();
    assert.throws(() => instance.update(null), TypeError);
    assert.throws(() => instance.update({}), TypeError);
    assert.throws(
      () => instance.update({ data: new Uint8ClampedArray(16), width: 4, height: 4 }),
      TypeError,
    );
  });

  test('rejects a malformed zone list', () => {
    const instance = aligner();
    assert.throws(() => instance.alignZones('zones'), TypeError);
    assert.throws(() => instance.alignZones([{ id: 'no-polygon' }]), TypeError);
    assert.throws(
      () =>
        instance.alignZones([
          {
            polygon: [
              [0.1, 0.1],
              [0.2, Number.NaN],
              [0.3, 0.3],
            ],
          },
        ]),
      TypeError,
    );
    assert.deepEqual(instance.alignZones([]), []);
  });
});

describe('frame budget', () => {
  test('one update on a 640x360 frame stays inside the alignment budget', () => {
    const current = warp(SCENE, translationPixels(15, -8), WIDTH, HEIGHT);
    const aligner = new ZoneAligner({ reference: SCENE, everyN: 1 });
    // Warm-up: JIT, scratch buffers and the reference already cached by the constructor.
    assert.equal(aligner.update(current), true);
    assert.equal(aligner.update(current), true);

    const samples = 6;
    const started = performance.now();
    for (let index = 0; index < samples; index += 1) {
      assert.equal(aligner.update(current), true);
    }
    const averageMs = (performance.now() - started) / samples;
    // The target is 30 ms; the assertion is looser so a loaded CI machine does not fail on
    // scheduler noise. The measured value is logged for the PR report.
    console.log(`[align] per-update average: ${averageMs.toFixed(1)} ms (target < 30 ms)`);
    assert.ok(averageMs < 45, `per-update average ${averageMs.toFixed(1)} ms is over budget`);
  });
});
