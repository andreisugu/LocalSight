// A dependency-free WHEP (WebRTC-HTTP Egress Protocol) player.
//
// Why this exists: a browser cannot open an RTSP stream. A camera on the apron speaks
// RTSP, the page needs WebRTC, and something has to translate. `gateway/mediamtx.yml` is
// that translator (RTSP in, WHEP out); this module is the whole browser side of it:
// create an offer, POST it as `application/sdp`, apply the answer, attach the incoming
// MediaStream to the one <video> the engine already reads frames from.
//
// No library is used on purpose. The protocol is one POST, one SDP exchange and one DELETE
// to end the session, and a 400-line wrapper would be a new dependency for a demo path
// that must keep working offline. Everything that is a decision (URL parsing, error
// mapping, ICE wait) is a pure function so `node --test` can check it without a DOM.
//
// Local-only spike: the URL is plain http, there is no auth and no TLS. See
// `gateway/README.md` for what production needs.

export const WHEP_STORAGE_KEY = 'localsight.whepUrl';

// The gateway answers in well under a second on loopback. Ten seconds covers a cold
// MediaMTX that is still pulling the first keyframe, and still fails before an operator
// gives up on the stage.
export const DEFAULT_WHEP_TIMEOUT_MS = 10_000;

// How long the offer waits for its own ICE candidates before it is sent without them. A
// local MediaMTX answers from its first host candidate, so five seconds is already generous;
// the offer must never hang on a network with no reachable interface.
export const ICE_GATHER_BUDGET_MS = 5_000;

// The copy the operator sees. One entry per failure this client can name, so the stage never
// prints a bare `TypeError: Failed to fetch` over a black rectangle.
export const WHEP_ERRORS = {
  'invalid-url': {
    title: 'Adresa WHEP nu este validă',
    detail:
      'Cheia `whep` trebuie să fie un URL http(s) complet, de forma '
      + 'http://127.0.0.1:8889/cam/whep.',
  },
  unsupported: {
    title: 'Browserul nu poate reda WebRTC',
    detail:
      'RTCPeerConnection, MediaStream sau fetch lipsește în acest browser. '
      + 'Fluxul RTSP rămâne indisponibil aici.',
  },
  timeout: {
    title: 'Gateway-ul WHEP nu a răspuns la timp',
    detail:
      'Verifică dacă MediaMTX rulează pe portul 8889 și dacă fluxul este publicat '
      + '(`gateway/publish-demo.sh`).',
  },
  offline: {
    title: 'Gateway-ul WHEP nu poate fi contactat',
    detail:
      'Conexiunea a fost refuzată sau blocată de browser (CORS sau conținut mixt). '
      + 'Pornește MediaMTX și deschide pagina pe http://localhost sau pe același host.',
  },
  refused: {
    title: 'Gateway-ul WHEP a refuzat cererea',
    detail:
      'Sesiunea WebRTC nu a putut fi creată. Verifică numele căii din URL '
      + '(ex. /cam/whep) și dacă fluxul RTSP este publicat.',
  },
  'no-answer': {
    title: 'Răspunsul WHEP este gol',
    detail: 'Gateway-ul a acceptat cererea, dar nu a trimis niciun SDP de răspuns.',
  },
  autoplay: {
    title: 'Fluxul a sosit, dar redarea a fost blocată',
    detail:
      'Browserul cere un gest înainte de redare. Apasă „Reconectează” sau pornește '
      + 'motorul: ambele sunt gesturi ale operatorului.',
  },
  disconnected: {
    title: 'Conexiunea WHEP s-a închis',
    detail:
      'Gateway-ul a închis sesiunea WebRTC (sau fluxul RTSP s-a oprit). '
      + 'Reconectează după ce `publish-demo.sh` rulează din nou.',
  },
  failed: {
    title: 'Fluxul WHEP nu a pornit',
    detail: 'Schimbul SDP a eșuat din alt motiv decât cele numite mai sus.',
  },
};

/** One error type for every failure this module reports; `code` indexes `WHEP_ERRORS`. */
export class WhepError extends Error {
  constructor(code, message, cause) {
    super(message || WHEP_ERRORS[code]?.title || 'Eroare WHEP');
    this.name = 'WhepError';
    this.code = WHEP_ERRORS[code] ? code : 'failed';
    if (cause) this.cause = cause;
  }
}

/** The copy for a thrown value, in the same shape `cameraErrorFor` returns. */
export function whepErrorInfo(error) {
  const code = error instanceof WhepError && WHEP_ERRORS[error.code] ? error.code : 'failed';
  return {
    code,
    name: error?.name || '',
    message: error?.message || '',
    ...WHEP_ERRORS[code],
  };
}

