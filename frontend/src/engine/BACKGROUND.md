# Background cameras — integration plan (OFF by default)

Status: **shipped behind an OFF toggle** on `prep/background-ui`. The manager core
(`backgroundCameras.js`), the worker factory (`createBackgroundEngine.js`), the provider hook
(`context/useBackgroundCameras.js`), the Live ownership signal and the Settings panel are now
wired. Nothing starts until the operator enables the option; the default build behaves
exactly as before. Measured numbers are in section 11.

Read with `docs/contract.md` (event envelope wins) and `docs/browser-engine.md` (engine
architecture). This plan adds no fields to the contract and no endpoint.

## 1. What the option is, and what it is not

The private engine can run on every camera, not only on the one Live is showing. The option
puts one low-rate engine per camera behind a Settings toggle that is **off by default**:

- incidents from all cameras enter the same list as Live incidents;
- the active camera is skipped, because Live already processes it;
- background means *off-screen in this tab*, not a recorder: closing the tab stops
  everything, and a hidden tab is throttled by the browser (section 10);
- no server, no upload, no recording. Frames stay in the tab and are blurred before any
  snapshot leaves a worker.

The core only orchestrates. It does not own pixels, workers, `<video>` elements, zones or
snapshot URLs; those belong to the integration layer described below.

## 2. Core API (already on this branch)

```js
import { createBackgroundCameras } from '../engine/backgroundCameras.js';

const manager = createBackgroundCameras({
  cameras,                         // same array the app renders; only `id` is required
  zonesForCamera: (camera) => [],  // read once per engine start
  engineFactory: ({ cameraId, zones }) => ({ start, stop, onEvent }), // + optional status()
  intervalMs: 2000,                // low-rate pump: event delivery and retries
  maxCameras: 3,
  onEvent: (event) => {},          // one accepted, unmodified event
  now: () => Date.now(),
});
```

| Call | Meaning |
|---|---|
| `start()` | Arms the mount lifecycle. Idempotent. Does **not** enable the feature. |
| `setEnabled(true/false)` | Operator preference. `false` stops every engine immediately; `true` starts them only if `start()` ran and the guard allows it. |
| `stop()` | Stops every engine, clears the timer and per-camera state. Idempotent; keeps `enabled`, so a later `start()` resumes the preference. |
| `setActiveCamera(id \| null)` | Camera Live owns and the manager must skip. `null` (Live unmounted, engine off, fullscreen) lets all cameras run. |
| `status()` | `{ enabled, running, refusedReason, cameras: [...] }`. `running` means the manager is supervising (started + enabled + not refused); each camera's `state` says whether its engine is up. |

Per-camera `state`: `stopped`, `active` (Live owns it), `starting`, `running`, `backoff`,
`unsupported`, `skipped` (resource guard), plus counters `events`, `duplicates`, `dropped`,
`invalid`, `failures`, `deliveryErrors`, `attempts`, and `lastError`, `skipReason`,
`engineStatus`. `engineStatus` is the last `{ state, message }` an engine reported through
its optional `status()` method.

Rules already enforced by the core:

- an engine is built only through `engineFactory({ cameraId, zones })`; a throw, a rejected
  async `start()` or a malformed return value puts that camera in `backoff` and never throws
  out of the manager;
- backoff is `min(60 s, 5 s × 2^(attempts−1))` and is reset by a successful start;
- events need a non-empty string `event_id`; a `camera_id` that names another camera is
  rejected. Nothing is added to an event, and nothing is invented when a field is missing;
- dedupe remembers the last 200 ids per camera and queues at most 32 events between pumps;
- `unsupported` is reported once and never retried; `error` becomes a retry;
- no engine starts for the active camera, and a stale callback from a stopped engine is
  ignored;
- the resource guard refuses the **whole run** (no partial, blind coverage) when there are
  more than `maxCameras` eligible cameras, when `hardwareConcurrency < 4`, or when the core
  count is unknown. `refusedReason` is `camera-limit`, `low-hardware` or `hardware-unknown`.

## 3. Settings toggle (OFF by default)

`frontend/src/context/useBackgroundCameras.js` owns the preference under its own key,
`localsight.backgroundCameras` (`'1'` / `'0'`). Only the literal `'1'` enables it; a missing,
corrupt or hand-edited value is OFF. There is no second storage key and no engine-settings
migration: the engine settings blob is untouched.

`frontend/src/components/views/SettingsView.jsx`, in its own **Camere în fundal** section:

