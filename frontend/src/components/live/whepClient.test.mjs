import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WHEP_TIMEOUT_MS,
  ICE_GATHER_BUDGET_MS,
  WHEP_ERRORS,
  WHEP_STORAGE_KEY,
  WhepError,
  connectWhep,
  describeWhepUrl,
  isIceGatheringComplete,
  normalizeWhepUrl,
  readStoredWhepUrl,
  resolveWhepUrl,
  whepErrorInfo,
} from './whepClient.js';

// No jsdom and no browser: the WHEP client takes its browser objects as options, so the
// protocol can be checked against fakes that record what the real browser would send.

const ENDPOINT = 'http://127.0.0.1:8889/cam/whep';
const ANSWER_SDP = 'v=0\r\na=recvonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
const OFFER_SDP = 'v=0\r\na=sendonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';

const storageWith = (value) => ({ getItem: () => value, setItem: () => {} });

class FakeMediaStream {
  constructor() {
    this.tracks = [];
    this.id = 'fake-stream';
  }

  getTracks() {
    return this.tracks;
  }

  addTrack(track) {
    this.tracks.push(track);
  }
}

function fakePeerConnection() {
  const listeners = new Map();
  const peer = {
    iceGatheringState: 'complete',
    connectionState: 'new',
    localDescription: null,
    remoteDescription: null,
    closed: false,
    transceivers: [],
    ontrack: null,
    onconnectionstatechange: null,
    addTransceiver(kind, init) {
      peer.transceivers.push({ kind, init });
    },
    async createOffer() {
      return { type: 'offer', sdp: OFFER_SDP };
    },
    async setLocalDescription(description) {
      peer.localDescription = description;
    },
    async setRemoteDescription(description) {
      peer.remoteDescription = description;
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    close() {
      peer.closed = true;
    },
  };
  return peer;
}

function fakeVideo() {
  return {
    srcObject: null,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
  };
}

function okResponse({ location = '/cam/whep/session/1', sdp = ANSWER_SDP } = {}) {
  return {
    ok: true,
    status: 201,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'location' ? location : null),
    },
    text: async () => sdp,
  };
}

function recordingFetch(responder) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  impl.calls = calls;
  return impl;
}

test('a WHEP URL is normalized, never guessed from RTSP', () => {
  assert.equal(normalizeWhepUrl('  http://127.0.0.1:8889/cam/whep  '), ENDPOINT);
  // A trailing slash is a different route for MediaMTX.
  assert.equal(normalizeWhepUrl('http://127.0.0.1:8889/cam/whep/'), ENDPOINT);
  // The path without `/whep` is what an operator copies from a working RTSP demo.
  assert.equal(normalizeWhepUrl('http://127.0.0.1:8889/cam'), ENDPOINT);
  // A token survives normalization because the hash does not belong to the request.
  assert.equal(
    normalizeWhepUrl('https://cam.example/whep/live?token=abc#frag'),
    'https://cam.example/whep/live?token=abc'
  );
  // The browser cannot speak RTSP: reject instead of rewriting it to a guessed host.
  assert.equal(normalizeWhepUrl('rtsp://127.0.0.1:8554/cam'), null);
  assert.equal(normalizeWhepUrl('ws://127.0.0.1:8889/cam/whep'), null);
  assert.equal(normalizeWhepUrl('127.0.0.1:8889/cam/whep'), null);
  assert.equal(normalizeWhepUrl('   '), null);
  assert.equal(normalizeWhepUrl(null), null);
  assert.equal(normalizeWhepUrl(undefined), null);
  assert.equal(normalizeWhepUrl({ href: ENDPOINT }), null);
});

test('the footer label is host plus path', () => {
  assert.equal(describeWhepUrl(ENDPOINT), '127.0.0.1:8889/cam/whep');
  assert.equal(describeWhepUrl('http://127.0.0.1:8889/cam'), '127.0.0.1:8889/cam/whep');
  assert.equal(describeWhepUrl('nonsense'), '');
});

