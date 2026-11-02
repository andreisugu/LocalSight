# Background cameras — integration plan (OFF by default)

Status: **core landed, application wiring pending.** This branch adds
`frontend/src/engine/backgroundCameras.js` and its tests. Nothing imports it yet, so the
app behaves exactly as before. This document is the exact plan for the wiring that follows
and for how the option is measured and accepted.

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

`frontend/src/utils/engineSettings.js`:

- add `backgroundCameras: false` to `DEFAULT_ENGINE_SETTINGS`;
- `readEngineSettings()` accepts it only when `typeof value === 'boolean'` (same tolerance
  as `safetyBlur`), so an old or hand-edited blob cannot enable it;
- add `storeBackgroundCameras(value)` next to `storeSafetyBlur`, reusing
  `storeEngineSettings` and the existing `localsight.engineSettings` key. No new storage
  key, no new quota entry.

`frontend/src/components/views/SettingsView.jsx`, in the existing **Motor & performanță**
section, below the WASM/blur controls:

- a checkbox labelled `Camere în fundal (toate camerele)` with the stored value;
- the toggle writes through `storeBackgroundCameras` and immediately calls the context's
  `setBackgroundEnabled(next)` (the host forwards it to `manager.setEnabled(next)`), so no
  reload and no remount is needed;
- a persistent warning block under the checkbox, not dismissible, with the honest copy:

> Rulează un worker de inferență pentru fiecare cameră, nu doar pentru cea din Live.
> 3 camere înseamnă aproximativ 3× memoria și CPU-ul unei singure camere (fiecare worker
> are propria sesiune ONNX). Ritmul este redus intenționat (~1 cadru la 2 s), dar un laptop
> mic va deveni lent. Într-un tab ascuns browserul suspendă redarea și temporizează
> timer-ele, deci evenimentele pot întârzia; nu este o înregistrare 24/7. Incidentele din
> toate camerele apar în listă și în raportul de tură. Implicit: OPRIT.

- show the live state (`OPRIT`, `PORNIT — 2 camere`, `REFUZAT: …`) from `status()`, mapping
  `refusedReason` to Romanian copy:
  - `camera-limit`: `Prea multe camere pentru limita de siguranță (max. 3).`
  - `low-hardware`: `Mașina are prea puține nuclee pentru încă o sesiune ONNX per cameră.`
  - `hardware-unknown`: `Browserul nu raportează numărul de nuclee; guarda refuză.`
- do not auto-enable it from WebGPU, from Live, or from a demo flag. The only writer is the
  operator.

## 4. Where the manager mounts

New files (not in this branch):

- `frontend/src/components/background/BackgroundCamerasHost.jsx`
- `frontend/src/engine/backgroundEngine.js` (worker factory, section 6)
- optionally `frontend/src/context/useBackgroundCameras.js` if the host grows; not needed
  for the first cut.

Mount the host in `AppShell`, inside `SecurityProvider` and **outside** `ScreenOutlet`:

```jsx
<SecurityProvider>
  <AppShell />
</SecurityProvider>
```

```jsx
// AppShell, next to <Toast />
<BackgroundCamerasHost />
```

The host survives route changes, so switching from Live to Incidents does not tear down
background workers. It reads `cameras`, `zones`, `addEngineEvents` through `useSecurity()`
and renders only one hidden container plus, later, a status probe.

The host owns the manager in a ref and creates it in one effect:

```js
const latest = useRef({ addEngineEvents, zones });
latest.current = { addEngineEvents, zones };

useEffect(() => {
  const manager = createBackgroundCameras({
    cameras: backgroundCameras,             // filtered, playable sources only
    zonesForCamera: (camera) => toEngineZones(latest.current.zones, camera.id),
    engineFactory: ({ cameraId, zones }) => createBackgroundEngine({
      cameraId,
      zones,
      video: videos.get(cameraId),
      intervalMs: BACKGROUND_INTERVAL_MS,   // 2000
    }),
    intervalMs: BACKGROUND_INTERVAL_MS,
    onEvent: (event) => latest.current.addEngineEvents([event]),
    now: () => Date.now(),
  });
  managerRef.current = manager;
  manager.start();
  manager.setEnabled(readEngineSettings().backgroundCameras);
  return () => {
    manager.stop();
    managerRef.current = null;
  };
}, [cameraKey]); // sorted ids + statuses; never addEngineEvents or zones
```

**Do not put `addEngineEvents` or `zones` in the dependency list.** They change identity on
every store render/zone edit; the effect would tear down every worker and reload the ONNX
graphs. Callbacks and zones are read through refs; the lifecycle depends only on which
cameras exist. On a zone or `engine_on` change, apply the same channels Live uses: worker
`{ type: 'config' }` if `backgroundEngine` exposes it, otherwise `manager.stop();
manager.start()` (engines restart, models come from the HTTP cache). Add that restart effect
in the host, debounced.

For Settings, add two additive context keys (the frozen surface stays intact):
`getBackgroundStatus()` returns `managerRef.current?.status() ?? null`, and
`setBackgroundEnabled(value)` forwards to the manager (and to storage in the toggle
handler). Settings polls only `getBackgroundStatus` once per second while mounted; there is
no global re-render loop.

## 5. Hidden `<video>` per camera

The host renders a container and creates one `<video>` per eligible camera imperatively, so
refs exist before the factory is called:

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