- a checkbox labelled `Toate camerele rulează în fundal (implicit OPRIT)` with the stored value;
- the toggle writes the key and immediately calls the context's `setBackgroundEnabled(next)`
  (the provider forwards it to `manager.setEnabled(next)`), so no reload and no remount;
- a persistent warning block under the checkbox, not dismissible, with the honest copy:

> Pornește un worker de inferență separat pentru fiecare cameră, nu doar pentru cea din Live.
> 3 camere înseamnă aproximativ 3× memoria și CPU-ul unei singure camere (fiecare worker are
> propria sesiune ONNX). Ritmul este redus intenționat, ~1 cadru la 2 s (0,5 fps) per cameră —
> nu 30 fps și nu o înregistrare 24/7. Într-un tab ascuns browserul suspendă redarea și
> temporizează timer-ele, deci evenimentele pot întârzia sau lipsi. Incidentele din toate
> camerele apar în listă și în raportul de tură. Implicit: OPRIT.

- show the live state (`OPRIT`, `PORNIT — 2 camere`, `REFUZAT: …`) from `status()`, mapping
  `refusedReason` to Romanian copy:
  - `camera-limit`: `Prea multe camere pentru limita de siguranță (max. 3).`
  - `low-hardware`: `Mașina are prea puține nuclee pentru încă o sesiune ONNX per cameră.`
  - `hardware-unknown`: `Browserul nu raportează numărul de nuclee; guarda refuză.`
- a per-camera row (`running`, `starting`, `preluată de Live`, `skipped`, `unsupported`,
  `backoff`, `stopped`) with its incident count and the reason for a skip or failure; the
  webcam row says it never runs in the background;
- do not auto-enable it from WebGPU, from Live, or from a demo flag. The only writer is the
  operator.

## 4. Where the manager mounts

No separate host component: the manager hook is called from `SecurityProvider`, which sits
above the routed screens in `App.jsx`. That is the composition root and the only place the
manager survives a route change.

New files shipped on this branch:

- `frontend/src/engine/createBackgroundEngine.js` (worker + hidden video factory, section 6)
- `frontend/src/context/useBackgroundCameras.js` (manager lifecycle + preference)

The hook owns the manager in a ref and creates it in one effect:

```js
const latest = useRef({ addEngineEvents, zones, enabled, liveEngineCameraId });
latest.current = { addEngineEvents, zones, enabled, liveEngineCameraId };

useEffect(() => {
  const manager = createBackgroundCameras({
    cameras: list,                          // clip cameras, webcam excluded
    zonesForCamera: (camera) => toEngineZones(latest.current.zones, camera.id),
    engineFactory: ({ cameraId, zones }) => createBackgroundEngine({
      cameraId,
      zones,
      referenceUrl: backgroundReferenceUrl(latest.current.zones, cameraId),
      intervalMs: BACKGROUND_INTERVAL_MS,   // 2000
    }),
    intervalMs: BACKGROUND_INTERVAL_MS,
    maxCameras: 3,
    minHardwareConcurrency: 4,
    onEvent: (event) => latest.current.addEngineEvents([event]),
  });
  managerRef.current = manager;
  manager.start();
  // Ownership before enabling: never start a worker for the camera Live feeds.
  manager.setActiveCamera(latest.current.liveEngineCameraId || null);
  manager.setEnabled(latest.current.enabled);
  return () => {
    manager.stop();
    managerRef.current = null;
  };
}, [runKey]); // sorted ids + statuses; never addEngineEvents or zones
```

**Do not put `addEngineEvents` or `zones` in the dependency list.** They change identity on
every store render/zone edit; the effect would tear down every worker and reload the ONNX
graphs. Callbacks and zones are read through refs; the lifecycle depends only on which
cameras exist. A zone edit restarts the run once after an 800 ms debounce; the models come
from the HTTP cache.

For Settings, two additive context keys (the frozen surface stays intact):
`getBackgroundStatus()` returns `managerRef.current?.status() ?? null`, and
`setBackgroundEnabled(value)` writes the preference and calls `manager.setEnabled(value)`.
Settings polls only `getBackgroundStatus` once per second while the option is on; there is
no global re-render loop.

## 5. Hidden `<video>` per camera

`createBackgroundEngine` creates one `<video>` per eligible camera in `start()`, so an OFF
run has zero video elements and zero workers:

```js
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.loop = true;                // demo clips; a live stream ignores loop
video.preload = 'auto';
video.tabIndex = -1;
video.setAttribute('aria-hidden', 'true');
video.dataset.backgroundCamera = camera.id;
// Off-screen but still decoded. `display: none` can stop decoding in some browsers.
Object.assign(video.style, {
  position: 'fixed',
  left: '-10000px',
  top: '0',
  width: '2px',
  height: '2px',
  opacity: '0',
  pointerEvents: 'none',
});
```