test('the query parameter wins over the stored URL', () => {
  const storage = storageWith('http://127.0.0.1:8889/other/whep');
  assert.equal(
    resolveWhepUrl({ search: '?whep=http%3A%2F%2F127.0.0.1%3A8889%2Fcam%2Fwhep', storage }),
    ENDPOINT
  );
  // An unencoded URL inside the query is what a human types in the address bar.
  assert.equal(resolveWhepUrl({ search: `?whep=${ENDPOINT}`, storage }), ENDPOINT);
  // No parameter: the stored gateway is used, and it is normalized the same way.
  assert.equal(
    resolveWhepUrl({ search: '?foo=1', storage: storageWith('http://127.0.0.1:8889/cam') }),
    ENDPOINT
  );
  // An empty parameter is "not provided", not "clear the stored value".
  assert.equal(resolveWhepUrl({ search: '?whep=', storage }), 'http://127.0.0.1:8889/other/whep');
  // A parameter that cannot be a WHEP endpoint is an answer: no silent fallback.
  assert.equal(resolveWhepUrl({ search: '?whep=rtsp%3A%2F%2F127.0.0.1%2Fcam', storage }), null);
  assert.equal(resolveWhepUrl({ search: '', storage: null }), null);
  // Storage that throws (private mode) and a garbage value both mean "no gateway".
  assert.equal(resolveWhepUrl({ search: '', storage: null }), null);
  assert.equal(readStoredWhepUrl(storageWith('not a url')), null);
  assert.equal(
    readStoredWhepUrl({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    null
  );
  assert.equal(WHEP_STORAGE_KEY, 'localsight.whepUrl');
});

test('errors carry operator copy, and an unknown error is still named', () => {
  const timeout = whepErrorInfo(new WhepError('timeout', 'slow'));
  assert.equal(timeout.code, 'timeout');
  assert.equal(timeout.message, 'slow');
  assert.match(timeout.title, /nu a răspuns la timp/);

  // A code nobody defined degrades to `failed` instead of rendering an undefined title.
  const bogus = new WhepError('something-else', 'x');
  assert.equal(bogus.code, 'failed');
  assert.equal(whepErrorInfo(bogus).title, WHEP_ERRORS.failed.title);

  const plain = whepErrorInfo(new TypeError('Failed to fetch'));
  assert.equal(plain.code, 'failed');
  assert.equal(plain.name, 'TypeError');
  assert.equal(whepErrorInfo(null).code, 'failed');
});

test('ICE gathering is only "complete" when the peer connection says so', () => {
  assert.equal(isIceGatheringComplete(null), true);
  assert.equal(isIceGatheringComplete({}), true);
  assert.equal(isIceGatheringComplete({ iceGatheringState: 'gathering' }), false);
  assert.equal(isIceGatheringComplete({ iceGatheringState: 'complete' }), true);
});

test('connectWhep posts the offer as application/sdp and attaches the stream', async () => {
  const peer = fakePeerConnection();
  const video = fakeVideo();
  const stream = new FakeMediaStream();
  const fetchImpl = recordingFetch(() => okResponse());

  const session = await connectWhep(ENDPOINT, video, {
    RTCPeerConnection: function FakePeerConnection() {
      return peer;
    },
    MediaStream: FakeMediaStream,
    fetch: fetchImpl,
    timeoutMs: 1_000,
  });

  const [post] = fetchImpl.calls;
  assert.equal(post.url, ENDPOINT);
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['Content-Type'], 'application/sdp');
  assert.equal(post.init.headers.Accept, 'application/sdp');
  assert.equal(post.init.body, OFFER_SDP);
  // One recvonly video transceiver: no microphone, no audio track is ever requested.
  assert.deepEqual(peer.transceivers, [{ kind: 'video', init: { direction: 'recvonly' } }]);
  assert.deepEqual(peer.remoteDescription, { type: 'answer', sdp: ANSWER_SDP });
  assert.equal(session.endpoint, ENDPOINT);
  assert.equal(session.sessionUrl, 'http://127.0.0.1:8889/cam/whep/session/1');

  // The browser delivers the track after the answer: that is when srcObject is written.
  peer.ontrack({ streams: [stream] });
  assert.equal(video.srcObject, stream);
  assert.equal(video.playCalls, 1);

  session.close();
  assert.equal(peer.closed, true);
  assert.equal(video.srcObject, null);
  // The session is ended on the server too, with the Location the gateway returned.
  const remove = fetchImpl.calls.at(-1);
  assert.equal(remove.url, 'http://127.0.0.1:8889/cam/whep/session/1');
  assert.equal(remove.init.method, 'DELETE');
  // Closing twice must not send a second DELETE.
  const callsBefore = fetchImpl.calls.length;
  session.close();
  assert.equal(fetchImpl.calls.length, callsBefore);
});

test('a track without a stream is collected into one MediaStream', async () => {
  const peer = fakePeerConnection();
  const video = fakeVideo();
  const fetchImpl = recordingFetch(() => okResponse());
  const session = await connectWhep(ENDPOINT, video, {
    RTCPeerConnection: function FakePeerConnection() {
      return peer;
    },
    MediaStream: FakeMediaStream,
    fetch: fetchImpl,
  });
  const track = { id: 'track-1' };
  peer.ontrack({ track, streams: [] });
  assert.ok(video.srcObject instanceof FakeMediaStream);
  assert.deepEqual(video.srcObject.getTracks(), [track]);
  session.close();
});

test('an invalid endpoint or a missing video element fails before touching the network', async () => {
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    return okResponse();
  };
  const video = fakeVideo();
  await assert.rejects(
    () => connectWhep('rtsp://127.0.0.1:8554/cam', video, { fetch: fetchImpl }),
    (error) => error instanceof WhepError && error.code === 'invalid-url'
  );
  await assert.rejects(
    () => connectWhep(ENDPOINT, null, { fetch: fetchImpl }),
    (error) => error instanceof WhepError && error.code === 'unsupported'
  );
  // Node has neither RTCPeerConnection nor MediaStream: no injected transport means this
  // browser cannot play WHEP, and the failure is named instead of thrown as a ReferenceError.
  await assert.rejects(
    () => connectWhep(ENDPOINT, video, { fetch: fetchImpl }),
    (error) => error instanceof WhepError && error.code === 'unsupported'
  );
  await assert.rejects(
    () =>
      connectWhep(ENDPOINT, video, {
        RTCPeerConnection: function FakePeerConnection() {
          return fakePeerConnection();
        },
        fetch: fetchImpl,
      }),
    (error) => error instanceof WhepError && error.code === 'unsupported'
  );
  assert.equal(fetched, 0);
});

