# LocalSight — from demo to apron pilot

**Product gap analysis.** 2 November 2026 · branch `prep/feature-gaps` · read-only analysis, no
application code changed.

This document answers one question: what is missing between the current browser-only demo and
something an apron team could actually use for a shift, without giving up the two constraints
that make LocalSight interesting — **everything runs in the tab** and **nothing is uploaded**.

It is deliberately not a feature wish list. Each gap names why it matters, what a browser-only
implementation looks like with the APIs that exist today, an effort estimate, the risks that
could sink it, and what is explicitly *not* in scope. Backend, Slack, server-side escalation
and cloud storage are **not** requirements anywhere in this document.

---

## 1. Verdict

The pipeline is real. On the build tested for this report, the browser engine ran at
**3.7–5.6 fps** on WASM with a 1280 px frame (the documented four-thread range), produced
contract-shaped incidents with blurred evidence, and the shift report recomputed from the list. The face guard is
fail-closed in the current code: a frame that cannot be blurred becomes a placeholder, not a
raw frame (`frontend/src/engine/worker.js`, `guardBitmap`/`blankFrame`).

It is not yet a product for an apron, for three structural reasons:

1. **It cannot see a real airport camera.** The only sources are a bundled `.mp4` and the
   laptop webcam. A browser cannot open RTSP; without a source adapter and a camera registry,
   the product cannot be installed on a stand.
2. **It stops being a monitor as soon as the operator uses it.** Opening an incident, editing a
   zone or reading the report unmounts Live and terminates the engine worker. A hidden tab gets
   no notification and no sound. The escalation timer lives and dies with the tab.
3. **It forgets the shift on reload.** Incidents, acknowledgements and evidence exist only in
   memory. A "shift report" over a list that vanishes at F5 is a screenshot, not a record.

Everything else — model management, zone editing ergonomics, i18n, accessibility, offline,
diagnostics, deployment — matters, but it is second order compared with those three.

**Honest positioning:** browser-only is defensible for a **supervised pilot** — one stand, one
camera, one operator, one shift, evidence exported at the end — and it is a genuinely strong
privacy story there. It is **not** defensible as unattended 24/7 multi-camera coverage, and
should not be sold as one. Section 6 says this explicitly.

---

## 2. How this was assessed

- Read `README.md`, `AGENTS.md`, `docs/browser-engine.md`, `docs/contract.md`,
  `demo/run_sheet_browser.md`, all of `docs/qa/`, and the relevant modules under
  `frontend/src/` (engine, Live, zones, reports, settings, operator, services).
- Built the exact Pages configuration and served it under `/LocalSight/`:
  `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`.