Source resolution reuses the Live helpers instead of a second table:
`mediaPlan()` / `demoClipFor()` from `components/live/liveMedia.js` and the
`VITE_DEMO_CAMERA` / `VITE_DEMO_CLIP` env parsing. A camera is eligible only when it has a
playable source:

- demo clip (`media/<id>.mp4` or the configured clip entry) that is same-origin http(s);
- `camera.status !== 'offline'` (no source to decode);
- `camera.id !== WEBCAM_CAMERA_ID`: one physical device, one permission prompt, and Live
  already asks for it.

`rtsp://` rows cannot be played by a browser; the seeded demo clips are what actually run.
A camera whose clip 404s or is not decodable is reported as `unsupported` in Settings; the
UI never claims the RTSP stream is processed.

`video.play().catch(...)` reports a refusal, and a cheap 5 s watchdog restarts playback if
the element is `paused` while the option is on (same intent as `LOOP_WATCHDOG_MS` in
`useEngine`, but no frame loop and no canvas).

## 6. Engine factory and the low-rate worker

`createBackgroundEngine({ cameraId, zones, referenceUrl, intervalMs })` returns the core's
`{ start, stop, onEvent, status }`:

1. If `typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'`, return an
   engine whose `status()` is `{ state: 'unsupported', message }`; `start()` does nothing.
   The manager exposes it and stops retrying.
2. If the resolved clip is not a playable same-origin URL, return the same `unsupported`
   engine instead of creating a worker that can never decode a frame.
3. `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` — the same
   worker module as Live. One worker per camera on purpose: a second camera in the same
   worker would serialize behind one ORT session and lose the per-camera error isolation.
4. Post one init message before the first frame:

```js
worker.postMessage({
  type: 'init',
  cameraId,
  zones,                 // toEngineZones(zones, cameraId), contract shape
  engineOn: true,        // background coverage does not follow the Live card switch
  wasmThreads: 1,        // background gets one thread; Live keeps its 4
  safetyBlur: true,      // forced, even if the setting is off (privacy, section 9)
  inputSize: 640,        // YOLO is 640 anyway; smaller copies between threads
  referenceUrl,          // uploaded zone frame, else the demo still; fetch once
});
```

5. **Sampling lives in the page, not in `worker.js`.** A `setInterval` of `intervalMs`
   (2 s) tries one frame: skip when `inFlight`, when the models are not `ready` yet, when
   `video.readyState < 2`, or when `video.videoWidth === 0`; otherwise
   `createImageBitmap(video)`, post
   `{ type: 'frame', bitmap, timestamp: performance.now(), mediaTime: video.currentTime }`
   with the bitmap transferred and `inFlight = true`. The worker clears the flag when
   `result` arrives. This keeps `worker.js` untouched and caps inference at ~0.5 fps per
   camera. `requestVideoFrameCallback` is deliberately not used: it fires at display rate
   and pauses in a hidden tab.
6. `result`: take `message.events`, convert each `snapshot_blob` to
   `URL.createObjectURL(blob)` exactly like `useEngine` (the worker cannot own the URL),
   close `message.bitmap` without drawing it (no canvas, no presentation), and hand the
   events to the manager's listener. Keep the last `ms/fps` for `status()`.
7. `ready` marks the models loaded; `status()` reports `loading` until then.
   `error`/`worker.onerror` → `status()` reports `{ state: 'error', message }`, which the
   manager turns into a retry. `stop()` clears both intervals, terminates the worker, pauses
   and clears the video, and removes it from the document; never leave an interval alive
   across a toggle.
8. The page owns the snapshot URLs it hands over. Incidents that the store persists keep
   their URL for the session (current Live behavior, and revoking would blank the evidence
   already on screen). URLs created for events that no listener accepted are revoked
   immediately, and any still undelivered at `stop()` are revoked there.

Model downloads: the first background worker fetches `yolo26n.onnx` and `yunet.onnx` from
the same origin; later workers reuse the HTTP cache but each keeps its own ORT session in
memory. That is the 3× cost the warning describes.

## 7. How incidents enter `addEngineEvents`

```js
onEvent: (event) => latest.current.addEngineEvents([event])
```

- `addEngineEvents` is the only entry point; never call `setEvents` directly. It decorates
  with camera/zone names, builds the template report and persists the row (section
  `useIncidentStore.js`).
- The manager already deduped by `event_id`; the store dedupes again, so a route change, a
  StrictMode re-render or a brief overlap with Live cannot add the same incident twice.