// Only http(s) is a WHEP endpoint. `rtsp://` is deliberately rejected instead of being
// rewritten: the browser speaks WebRTC, and guessing a gateway address from an RTSP URL
// would invent a host nobody configured.
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Canonical form of a WHEP endpoint, or `null` when the input cannot be one.
 *
 * MediaMTX exposes `/<path>/whep`. An operator who copies only the path half of the URL
 * (`http://127.0.0.1:8889/cam`) gets the endpoint they meant instead of a 404, and a
 * trailing slash is dropped because `/cam/whep/` is a different route for the gateway.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeWhepUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!HTTP_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  url.pathname = segments.length === 1 ? `${path}/whep` : path || '/';
  return url.toString();
}

/** Short form for the footer: host plus path, without the scheme. */
export function describeWhepUrl(raw) {
  const normalized = normalizeWhepUrl(raw);
  if (!normalized) return '';
  const { host, pathname } = new URL(normalized);
  return `${host}${pathname}`;
}

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/** The persisted URL, normalized; an unreadable or invalid value is simply absent. */
export function readStoredWhepUrl(storage = defaultStorage()) {
  try {
    return normalizeWhepUrl(storage?.getItem(WHEP_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * `?whep=…` wins over the stored `localsight.whepUrl`.
 *
 * A non-empty but invalid query value is an answer, not a reason to silently fall back to a
 * stored gateway the operator cannot see in the address bar: it resolves to `null` and no
 * network camera is offered.
 *
 * @param {{search?: string, storage?: {getItem(key: string): string|null}|null}} [options]
 * @returns {string|null}
 */
export function resolveWhepUrl(options = {}) {
  const search = typeof options.search === 'string'
    ? options.search
    : typeof window === 'undefined'
      ? ''
      : window.location.search;
  const storage = Object.prototype.hasOwnProperty.call(options, 'storage')
    ? options.storage
    : defaultStorage();
  let param = null;
  try {
    param = new URLSearchParams(search || '').get('whep');
  } catch {
    param = null;
  }
  if (typeof param === 'string' && param.trim()) return normalizeWhepUrl(param);
  return readStoredWhepUrl(storage);
}

/** True once the peer connection has every candidate it will get. */
export function isIceGatheringComplete(peerConnection) {
  if (!peerConnection) return true;
  // A fake/partial implementation that does not expose the state cannot be waited on.
  if (typeof peerConnection.iceGatheringState !== 'string') return true;
  return peerConnection.iceGatheringState === 'complete';
}

function waitForIceGathering(peerConnection, budgetMs) {
  if (isIceGatheringComplete(peerConnection)) return Promise.resolve();
  if (typeof peerConnection.addEventListener !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      peerConnection.removeEventListener?.('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (isIceGatheringComplete(peerConnection)) finish();
    };
    peerConnection.addEventListener('icegatheringstatechange', check);
    timer = setTimeout(finish, budgetMs);
  });
}

function sessionUrlFrom(response, endpoint) {
  const header = response?.headers?.get?.('Location')
    || response?.headers?.get?.('location');
  if (!header) return null;
  try {
    return new URL(header, endpoint).toString();
  } catch {
    return null;
  }
}

function asWhepError(caught) {
  if (caught instanceof WhepError) return caught;
  const name = caught?.name || '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new WhepError('timeout', caught?.message, caught);
  }
  // In a browser both a refused connection and a CORS rejection surface as TypeError.
  if (name === 'TypeError') return new WhepError('offline', caught?.message, caught);
  return new WhepError('failed', caught?.message, caught);
}

/**
 * Open a WHEP session and attach its video track to `video`.
 *
 * The offer is non-trickle: the client waits (bounded) for its own ICE candidates and sends
 * them inside the SDP, so one POST completes the exchange on a loopback gateway. Late
 * candidates after the answer are not renegotiated; the connection the stage needs is
 * already up at that point.
 *
 * `video` is only assigned `srcObject` and, unless `play: false`, told to play. It is muted
 * by the stage, so muted-autoplay rules apply and no sound is ever requested: the
 * transceiver is `recvonly` video.
 *
 * @param {string} url WHEP endpoint (`?whep=` or `localsight.whepUrl`).
 * @param {HTMLVideoElement} video The stage element the engine reads frames from.
 * @param {{
 *   timeoutMs?: number,
 *   iceServers?: RTCIceServer[],
 *   play?: boolean,
 *   RTCPeerConnection?: typeof RTCPeerConnection,
 *   MediaStream?: typeof MediaStream,
 *   fetch?: typeof fetch,
 *   onAutoplayBlocked?: (reason: unknown) => void,
 *   onConnectionState?: (state: string) => void,
 *   onTrack?: (event: unknown) => void,
 * }} [options]
 * @returns {Promise<{close: () => void, endpoint: string, sessionUrl: string|null, stream: MediaStream|null}>}
 */
export async function connectWhep(url, video, options = {}) {
  const endpoint = normalizeWhepUrl(url);
  if (!endpoint) {
    throw new WhepError('invalid-url', `Adresa WHEP nu este validă: „${String(url ?? '')}”.`);
  }
  if (!video || typeof video !== 'object') {
    throw new WhepError('unsupported', 'Elementul <video> lipsește; fluxul WebRTC nu are unde fi atașat.');
  }
  const PeerConnection = options.RTCPeerConnection || globalThis.RTCPeerConnection;
  const MediaStreamImpl = options.MediaStream || globalThis.MediaStream;
  const fetchImpl = options.fetch || (
    typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  );
  if (
    typeof PeerConnection !== 'function'
    || typeof MediaStreamImpl !== 'function'
    || typeof fetchImpl !== 'function'
  ) {
    throw new WhepError('unsupported');
  }
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_WHEP_TIMEOUT_MS;
  const iceServers = Array.isArray(options.iceServers) ? options.iceServers : [];

  let peerConnection;
  try {
    peerConnection = new PeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  } catch (caught) {
    throw new WhepError('unsupported', caught?.message, caught);
  }

  const localStream = new MediaStreamImpl();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let closed = false;
  let sessionUrl = null;
  let attached = null;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      peerConnection.close();
    } catch {
      // Already closed by the browser after a failed handshake.
    }
    if (attached && video.srcObject === attached) video.srcObject = null;
    attached = null;
    if (sessionUrl) {
      try {
        // Best effort: MediaMTX expires the session on its own if the DELETE is lost.
        const result = fetchImpl(sessionUrl, { method: 'DELETE' });
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // Nothing to recover from; the connection is already gone.
      }
    }
  };

  peerConnection.ontrack = (event) => {
    if (closed) return;
    const incoming = Array.isArray(event?.streams) && event.streams[0] ? event.streams[0] : null;
    if (incoming && typeof incoming.getTracks === 'function') {
      attached = incoming;
    } else if (event?.track && typeof localStream.addTrack === 'function') {
      const duplicate = localStream
        .getTracks()
        .some((track) => track.id === event.track.id);
      if (!duplicate) localStream.addTrack(event.track);
      attached = localStream;
    }
    if (attached && video.srcObject !== attached) video.srcObject = attached;
    if (options.play !== false && typeof video.play === 'function') {
      const played = video.play();
      if (played && typeof played.catch === 'function') {
        // A rejected play is real: the stage is muted, so the policy allows it.
        played.catch((reason) => options.onAutoplayBlocked?.(reason));
      }
    }
    options.onTrack?.(event);
  };

  peerConnection.onconnectionstatechange = () => {
    options.onConnectionState?.(peerConnection.connectionState);
  };

  let deadlineTimer = null;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      controller?.abort();
      reject(new WhepError('timeout', `Gateway-ul WHEP nu a răspuns în ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    peerConnection.addTransceiver?.('video', { direction: 'recvonly' });
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection, Math.min(ICE_GATHER_BUDGET_MS, timeoutMs));
    const offerSdp = peerConnection.localDescription?.sdp || offer?.sdp || '';
    if (!offerSdp) throw new WhepError('failed', 'Oferta SDP este goală.');

    const response = await Promise.race([
      fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
        body: offerSdp,
        signal: controller ? controller.signal : undefined,
      }),
      deadline,
    ]);
    if (!response || !response.ok) {
      const status = response?.status;
      throw new WhepError(
        'refused',
        `Gateway-ul WHEP a răspuns ${status ? `cu ${status}` : 'fără status'}.`
      );
    }
    const answerSdp = await response.text();
    if (!answerSdp || !answerSdp.trim()) {
      throw new WhepError('no-answer', 'Gateway-ul WHEP nu a trimis niciun SDP de răspuns.');
    }
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    sessionUrl = sessionUrlFrom(response, endpoint);

    return {
      close,
      endpoint,
      sessionUrl,
      stream: attached || localStream,
    };
  } catch (caught) {
    close();
    throw asWhepError(caught);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