- Clicked through Live, incident detail, Reports, Zones and Sistem & Audit in Playwright
  (Chromium, headless, no WebGPU adapter → WASM; the COOP/COEP service worker was controlling
  the page and `crossOriginIsolated` was `true`, so the code's four-thread path was active).
- Re-checked the QA findings against the current code, because several of them have been fixed
  since they were written. What is listed below is what the branch does **today**.

### 2.1 Measurements from the probe

| Probe | Result |
|---|---|
| Live, engine off | 1 `<video>`, 0 `<canvas>`, 4 fixture incidents, 4 cameras in the selector |
| Engine start (WASM, 4 threads) | 1 worker, **3.9 fps**, 4 persons, 1 face, 1 local incident within 15 s |
| Engine warm | **5.6 fps** at 1280 px |
| Open an incident from the feed | worker **terminated**, 0 video, 0 canvas — monitoring stopped |
| Return to Live | new worker; the same model warm-up applies (2.5–3 s before the first processed frame, measured at start) |
| Switch camera | same worker, pipeline rebuilt, engine feed history reset (`INCIDENTE 0`) |
| Reports screen | 8 events, 4 critical, 43 s average ack; shift/date selectors disabled in mock |
| Browser storage | `localStorage`: theme only (engine preference after start); **no IndexedDB**; quota 10.7 GB unused |
| Notifications | `Notification` exists in the browser; the app **never requests permission and never calls it** |
| Mobile 375×812 | sidebar auto-collapsed, no horizontal overflow (QA F3 fixed) |
| Console | YuNet output-shape warnings from ONNX Runtime on every engine start |

The measurements are one laptop, one clip, WASM. WebGPU will be faster on a capable GPU; a
tablet will be slower. They are enough to size the gaps, not to promise a number.

### 2.2 QA findings already fixed (do not re-report these)

Fail-open blur on a missing YuNet model; raw clip visible during warm-up and fullscreen; phone
sidebar covering the content; incident cards not keyboard reachable; double-click double
acknowledge in the Live feed. The current code guards the frame (`guardBitmap`), hides the raw
video while the engine is requested (`MediaStage`), blocks fullscreen while detection runs
(`CameraToolbar`), auto-collapses the rail below 640 px (`Sidebar.jsx`), and makes the card a
`role="button"` with a press guard (`IncidentFeedCard.jsx`, `shouldAcceptAck`).

The remaining QA findings that are still product gaps are folded into the sections below
(reference-image privacy, report/KPI provenance).

---

## 3. Priorities at a glance

Effort for one developer who knows this codebase: **S** ≤ 3 days, **M** ≈ 1–2 weeks,
**L** > 2 weeks.

| # | Gap | Demo | Pilot | Effort |
|---|---|---|---|---|
| 1 | Camera ingestion and multi-camera behaviour | Could | **Must** | L |
| 2 | Engine lifecycle and background alerting | Must (stop implying otherwise) | **Must** | M |
| 3 | Incident persistence and evidence retention | Could | **Must** | L |
| 4 | Shift report and KPI accuracy, export | **Must** (honesty) | **Must** | M |
| 5 | Operator identity and audit for a kiosk | Could | **Must** | M |
| 6 | Zone editing against the running engine | Should | **Must** | M |
| 7 | Model and provider management, fallbacks | Should | Should | M |
| 8 | Data-protection controls (blur, retention, evidence) | Should | **Must** | M |
| 9 | Monitoring and diagnostics | Should | Should | M |
| 10 | Mobile and tablet use | Should | Should | M |
| 11 | Offline, PWA and caching | Could | Should | M |
| 12 | Onboarding and first-run | Should | Should | M |
| 13 | Accessibility | Should | Should | S/M |
| 14 | Internationalisation | Could | Should | M |
| 15 | Deployment, update strategy and licensing | Should (verify) | **Must** | S/M |

**Demo column, honestly:** the demo path already works; the only *must* is not promising more
than it does. The KPI strip mixes fixture values with values derived from incidents, and the
report is labelled `șablon` but not scoped to a shift — both are fixable in a day and both
matter because the demo's credibility rests on "we say what is real".

---

## 4. Gap catalogue

### 4.1 Camera ingestion and multi-camera behaviour

**Today.** Four cameras are hardcoded in `frontend/src/data/cameras.js`: three bundled clips
(`/media/<camera_id>.mp4`) and the laptop webcam. There is one `<video>`, one engine worker,
and one processed source at a time. The "Split" display mode is a layout (feed + incident
grid), not a second camera. Switching cameras rebuilds the pipeline (tracker and cooldown
reset) and clears the engine panel history.

**Why it matters.** Airport cameras are RTSP/ONVIF streams. A browser cannot consume RTSP, so
without an adapter **the product cannot be pointed at the thing it is supposed to watch**. A
single camera also cannot cover a stand; supervisors need an overview across the cameras on
their pier, and an incident on CAM-03 should be visible while looking at CAM-01.

**What browser-only looks like.**
- A **source adapter** with one interface: bundled file, `getUserMedia`, and a live network
  source. For network sources, the browser-compatible options are:
  - **WebRTC (WHEP)** — `RTCPeerConnection` plus a plain `fetch` of an SDP offer/answer; no
    library required. Lowest latency, best fit for detection.
  - **MJPEG over HTTP** — render via `<img>` or a `fetch` stream into a canvas; trivial, high
    bandwidth, no audio.
  - **HLS** — only native in Safari; Chrome needs a library (a new dependency, ask first), so
    prefer a gateway that speaks WHEP/MJPEG.
  The encoder/gateway that turns RTSP into WHEP or MJPEG is **site infrastructure**, not an
  application backend. The app still has no server of its own.
- A **camera registry** in IndexedDB (id, label, adapter type, URL, credentials *not* stored in
  plain text if avoidable, zones, enabled, last seen), with add/edit/disable in the UI so a new
  camera does not need a rebuild.
- A **scheduler** instead of a second copy of Live: one camera is *active* (full cadence,
  1280 px), others are *sampled* (e.g. 1 frame/2 s at 640 px) or paused with a "last frame age"
  badge. A grid of last frames with one live tile is more honest than four half-speed tiles.
- Per-camera health: last frame timestamp, decode errors, effective fps, and "no frames for N s"
  — the browser equivalent of the old `CAMERA_OFFLINE` watchdog, without a backend.
- A capacity budget surfaced in the UI: "2 cameras at 3 fps each on this device" derived from a
  quick self-benchmark, not a promise.

**Effort.** **L.** Registry + add/edit UI (M), adapter (M, depending on the gateway), scheduler
and grid (L), health (S).

**Risks.**
- Inference cost is roughly linear in cameras. One session at 3.7–5.6 fps on four threads means
  three full-rate cameras will not fit on a laptop; two ONNX sessions also double model memory.
  Round-robin and smaller inputs are the only browser-side levers.
- WebRTC needs a gateway the site may not have; HLS adds latency and a dependency; MJPEG is
  bandwidth-hungry.
- Autoplay policy, codec support, CORS for canvas pixel access (the engine needs pixels; a
  cross-origin video taints the canvas unless CORS is correct), and reconnection storms.
- Track IDs and cooldowns are per camera by construction; a shared scheduler must not let
  state bleed between feeds.

**Out of scope.** ONVIF discovery, PTZ control, transcoding, recording/NVR, server-side
analytics, cloud camera registries, native apps.

---

### 4.2 Alerting and notification when the tab is in the background

**Today.** A CRITICAL incident from the **browser engine produces no sound at all**:
`playCriticalAlertSound` is called only from the backend socket handler and the demo simulator
(`useConnectionHealth.js`, `useSimulation.js`); `addEngineEvents` just merges the event. The in-app
toast is polite, not assertive. There is no `Notification` request, no service-worker
notification, no favicon/title badge, no Wake Lock, and no `visibilitychange` handling. The
engine loop is driven by `requestVideoFrameCallback`, which is tied to frame presentation, and
the worker is terminated when Live unmounts.

**Why it matters.** An alert that only exists while someone is staring at the tab is not an
alert. On an apron the operator walks away, opens another tab, or locks the screen; escalation
must reach them or the incident is just a row in a list. This is also where the browser-only
promise is weakest, and where honesty is required.

**What browser-only looks like.**
- **Web Notifications without push**: request permission from an explicit "Enable alerts"
  action, then `registration.showNotification(title, { body, tag, requireInteraction: true })`
  from the existing service worker registration. No push server, no backend. `notificationclick`
  focuses the tab.
- **Audio that survives**: one unlocked `AudioContext` after a user gesture (already the
  pattern in `utils/sound.js`), a distinct escalation tone, and a mute control. Autoplay policy
  is the constraint; the first engine start is the natural unlock point.
- **Wake Lock** (`navigator.wakeLock.request('screen')`) while the engine runs, released on
  hide, with a visible "screen kept awake" state.
- **Visibility policy**: on `hidden`, keep the video playing where the browser allows it, mark
  the session "degraded" and show it on return with the gap duration. On `visible`, re-arm the
  loop and recompute escalations from absolute timestamps. Do not pretend frames were processed
  while the tab was frozen.
- **Escalations as absolute deadlines** in the local store (already the shape of
  `applyEscalations`), re-evaluated on resume, plus a notification at escalation.
- **One voice per incident**: `BroadcastChannel` + Web Locks so two open tabs do not double-alert
  or double-ack.
- **A visible "monitoring paused" banner** whenever the browser is throttling or the engine is
  stopped — the honest alternative to a guarantee the browser cannot give.

**Effort.** **M.** Notification permission and SW handler (S), audio for engine incidents (S),
wake lock (S), visibility/degraded state (M), escalation deadlines in the store (S), multi-tab
coordination (S).

**Risks.**
- Browsers freeze or discard background tabs; a hidden tab may produce **no** frames. No
  browser API changes that. The product must say "supervised monitoring", not "24/7".
- Notification permission can be denied or blocked by enterprise policy; kiosk browsers often
  suppress them.
- Audio can be muted, the device can be asleep, and the operator can be away. Notification is a
  nudge, not a guarantee.
- Escalation computed after a long freeze can fire a burst of alerts; needs coalescing.
- A notification that fires from a stale frame is worse than none; include the frame age.

**Out of scope.** Push notifications, server-side paging, SMS/radio/Teams/Slack delivery,
OS-level agents, guaranteed delivery SLAs.

---

### 4.3 Incident persistence and evidence retention

**Today.** Nothing survives a reload. `useIncidentStore` starts from fixtures in the mock build
and from the API in the backend build; the browser build has no store. `localStorage` holds
theme, the engine preference, the operator name and bench runs — no incidents. There is no
IndexedDB database at all (measured), despite 10.7 GB of available quota. Engine snapshots are
`Blob` → `URL.createObjectURL` in `useEngine`, capped in count by the feed (50 in the engine
panel, 200 in the incident list), but the URLs are never revoked for engine incidents; they
live until the document dies. The zone reference image and the processed frame are likewise
memory-only.

**Why it matters.** A shift report over a list that disappears is not a record. An
acknowledgement with no storage cannot prove who stopped an escalation. Evidence that cannot be
exported cannot support a safety review or an insurance conversation. And a long shift grows
blob memory monotonically — the browser-engine note already flags this as a risk.

**What browser-only looks like.**
- **IndexedDB** for incidents, acks, zone versions, settings and audit rows, with a schema
  version and an explicit migration step. One store, one writer, guarded by Web Locks so two
  tabs cannot corrupt it.
- **Evidence in OPFS or an IndexedDB blob store**, keyed by `event_id`, with the JPEG that the
  worker already produces (960 px, quality 0.8). Keep the `blob:` URL only for rendering;
  persist the Blob, revoke the URL on eviction.
- **Retention policy** as data, not code: max days, max bytes, max incidents, enforced at write
  and on boot, with a visible "stored until …" line on each incident. `navigator.storage.persist()`
  requested at first run; eviction warning if `navigator.storage.estimate()` approaches quota.
- **Export**: a JSON bundle plus evidence files written through the File System Access API
  (`showDirectoryPicker`) when available, or one download per file otherwise. No zip dependency
  required. A "delete this shift" and "delete all local data" action that actually revokes and
  purges.
- **Coverage as a first-class record**: when the engine ran, when it was paused, when frames
  stopped. A report without coverage overstates its own completeness.

**Effort.** **L.** Store and migrations (M), evidence (M), retention and quota (S), export (M),
multi-tab safety (S).

**Risks.**
- Private windows, quota eviction, Safari's IndexedDB behaviour, OPFS availability.
- Persisted evidence is personal data: retention and access must be deliberate, and "delete"
  must be real. Browser storage is not encrypted at rest in any way the app controls.
- Schema drift between releases; a bad migration can lose a shift. Keep a read-only fallback and
  a "export before upgrade" prompt.
- Blob URL leaks if eviction forgets to revoke; test it with a long synthetic run.

**Out of scope.** Server database, object storage, cloud backup, chain-of-custody signing,
legal hold, cross-device sync.

---

### 4.4 Shift report and KPI accuracy, export

**Today.** `buildShiftReport(events)` counts **every event in the list**; `shiftLabel` and
`operationalDate` are passed in as display strings and do not filter anything
(`frontend/src/constants/shiftReport.js`). The screen even accepts `selectedDate`, which is used
for the header but not the count. The KPI strip is mixed provenance: open/escalated are
recomputed from incidents (`useKpis`), while **PPE compliance (93.8 %) and detection→alert
latency (1.3 s) are fixtures**; the "date demo" chip sits above the whole strip, so it neither
marks the fixture tiles specifically nor tells the truth about the derived ones. Export is CSV
(comma-separated with a UTF-8 BOM) plus `window.print()` for "PDF"; there is no per-camera
breakdown, no coverage figure, no model/build version, no operator sign-off, and no evidence
appendix. The report is honestly tagged `șablon`, not AI.

**Why it matters.** A safety report has to reconcile with the record it claims to summarise.
Today it cannot: the report is not scoped to a shift or a camera, and one of its headline KPIs
is invented. That is the fastest way to lose an operator's trust — and the demo's credibility
rests on labelling what is real.

**What browser-only looks like.**
- Derive the shift window from site config and the operational day (06:00 boundary already
  modelled in `shiftReport.js`), then **filter incidents by `detected_at`** and by camera.
- Compute every KPI from incidents; where a metric cannot be derived (PPE compliance over all
  detections), show "not measured" instead of a number, as the page already does for PPE.
- Add **coverage** and **data quality**: minutes monitored per camera, engine uptime, processed
  frames, average fps, gaps, incidents with/without evidence. This is the browser-only
  replacement for the backend's `coverage` field.
- Include the **model and build identity** on the report and in the export: model id and hash,
  app version/commit, engine provider at capture time. Without it an incident cannot be
  reproduced.
- CSV: keep the BOM, allow `;` (Romanian Excel default) or document the separator, use ISO
  timestamps, and include the incident list the totals came from (already the design).
- PDF: keep print-to-PDF (no dependency; `styles/print.css` already forces dark text on
  white), but add a print header/footer with report id, generated-at, operator and page
  numbers, and include coverage and model/build identity in the printed document.
- **Sign-off**: operator name, timestamp, and an explicit "I reviewed this report" action that
  is stored, not just displayed.

**Effort.** **M.** Filtering and KPI derivation (S), coverage/data quality (M), export fields
and print layout (S), sign-off (S).

**Risks.**
- Time zones and DST; the report already groups by Europe/Bucharest. A site in another zone
  needs configuration, not a constant.
- Media time vs wall clock: the pipeline's clock is `video.currentTime` (see 4.9), so a looping
  clip or a reconnecting stream can produce negative or reset intervals. Filtering by
  `detected_at` is safe; duration/cooldown maths may not be.
- Partial coverage presented as a full shift is worse than no report; the coverage section must
  be prominent.
- Late-arriving incidents (if a store is added) can change a signed report; version reports.

**Out of scope.** LLM-written narratives, scheduled email delivery, server-side aggregation,
BI integration, compliance certification.

---

### 4.5 Operator identity and audit for a kiosk

**Today.** An operator is a free-text name in `localStorage` plus a role picked from a fixture
list (`useOperator`, `data/operators.js`). Any visitor can change it, there is no PIN, no idle
lock, no session, and no capability check beyond "is the incident in a state that allows this
action". The "Jurnal" on Sistem & Audit is a **read-only projection of incident timestamps**
(`utils/systemView.js`); zone edits, reference uploads, settings changes and report exports are
not logged at all.

**Why it matters.** "Acked by Ana" means nothing if anyone can type Ana. A shared apron terminal
needs shift handover, an idle lock so the previous operator's session does not acknowledge
things, and a record of who changed a zone — because a bad zone is a safety defect, not a
preference.

**What browser-only looks like.**
- Local operator profiles (name, role, PIN hash via WebCrypto **PBKDF2-SHA-256** with a per-profile
  salt) and, where available, **WebAuthn** platform authenticator for kiosk unlock. Both work
  offline; no new dependency.
- Idle lock after N minutes, explicit "lock / switch operator", and the operator captured on
  every action (ack, false positive, reopen, zone save/delete, reference capture, export).
- A capability table (dispatcher, supervisor, viewer) enforced in the store, not only by hiding
  buttons.
- An **append-only audit log** in IndexedDB: actor, action, target, before/after hash, timestamp,
  session id. Hash-chain the rows with `crypto.subtle` so a deleted middle row is detectable on
  export; verify the chain in the exported bundle.
- Make it clear in the UI that this is **deterrence on a trusted kiosk**, not a security
  boundary: anyone with devtools can bypass local checks.

**Effort.** **M.** Profiles and PIN (S), WebAuthn (S), idle lock and capabilities (S), audit log
and chain (M), UI (S).

**Risks.**
- Local auth is bypassable; do not describe it as access control for untrusted devices.
- Lost PIN means lost attribution; need a documented reset that itself is audited.
- Operator names are personal data; retention applies.
- Hash chains prove tampering only if the verifier has the expected head; document the export
  verification step.

**Out of scope.** SSO/OIDC, JWT, server-side RBAC, organisation directory integration, legal
e-signature.

---

### 4.6 Zone editing while the engine runs

**Today.** Zones are edited on a separate route. The engine lives in `LiveView` and is
terminated on navigation, so **the editor never has a running engine**: no live feed, no
detection feedback, only a static reference still (the demo still or an uploaded JPEG). Zone
changes do apply live while staying in Live — `useEngine` sends `config` and the worker calls
`pipeline.setZones` — but there is no way to draw and see the effect at the same time. There is
no version history, no author, no enable/disable, no schedule, and no "how many incidents would
this zone have produced in the last hour".

**Why it matters.** A polygon drawn on a still frame misses the perspective and the walking
paths that produce false positives. Operators tune zones after the first week of alerts; if
tuning requires stopping the engine and guessing, they will either stop tuning or stop trusting
the system.

**What browser-only looks like.**
- A **drawer/overlay editor over Live** (or an app-level engine that survives routing), so the
  worker keeps running: pause the canvas on a representative frame, draw, apply as a `config`
  message, watch the boxes and the zone membership immediately.
- A **"replay last N minutes"** mode from a small in-memory ring buffer of recent frames (not
  persisted) to test a zone against what actually happened, with hit counts per zone.
- **Zone versions** in IndexedDB (author, timestamp, polygon hash, rule fields), a diff view and
  a one-click revert. This doubles as the audit trail for 4.5.
- Per-zone **enable/disable**, **schedule** (local time windows, evaluated against wall clock),
  and duplicate-to-camera for multi-camera sites.
- Validation stays where it is (self-intersection, 0..1 coordinates, debounce); add a warning
  when a zone covers almost the whole frame or is smaller than a person at the current
  resolution.

**Effort.** **M.** Overlay editor + live config (M), versions (S/M), replay ring buffer (M),
schedule (S).

**Risks.**
- Editing while detection runs can hide or mask incidents; show a clear "editing, alerts still
  active" banner and keep the incident feed visible.
- Replay buffer memory vs the frame budget; cap it hard (e.g. 5 s at low resolution).
- A zone change mid-shift changes the meaning of past incidents; versions must record which zone
  definition an incident was produced under.
- Schedule evaluation needs a clock policy (wall clock, not media time).

**Out of scope.** Multi-user concurrent editing, approval workflows, server-side config
distribution, cross-site zone templates.

---

### 4.7 Model and provider management, fallbacks

**Today.** Two ONNX files are hardcoded (`detectors.js`: `yolo26n.onnx`, `yunet.onnx`) and served
same-origin from `/models/`. Provider selection is automatic (WebGPU if a real adapter exists,
Firefox forced to WASM, 30 s stall watchdog falls back to WASM). The UI prints "YOLO26n · wasm";
the model label is a literal, not read from a manifest, and there is no version, hash, license
or size. Thresholds are constants in code (`FACE_CONF 0.6`, letterbox conf 0.35/NMS 0.45, the
PPE `MIN_PERSON_PX_NO_VEST` gate). There is no way to choose a model, check its integrity, or
switch to a different one without a rebuild.

**Why it matters.** Different sites and cameras need different operating points (confidence,
minimum person size, PPE gate). An incident's credibility depends on knowing **which model**
produced it. A model that fails to load silently stops detection (fail-closed, correct) but
leaves the operator with no alternative and a generic error.

**What browser-only looks like.**
- A **model manifest** (`models/manifest.json`) with id, version, SHA-256, size, license, input
  shape, output decoding and threshold profile. Verify the hash with `crypto.subtle.digest`
  before creating the session; refuse to run a mismatched file and say so.
- Show model id/version/provider/threads in the engine card and in every exported incident.
- A **model picker** for models shipped in the build (e.g. accuracy vs speed variants), with a
  measured self-test on a fixed frame before accepting the choice.
- **Per-site threshold profiles** (stored with the camera config): detector confidence, face
  confidence, PPE pixel gates, input size. Show the trade-off in `/bench` numbers, not prose.
- A **fallback chain that stays fail-closed**: if the person model fails, no frames are
  produced and the banner says so; if only the PPE colour pass fails, keep detecting persons but
  mark PPE unknown (the code already does this). Never fall back to an unblurred path.
- **No runtime download from third parties.** Keep models same-origin; cache them in the app
  cache (see 4.11) so a reload does not re-download 10 MB + 28.7 MB WASM.

**Effort.** **M** for manifest, hash, UI and profiles; **L** for actually producing/training
alternate models (out of scope here).

**Risks.**
- Hash verification on a 10 MB file costs milliseconds, not seconds — fine — but a mismatch
  after a partial download must be retried, not ignored.
- Thresholds are seductive: lowering the PPE gate to make the demo fire is exactly how false
  positives return. Any change needs a measured before/after on labelled clips.
- Licences are a product blocker: YOLO26n is **AGPL-3.0** (see 4.15). Shipping it in a paid or
  hosted product requires an Ultralytics licence or an AGPL-compatible release. The manifest is
  the right place to make that visible, not to hide it.
- Model files in git make the repo heavy and couple model updates to app deploys.

**Out of scope.** Training pipelines, model registry service, auto-update from a cloud,
VLM-based verification, FOD detection.

---

### 4.8 Data-protection controls (blur settings, retention, evidence)

**Today.** Blur is the strongest part of the product and is now fail-closed: faces are blurred
and the top 35 % of every person box is blurred as a safety net before any frame is drawn or
snapshotted (`worker.js`, `blur.js`). But the parameters are fixed (face confidence 0.6, head
band 0.35, 8× shrink + blur, 960 px JPEG at 0.8), there is no privacy settings screen, no
retention control, no "view evidence" audit, and no way to run in a metadata-only mode. The zone
reference upload **accepts an unblurred image** and only asks the operator to use an already
blurred frame (`ZoneReferencePanel.jsx`); that is a real hole the moment persistence exists. The
demo stills themselves are bundled locally, so the network claim holds today — the hole is the
operator-supplied frame, not the fixtures.

**Why it matters.** Privacy is the differentiator and the legal basis. A promise that depends on
an operator remembering to blur a reference frame is not a promise. Retention must be
enforceable, not aspirational, and evidence access should be attributable.

**What browser-only looks like.**
- A **privacy panel** with: blur profile (face + head band, always), blur strength, whether
  evidence is captured at all (metadata-only mode), retention days/bytes, and a live status chip
  ("blur active · YuNet loaded · 0 frames without coverage").
- **Automatic blur of uploaded reference frames** through the same face/head-band pipeline
  before the image is accepted; refuse the upload if the face model is unavailable (fail-closed,
  same rule as the live path).
- **Evidence access log**: who opened which evidence, when, in the same store as 4.5.
- **Purge controls** that revoke blob URLs, delete OPFS/IDB blobs and report what was deleted.
- **Export redaction**: metadata-only CSV/JSON by default; evidence only on explicit action,
  with a warning and a record.

**Effort.** **M.** Panel and settings (S), reference auto-blur (S), access log (S), purge (S),
same-origin stills (S), retention enforcement (covered by 4.3).

**Risks.**
- Stronger blur destroys PPE/pose cues and makes evidence less useful; the trade-off must be
  explicit per site.
- Blur is not anonymisation in the cryptographic sense; a determined human or model may
  reconstruct. Do not claim "anonymous".
- Metadata-only mode conflicts with safety investigations; make it a policy, not a default
  surprise.
- Browser storage is not encrypted at rest; a shared kiosk profile is readable by the next
  user. Full-disk encryption is an OS concern.

**Out of scope.** On-device anonymisation guarantees beyond blur, face recognition, emotion
recognition, encryption-at-rest guarantees, GDPR certification.

---

### 4.9 Monitoring and diagnostics

**Today.** The engine card shows fps, persons, faces, incidents, PPE counts, provider and a
latency label; `/bench` measures fps/p50/p95 per provider and input size and exports JSON;
`/lab` is the developer playground. Missing: whether the document is cross-origin isolated,
WASM thread count actually in use, WebGPU adapter/fallback events, worker restarts, frames
submitted vs processed vs dropped, per-stage timings in the UI (the Python reference had a `StageTimer`; the browser
port reports only a total `ms`), memory/heap, model hash/version, build id, storage
quota/usage, last-frame age, snapshot failures. The console prints YuNet output-shape warnings on every start (ONNX Runtime ignores
`logLevel: fatal` for these), which trains support to ignore errors. The `Sistem & Audit` page
reports a build summary and an audit projection, not runtime health.

**Why it matters.** On site, the support ticket is "it's slow" or "it missed someone". Without
numbers for provider, threads, dropped frames and coverage, every diagnosis is a guess. And an
incident record without model/build identity cannot be reproduced.

**What browser-only looks like.**
- A **diagnostics drawer** (operator-readable summary + expandable detail) with: provider
  attempts and fallbacks, `crossOriginIsolated`, `navigator.hardwareConcurrency`,
  `navigator.deviceMemory`, worker live/created/terminated counts, frames submitted/processed/
  dropped, fps now/p50/p95, per-stage ms (detect, blur, overlay, snapshot, emit), heap where
  available, storage estimate, model id/hash, app version/commit, visibility state, last frame
  age.
- **A health chip** on Live with thresholds (e.g. fps < 2 after warm-up, no frame for 10 s,
  model not loaded) and one actionable sentence, not just a number.
- **Export diagnostics JSON** with the report bundle, plus a ring buffer of the last N errors.
- **Quiet the known YuNet shape warnings** or document them in the UI; keep real errors loud.
- Fix the **time base**: `pipeline.step` documents `nowS` as monotonic, but the worker passes
  `video.currentTime`, which resets on loop/seek/reconnect. A negative jump can confuse cooldown
  and membership pruning. Either clamp/monotonicise the clock in the worker or document and test
  the reset behaviour.
- A **coverage counter** shared with the report (engine running minutes vs wall clock).

**Effort.** **M.** Telemetry plumbing is mostly already in `useEngine`/worker messages; the work
is a panel, thresholds tests and export.

**Risks.**
- Diagnostics exports contain fingerprinting data (UA, hardware) and operator names; treat as
  personal data and redact by default.
- An always-on diagnostics panel costs frames; keep it on a separate route or a paused overlay.
- fps after a long pause is misleading; require a warm-up window before judging (the existing
  10 s verdict is a good start).
- Log noise from ONNX Runtime can hide real failures.

**Out of scope.** Remote telemetry, APM, crash reporting services, server-side alerting on
health, heartbeat to a supervisor.

---

### 4.10 Mobile and tablet use

**Today.** The phone layout no longer breaks (sidebar auto-collapses below 640 px; measured
375 px, no horizontal overflow). But the UI is still desktop-dense: 9–11 px labels, 20 px
polygon handles, a 16:9 canvas that becomes small in portrait, and a zone editor whose polygon
creation needs a pointer. Touch dragging works through pointer events; keyboard nudging exists
only for an existing point. Performance on a tablet will be below the 3.7–5.6 fps measured on a
laptop, and thermal throttling is real during a long shift.

**Why it matters.** Supervisors walk the apron with a tablet; phones are for acknowledgement and
quick review, not for drawing zones. A product that only works on a desktop at the supervisor's
office misses the main use.

**What browser-only looks like.**
- A **supervisor layout** breakpoint: feed + alert list + ack, no zone editing on coarse
  pointers (or a simplified, list-based zone editor).
- Touch targets ≥ 44 px, larger type option, bottom-sheet incident detail instead of a route
  (which also solves the engine lifecycle problem in 4.2), and safe-area padding.
- Orientation guidance and a "keep screen awake" behaviour (Wake Lock) for tablet use.
- **Device capability gate**: run the self-test on first use, recommend input size and cadence,
  and disable the engine with an explanation on devices below the threshold.
- PWA standalone display (see 4.11) so the browser chrome does not eat the screen; an install
  prompt is optional.

**Effort.** **M.** Layout and touch targets (M), simplified zone editor (M), capability gate (S).

**Risks.**
- Mobile browsers suspend background tabs aggressively; the alert story is weaker than on
  desktop (see 4.2).
- iOS Safari has its own canvas/memory limits and no WebGPU in older versions; test on the
  actual device, not a resized desktop window.
- A tablet propped on a stand is a kiosk with no lock screen; physical security matters.
- Larger touch targets reduce information density; do not simply scale the desktop UI.

**Out of scope.** Native iOS/Android apps, offline sync between devices, push notifications,
phone-as-camera fleets.

---

### 4.11 Offline, PWA and caching

**Today.** The only service worker is `coi-serviceworker.js`, which adds COOP/COEP and
**caches nothing by design**. There is no web app manifest, no offline shell, no explicit asset
cache. After a reload without network, the browser shows its offline page. Models (9.9 MB) and
the ORT WASM binary (28.7 MB) are re-fetched per session subject to the HTTP cache. The
cache-less choice is deliberate and defensible for a demo (no stale bundle behind a deploy), but
it means a flaky apron network can prevent the app from starting at all.

**Why it matters.** Apron connectivity is unreliable and often segmented. A safety tool that
needs the internet to boot is fragile; a safety tool that silently runs last month's model is
worse. The right answer is explicit, versioned offline capability with an update decision.

**What browser-only looks like.**
- Keep the COI worker's "no cache" rule for navigations, and add a **separate, versioned app
  cache** (Cache Storage) for hashed assets and models, populated after a successful load. The
  cache name includes the build id; activation deletes older caches.
- Precache the app shell + models only after the user chooses **"Make available offline"**, with
  a size disclosure (≈40 MB) and a progress indicator.
- **Update flow**: detect a new build id (via `/version.json` or a message from the service
  worker), show "update available — reload when idle", and never swap models mid-shift without
  saying so.
- A **manifest** with name, icons, theme colour, `display: standalone`, and an install prompt on
  supporting browsers. Keep scope at `/LocalSight/`.
- Handle quota and eviction: `navigator.storage.persist()`, estimate warnings, and a "download
  models again" action.

**Effort.** **M** (bordering L if the update flow must be bulletproof). Cache worker and version
manifest (M), offline UI (S), update prompt (S).

**Risks.**
- Service worker bugs are the hardest to debug and the easiest to ship; a bad cache can pin a
  broken app on every kiosk.
- Caching a model means a model update needs its own rollout and invalidation; couple it to the
  manifest hash.
- Cache Storage is per origin and shared across tabs; a shift in progress and an update can
  collide.
- GitHub Pages has no custom headers, so cache-control is limited; the SW is the only lever.
- "Offline" must not be confused with "no upload": incident evidence still never leaves the tab,
  which is the point.

**Out of scope.** Offline sync to a server, background sync of incidents, app-store
distribution, multi-device cache sharing.

---

### 4.12 Onboarding and first-run

**Today.** On a browser without a WebGPU adapter the engine defaults to **off**, and the visitor
sees a video with a note that detection is off. There is no checklist that says "this is why,
here is what to do", no permission primer for the camera, no model self-test, no "your first
incident" guidance, and no readiness summary. Zones and cameras are pre-seeded, so a new site
starts by editing someone else's demo data. The demo chips explain fixtures, but not the
product's state.

**Why it matters.** An operator cannot tell the difference between "working and quiet" and
"broken and quiet". First-run failures look like product failures, and the first ten minutes
decide whether the tool is trusted.

**What browser-only looks like.**
- A **readiness checklist** on Live (collapsible): browser supports the engine; model loaded and
  hash verified; camera source delivering frames; zone configured and enabled; blur active;
  notifications allowed; storage persisted; last test incident acknowledged. Each row is derived
  from a real measurement, not a static claim.
- A **first-run wizard** (3 steps): choose source → draw/confirm a zone → run a 30 s live test
  with a "this is what an incident will look like" explanation and a test notification.
- **Permission primers** before `getUserMedia` and Notifications, explaining why and what stays
  local.
- A **demo vs live switch** that is explicit and does not mix fixture incidents with local ones
  in the same list without a marker (the `local` chip helps; make it a filter).
- Store completion per site so an update does not replay the wizard, but re-run the readiness
  check after every update.

**Effort.** **M.** Checklist and wizard (M), test incident and notification (S), demo/live
separation (S).

**Risks.**
- A wizard that blocks the demo is a regression; make it skippable and non-modal.
- Readiness checks can lie if they cache a result; recompute on each load.
- Site-specific steps (gateway URL, camera credentials) need a place to live; that is the
  camera registry (4.1).
- Over-explaining slows an experienced operator; keep it collapsible.

**Out of scope.** Remote guided onboarding, admin console, tenant provisioning, training
material authoring.

---

### 4.13 Accessibility

**Today.** Several things are good: incident cards are keyboard reachable with a visible focus
ring, the toast is a polite live region, form controls have labels, severity is text as well as
colour, and the mobile rail no longer traps the content. Gaps: a new CRITICAL incident is **not
announced** (no assertive live region; only the toast for acks/simulation), there is no skip
link, type is very small (9–11 px in labels and metadata), the annotated canvas has no text
alternative, polygon **creation** needs a pointer (keyboard only nudges existing points),
`prefers-reduced-motion` is not respected (pulse/bounce animations on escalated cards), and
the false-positive dialog has `aria-modal` but no initial focus, focus trap or Escape handling.

**Why it matters.** Accessibility is a legal requirement in many procurement processes and a
real need for low-vision operators on a bright apron. It also overlaps with glanceability: if
the critical alert is not perceivable in two seconds, it fails for everyone.

**What browser-only looks like.**
- A single **assertive live region** for new critical incidents, rate-limited and dismissible,
  with the same content as the notification (camera, zone, type, age).
- **Keyboard-complete zone editing**: add a point at the frame centre, move with arrows, delete,
  cycle points; expose the polygon as a table of coordinates with editable inputs (the editor
  already has JSON; a table is the accessible equivalent).
- A **text summary of the processed frame**: "3 persons, 1 without hi-vis vest, 0 faces visible"
  next to the canvas, updated at the stats cadence. Useful for everyone, essential for screen
  readers.
- Respect `prefers-reduced-motion`; keep a non-animated escalation marker.
- A **larger-text / high-contrast** option in the theme menu; audit contrast on the dark theme.
- Skip link, focus trap in dialogs, and a documented tab order for Live.

**Effort.** **S/M** for the high-value items; a full audit is M.

**Risks.**
- Assertive announcements can spam and block a screen reader; deduplicate by incident id and
  limit rate.
- Audio alert + screen reader + notification can triple-announce; offer a single channel choice.
- The frame summary must be generated from real detection, not mocked, or it becomes another
  inaccurate KPI.
- Accessibility work on a canvas-heavy UI is never "done"; treat it as a standing budget.

**Out of scope.** WCAG certification, screen-reader support for freehand polygon drawing (the
table editor is the accessible path), cognitive-load research.

---

### 4.14 Internationalisation

**Today.** All copy is Romanian and inline in JSX/JS. `index.html` has `lang="ro"`, dates use
`ro-RO`, the report and CSV headers are Romanian, shift labels are hardcoded, and the type
labels are duplicated in at least three places (`services/api.js`, `constants/shiftReport.js`,
`LiveEngineCard.jsx`). There is no message catalog, no locale switch, and pluralisation is
hand-written.

**Why it matters.** Airports are multilingual workplaces; a pilot in another country needs
English (and possibly the local language). Mixed-language exports are a liability, and the
duplicated labels drift.

**What browser-only looks like.**
- Extract strings into `src/i18n/ro.json` and `en.json` with a tiny `t(key, params)` helper and
  a React context (no dependency).
- Locale from site config plus a user preference; `Intl` for dates, numbers and relative time;
  per-locale report labels, CSV headers and file names.
- A language switch in the header; persist the choice with the operator profile.
- Key-parity test in Node (`node --test`) so a missing translation fails CI.
- Keep zone names, camera names and operator names as **data**, never translated.

**Effort.** **M** (large mechanical extraction; **S** if only Live, Incidents, Reports and
settings are covered first).

**Risks.**
- Text expansion breaks the dense 9 px layout; plan a typography pass with the extraction.
- Half-translated UI is worse than monolingual; ship a locale only when key parity is complete.
- Exported reports need a locale snapshot; a later language change must not rewrite history.
- `lang` attributes on mixed-language content (camera names) need care.

**Out of scope.** Translation management platform, machine translation, RTL support unless a
target market requires it.

---

### 4.15 Deployment, update strategy and licensing

**Today.** `.github/workflows/pages.yml` builds the mock configuration
(`VITE_USE_MOCK=true VITE_BASE=/LocalSight/`) on every push to `main`, copies `index.html` to
`404.html`, and deploys. There is no version or commit shown in the UI, no release tag, no
staging site, no rollback button, no update notification for an open tab, no CSP or SRI, and no
integrity check on the models. The build has no backend, which is the strength; the flip side
is that configuration (cameras, zones, operator) lives only in memory and would be wiped by a
deploy if it were persisted naively.

**Why it matters.** A safety record must name the version that produced it. A mid-shift deploy
must not half-break a kiosk, and a bad release must be reversible without a git surgery. The
licence is not a detail: YOLO26n is **AGPL-3.0** and the repo is **BSL 1.1**; shipping this to a
customer without resolving that is a legal blocker, not a backlog item.

**What browser-only looks like.**
- Inject **build metadata** at build time (commit, date, model manifest hash, locale) and show it
  on Sistem & Audit and in every export.
- Publish `/version.json`; the app compares it on focus and shows "new version available —
  reload when idle". Never auto-reload during an active shift without a prompt.
- **Tag releases** and keep the previous `dist` artifact (or a `release/<version>` branch) so a
  rollback is a workflow dispatch, not a revert.
- Add a **CSP meta tag** compatible with the app (no inline script except the theme bootstrap,
  which can be hashed or moved to a module), `Referrer-Policy`, and integrity checks for the
  model files via the manifest hash. Full COOP/COEP remains the service worker's job.
- A **smoke test on the deployed artifact** in CI: load `/LocalSight/`, start the engine, assert
  one frame and zero console errors beyond the known YuNet warnings.
- **Licensing**: decide between an Ultralytics enterprise licence and an AGPL-compatible
  distribution before any paid pilot; surface the licence and model source in the manifest and
  in the docs. The BSL 1.1 production clause applies to the app itself.
- Document a **rollback and config-migration** procedure; keep the storage schema version in the
  build metadata.

**Effort.** **S/M** (build metadata, version check, CSP, release tags); licensing is a business
decision with engineering follow-through.

**Risks.**
- GitHub Pages cannot set arbitrary headers per path, so CSP/SRI and COOP/COEP have to go
  through meta tags and the service worker; test in all target browsers.
- A service worker plus a version check can produce update loops if the build id does not change
  deterministically.
- Rollback with persisted IndexedDB data requires a backward-compatible schema, or an export
  before downgrade.
- AGPL obligations extend to the combined work if YOLO is distributed; get legal input, do not
  improvise.

**Out of scope.** Blue/green infrastructure, CDN, canary analytics, app-store distribution,
server-side feature flags.

---

## 5. What is already product-grade

Worth protecting while the gaps above are closed:

- **The engine port is proven.** Behavioural parity with the Python reference was measured:
  identical zone/membership/rule decisions, 100 % face recall on the test frames, 98 % person
  recall vs Ultralytics (and 100 % vs the ncnn path the port follows), IoU ≈ 0.99. The event
  envelope matches `docs/contract.md`.
- **Privacy is engineered, not claimed.** Blur runs before draw and snapshot; a missing model
  produces a guard frame, not a raw frame; the raw video is hidden while the engine is requested;
  fullscreen is blocked during detection; the worker never posts a pre-blur bitmap.
- **The demo path works without a server.** Static build, models same-origin, deep links via the
  404 fallback, COOP/COEP via a cache-less service worker, deterministic fixtures, an explicit
  "demo vs local" marker.
- **Reports are honest by construction.** The summary is a template labelled `șablon`, PPE
  compliance is explicitly not derived from incidents, and empty states say why they are empty.
- **The codebase is testable.** Pure logic lives in `engine/`, `utils/`, `constants/` with Node
  tests; the UI is a composition; CI runs unit, build and e2e.

---

## 6. Explicitly out of scope

For this product direction, not "later" — out:

- Application backend, database, API, authentication server, Slack/Teams/SMS delivery,
  server-side escalation, push notifications.
- Server-side recording, NVR, transcoding, ONVIF discovery, PTZ.
- Cloud storage or sync of frames, incidents or evidence.
- Face recognition, identity, emotion analysis, person re-identification across cameras.
- FOD detection, smoking detection beyond the existing rule type, crowd analytics.
- A trained PPE classifier: the current hi-vis check is a colour heuristic, and no shipped
  footage proves a real vest-free worker. Do not present it as a classifier.
- Native mobile apps and app-store distribution.
- LLM-written incident reports.

The camera gateway (RTSP → WHEP/MJPEG) is site infrastructure. It is a prerequisite, not an
application backend, and the app must keep working with only local files and the webcam.

---

## 7. The three features to build next

The order is deliberate: each one removes a blocker the next one depends on.

### 7.1 Build 1 — A durable session shell: engine above routes, local record, alert delivery

**Why first.** Two of the three product-deciding gaps are the same architectural mistake: the
engine and the incident list live inside `LiveView` and inside React state. Move the engine to
an app-level provider (a persistent, hidden stage that survives routing), persist incidents and
evidence locally, and deliver alerts while another window is in front while reporting gaps
honestly when the browser suspends the tab. After this, opening an
incident, editing a zone, or reading a report no longer stops monitoring, and a reload no longer
erases a shift. Everything else — reports, retention, audit, onboarding — is built on this
record.

**Scope.**
- Engine provider + persistent stage; worker lifecycle independent of the route; explicit
  start/stop and a visible state.
- IndexedDB store (incidents, acks, zones, settings, audit, coverage) with schema version and
  migrations; OPFS/IDB evidence; retention and purge; `storage.persist()`.
- Notification permission + service-worker notification + engine-incident sound + escalation
  sound; Wake Lock; visibility/gap handling; Web Locks for a single alerting tab.
- Coverage counter (monitored minutes, gaps) that the report can consume.

**Success criteria.** Open an incident detail while frames keep arriving; reload and find the
shift intact; get a sound and a system notification for a new CRITICAL engine incident with
another window in front; a hidden or frozen tab is reported as a monitoring gap on return, not
silently counted as monitored; a retention purge removes evidence and revokes URLs; two tabs do
not double-acknowledge.

**Effort.** L. **Depends on:** nothing. **Unlocks:** 7.2, 7.3, report accuracy, audit.

### 7.2 Build 2 — Camera onboarding: registry plus a live source adapter

**Why second.** The product cannot watch an apron camera today. A registry and an adapter turn a
hardcoded demo into something installable: add a camera, paste a WHEP or MJPEG URL, see frames,
draw zones, get incidents — without a rebuild. It is also the honest place to state the capacity
limit: one active engine, N sampled cameras, measured on the device.

**Scope.**
- Camera registry in IndexedDB with add/edit/disable; per-camera zones and health.
- Adapter interface for bundled file, `getUserMedia`, WHEP (native `RTCPeerConnection`), and
  MJPEG over HTTP; reconnect with backoff; last-frame age and error surface.
- Scheduler: one active camera at full cadence, others sampled or paused; a grid of last frames;
  a self-benchmark that recommends how many cameras fit.
- Keep the existing clip cameras as demo sources; do not regress the demo path.

**Success criteria.** A real camera on the pilot network appears in the selector and produces
incidents at ≥3 fps on the pilot laptop; adding it requires no code change; a dead camera shows
"no frames for 10 s" instead of a frozen picture; the demo still runs from the static build.

**Effort.** L. **Depends on:** 7.1 (persisted registry, engine provider). **Unlocks:** a real
pilot site.

### 7.3 Build 3 — Operator session and shift record

**Why third.** Once a shift survives locally, it has to be attributable and presentable. This is
what turns "a demo that detects people" into "a record a supervisor can sign". It also closes the
report-accuracy gap cheaply because the data model from 7.1 is already there.

**Scope.**
- Local operator profiles with PIN (PBKDF2) and optional WebAuthn; idle lock; capability table;
  operator captured on every action.
- Append-only, hash-chained audit log covering acks, zone changes, evidence views and exports.
- Shift-scoped report: filter by operational day, shift and camera; compute KPIs from incidents;
  add coverage and data quality; include model/build identity; sign-off with operator and time.
- Export: CSV (documented separator, ISO timestamps), print PDF with header/footer, JSON bundle
  with evidence written through the File System Access API; a verified audit chain in the bundle.

**Success criteria.** The report for a shift reconciles with the incident list and states its
coverage; every ack names an operator who unlocked the session; a second operator cannot ack
under the first name without unlocking; the export opens in Excel and contains model, build and
coverage; the audit chain verifies.

**Effort.** M/L. **Depends on:** 7.1 (store and audit), partially 7.2 (per-camera report).

**What I would not build next:** a multi-camera wall, full i18n extraction, a native app, cloud
sync, an LLM report, FOD, or face recognition. They are either premature or contradict the
product's constraints.

---

## Appendix A — decisions needed before a pilot

1. **Operating model:** supervised (operator present, tab open) or unattended? The answer decides
   whether browser-only is acceptable at all. If unattended, a local companion process is
   required and that is a different product.
2. **Camera plumbing:** who owns the RTSP → WHEP/MJPEG gateway, and is it allowed on the apron
   network? Without it, only demo clips and the laptop camera exist.
3. **Capacity:** how many cameras per kiosk, at what cadence, on what hardware? One active engine
   is the safe default; the pilot should measure before promising more.
4. **Retention:** how many days of evidence, and who may view it? The answer becomes a setting and
   a purge policy, not a paragraph.
5. **Auth strength:** PIN on a trusted kiosk, WebAuthn, or both? Local auth is deterrence, not a
   security boundary.
6. **Languages:** RO only, RO + EN, or site-specific? Determines the i18n scope.
7. **Licence:** Ultralytics enterprise licence or AGPL-compatible distribution? This is a
   go/no-go for a commercial pilot, independent of every feature above.
8. **Report consumer:** who reads the shift report, and in what format (print, CSV, PDF, email
   attachment)? The export should be designed for that reader, not for the demo.

---

## Appendix B — reproducibility

```bash
cd frontend
npm ci
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
# served dist/ under /LocalSight/ on 127.0.0.1:4340, SPA fallback, no-store
# Playwright chromium (headless, no WebGPU) clicked through Live, detail, reports, zones,
# settings at 1440x900 and 375x812; worker constructor wrapped to count create/terminate.
```

Files read for the claims above (paths in this repo):
`frontend/src/engine/{worker,useEngine,pipeline,detectors,blur,webgpu}.js`,
`frontend/src/components/views/{LiveView,ReportsView,ZoneEditorView,SettingsView}.jsx`,
`frontend/src/components/live/{MediaStage,CameraToolbar,IncidentFeedCard,KpiStrip,LiveEngineCard}.jsx`,
`frontend/src/context/{useIncidentStore,useKpis,useOperator,useConnectionHealth,useShiftReport,SecurityContext}.jsx`,
`frontend/src/{constants/shiftReport.js,utils/reportExport.js,utils/sound.js,utils/systemView.js,services/config.js}`,
`frontend/public/coi-serviceworker.js`, `.github/workflows/pages.yml`, `docs/qa/*`.

Probe scripts, screenshots and JSON output were kept in `/tmp/opencode/ls-gaps/`; none of them
are part of the deliverable. No application code, tests, configuration or other worktree was
modified by this analysis.