- `snapshot_url` stays a page-owned `blob:` URL, as documented for Live in
  `docs/browser-engine.md` §3. Nothing is uploaded and no `minio://` appears.
- Incidents from background cameras appear in Live's feed (`IncidentFeed`), the incident
  list, KPIs and the shift report exactly like Live incidents; there is no "background"
  badge, because they are real detections. The Settings status is the only place that says
  which camera had a worker.

## 8. Avoiding double-processing of the active camera

Live publishes what it actually feeds to its engine, not just what is selected:

```js
// LiveView, after `engineEnabled` is computed
const { reportActiveCamera } = useSecurity();
useLayoutEffect(() => {
  reportActiveCamera(engineEnabled ? activeCamera?.id ?? null : null);
  return () => reportActiveCamera(null);
}, [engineEnabled, activeCamera?.id, reportActiveCamera]);
```

`engineEnabled` is the exact expression that already gates `useEngine`:

```js
browserEngineOn && engineSource && displayMode !== 'fullscreen'
```

A layout effect is deliberate: the ownership update lands before the provider's passive
effect creates the manager, so the manager never starts a frame pump for the camera Live is
claiming. A worker object can still be constructed at the same commit in a cold start and is
terminated before the first 2 s tick; no frame, no incident.

The provider subscribes with `manager.setActiveCamera(id)`:

- Live mounted with its engine on → that camera is `active`, its background engine is
  stopped, and the other cameras keep running (their engines are not recreated);
- Live unmounted (another route), browser engine off, local webcam, or fullscreen →
  `null` → background takes every eligible camera;
- switching the Live camera stops one background engine and starts the newly selected
  camera's engine; the rest are untouched;
- a Live worker that fails or stalls **keeps ownership** of its camera. There is no
  automatic fallback to a background worker, because two workers on the same frames would
  duplicate CPU and incidents; the Live banner already reports the failure.

A one-commit overlap during a route transition is possible. The `event_id` dedupe in the
manager and in the store is the second line of defense; the acceptance check in section 10
verifies it.

## 9. Privacy

- The background path is the same `worker.js` pipeline: face blur runs before any bitmap or
  snapshot leaves the worker, and blur failure is fail-closed (no snapshot).
- `safetyBlur: true` is forced for background workers regardless of the Settings value,
  because nobody watches these feeds live and a missed profile must still be covered.
- The hidden `<video>` is off-screen, muted, unfocusable and `aria-hidden`; it is never in
  the rendered stage and no canvas is attached to it.
- Snapshots remain page-owned blob URLs; the incident store owns them after handoff.
  Nothing is written to disk or sent to a server. No names, no emotion recognition, no
  unblurred faces, same as Live.
- A camera that runs in the background is still not monitoring in a hidden tab: browsers
  throttle timers and may pause decoding. The UI copy says so; do not present it as NVR.

## 10. Tab throttling and low rate, stated honestly

- The core's `intervalMs` (2 s) is the delivery/retry pump. The factory's frame interval is
  the same number, so a camera at most runs one inference per 2 s.
- A background browser tab clamps timers (commonly to 1 s, then more after several minutes)
  and may pause video decoding. Events can therefore arrive late or not at all while the
  tab is hidden. This option means "off-screen in the open app", not "24/7 recording".
- No queue grows unbounded: at most 32 events per camera wait for a pump; excess is counted
  in `status().cameras[].dropped`.
- `document.visibilityState` is not a dependency of the core; a later change may pause
  engines when hidden if measurement shows it helps, but it must not be used to claim
  background-tab coverage.

## 11. Measurement and acceptance

Run on Chromium, `crossOriginIsolated === true` where possible, `hardwareConcurrency >= 8`,
with **two** background cameras (the seeded set) for **2 minutes**. The option starts OFF;
turn it on in Settings.

| Check | Method | Acceptance |
|---|---|---|
| Memory | Browser task manager (or `performance.memory` in Chromium) before/after | Record the delta; no unbounded growth. Target: ≤ 300 MB per background worker and ≤ 1 GB tab total for 2 cameras. Treat as a target to confirm, not a measured claim until the run is logged. |
| CPU | Browser task manager, idle tab | ≤ 2× the one-Live-camera baseline on the same machine; Live fps must not drop more than ~20%. |
| Per-camera rate | `status().cameras[].engineStatus` / worker `ms`, `fps` | ~0.5 inference/s per camera, no stuck `inFlight`, no backlog. |
| No duplicates | `new Set(events.map(e => e.event_id)).size === events.length` after 2 min; same for the store | Zero duplicate ids; each event's `camera_id` matches its worker. |
| Active skip | Open Live on camera A, then switch to B, then Incidents | A→B: only one worker per camera at a time; no incident from the same frame twice. |
| Guard | Temporarily pass 4 cameras; then run on a 2-core profile | `refusedReason` is `camera-limit` / `low-hardware`, zero background workers, Live unaffected. |
| Teardown | Toggle OFF; leave Settings | Worker count in DevTools returns to Live only; timer count does not grow; no further incidents. |
| Hidden tab | Hide the tab for 1 min, restore | No crash, no duplicate burst; delayed events are acceptable and reported as such. |
| Privacy | Raise a background incident, open Network panel and the snapshot | Snapshot visibly blurred, zero upload requests, no raw frame rendered. |

