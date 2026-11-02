# LocalSight — architecture and code review

**Branch:** `prep/architecture-audit` · **Base commit:** `ad05128` · **Date:** 2026-11-02
**Scope:** `frontend/` (product), `docs/`, CI workflows. Read-only review: no application code was changed.
**Method:** full read of `src/`, `docs/browser-engine.md`, `docs/contract.md`, `docs/rewrite-backlog.md`,
`docs/provenance.md`, `docs/qa/*`; `python3 scripts/provenance.py`; `git grep`; `npm run test:unit`;
`VITE_USE_MOCK=true npm run build`; two throwaway Node harnesses in `/tmp` to reproduce the event-id
collision and the HTTP error path.

Evidence commands and their results are in Appendix A. Findings that were already recorded in
`docs/qa/` and are **fixed in this tree** are listed in Appendix B so they are not re-litigated.

---

## 1. Verdict

The codebase is in better shape than its history suggests. The provenance sweep is honest
(97.2% ours, 2.8% structural scaffolding, zero inherited logic), the module graph has **no cycles and no
layer violations**, and 403 pure tests run in under half a second. The engine core (`zones.js`,
`tracker.js`, `events.js`, `vest.js`, `blur.js`) is genuinely deep: small interfaces, heavy behaviour,
tested against the Python reference.

The problems are concentrated in the two places where the product is newest: the **engine/page boundary**
(`useEngine.js` ↔ `worker.js`) and the **multi-zone event identity**. Two defects are severe enough to fix
before the next demo (P0), and six are P1. Nothing here requires a rewrite; most fixes are under 30 lines.

The single most misleading thing in the repo is not code: `docs/browser-engine.md` still describes the
tracker, zones and the store as "the target, not code" and promises a snapshot lifecycle that does not
exist. The document is cited as the design source of truth, so it should be corrected in the same pass as
the code.

---

## 2. Module map and responsibilities

| Area | Files (lines) | Responsibility | Shape |
|---|---|---|---|
| Pure engine core | `engine/zones.js` (380), `tracker.js` (296), `events.js` (334), `pipeline.js` (265), `vest.js` (383), `blur.js` (71), `decode.js` (163), `report.js` (71) | Geometry, membership, rules, tracking, event envelope, PPE colour, blur geometry, YOLO/YuNet decode, report template. No DOM, no inference. | Deep, well-documented, mostly tested |
| Model I/O | `engine/detectors.js` (254), `engine/webgpu.js` (29) | ORT-web loading, provider choice, letterbox, RGBA→NCHW, inference calls. | Deep at the boundaries, but the two pure helpers are untested |
| Worker shell | `engine/worker.js` (836) | Frame loop, fail-closed privacy guard, PPE read, render, snapshot, message protocol, media clock, pipeline lifetime. | **God file** by necessity; 4 of its 8 concerns are pure and untested |
| Page/hook bridge | `engine/useEngine.js` (405) | Worker lifecycle, frame pump (`rVFC`), canvas paint, stats throttle, snapshot URL ownership, provider watchdog. | Deep but untyped contract with the worker |
| Live composition | `views/LiveView.jsx` (234), `live/useLiveMedia.js` (207), `live/liveMedia.js` (341), 11 `live/*` components | Sources, labels, webcam lifecycle, readouts, ack guard. | Rules extracted and tested; effects still in hooks |
| Zone editor | `views/ZoneEditorView.jsx` (379), `utils/zoneDraft.js` (460), `zones/*` (804) | Draft document state machine + canvas pointer geometry + panels. | Best-separated feature in the app; 39 reducer tests |
| Incident screens | `views/Incident*.jsx`, `views/ReportsView.jsx`, `views/SettingsView.jsx`, `incidents/*`, `utils/incident*.js`, `utils/reportExport.js`, `utils/systemView.js` | Presentation + tested formatters. | Good; flat JSX, few decisions |
| App store | `context/SecurityContext.jsx` (164) + 11 hooks | Composition root; state per concern; frozen public surface. | Clean; the provider is wiring only |
| Data / API | `data/*` (fixtures + clock), `services/{api,mockApi,backendApi,backendMappers,http,shift,config}.js` | Demo data, build-mode switch, HTTP transport, field mapping. | Small; `api.js` is a shallow pass-through |
| Product chrome | `layout/Header.jsx` (449), `Sidebar.jsx` (370), `common/*` | Navigation, search, operator, theme, toasts. | UI-only; `Header` is the largest hand-written component |
| Dev pages | `views/BenchView.jsx` (764), `views/LabView.jsx` (554) | Measurement and spike pages, URL-only. | **Shipped in the main bundle** (finding P2-6) |
| Isolation | `public/coi-serviceworker.js` (75), `main.jsx:14-43` | COOP/COEP for threaded WASM, one reload guard. | Small, correct, untested |

