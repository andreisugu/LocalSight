// Pure rules behind the background-camera wiring: the stored preference, which cameras are
// eligible, the reference frame, the zone fingerprint and the clip URL. The manager itself
// is covered in `engine/backgroundCameras.test.mjs`; the browser-side lifecycle is measured
// in the acceptance run, not here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKGROUND_STORAGE_KEY,
  backgroundCandidates,
  backgroundReferenceUrl,
  readBackgroundPreference,
  storeBackgroundPreference,
  zoneSignature,
} from './useBackgroundCameras.js';
import {
  backgroundVideoSource,
  isPlayableSameOriginClip,
} from '../engine/createBackgroundEngine.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    value: (key) => values.get(key),
  };
}

const camera = (id, extra = {}) => ({
  id,
  code: id.toUpperCase(),
  status: 'online',
  ...extra,
});

describe('background preference', () => {
  it('is OFF unless the stored value is exactly 1', () => {
    assert.equal(readBackgroundPreference(memoryStorage()), false);
    assert.equal(readBackgroundPreference(memoryStorage({ [BACKGROUND_STORAGE_KEY]: '0' })), false);
    assert.equal(readBackgroundPreference(memoryStorage({ [BACKGROUND_STORAGE_KEY]: 'true' })), false);
    assert.equal(readBackgroundPreference(memoryStorage({ [BACKGROUND_STORAGE_KEY]: 'yes' })), false);
    assert.equal(readBackgroundPreference(memoryStorage({ [BACKGROUND_STORAGE_KEY]: '1' })), true);
  });

  it('survives a blocked storage getter and writes the documented key', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    assert.equal(readBackgroundPreference(throwing), false);
    assert.equal(storeBackgroundPreference(true, throwing), true);

    const storage = memoryStorage();
    assert.equal(storeBackgroundPreference(true, storage), true);
    assert.equal(storage.value(BACKGROUND_STORAGE_KEY), '1');
    assert.equal(storeBackgroundPreference(false, storage), false);
    assert.equal(storage.value(BACKGROUND_STORAGE_KEY), '0');
  });
});

describe('backgroundCandidates', () => {
  it('takes online clip cameras and never the local webcam', () => {
    const cameras = [
      camera('stand12'),
      camera('taxiway-b'),
      camera('baggage-area'),
      camera('webcam-live'),
      camera('offline-cam', { status: 'offline' }),
    ];
    assert.deepEqual(
      backgroundCandidates(cameras).map((item) => item.id),
      ['stand12', 'taxiway-b', 'baggage-area']
    );
  });

  it('honours VITE_DEMO_CAMERA and a configured clip list', () => {
    const cameras = [camera('stand12'), camera('taxiway-b'), camera('baggage-area')];
    assert.deepEqual(
      backgroundCandidates(cameras, { demoCameraIds: ['stand12', 'taxiway-b'] })
        .map((item) => item.id),
      ['stand12', 'taxiway-b']
    );
    assert.deepEqual(
      backgroundCandidates(cameras, {
        clipEntries: ['stand12=clip-a.mp4', 'baggage-area=clip-c.mp4'],
      }).map((item) => item.id),
      ['stand12', 'baggage-area']
    );
  });

  it('ignores malformed rows instead of inventing an id', () => {
    assert.deepEqual(backgroundCandidates([null, {}, camera('')]), []);
  });
});

describe('backgroundReferenceUrl', () => {
  const zones = [
    { zone_id: 'a', camera_id: 'stand12', reference_frame_url: null },
    { zone_id: 'b', camera_id: 'stand12', reference_frame_url: '/ref/stand12.png' },
    { zone_id: 'c', camera_id: 'stand12', reference_frame_url: '/ref/other.png' },
  ];

  it('prefers the first uploaded reference of the camera', () => {
    assert.equal(backgroundReferenceUrl(zones, 'stand12'), '/ref/stand12.png');
  });

  it('falls back to the demo still and then to null', () => {
    assert.match(backgroundReferenceUrl([], 'stand12'), /zone-stand12\.jpg$/);
    assert.equal(backgroundReferenceUrl([], 'unknown-camera'), null);
  });
});

describe('zoneSignature', () => {
  const base = {
    zone_id: 'engine-left',
    camera_id: 'stand12',
    rule_type: 'RESTRICTED',
    active_when: 'engine_on',
    severity: 'CRITICAL',
    polygon: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
  };

  it('is stable across identical arrays and changes when geometry changes', () => {
    assert.equal(zoneSignature([base]), zoneSignature([{ ...base }]));
    assert.notEqual(
      zoneSignature([base]),
      zoneSignature([{ ...base, polygon: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.9 }] }])
    );
  });

  it('ignores rows without an id', () => {
    assert.equal(zoneSignature([{ camera_id: 'x' }]), '');
  });
});

describe('background clip resolution', () => {
  it('builds the seeded clip under the deploy base', () => {
    assert.equal(
      backgroundVideoSource('stand12', { baseUrl: '/LocalSight/', clipEntries: [] }),
      '/LocalSight/media/stand12.mp4'
    );
    assert.equal(
      backgroundVideoSource('stand12', {
        baseUrl: '/LocalSight/',
        clipEntries: ['stand12=clips/a.mp4'],
      }),
      'clips/a.mp4'
    );
    assert.equal(backgroundVideoSource('', { clipEntries: [] }), null);
  });

  it('accepts only same-origin http(s) clips', () => {
    const origin = 'http://127.0.0.1:4000';
    assert.equal(isPlayableSameOriginClip('/media/a.mp4', origin), true);
    assert.equal(isPlayableSameOriginClip(`${origin}/media/a.mp4`, origin), true);
    assert.equal(isPlayableSameOriginClip('https://cdn.example/a.mp4', origin), false);
    assert.equal(isPlayableSameOriginClip('rtsp://edge/a', origin), false);
    assert.equal(isPlayableSameOriginClip('blob:http://x/y', origin), false);
    assert.equal(isPlayableSameOriginClip(null, origin), false);
  });
});