test('a refused, empty or unreachable gateway is named and the peer is closed', async () => {
  const makeVideo = fakeVideo;

  const refusedPeer = fakePeerConnection();
  await assert.rejects(
    () =>
      connectWhep(ENDPOINT, makeVideo(), {
        RTCPeerConnection: function FakePeerConnection() {
          return refusedPeer;
        },
        MediaStream: FakeMediaStream,
        fetch: async () => ({ ok: false, status: 404, headers: { get: () => null } }),
      }),
    (error) => error.code === 'refused' && /404/.test(error.message)
  );
  assert.equal(refusedPeer.closed, true, 'a failed handshake must not leak a peer connection');

  await assert.rejects(
    () =>
      connectWhep(ENDPOINT, makeVideo(), {
        RTCPeerConnection: function FakePeerConnection() {
          return fakePeerConnection();
        },
        MediaStream: FakeMediaStream,
        fetch: async () => okResponse({ sdp: '   ' }),
      }),
    (error) => error.code === 'no-answer'
  );

  // A CORS rejection and a refused TCP connection look identical in the browser.
  await assert.rejects(
    () =>
      connectWhep(ENDPOINT, makeVideo(), {
        RTCPeerConnection: function FakePeerConnection() {
          return fakePeerConnection();
        },
        MediaStream: FakeMediaStream,
        fetch: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    (error) => error.code === 'offline'
  );
});

test('a gateway that never answers times out instead of hanging the stage', async () => {
  const peer = fakePeerConnection();
  const started = Date.now();
  await assert.rejects(
    () =>
      connectWhep(ENDPOINT, fakeVideo(), {
        RTCPeerConnection: function FakePeerConnection() {
          return peer;
        },
        MediaStream: FakeMediaStream,
        // Never resolves and never honours the abort signal.
        fetch: () => new Promise(() => {}),
        timeoutMs: 20,
      }),
    (error) => error.code === 'timeout'
  );
  assert.ok(Date.now() - started < 1_000, 'the timeout must fire on its budget');
  assert.equal(peer.closed, true);
  assert.equal(DEFAULT_WHEP_TIMEOUT_MS, 10_000);
  assert.equal(ICE_GATHER_BUDGET_MS, 5_000);
});

test('a blocked autoplay is reported, not swallowed', async () => {
  const peer = fakePeerConnection();
  const blocked = [];
  const video = {
    srcObject: null,
    play: () => Promise.reject(new Error('NotAllowedError')),
  };
  const session = await connectWhep(ENDPOINT, video, {
    RTCPeerConnection: function FakePeerConnection() {
      return peer;
    },
    MediaStream: FakeMediaStream,
    fetch: async () => okResponse(),
    onAutoplayBlocked: (reason) => blocked.push(reason),
  });
  peer.ontrack({ streams: [new FakeMediaStream()] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].message, /NotAllowedError/);
  session.close();
});

test('connection-state changes reach the caller', async () => {
  const peer = fakePeerConnection();
  const states = [];
  const session = await connectWhep(ENDPOINT, fakeVideo(), {
    RTCPeerConnection: function FakePeerConnection() {
      return peer;
    },
    MediaStream: FakeMediaStream,
    fetch: async () => okResponse(),
    onConnectionState: (state) => states.push(state),
  });
  peer.connectionState = 'failed';
  peer.onconnectionstatechange();
  assert.deepEqual(states, ['failed']);
  session.close();
});