Dependency direction is clean: `data` → `services` → `context` → `components`/`views`; `engine` is a leaf
that `context` and `views` import, never the other way. A script over every import found **0 cycles and 0
layer violations**. The engine contract with React is one-directional: the worker never touches the DOM,
and the page never touches a source pixel except to draw the bitmap it is handed.

### Strengths worth protecting

- Fail-closed privacy is real: a missing model, a failed detection or a failed blur produces an opaque
  guard bitmap (`worker.js:311-365`), and the canvas is hidden again on the page (`EngineOverlayBadges.jsx:72-80`).
- Snapshot ownership is correct: the worker produces a `Blob`, the page creates the URL
  (`useEngine.js:174-182`), because a worker-created URL dies with the worker and opening an incident
  terminates it.
- Effect ordering in `useEngine` is deliberate and documented (config in a ref so zone edits do not
  reload ONNX).
- `zoneDraft.js` is a textbook reducer: every transition pure, no mutation, history as data.
- The QA documents are honest about their own limits (headless, no GPU) and about the product.

---

## 3. Ownership boundaries: `useEngine` / worker / context / UI

### 3.1 Who owns what today

| Concern | Owner | Mechanism | Assessment |
|---|---|---|---|
| Zone/engine/camera config | Page (`LiveView.jsx:97-110`) sends, worker (`worker.js:104-119`) rebuilds/sets | `init` once, `config` on change; page filters zones by camera, then the worker filters again | Duplicated filter; no acknowledgement back to the page |
| Frame production | Page (`useEngine.js:246-289`) | `requestVideoFrameCallback` + one frame in flight | Correct drop-instead-of-queue policy |
| Detection, PPE, blur, render, snapshot | Worker | Pixel path never leaves the worker | Correct and fail-closed |
| Event envelope | Worker (`pipeline.js`) | `buildEvent` validates the contract | Correct except `escalate_after_s` (P1-4) |
| Event identity + snapshot URL | Split: worker builds id, page creates URL | page maps `snapshot_blob` → `blob:` URL | Identity collides across zones (P0-1) |
| Incident list, ack, dedupe | Context (`useIncidentStore.js:169-175`) | `mergeEngineEvents` dedupes by `event_id` | Assumes ids are unique; they are not |
| Fatal engine error | Worker (`worker.js:48-50,173-200`) | sticky `modelError` for the worker's life | No recovery path from the UI (P1-3) |
| Status/fps/vest readout | Page (`useEngine.js:186-205`) | throttled stats object | No frame-age/staleness signal (P2-4) |
| Guard/raw-frame display | Page (`MediaStage.jsx:81,89-97`; `EngineOverlayBadges.jsx`) | `opacity-0` from the click, opaque canvas above | Correct |

### 3.2 Behaviour on lifecycle events

| Trigger | What happens today | Gap |
|---|---|---|
| **Engine on → off → on** | Effect cleanup terminates the worker and resets stats; a new worker reloads both graphs from HTTP cache (~2.5–3 s warm-up) | Expected, but the operator loses tracker/rule state and the "last incidents" panel empties |
| **Camera switch (engine on)** | No worker restart. `config` with the new `cameraId` rebuilds the pipeline (tracker, cooldown, vest state) and keeps the model sessions (`worker.js:803-819`). Video counters reset on `loadstart`/`emptied` | Good design. But if the zone list arrives empty, detection silently turns off (P2-3) |
| **Zone edit** | `config` → `pipeline.setZones`; tracker and cooldown state survive | Correct. No ack to the page, so the card's "Zonă activă" can disagree with what the worker has |
| **Engine preference change** | Stored in `localStorage`, restarts the worker only if it changes the effective config | Correct |
| **Theme/locale change** | Re-render only; no engine effect | Correct |
| **Model load error** | `modelError` sticky; every later frame is a guard bitmap; UI shows `error` | No retry; toggling the engine off/on is the only recovery and is not suggested (P1-3) |
| **Worker `onerror`** | Status set to `error`; loop keeps posting frames; no restart | A wedged/crashed worker is not replaced (P1-3) |
| **Frame stall after the first frame** | Nothing; `status` stays `running`, fps frozen on the last value | A paused/hidden video or a wedged WASM worker looks live (P2-4) |
| **Cold load > 30 s** | The page-level stall watchdog kills the worker and forces WASM, even though the GPU was fine (`useEngine.js:342-346`) | Demo-breaking on a slow venue network (P0-2) |
| **Navigate to an incident** | Live unmounts, worker terminates, monitoring stops; incident snapshots survive because the page owns the URLs | Acceptable for a demo, but monitoring pauses while an operator reads an incident (P2-9) |

**Verdict on the boundary:** the split is conceptually right (page owns identity/display, worker owns
pixels), but it is coupled by stringly-typed messages with no shared protocol module. `ready`, `status`,
`result`, `error` and their fields are duplicated literals on both sides (`worker.js:169-200,764-779` vs
`useEngine.js:153-225`); the design doc even lists a `protocol.js` that was never written. That is cheap to
fix later (constants + JSDoc, no behaviour change); it is not P0.

