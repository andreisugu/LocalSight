import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACK_POINTER_WINDOW_MS,
  cameraErrorFor,
  cameraOptionLabel,
  demoClipFor,
  edgeIsActive,
  engineBadgeCopy,
  engineReadout,
  engineReason,
  hiddenRawCopy,
  mediaPlan,
  outlineForZone,
  parseList,
  pickActiveZone,
  readEnginePreference,
  shouldAcceptAck,
  storeEnginePreference,
  toEngineZones,
} from './liveMedia.js';

const storageWith = (value) => ({
  getItem: () => value,
  setItem: () => {},
});

test('the stored engine preference always wins over the probe', () => {
  assert.equal(readEnginePreference(storageWith('1')), true);
  assert.equal(readEnginePreference(storageWith('0')), false);
  assert.equal(readEnginePreference(storageWith(null)), null);
  assert.equal(readEnginePreference(storageWith('garbage')), null);
  assert.equal(
    readEnginePreference({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    null
  );
});

test('a stored preference is written as 1/0 and a failure is ignored', () => {
  const writes = [];
  storeEnginePreference(true, { setItem: (key, value) => writes.push([key, value]) });
  storeEnginePreference(false, { setItem: (key, value) => writes.push([key, value]) });
  assert.deepEqual(writes, [
    ['localsight.liveEngine', '1'],
    ['localsight.liveEngine', '0'],
  ]);
  assert.doesNotThrow(() =>
    storeEnginePreference(true, {
      setItem: () => {
        throw new Error('quota');
      },
    })
  );
});

test('camera errors map to the copy the operator sees', () => {
  assert.equal(cameraErrorFor({ name: 'NotAllowedError' }).code, 'denied');
  assert.equal(cameraErrorFor({ name: 'NotFoundError' }).code, 'notfound');
  assert.equal(cameraErrorFor({ name: 'NotReadableError' }).code, 'busy');
  assert.equal(cameraErrorFor({ name: 'NotSupportedError' }).code, 'notfound');
  assert.equal(cameraErrorFor({ name: 'SomethingElse' }).code, 'unknown');
  const error = cameraErrorFor({ name: 'NotAllowedError', message: 'no' });
  assert.match(error.title, /Permisiune refuzată/);
  assert.equal(error.message, 'no');
});

test('demo lists tolerate spaces, empties and a single plain clip', () => {
  assert.deepEqual(parseList(' stand12 , taxiway-b ,,'), ['stand12', 'taxiway-b']);
  assert.deepEqual(parseList(undefined), []);

  assert.equal(demoClipFor('stand12', ['stand12=a.mp4', 'taxiway-b=b.mp4']), 'a.mp4');
  assert.equal(demoClipFor('missing', ['stand12=a.mp4', 'taxiway-b=b.mp4']), null);
  assert.equal(demoClipFor('anything', ['only.mp4']), 'only.mp4');
  assert.equal(demoClipFor('anything', ['a=1.mp4', 'b=2.mp4']), null);
  assert.equal(demoClipFor(null, ['only.mp4']), null);
});

test('the camera menu labels status without inventing a feed', () => {
  const ids = ['stand12'];
  assert.equal(
    cameraOptionLabel({ id: 'stand12', code: 'CAM-01', name: 'CAM-01 • Stand 12' }, ids),
    'CAM-01 — CAM-01 • Stand 12'
  );
  assert.equal(
    cameraOptionLabel({ id: 'stand12', code: 'CAM-01', name: 'CAM-01' }, ids),
    'CAM-01'
  );
  assert.match(
    cameraOptionLabel({ id: 'taxiway-b', code: 'CAM-02', name: 'CAM-02' }, ids),
    /fără feed în demo$/
  );
  assert.match(
    cameraOptionLabel({ id: 'webcam-live', code: 'CAM-LOCAL', status: 'online' }, ids),
    /cameră locală$/
  );
  assert.match(
    cameraOptionLabel({ id: 'stand12', code: 'CAM-01', status: 'offline' }, ids),
    /offline$/
  );
});

test('the webcam disables every network source by id', () => {
  const plan = mediaPlan({
    camera: { id: 'webcam-live', stream_url: 'http://camera/stream', status: 'online' },
    cameras: [],
    demoCameraIds: ['stand12'],
    demoClipEntries: ['stand12=a.mp4'],
    isWebcam: true,
  });
  assert.equal(plan.showStream, false);
  assert.equal(plan.showDemoVideo, false);
  assert.equal(plan.demoClip, null);
});

test('an offline camera shows no source at all', () => {
  const plan = mediaPlan({
    camera: { id: 'stand12', stream_url: 'http://camera/stream', status: 'offline' },
    demoCameraIds: [],
  });
  assert.equal(plan.isOffline, true);
  assert.equal(plan.showStream, false);
  assert.equal(plan.showDemoVideo, false);
});

test('a camera outside the demo list gets no fallback clip', () => {
  const plan = mediaPlan({
    camera: { id: 'baggage-area', status: 'online' },
    cameras: [{ id: 'stand12', code: 'CAM-01' }],
    demoCameraIds: ['stand12'],
    demoClipEntries: [],
    baseUrl: '/LocalSight/',
  });
  assert.equal(plan.noLiveForCamera, true);
  assert.equal(plan.showDemoVideo, false);
  assert.equal(plan.demoCameraLabel, 'CAM-01');
});

test('a failed clip falls back to the gradient, not to a stream', () => {
  const plan = mediaPlan({
    camera: { id: 'stand12', status: 'online' },
    demoCameraIds: [],
    baseUrl: '/',
    videoFailed: true,
  });
  assert.equal(plan.demoVideoSrc, '/media/stand12.mp4');
  assert.equal(plan.showDemoVideo, false);
});

test('the media override wins over the per-camera file', () => {
  const plan = mediaPlan({
    camera: { id: 'stand12', status: 'online' },
    demoCameraIds: [],
    baseUrl: '/base/',
    videoOverride: ' https://cdn/clip.mp4 ',
  });
  assert.equal(plan.demoVideoSrc, 'https://cdn/clip.mp4');
  assert.equal(plan.showDemoVideo, true);
});

test('the engine reason never claims a fast path before the probe answers', () => {
  assert.match(engineReason(null, false), /se verifică WebGPU/);
  assert.match(engineReason(true, false), /WebGPU disponibil/);
  assert.match(engineReason(true, true), /camerei locale/);
  assert.match(engineReason(false, false), /WASM cu 4 fire/);
});

test('the engine badge names the provider state and the mock build', () => {
  assert.equal(
    engineBadgeCopy({ status: 'running', fps: 5.25, useMock: true }),
    'detecție reală · procesat local · 5.3 fps'
  );
  assert.equal(
    engineBadgeCopy({ status: 'running', fps: 0, useMock: false }),
    'procesat local · — fps'
  );
  assert.equal(
    engineBadgeCopy({ status: 'error', fps: 0, useMock: false }),
    'motor indisponibil · flux brut ascuns'
  );
  assert.equal(
    engineBadgeCopy({ status: 'loading', fps: 0, useMock: false }),
    'se pregătește · flux brut ascuns'
  );
  assert.match(hiddenRawCopy('error'), /nu a produs cadre procesate/);
  assert.match(hiddenRawCopy('loading'), /până la primul cadru procesat/);
});

test('readouts use measured numbers only', () => {
  const base = {
    engine: { status: 'idle', fps: 0, actualProviders: [] },
    isWebcam: false,
    webcamLive: false,
    activeZone: { name: 'Zona motor' },
    activeCamera: { id: 'stand12', subtitle: 'Stand 12', name: 'CAM-01' },
    showStream: false,
    browserEngineOn: false,
    engineSource: false,
    health: {},
    kpis: { detection_to_alert_latency_s: '—' },
  };
  const idle = engineReadout(base);
  assert.equal(idle.pipelineActive, false);
  assert.equal(idle.pipelineLabel, 'FPS necunoscut');
  assert.equal(idle.zoneLabel, 'Zona motor');
  assert.equal(idle.modelLabel, 'oprit');
  assert.equal(idle.latencyLabel, '—');

  const engine = { status: 'running', fps: 5.5, actualProviders: ['webgpu'] };
  const running = engineReadout({
    ...base,
    engine,
    browserEngineOn: true,
    engineSource: true,
    kpis: { detection_to_alert_latency_s: 12 },
  });
  assert.equal(running.pipelineActive, true);
  assert.equal(running.pipelineLabel, '5.5 FPS • browser');
  assert.equal(running.modelLabel, 'YOLO26n · webgpu');
  assert.equal(running.latencyLabel, '12s');

  // The spike flag names the graph that really ran; the default stays YOLO26n.
  const lite0 = engineReadout({
    ...base,
    engine: { ...engine, detector: 'efficientdet' },
    browserEngineOn: true,
    engineSource: true,
  });
  assert.equal(lite0.modelLabel, 'EfficientDet-Lite0 · webgpu');
  const lite2 = engineReadout({
    ...base,
    engine: { ...engine, detector: 'efficientdet-lite2' },
    browserEngineOn: true,
    engineSource: true,
  });
  assert.equal(lite2.modelLabel, 'EfficientDet-Lite2 · webgpu');
  const unknown = engineReadout({
    ...base,
    engine: { ...engine, detector: 'bogus' },
    browserEngineOn: true,
    engineSource: true,
  });
  assert.equal(unknown.modelLabel, 'YOLO26n · webgpu');
});

test('zones are converted once, in contract shape', () => {
  const zones = [
    { zone_id: 'a', camera_id: 'cam', polygon: [{ x: 0.1, y: 0.2 }, [0.3, 0.4], { x: 'bad' }] },
    { zone_id: 'b', camera_id: 'other', polygon: [] },
  ];
  const converted = toEngineZones(zones, 'cam');
  assert.equal(converted.length, 1);
  assert.equal(converted[0].id, 'a');
  assert.deepEqual(converted[0].polygon, [
    [0.1, 0.2],
    [0.3, 0.4],
  ]);
  assert.deepEqual(converted[0].required_ppe, []);
});

test('the configured zone is the camera zone, never a detection', () => {
  const zones = [
    { zone_id: 'first', camera_id: 'cam' },
    { zone_id: 'wanted', camera_id: 'cam' },
    { zone_id: 'elsewhere', camera_id: 'other' },
  ];
  assert.equal(pickActiveZone(zones, { id: 'cam', zone_id: 'wanted' }).zone_id, 'wanted');
  assert.equal(pickActiveZone(zones, { id: 'cam', zone_id: 'missing' }).zone_id, 'first');
  assert.equal(pickActiveZone(zones, { id: 'none' }), null);
});

test('an outline needs three finite points and keeps the label on the polygon corner', () => {
  assert.equal(outlineForZone({ polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), null);
  assert.equal(outlineForZone({ polygon: [] }), null);
  const outline = outlineForZone({
    polygon: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.4 },
      { x: 0.5, y: 0.9 },
    ],
  });
  assert.equal(outline.pointsAttr, '0.2,0.3 0.8,0.4 0.5,0.9');
  assert.equal(outline.leftPct, 20);
  assert.equal(outline.topPct, 30);
});

test('edge freshness needs a database and a recent frame', () => {
  assert.equal(edgeIsActive({ db: true, edge_last_seen_s: 10 }), true);
  assert.equal(edgeIsActive({ db: false, edge_last_seen_s: 10 }), false);
  assert.equal(edgeIsActive({ db: true, edge_last_seen_s: 61 }), false);
  assert.equal(edgeIsActive({ db: true, edge_last_seen_s: null }), false);
});

test('a double-click acknowledges exactly one card', () => {
  const now = 1_000;
  const press = { eventId: 'evt-a', at: now - 50 };
  // First click: the press names the card.
  assert.equal(shouldAcceptAck({ detail: 1, eventId: 'evt-a', press, now }), true);
  // Second click of the double-click, already on the next card.
  assert.equal(shouldAcceptAck({ detail: 2, eventId: 'evt-b', press: null, now }), false);
  // A click with no matching press is not a decision about this card.
  assert.equal(shouldAcceptAck({ detail: 1, eventId: 'evt-b', press, now }), false);
  // A stale press does not survive the window.
  assert.equal(
    shouldAcceptAck({
      detail: 1,
      eventId: 'evt-a',
      press,
      now: now + ACK_POINTER_WINDOW_MS + 1,
    }),
    false
  );
  // Keyboard activation has no pointerdown and is always deliberate.
  assert.equal(shouldAcceptAck({ detail: 0, eventId: 'evt-b', press: null, now }), true);
});

test('two deliberate clicks 200 ms apart are two decisions', () => {
  const first = 2_000;
  const second = 2_200;
  assert.equal(
    shouldAcceptAck({
      detail: 1,
      eventId: 'evt-a',
      press: { eventId: 'evt-a', at: first - 30 },
      now: first,
    }),
    true
  );
  assert.equal(
    shouldAcceptAck({
      detail: 1,
      eventId: 'evt-b',
      press: { eventId: 'evt-b', at: second - 30 },
      now: second,
    }),
    true
  );
});