- demo clip exists (`media/<id>.mp4` or the configured clip entry), or a same-origin URL;
- `camera.status !== 'offline'` (no source to decode);
- `camera.id !== WEBCAM_CAMERA_ID`: one physical device, one permission prompt, and Live
  already asks for it;
- the camera is not in the temporary failed set.

`rtsp://` rows cannot be played by a browser; the seeded demo clips are what actually run.
Say so in the UI; do not claim the RTSP stream is processed.

Wait for `loadeddata`/`canplay` (with a 10 s timeout) before building the manager, and call
`video.play().catch(...)`. If a video later errors, remove that camera from the next run and
surface it; don't hand the factory a dead element. A cheap 5 s watchdog restarts playback if
`paused` while the option is on (same intent as `LOOP_WATCHDOG_MS` in `useEngine`, but no
frame loop in the host).

## 6. Engine factory and the low-rate worker

`createBackgroundEngine({ cameraId, zones, video, intervalMs })` returns the core's
`{ start, stop, onEvent, status }`:

1. If `typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'`, return an
   engine whose `status()` is `{ state: 'unsupported', message }`; `start()` does nothing.
   The manager exposes it and stops retrying.
2. `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` — the same
   worker module as Live. One worker per camera on purpose: a second camera in the same
   worker would serialize behind one ORT session and lose the per-camera error isolation.
3. Post one init message before the first frame:

```js
worker.postMessage({
  type: 'init',
  cameraId,
  zones,                 // toEngineZones(zones, cameraId), contract shape
  engineOn: Boolean(camera.engine_on),
  wasmThreads: 1,        // background gets one thread; Live keeps its 4
  safetyBlur: true,      // forced, even if the setting is off (privacy, section 9)
  inputSize: 640,        // YOLO is 640 anyway; smaller copies between threads
});
```

4. **Sampling lives in the page, not in `worker.js`.** A `setInterval` of `intervalMs`
   (2 s) tries one frame: skip when `inFlight`, when `video.readyState < 2`, or when
   `video.videoWidth === 0`; otherwise `createImageBitmap(video)`, post
   `{ type: 'frame', bitmap, timestamp: performance.now(), mediaTime: video.currentTime }`
   with the bitmap transferred and `inFlight = true`. The worker clears the flag when
   `result` arrives. This keeps `worker.js` untouched for v1 and caps inference at
   ~0.5 fps per camera. `requestVideoFrameCallback` is deliberately not used: it fires at
   display rate and pauses in a hidden tab.
5. `result`: take `message.events`, convert each `snapshot_blob` to
   `URL.createObjectURL(blob)` exactly like `useEngine` (the worker cannot own the URL),
   close `message.bitmap` without drawing it (no canvas, no presentation), and hand the
   events to the manager's listener. Keep the last `ms/fps` for `status()`.
6. `ready` → nothing to load on the page; `status()` reports `loading` until the first
   `result`. `error`/`worker.onerror` → `status()` reports `{ state: 'error', message }`,
   which the manager turns into a retry. `stop()` clears the interval, terminates the
   worker and drops listeners; never leave the interval alive across a toggle.
7. The page owns the snapshot URLs it hands over. Incidents that the store persists keep
   their URL for the session (current Live behavior); events dropped by a late/duplicate
   path should be revoked in the factory. A bounded revoke on manager stop is a follow-up,
   not a blocker.

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
useEffect(() => {
  reportActiveCamera(engineEnabled ? activeCamera.id : null);
  return () => reportActiveCamera(null);
}, [engineEnabled, activeCamera?.id, reportActiveCamera]);
```

`engineEnabled` is the exact expression that already gates `useEngine`:

```js
browserEngineOn && engineSource && displayMode !== 'fullscreen'
```

The host subscribes with `manager.setActiveCamera(id)`:

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
- `document.visibilityState` is not a dependency of the core; a later host may pause
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

Acceptance is the table above plus the core's 20 unit tests. If a row fails, the toggle
stays OFF by default and the failure is reported; do not lower a check to pass.

## 12. Files and PR sequencing

This branch (core only, no behavior change):

- `frontend/src/engine/backgroundCameras.js`
- `frontend/src/engine/backgroundCameras.test.mjs`
- `frontend/src/engine/BACKGROUND.md`

Follow-up PRs, each behind the OFF toggle:

1. `utils/engineSettings.js`: `backgroundCameras` key + tests; `SettingsView.jsx`: toggle,
   warning, status copy. No engine starts even when toggled until the host exists? Ship
   after (2).
2. `components/background/BackgroundCamerasHost.jsx`, `engine/backgroundEngine.js`, mount in
   `App.jsx`, additive `reportActiveCamera`, `getBackgroundStatus` and
   `setBackgroundEnabled` keys in `SecurityContext.jsx`. Hidden videos + factory.
3. `LiveView.jsx`: report the active camera only while its engine really runs. Measurement
   run and numbers recorded here.
4. `docs/browser-engine.md` cross-link, `runtime` numbers, and any worker `config` support
   for zone edits.

Out of scope: changing `docs/contract.md`, adding dependencies, FOD/mobile/PWA, recording,
server upload, background-tab guarantees, and sharing one ORT session between cameras.

## 13. What is real now

- Real: the manager API, dedupe, caps, active-camera skip, resource guard, backoff,
  unsupported reporting and timer lifecycle, covered by `node --test`.
- Not wired: Settings toggle, hidden videos, worker factory, context keys, active-camera
  report, measurement. The app has no behavior change on this branch.
- No number in section 11 is measured yet; the targets are there to be confirmed or
  corrected by the run, not quoted as results.