---

## 4. Prioritized findings

Severity: **P0** = fix before the next demo; **P1** = correctness/demo risk, small fix; **P2** = quality,
consistency or test gap. “Effort” is the size of the minimal honest fix, not a refactor.
**Path convention:** source paths are relative to `frontend/src/` (`engine/...`, `services/...`);
`docs/`, `e2e/`, `scripts/` and `public/` are relative to the repo or `frontend/` as written.

| ID | Sev | Location | Problem | Consequence | Fix (small) | Effort |
|---|---|---|---|---|---|---|
| P0-1 | P0 | `engine/pipeline.js:198-240`, `engine/events.js:87-97` | `event_id` is `evt_camera_ms_track`, and `detectedAt` is computed once per frame. Two zones confirming for the same track in the same frame produce the **same id** (reproduced, Appendix A.3). | `event_id` is the contract's idempotency key (`docs/contract.md:38`). The store holds two rows with one id: ack patches both, the detail link resolves to the first, React keys collide. | Make the id unique per event without changing its shape: offset `detectedAt` by the event's index inside the frame (0/1/2 ms), or refuse a second event for the same `(track, ms)` in `step()`. Add a pipeline test with two overlapping zones. | S (~5 prod lines, ~30 test lines) |
| P0-2 | P0 | `engine/useEngine.js:342-346` | The 30 s stall timer is armed at worker start and is never reset by `status`/`ready` progress messages. A cold first start transfers 38.9 MB raw (28.7 MB ORT wasm + 9.9 MB YOLO + 0.23 MB YuNet + 0.12 MB JS); at 10 Mbit/s that is ~31 s, and even the ~16 MB compressed case is ~13 s before ORT starts compiling shaders. | A slow network is misdiagnosed as a wedged GPU: the worker is terminated mid-download and the engine is permanently forced onto WASM (no WebGPU), restarting the download. The likely venue-wifi failure of the demo. | Only arm the timer after a `ready` message, or clear/re-arm it on every `status`/`ready`. Keep the hard 30 s budget between frames, not during loading. | S (~15 lines) |
| P1-1 | P1 | `services/http.js:45-54` | On a non-ok response the code calls `response.json()` and, in the catch, `response.text()` on the **same consumed body**. Reproduced: a 502 HTML body throws `TypeError: Body is unusable` instead of `502 <detail>`. | Status and detail are lost whenever the error body is not JSON (proxy HTML, empty 502); `isConflictError` (`utils/incidentState.js:165`) then cannot see the `409` prefix, so the conflict-recovery path in `useIncidentStore` is skipped and the row is rolled back instead of refreshed. | Read `await response.text()` once, then `JSON.parse` in a `try`; build the message from the parsed `detail` or the raw text. | S (~10 lines + 2 tests) |
| P1-2 | P1 | `context/useZoneStore.js:22-47`, `services/backendApi.js:31-48` | Save is optimistic but never rolls back and toasts success **before** the await; `setEngineState` swallows every error and returns a success object, so the hook's `catch` never runs. | A failed zone save leaves a phantom zone and two contradictory toasts; a failed engine switch reports success and no "stare locală" is shown. Delete already does it correctly (`:49-59`), so this is an inconsistency, not a policy. | Capture the previous zone, revert on failure, move the success toast after the await; let `backendApi` rethrow and keep the local fallback in the hook. | S (~20 lines) |
| P1-3 | P1 | `engine/worker.js:48-50,173-200`; `engine/useEngine.js:227-235` | A single model-load or inference failure poisons the worker for its whole life; `worker.onerror` never restarts it; the card shows the error but offers no action. | A transient network/GPU error kills detection until the operator discovers the preference toggle. In a safety product the page should offer "reîncearcă". | Add a `restart()` from `useEngine` (bump a nonce in the effect deps) and a retry button in `LiveEngineCard` when `status === 'error'`; on `onerror`, restart once automatically. | S–M (~25 lines) |
| P1-4 | P1 | `utils/engineEventFeed.js:37-55`, `utils/incidentState.js:145-156` | Engine events never carry `escalate_after_s`; `mergeEngineEvents` already looks up the zone but copies only the report. Reproduced: `escalate_after_s` is `undefined` on merged engine events. | Engine incidents never escalate in the mock tick, while fixture incidents do; the ack toast says "Escaladare anulată" for a timer that was never armed. | `escalate_after_s: event.escalate_after_s ?? zone?.escalate_after_s ?? null` in the merge. Add one test. | S (1 line + test) |
| P1-5 | P1 | `engine/useEngine.js:174-182,198`; `utils/incidentState.js:74-83` | Every engine event gets a new `URL.createObjectURL`; no code ever calls `revokeObjectURL` (`git grep` in Appendix A.5). Engine history drops at 50, the store at 200, and neither revokes. | Snapshot blobs (50–150 KB each) are retained for the tab's life, including events evicted from both lists. Contradicts `docs/browser-engine.md:118` ("revoked when the incident is closed"). Not a 10-minute demo blocker; it is a shift-long leak and a false documentation claim. | Revoke when an event is sliced out of the store (`upsertEvent`/`mergeEngineEvents`) and when the engine history drops one. Keep the URL alive while any incident still references it. | S (~25 lines) |
| P1-6 | P1 | `engine/decode.js` (163 lines), `engine/detectors.js:75-116` | The two pure functions that turn model output into boxes (`decodeYolo`, `decodeYuNet`, `nms`) and the letterbox/RGBA→NCHW math have **no tests**. Only the one-off `/tmp` parity harness ever checked them. | A regression silently shifts every box: wrong persons, and — worse for this product — blur rectangles over the wrong region while the UI still says "procesat local". No CI signal. | Port 6–8 deterministic cases from `docs/qa/engine-parity.md` into `decode.test.mjs` and `detectors.test.mjs` (synthetic arrays, no canvas, no models). | S–M (~150 test lines) |
| P2-1 | P2 | `engine/worker.js:127-167,374-377` | The media clock (`mediaSeconds`) and the PPE size gate are module-private inside the worker, so they cannot be imported by Node tests; `frameCountsForVest` also re-implements the gate already in `vest.js:204-206`. | The code that decides whether "1 s in the zone" is 1 s (debounce, cooldown, event duration) is untested and can only be exercised in a browser. | Extract `mediaSeconds` and `targetFrameSize` into `engine/mediaClock.js` (pure, injected clock) with tests; export the gate from `vest.js` and call it from the worker. | M (~1 h, no behaviour change) |
| P2-2 | P2 | `components/views/ZoneEditorView.jsx:164-181`, `components/zones/ZoneCanvas.jsx:237-266` | The keydown listener is on `window`; points are non-focusable `div`s. Any arrow/Delete press on the page (outside form fields) nudges/deletes the selected point; arrows stop scrolling; a keyboard-only user cannot select a point at all. | Accessibility and accidental-edit risk on the editor screen; contradicts the hint that advertises the shortcuts. | Put `tabIndex={0}` and `onKeyDown` on the canvas container, render points as `button`s with `aria-label`, keep the text-field guard. | S (~20 lines) |
| P2-3 | P2 | `components/live/LiveView.jsx:87-91`, `engine/worker.js:104-119`, `engine/pipeline.js:77-82` | Zones are filtered by camera twice (page and worker). If either key drifts (`id` vs `zone_id`) the worker gets `[]` and the pipeline deliberately detects nothing; the page still shows "Zonă activă: engine-left". | A config bug presents as "the engine does nothing", with no signal in the UI or the console. | Report the applied `cameraId` and zone count in the `ready`/`status` payload and show "0 zone aplicate" in the card; keep one filter (prefer the worker's). | S (~15 lines) |
| P2-4 | P2 | `engine/useEngine.js:186-205,334-337`; `components/live/LiveEngineCard.jsx:83-101` | No last-frame timestamp. After the first frame the watchdog is satisfied forever: a paused/hidden video or a wedged worker leaves `status: 'running'` and a frozen fps on screen. | A stale frame looks like a live safety feed. That is the failure mode an operator is least able to notice. | Track `lastFrameAt` in the hook; expose `staleAfterMs`; downgrade the card to "ultimul cadru acum Ns" after ~5 s. | S (~15 lines) |
| P2-5 | P2 | `components/views/LabView.jsx:14-55` vs `components/live/liveMedia.js:30-79` | `CAMERA_ERRORS` and `cameraErrorFor` are duplicated verbatim (~55 lines) in a "spike" page that now ships in the bundle; `TYPE_LABELS` exists three times (`data/labels.js`, `constants/shiftReport.js:17`, `LiveEngineCard.jsx:21`). | Two copies drift; the one a user sees in `/lab` is not the one Live uses. | Import from `liveMedia` in `LabView`; import `TYPE_LABELS` in `LiveEngineCard` and `shiftReport`. | S (~60 lines deleted) |
| P2-6 | P2 | `App.jsx:12-13,23-24` | `LabView` (554) and `BenchView` (764) are statically imported for URL-only routes. | ~1 300 lines plus their state machines are parsed by every visitor and sit in the main 407 kB chunk. | `React.lazy` + `Suspense` for the `lab`/`bench` entries; no other change. | S (~10 lines) |
| P2-7 | P2 | `engine/events.js:275-303,320-334` | `applyAction` and `escalateIfDue` are a second, tested implementation of the status machine that the app does not use (the store uses `utils/incidentState.js` + `services/mockEvents.js`). Also dead: `FEED_FILTERS` (`utils/eventFeed.js:7`), the `toggleEngine` API alias (`services/api.js:26`), the worker's `close` handler (`worker.js:829-835`). | Two places to change an ack/escalation rule; a fix in the dead one changes nothing. Confusing for the next contributor. | Either wire the mock transitions to `applyAction`, or narrow the engine module to `buildEvent` and delete the dead exports. Delete the three smaller dead symbols. | S–M (delete ~100 lines or rewire ~30) |
| P2-8 | P2 | `main.jsx:14-43`, `index.html:12-20`, `utils/themePreference.js:4` | The COI reload guard, the service-worker registration and the "theme key" literal are untested; the theme key exists twice (inline script + module). Registration runs only in `PROD`, so dev is never isolated and the dev experience diverges from the shipped one. | A guard regression means an infinite reload loop or a permanently single-threaded production tab; a key rename silently breaks the first-paint theme. | Extract the guard decision into a small pure module (`shouldReloadForIsolation`) with tests; add a check in `scripts/check-base.mjs` that the HTML key matches the module; document the dev/prod difference. | S (~30 lines) |
| P2-9 | P2 | `components/views/LiveView.jsx:54-55,98-112` | Engine lifetime is tied to the Live screen. Opening an incident unmounts it and terminates the worker; returning restarts detection from scratch. | "Monitoring" stops while the operator reads an incident, and the engine history/fps restart. Acceptable for a demo, wrong for the product framing. | Document it in the run sheet; if it must change, hoist `useEngine` into a provider (separate PR, not a quick fix). | M |
| P2-10 | P2 | `engine/detectors.js:20-22,121` | Model URLs are unversioned and fetched with `cache: 'force-cache'`. The ORT wasm is content-hashed, the models are not. | After a model update, a returning visitor can keep the old graph until the cache entry is evicted; `force-cache` explicitly allows stale reuse. | Append a build id (`?v=`) to `MODEL_BASE` via a Vite `define`, or drop `force-cache` for the models. | S (~5 lines) |
| P2-11 | P2 | `components/views/ZoneCanvas.jsx:39-60,147-163` | Before the reference image loads, the container has no aspect ratio (`min-h-[380px]`) and the image is stretched with `object-fill`; after `onLoad` the box is re-laid out to the real aspect. Coordinates are normalized to the box, so a point placed in that window is valid but sits on a different feature of the frame once the image re-stretches. | A quick first click can put a vertex on the wrong part of the apron; the operator sees it move after the image loads. | Ignore canvas clicks until `aspect` is known (show the "se încarcă cadrul" state), or derive the box from the image's natural size before enabling drawing. | S (~10 lines) |
| P2-12 | P2 | `docs/browser-engine.md:41,54,118,209,255`; `AGENTS.md:23`; `services/api.js:6` | Documented state contradicts the code: tracker/zones/store called "the target, not code"; snapshot "revoked at close"; first-frame budget "9.9 MB + runtime" (actual first start 38.9 MB raw / ~16 MB compressed); "React 19" (package is 18.3.1); "a component never branches on the mode" (8 components import `USE_MOCK`). | Agents and reviewers plan against a stale design; the size assumption is the one that decides whether the demo survives venue wifi. | Update the four claims; add a "total first-run transfer" row to the budget table; either move the `USE_MOCK` flags into selectors or fix the comment. | S (docs) |
| P2-13 | P2 | `e2e/smoke.spec.js:20-21` | The error whitelist still exempts `images.unsplash.com`, although fixtures moved to local stills (`data/media.js`). | A future third-party image blocked by COEP would be silently ignored by the only browser test. | Delete the exemption; keep the suite strict. | S |
| P2-14 | P2 | `scripts/check-base.mjs:50-94` | The base guard only scans `dist/index.html`. Asset paths built in JS (`import.meta.env.BASE_URL`, e.g. `media/`, `models/`) are not checked. | A hardcoded `/media/x.jpg` in a JS module passes CI and 404s only on Pages. | Also scan `dist/assets/*.js` for root-absolute `"/media/`, `"/models/`, `"/assets/` strings. | S |

### 4.1 Detail on the two P0s

**P0-1 — event identity is not unique.** `pipeline.step()` computes `nowMs = clock()` once
(`pipeline.js:167`), then loops over tracks and zones and calls `buildEvent({ detectedAt: nowMs, ... })`
(`pipeline.js:219-237`). `eventId()` (`events.js:87-97`) uses only camera, ms and track. Two zones that
both confirm in the same frame therefore build the same string. Reproduced with the real modules: a single
track inside two overlapping `RESTRICTED` zones yields two events, one id, and `mergeEngineEvents` puts
**both rows** in the list (the dedupe set is built from the existing list, not from the incoming batch —
`engineEventFeed.js:32-34`). The seed configuration already has two zones on `stand12`
(`data/zones.js:12-53`), so the configuration is one operator action away.

**P0-2 — slow is not stalled.** The watchdog message is correct ("a WebGPU session that never settles is
indistinguishable from one still compiling shaders") but the timer starts before the model bytes are even
requested. `fetchModelBytes` uses `force-cache` and reads the whole 9.9 MB model before
`InferenceSession.create`; ORT then fetches the 28.7 MB wasm. On a cold cache and a shared venue link this
is a 30 s+ silent phase with `status: 'loading'` messages the watchdog ignores. The result is a forced WASM
restart (and a second full download), not a recovery.

---

## 5. Test suite: what is covered and what can break silently

`npm run test:unit` → **403 tests, 14 suites, 0 failures, ~0.4 s** (Appendix A.2). Breakdown by area:
engine 105, utils 185, constants 19, data 41, services 35, live 19.

| Area | Untested modules that matter | What breaks silently | Suggested test (cheap) |
|---|---|---|---|
| Engine decode | `decode.js` (all), `detectors.js` letterbox + `rgbaToNchw` | Boxes and therefore **blur rectangles** land in the wrong place; faces stay visible while the UI says "procesat local" | Table-driven cases from `docs/qa/engine-parity.md`; synthetic arrays |
| Worker | `worker.js` media clock, frame sizing, PPE gate, guard-bitmap contract | Rule windows/cooldown drift on loops and seeks; blur gate drifts from `vest.js` | Extract the clock and the gate (P2-1), then unit-test |
| Hook | `useEngine.js` restart policy, config messages, snapshot URL lifecycle, stall watchdog | Worker restarts that reload graphs; leaked blob URLs; the P0-2 regression | Extract the decision functions; a fake `Worker` in Node is enough for the message reducer |
| Isolation | `coi-serviceworker.js`, `main.jsx` guard | Infinite reload or permanently single-threaded production | Pure guard function + a Playwright assertion that `crossOriginIsolated` is true after the reload |
| Persistence | `localStorage` keys: theme (utility tested), engine preference (tested), operator (tested), bench history (untested), zone reference frames (not persisted at all) | A key rename breaks first paint; bench history corruption | e2e: set a value, reload, assert; plus the `check-base` key check (P2-8) |
| Zone editor | `ZoneCanvas` pointer→normalized mapping, edge insert, close hit-test (only render is e2e-tested) | Points placed before the frame's aspect settles; insert/close off by one | Playwright: click three points, assert count and the JSON textarea; one drag |
| Incident store | `useIncidentStore` (logic is in tested helpers, wiring is not) | Double ack, lost engine event, 409 path | Mostly covered; add a merge test for the duplicate-id batch after P0-1 |
| API transport | `http.js`, `backendApi.js` | Error status/detail lost; reconnection loop | `http.test.mjs` with a stubbed `fetch` (P1-1) |

The suite is honest about being pure: no React, no browser, no model. That is the right default. The gaps
above are exactly the ones that need a browser or a small extraction — not a reason to add a heavy test
framework.

**Test hygiene items:** the e2e deep-link comment still says mock ids embed `Date.now()`
(`e2e/smoke.spec.js:106-109`) although `data/eventIds.js:9-23` made them stable; the `date` clock freeze is
now unnecessary (and harmless). `pipeline.test.mjs` never feeds two zones at once — the P0-1 hole.

---

## 6. Build, bundle and CI

Measured on `VITE_USE_MOCK=true npm run build` (Appendix A.4):

| Artifact | Raw | gzip | brotli | Notes |
|---|---:|---:|---:|---|
| `index-*.js` | 407.4 kB | 122.2 kB | 103.2 kB | includes `LabView` + `BenchView` (P2-6) |
| `index-*.css` | 48.6 kB | 8.9 kB | — | one Tailwind sheet; no unused-class problem visible |
| `worker-*.js` | 30.7 kB | 11.5 kB | 10.3 kB | ES-module worker, ORT is a separate chunk (correct) |
| `ort.webgpu.bundle.min-*.js` | 123.1 kB | — | — | lazy `import()` on first engine start |
| `ort-wasm-simd-threaded.asyncify-*.wasm` | **28.7 MB** | 7.1 MB | 4.2 MB | content-hashed; asyncify is required by the WebGPU build |
| `yolo26n.onnx` | 9.9 MB | 8.6 MB | 8.7 MB | unversioned URL |
| `yunet.onnx` | 232 kB | — | — | unversioned URL |
| `media/` | 11.9 MB | — | — | three clips + stills |
| **`dist/` total** | **50 MB** | | | Pages limit is 1 GB, so not a hosting problem |

Findings:

- **First engine start is ~38.9 MB raw (~16 MB compressed)**, while the budget table implies ~10 MB and a
  <3 s first frame (`docs/browser-engine.md:209`). Combined with P0-2 this is the top demo risk.
- **Source maps are off** (Vite default; `vite.config.js` has no `build.sourcemap`). Fine for a public
  demo; it does mean a worker/ORT stack trace is unreadable. Deliberate, not a defect.
- **Cache/versioning:** hashed JS/CSS/wasm are safe to cache forever. The two ONNX files and
  `coi-serviceworker.js` are unversioned, and the models are fetched with `force-cache` (P2-10). The
  service-worker script is revalidated by the browser per spec, so its staleness is not a problem.
- **CI jobs:** unit, build, e2e (real `dist` via `vite preview`), pages-base guard — four independent jobs,
  no Python, no silent skip. Good.
- **Missing gates:** no bundle/size budget (the 28.7 MB wasm and the 50 MB `dist` are only discovered by
  running a build); no lint/static analysis at all, while the code contains `eslint-disable` comments that
  nothing verifies; `check-base.mjs` covers the HTML only (P2-14).
- **Dead exports** (`grep` over `src`, tests excluded): `FEED_FILTERS`, `localSightApi.toggleEngine`,
  `applyAction`, `escalateIfDue`, and the worker's `close` message handler. Everything else exported has a
  consumer. That is a good ratio.
- **CSS:** one 48.6 kB sheet. The Tailwind config imports the runtime theme tokens
  (`tailwind.config.js:10-17`), so a token rename fails the build instead of drifting — keep that.
- **`README.md`** states the model sizes correctly (9.9 MB + 232 KB) but never states the total first-run
  transfer; add one line there or in `browser-engine.md`.

---

## 7. Duplication and consistency ledger

| Duplicated thing | Copies | Action |
|---|---|---|
| Camera error table + `cameraErrorFor` | `liveMedia.js:30-79`, `LabView.jsx:14-55` | import from `liveMedia` (P2-5) |
| Incident type labels | `data/labels.js:7`, `constants/shiftReport.js:17`, `LiveEngineCard.jsx:21` | one table (P2-5) |
| Status action machine | `engine/events.js:275-334` vs `utils/incidentState.js` + `services/mockEvents.js` | pick one (P2-7) |
| PPE frame gate | `vest.js:204-206` vs `worker.js:374-377` | export from `vest.js` (P2-1) |
| Webcam camera id | `liveMedia.js:17` (hardcoded) vs `services/config.js:35` (env) | one source (the env one is dead in mock builds) |
| Engine status strings | `useEngine` producer, `LiveEngineCard.jsx:33-39`, `EngineOverlayBadges.jsx:51`, `liveMedia.js:281-297` | export `ENGINE_STATUS` constants |
| Zone filtering | page `liveMedia.js:198-222` + worker `pipeline.js:77-82` | keep one, report the applied count (P2-3) |

Naming is otherwise consistent: `zone_id` in the store/API, `id` only where the engine contract wants it,
with two explicit mappers (`liveMedia.toEngineZones`, `backendMappers.mapZone`). That is the right place
for the translation; do not "unify" it by renaming the contract field.

**Error-handling inconsistencies:** `saveZone` (no rollback) vs `deleteZone` (rollback); `backendApi`
swallowing the engine-switch error; `useConnectionHealth.toggleWsSimulation`'s `catch` is unreachable
because it awaits `Promise.allSettled`; `useSimulation` and `mockApi` never reject, so the deployed mode
never exercises any error path. The last one is worth an explicit note in the run sheet: the static demo
cannot show failure handling.

---

## 8. What I would not touch (and why)

- **`worker.js` as a whole.** 836 lines is large, but it is one coherent per-frame pipeline with a single
  owner and no consumer. Splitting render/PPE/snapshot into modules now would add indirection without a
  second caller. Extract only the pure clock/size/gate (P2-1), which buys tests without changing the shape.
- **The rule/tracker algorithms.** They are ported, documented against the Python reference, and covered by
  31 + 12 + 20 tests plus the parity QA. Rewriting them risks the only part of the product that is proven.
- **The design token pipeline** (`theme/*`, `tailwind.config.js` importing runtime tokens). It is coherent
  and a rewrite would be cosmetic.
- **The contractual deviation `snapshot_url: blob:`.** It is documented, deliberate, and the alternative
  (a server) does not exist in this fork. Do not "fix" it without a backend.
- **`data/` fixtures and their prose.** Reference material, not product; the provenance policy says so.
- **Greenfield abstractions:** a shared protocol module, an engine provider, a second store, a lint setup.
  They are all reasonable, but none is needed to deliver; they would be new dependencies or new layers.
- **React 18 → 19.** The docs are wrong, not the dependency. Upgrading is a separate risk with no product
  value in this fork.

---

## 9. The five changes with the best impact/effort

1. **Make `event_id` unique per zone event** (`pipeline.js:219-237`, plus a two-zone test). ~5 production
   lines, kills the only correctness defect in the identity model. No contract change.
2. **Stop treating a slow model load as a GPU stall** (`useEngine.js:342-346`). ~15 lines; removes the most
   likely demo failure on a venue network and the forced-WASM downgrade that comes with it.
3. **Read the HTTP body once** (`http.js:45-54`). ~10 lines + 2 stub tests; restores status/detail on
   non-JSON errors and keeps the documented 409 recovery path reliable.
4. **Carry `escalate_after_s` into engine events** (`engineEventFeed.js:37-52`). One line + one test; makes
   engine incidents escalate like every other incident and makes the ack copy true.
5. **Test the box math** (`decode.js`, `detectors.js` letterbox). Test-only, ~150 lines, and it is the only
   guard between a decode regression and a blurred-wrong-region privacy failure.

Runner-ups (do them next, same week): revoke blob URLs when an incident leaves the store (P1-5), the engine
retry button (P1-3), the worker media clock extraction (P2-1), lazy-loading `/lab` and `/bench` (P2-6), and
the documentation corrections (P2-12).

---

## Appendix A — evidence

**A.1 Provenance** (`python3 scripts/provenance.py`, run at `ad05128`):

```text
TOTAL 23345 linii: tu 22690 (97.2%), colegi 655 (2.8%), necunoscut 0 (0.0%)
```

**A.2 Unit tests** (`npm run test:unit`):

```text
ℹ tests 403
ℹ suites 14
ℹ pass 403
ℹ fail 0
```

**A.3 Event-id collision** (throwaway harness against the real modules, `clock` fixed, two overlapping zones):

```text
events: 2
unique ids: 1
[ { id: 'evt_stand12_1793356933120_1', zone: 'engine-left',  severity: 'CRITICAL' },
  { id: 'evt_stand12_1793356933120_1', zone: 'engine-right', severity: 'CRITICAL' } ]

mergeEngineEvents([], both, ...) -> merged rows: 2, unique ids: 1
escalate_after_s on engine events: [ undefined, undefined ]
```

**A.4 Build** (`VITE_USE_MOCK=true npm run build`):

```text
dist/index.html                                            1.01 kB
dist/assets/worker-*.js                                   30.72 kB
dist/assets/ort.webgpu.bundle.min-*.js                   123.07 kB
dist/assets/ort-wasm-simd-threaded.asyncify-*.wasm    28,747.74 kB
dist/assets/index-*.css                                   48.55 kB | gzip: 8.89 kB
dist/assets/index-*.js                                   407.37 kB | gzip: 122.24 kB
dist total                                                50 MB
```

`gzip -9` / `brotli -q 11`: wasm 7.10 MB / 4.18 MB; `yolo26n.onnx` 8.63 MB / 8.67 MB.

**A.5 Snapshot lifecycle** (`git grep`): for incident snapshots `createObjectURL` appears only in
`useEngine.js:178`; the other three uses (`LabView`, `BenchView`, `ReportsView`) are local file/CSV/JSON
previews. `revokeObjectURL` appears only in `BenchView:340`, `LabView:252,258` and `ReportsView:462` —
**never for an incident snapshot**.

**A.6 HTTP error path** (stubbed `fetch` returning 502 `text/html` through `services/http.js`):

```text
error name: TypeError
error message: Body is unusable: Body has already been read
starts with 502? false
```

**A.7 Import graph** (script over `src/**/*.{js,jsx}`, relative imports):
`cycles: 0`, `layer violations: 0`.

**A.8 `git grep`** for legacy paths in `src/`: only provenance comments referencing the removed
`ml/`/`backend/` files (as intended by `AGENTS.md`); no executable reference.

---

## Appendix B — findings already tracked in `docs/qa/`, re-checked here

| QA finding | Status in this tree | Note |
|---|---|---|
| Privacy: raw clip visible during the ~2.7 s warm-up | **Fixed** | `MediaStage.jsx:81` hides the video from the click; the black overlay covers the canvas gap |
| Privacy: fail-open when YuNet is missing | **Fixed** | `worker.js:311-365` guard bitmap + page hides the canvas on error |
| Privacy: `/lab` and fullscreen show raw frames | **Accepted by design**, and fullscreen is blocked while the engine is on (`CameraToolbar.jsx:141-149`) | `/lab` is a dev page; the caveat is in the page copy |
| QA F1 double-ack | **Fixed** | `shouldAcceptAck` (`liveMedia.js:328-341`) + `pendingAcks` in `useIncidentStore.js:45,109-128` |
| QA F2 deep link after reload | **Fixed** for mock fixtures | `data/eventIds.js` uses a fixed anchor; engine events are session-only by design |
| QA F6 decorative shift selectors | **Fixed** | `ReportsView.jsx:439-476` forces the operational shift and passes `disabled` |
| QA F7 huge operator name | **Mitigated** in the header; the toast still renders the full name | `Header.jsx:61-63` caps the preview only |
| QA F8 keyboard-inaccessible Live cards | **Open** (not re-reported here) | Out of the architecture scope; one-line `role`/`tabIndex` fix |
| QA F12 deleted zone left in the form | **Fixed** | `draftAfterDelete` + the camera effect (`zoneDraft.js:185-187`, `ZoneEditorView.jsx:147-160`) |
| QA F14 two tabs do not share state | **Open by design** | `docs/browser-engine.md` §7: no `BroadcastChannel`; do not "fix" without a product decision |