Acceptance is the table above plus the unit tests: the manager's 20 and the wiring's 11
(`useBackgroundCameras.test.mjs`). If a row fails, the toggle stays OFF by default and the
failure is reported; do not lower a check to pass.

### 11a. Measured on this machine (2026-11-02)

Chromium (Playwright build) on 16 logical cores, static `/LocalSight/` build, option turned
ON through Settings on the `reports` route, 45 s warm-up, 15 s sample. Three seeded clips
ran (`stand12`, `taxiway-b`, `baggage-area`), no Live engine.

| Check | Measured |
|---|---|
| Whole-browser RSS | OFF 215 MB → ON 261 MB (+46 MB; summed RSS, shared pages counted per process) |
| Whole-browser CPU | OFF 2.7 % → ON 4.9 % of one core (CPU-time delta across the Chromium process tree over 15 s) |
| Page-owned objects | 3 hidden videos, `readyState = 4`, `muted`, `loop`, positioned at x = -10000, **0 canvases**, 0 rendered frames |
| Incidents | 2 incidents from `stand12` and `taxiway-b` in 120 s while on Reports; 0 duplicate ids; `local` chip present. `baggage-area` ran at ~0.5 fps but produced no incident in that window — reported as zero, not implied. |
| Worker init | per camera: `inputSize=640`, `wasmThreads=1`, `safetyBlur=true`, `engineOn=true`, contract zones, reference frame |
| Live ownership | Live engine on `stand12`: 2 background videos (`taxiway-b`, `baggage-area`), no `stand12` background video; after `engine-stop`, 3 videos and `stand12` published on the next tick |
| Guard (2 cores) | `REFUZAT: … minimum 4`, `refusedReason=low-hardware`, 0 videos, all rows `skipped`; Live unaffected |
| Teardown | toggle OFF: 0 background videos, status `OPRIT`, incident count unchanged over the next 12 s |
| Privacy | background snapshot 58.7 KB JPEG; head band pixelated (forced `safetyBlur`); no canvas and no upload |
| Hidden tab | not measured with a real background tab; browser timer throttling is the documented behaviour, not a claim of coverage |

## 12. Files and PR sequencing

Shipped together on `prep/background-ui`, all behind the OFF toggle:

- `frontend/src/engine/backgroundCameras.js` + tests (core, unchanged interface)
- `frontend/src/engine/createBackgroundEngine.js` (hidden video + worker factory)
- `frontend/src/context/useBackgroundCameras.js` + tests (preference, manager lifecycle)
- `frontend/src/context/SecurityContext.jsx` (additive `reportActiveCamera`,
  `liveEngineCameraId`, `backgroundEnabled`, `setBackgroundEnabled`, `getBackgroundStatus`)
- `frontend/src/components/views/LiveView.jsx` (ownership layout effect only)
- `frontend/src/components/views/SettingsView.jsx` (toggle, warning, per-camera status,
  guard copy, QA F6 thread select)
- this document

Follow-ups: a hidden-tab measurement, a Live `engine_on` change without a full run restart,
and (only if measurement shows a leak) a store-aware snapshot release.

Out of scope: changing `docs/contract.md`, adding dependencies, FOD/mobile/PWA, recording,
server upload, background-tab guarantees, and sharing one ORT session between cameras.

## 13. What is real now

- Real and measured: manager API, dedupe, caps, active-camera skip, resource guard, backoff,
  unsupported reporting, hidden videos and their teardown, snapshot blur, Settings status,
  and the QA F6 thread display, all covered by `node --test` and the browser run above.
- Default OFF: no worker, no `<video>`, no timer and no extra incident until the operator
  enables it. Old/corrupt storage values are OFF.
- Honest limits: ~0.5 fps per camera, one ORT session per camera, a hidden tab is throttled
  by the browser, and only same-origin demo clips are processed; RTSP rows are not.
