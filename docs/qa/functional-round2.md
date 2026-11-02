> **Notă de stare:** raportul descrie build-ul `473ad8e`. F1 (id-uri duplicate la zone suprapuse) a fost reparat pe `main` în `83b8206` — fiecare eveniment primește un id propriu, iar ack-ul este independent. F2–F6 rămân de reparat.

# Functional QA round 2 — zones on the frame, WASM threads, safety blur

**Branch:** `prep/qa-functional` · **Date:** 2 November 2026 · **Author:** QA subagent (read-only).
**Build under test:** `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build` of `main` @ `473ad8e`
(production bundle; no application, test or dependency change in this task).
**Serving:** `frontend/e2e/pages/server.mjs` on `127.0.0.1:4341` — the Pages stand-in: artifact under
`/LocalSight/`, SPA fallback as `404.html`, no COOP/COEP headers, so isolation comes only from
`coi-serviceworker.js` (the page reloads once, ~1–2.5 s).
**Browser:** Chromium headless, Playwright 1.64.1 (`chromium-1248`), 1280×900 (plus 1024×800 and 375×812),
**16 logical cores**, no usable WebGPU adapter → engine on WASM. Idle machine: 5.1–6.2 fps at 4 threads,
1280×720 processed frame, as expected.
**Clip:** `media/stand12.mp4` (camera `stand12`, default), `media/taxiway-b.mp4`; fake media device for the
browser camera.
**No test hooks.** The app was not modified. Test scripts wrap `window.Worker` **inside the test page only**
(`page.addInitScript`) to record the `init`/`config` payloads the harness sends and to expose worker instances
for fault injection; this observes the existing contract, it does not add an app hook.

All scripts, screenshots and JSON measurements are in **`/tmp/opencode/qa2/`** (paths below are relative to it).

---

## Verdict per feature

| Feature | Verdict | One-line reason |
|---|---|---|
| **Zones on the processed frame** | **Works**, with three UI defects | Both zones, a new full-frame zone, a canvas-drawn zone, long names, 9 zones and deletion all render correctly in canvas and snapshot; labels become unreadable at 375 px (F3), collide when zones overlap (F4), and the status tile calls an inactive zone active (F5). |
| **WASM thread setting** | **Pass** | 1/4/6 threads reach ORT exactly (`targets`: 0/3/5 pthread workers), persist, clamp to hardware, ignore corrupt values, fall back to 1 without COI, and restart cleanly from Settings → Live. Only nit: the select still shows an impossible stored value without COI (F6). |
| **Safety-blur toggle** | **Works as specified**, one claim defect | Same paused frame is measurably sharper in the head band with OFF (torso control identical), face boxes stay blurred, persist across reload, fail-closed survives; the evidence caption still claims “fețe blurate” when OFF (F2). |
| **Regressions** | **Mostly pass** — one High data-identity defect | Incidents/list/report/ack, camera switch, webcam on/off, deep link, 375 layout and console are clean; overlapping zones produce **duplicate `event_id`s** (F1). |

---

## Findings

Severity: **High** = wrong data or broken guarantee on a supported path; **Medium** = visible defect that
misleads or degrades a supported path; **Low** = cosmetic/edge; **Info** = observation, not a defect.

| ID | Severity | Area | Steps | Expected | Observed | Evidence |
|---|---|---|---|---|---|---|
| **F1** | **High** | Engine events / data identity | Create two `RESTRICTED` zones on `stand12` whose polygons overlap the seeded `engine-left` (both `active_when: always`, debounce 0.5); start the browser engine; wait for the first event | Every incident has a unique `event_id`; one zone cannot overwrite or alias another | **3 incidents, 1 unique id**: `evt_stand12_1793641735817_3` appears three times (zones `engine-left`, `Suprapunere A`, `Suprapunere B`). The feed renders 3 cards and every incident consumer counts them as three events, but only one id identifies all three. Cause: `eventId(camera, nowMs, trackId)` has no zone component and `nowMs` is taken once per frame (`pipeline.js` `step` / `events.js` `eventId`). Ack/deep-link by id are ambiguous; the production React build does not warn about the duplicate key | `overlap-result.json` (`local_labels`, `unique_labels: 1`), `overlap-feed.png`, `overlap-canvas.png` |
| **F2** | **Medium** | Safety blur / evidence honesty | Let the seeded `engine-left` incident fire with safety blur ON, then repeat with OFF; open each incident detail and compare the snapshot and its caption | Caption describes what the picture actually is; with OFF it should not claim all faces are blurred | Snapshot with OFF visibly shows the right worker’s profile face (and the distant worker’s head) sharp, while the caption still reads **“Momentul incidentului • fețe blurate în browser”** — hard-coded in `snapshotCaption()` independent of the setting. The Settings caveat is correct, the evidence label is not | `incident-on-snapshot.png`, `incident-off-snapshot.png`, `incident-off-result.json` |
| **F3** | **Medium** | Zones at 375 px | 375×812 viewport, engine on, `stand12` | Zone name readable on the only zone surface (the processed canvas) | Canvas is 1280×720 intrinsic displayed at **349×258** (scale 0.273); label font is 20 px intrinsic → **5.45 px rendered**. Visible in the screenshot as an illegible strip; at 1024 px the same label is ~11.7 px and readable. No page overflow (scrollWidth 375) | `reg-03-mobile-375.png`, `reg-04-mobile-canvas.png`, `regression-result.json` (`mobile_label_font_px`) |
| **F4** | **Low** | Zone labels | Two zones whose top vertices are within a few pixels (e.g. `Suprapunere A` and the seeded `engine-left`), engine on, 1280 px | Two distinct labels, or a collision rule | Labels are both drawn at the top vertex with no collision avoidance; they overprint into **“ZZONĂ: Suprapunere Bar stâng”**, unreadable. With 9 zones stacked near the top the labels form a dense block but stay legible at 1280 | `overlap-feed.png`, `zones-04-many.png` |
| **F5** | **Low** | Zone state copy | Toggle `MOTOR: ON → OFF` while the engine runs and the `engine_on` zone is dimmed with “(inactiv)” | The metric tile should not call an inactive zone “Zonă activă”, or should qualify it | Canvas correctly draws “ZONĂ: Stand 12 — motor stâng **(inactiv)**” dimmed; the card below still says **“ZONĂ ACTIVĂ Stand 12 — motor stâng”** unchanged. `engineReadout` always labels `activeZone` as active | `zone-active-card-engine-off.png`, `zone-active-card.txt` |
| **F6** | **Low** | Threads without COI | Block service workers (no isolation), store `wasmThreads: 6` | The control reflects what will run, or is visibly disabled | Select shows **“6”** while the helper line says **“1 — izolarea nu e activă; rulează single-thread”**, and the engine init carries 1. The effective value is stated, but the control itself shows an impossible choice | `threads-02-no-coi.png`, `threads-nocoi-result.json` |
| **F7** | **Info** | Zones with the browser engine off | Engine off; 2+ zones configured | — | Only the camera’s single seeded/active zone is outlined (static `ZoneOutline` + SVG); the other configured zones are not shown even though the engine-on canvas draws all of them. This is the pre-existing static overlay, not a regression of the new feature; noting it for consistency | `zones-05-engine-off.png`, `zones-result.json` (`static_zone_label`) |

### Top 3 problems

1. **F1 — duplicate engine incident ids when zones overlap.** This is a data-integrity bug: incidents are
   keyed by id everywhere (list, detail route, ack, report). Three cards with the same id inflate the KPI and
   report, and acking one id acts on records that have different zone names. Fix direction: include the zone
   (or a per-frame sequence) in the event id, or de-duplicate by `(event_id, zone_id)` in the store.
2. **F2 — the snapshot caption claims blurred faces with safety blur OFF.** The operator can deliberately turn
   the head-band net off; the picture then contains a sharp profile face, while the evidence panel still calls
   it “fețe blurate în browser”. A caption that depends on the setting (or neutral wording) is needed.
3. **F3 — zone names are unreadable at 375 px.** The new labelling feature has no effect at the mobile width
   the app otherwise supports; the outline is still visible, but the name is ~5 px tall.

---

## What held

### Zones

- **Both configured `stand12` zones** are stroked and labelled on the processed canvas: `ZONĂ: Stand 12 —
  motor stâng` (dashed outline, `engine_on`) and `ZONĂ: Platformă Stand 12`, at their top vertices; yellow
  edge sampling found 1957 px on `engine-left` and 897 px on `apron-stand12` (`zones-01-two-zones.png`).
- **Newly drawn zone**: four real canvas clicks + click on point 0 closed the polygon; saved and drawn by the
  engine (1275 yellow px along the new top edge at y=0.10), zone count 2→3
  (`extra-01-drawn-zone.png`, `extra-result.json`).
- **New full-frame zone** (`[[0,0],[1,0],[1,1],[0,1]]`): border drawn on all sides (1522 yellow px in the top
  12 px band; the bottom band sampled 830, lower because the clip’s yellow apron markings overlap it), label
  at the top-left (`zones-02-fullframe.png`).
- **Long name (122 chars)**: `fitText` truncates with an ellipsis; the label box stays inside the frame and
  does not crash or clip the polygon (`zones-03-longname.png`).
- **Many zones**: 9 zones → labels/outlines all drawn; **50 synthetic zones** via a `config` message → still
  drawn, **no measurable frame cost**: chip 5.45 fps (3 zones) → 6.0 (50) → 5.8 (0); canvas-change sampling
  2.75 / 3.63 / 3.25 fps (coarse, within noise). Zone drawing is post-detection presentation only
  (`zones-04-many.png`, `extra-02-50-zones.png`, `extra-result.json`, `zones-result.json`).
- **Deleted zone**: deleting `apron-stand12` through the editor removes its outline from the very next canvas
  (yellow hits on its top edge 897 → **0**) and its label; the engine keeps running (`zones-08-deleted.png`).
- **Engine off vs on**: engine off → **0 canvases**, static SVG outline + single label
  `zonă configurată: engine-left · nu este detecție`; engine on → canvas with all zones and labels. The raw
  clip is visible only with the engine off, which is the documented state (`zones-05-engine-off.png`).
- **Inactive `engine_on` zone**: with `MOTOR: OFF` the canvas draws `ZONĂ: Stand 12 — motor stâng (inactiv)` at
  alpha 0.4 while `always` zones stay full opacity; the rule is muted too: **30 s with the aircraft engine OFF
  produced 0 engine incidents**, then switching `MOTOR: ON` produced the `engine-left` incident within 20 s
  (`zones-07-inactive-dimmed.png`, `engineon-race.png`).
- **Malformed zones cannot kill a frame**: sending `config` with `polygon: []`, two points, a `NaN` vertex, a
  string polygon and a numeric name at the worker boundary left the engine at 5.1 fps with `rulează`; the
  valid zone sent in the same batch was still drawn (1856 yellow px) and frames kept flowing. `drawZones`
  also restores canvas state per zone, so a bad zone cannot leak its dash/alpha into the next frame
  (`zones-09-malformed.png`, `zones-result.json`).
- **Rules still fire**: the seeded `RESTRICTED` zone produced a real engine incident (`local`, 5/5 frames,
  confidence 0.66–0.67) in **~1.5 s** of engine time in both ON and OFF runs (`incident-on-result.json`,
  `incident-off-result.json`).
- **Snapshot evidence carries the zones**: the 960×540 JPEG snapshot from the incident detail contains the
  dashed zone outlines and labels — 393 / 389 yellow pixels sampled on the `engine-left` top edge, 10 880 /
  11 206 yellow pixels in the whole snapshot (`incident-on-snapshot.png`, `incident-off-snapshot.png`).
- **1024 px**: canvas 750×421, label font ~11.7 px, readable; no overflow (`reg-05-1024-canvas.png`).

### WASM threads

Measured with 16 cores and the Pages-shaped build. ORT starts `threads − 1` pthread workers next to the
engine worker, so the CDP `Target.getTargets` count is an exact, independent check of the setting:

| Setting | Settings helper text | `wasmThreads` in `init` | ORT worker targets | Engine fps |
|---|---|---|---|---|
| Automat (isolated) | `4 — izolat, 16 nuclee; automat (max. 4)` | 4 | 3 | 6.08 |
| 1 | `1 — izolat, 16 nuclee; ales 1` | 1 | **0** | 2.28 |
| 2 (changed while running) | `2 — izolat, 16 nuclee; ales 2` | 2 | 1 | 3.98 |
| 4 | `4 — izolat, 16 nuclee; ales 4` | 4 | 3 | 5.60 |
| 6 | `6 — izolat, 16 nuclee; ales 6` | 6 | 5 | 5.92 |
| 8 on a 3-core override | `3 — izolat, 3 nuclee; ales 8, limitat de nuclee` | **3** | 2 | 4.63 |
| 6 without COI | `1 — izolarea nu e activă; rulează single-thread` | **1** | **0** | 2.35 |

- **Persistence**: select 6 → reload → select still 6, storage `{"wasmThreads":6,"safetyBlur":true}` and the
  next engine starts with 6.
- **Corrupt storage**: `{"wasmThreads":7,"safetyBlur":"yes"}` → UI **Automat**, blur checked, init 4 and 3
  pthread workers, i.e. field-by-field fallback to the privacy-safe defaults.
- **Invalid types ignored**: `{"wasmThreads":"4"}` (string) → Automat/4, not a crash and not a silent 4.
- **No COI**: with service workers blocked, `crossOriginIsolated=false`, UI says 1, init 1, zero pthread
  workers, engine still processes at 2.35 fps.
- **Change while the engine runs**: from a running 6-thread engine, Settings → 2 → Live; a new engine worker
  starts with `wasmThreads: 2` and exactly one pthread target, another init with the new count; no stale pool.
  Cumulative engine workers 1→2, as expected for a restart rather than reconfiguration.
- **1280 cap and hardware**: intrinsic canvas 1280×720 in every run; `hardwareConcurrency` override is honored
  by the UI copy and the clamp.

### Safety blur

- **Same paused frame, only the head band changes**: both runs seek and pause at `currentTime = 4.6`, wait for
  the worker to render that exact frame (canvas hash change), then measure. Torso control region is
  **identical to the last digit** (mean gradient 13.284073795180731 in both), proving the same frame; head
  bands are clearly sharper with OFF:
  - centre worker head: **14.14 → 19.66** (+39 %)
  - right worker head: **14.30 → 23.45** (+64 %)
  - (`blur-on.png`, `blur-off.png`, `blur-metrics.json`)
- **Face blur still applied with OFF**: the centre worker's YuNet-boxed face stays blurred while the right
  worker's profile face (never boxed) becomes sharp — exactly the documented caveat; the OFF screenshot shows
  it directly (`blur-off.png`).
- **Snapshot difference**: ON snapshot blurs all four head bands; OFF snapshot shows the right worker's face
  and the distant worker's head sharp, with the same zone overlays (`incident-on-snapshot.png`,
  `incident-off-snapshot.png`). This is also the evidence for F2.
- **Persistence from the UI**: uncheck in Settings → storage `safetyBlur:false`, next engine `init.safetyBlur
  = false`, reload keeps it unchecked and the engine starts with false; re-check restores true
  (`extra-result.json`).
- **Fail-closed still holds**: blocking `**/models/*.onnx` gives the opaque
  `PRIVACY: modelul de blur nu este disponibil` placeholder (canvas mean 12.5, all black), video opacity 0,
  card `eroare` with the fetch error; **no raw frame** is shown. With `Worker` removed, the card says
  `browser neacceptat`, shows the “fluxul brut nu este afișat ca procesat” message, and the raw video stays at
  opacity 0 (`extra-03-fail-closed.png`, `extra-04-unsupported.png`).
- **OFF caveat visible**: Settings states “OFF = doar fețele găsite de YuNet sunt blurate; o față ratată
  (profil) poate rămâne vizibilă” and recommends ON for public demos; the panel also explains that face blur
  and fail-closed do not change (`settings-engine-panel.png`, `settings-engine-panel.txt`).

### Regressions

- **Engine incidents enter the list and the report**: the `local` incident appears in Incidents with a
  `Confirmat` status after ack; the shift report moves `RESTRICTED_ZONE` **4 → 5** and acknowledged
  **4 → 5**, and the summary recomputes to “9 evenimente, 5 critice și 4 avertismente… 4 sunt confirmate”
  (`incident-on-result.json`, `incident-on-snapshot.png`).
- **Ack**: acknowledging in the incident detail switches the decision panel to `Confirmat`, adds the
  confirmation timeline entry, and the report counts it. Acknowledging a fixture from the Live feed shows
  “Evenimentul 000_17 confirmat de Dispecer. Escaladare anulată.” (`incident-on-result.json`,
  `regression-result.json`).
- **Camera switch while running**: `stand12` → `taxiway-b` keeps the same engine worker (`workers = 1`), sends
  `config.cameraId = taxiway-b`, draws the taxiway zone (2283 yellow px on its `y=0.62` line) and holds
  5.93 → 6.53 fps; source changes to `media/taxiway-b.mp4` (`reg-01-taxiway.png`).
- **Browser camera (fake device)**: `getUserMedia` track live (`fake_device_0`), engine runs at 6.4 fps with
  the `webcam-view` zone drawn; switching the browser engine off removes the canvas (0), restores video opacity
  1 while keeping the stream live; switching it back on resumes at 6.63 fps without re-requesting the camera
  (`reg-02-webcam-engine-on.png`, `regression-result.json`).
- **Deep link**: `/LocalSight/incidents/evt_stand12_1700000000000_17` returns the Pages 404 fallback and still
  renders the header, report and evidence panel for that incident (`deeplink_status: 404`).
- **375 px**: no horizontal overflow (`scrollWidth = innerWidth = 375`), canvas present and engine running at
  3.87 fps; only the label legibility fails (F3).
- **Console**: across all pages, no `pageerror` and no application `console.error` except the expected ONNX
  `VerifyOutputSizes` shape warnings; the only warnings are `No available adapters.` (headless WebGPU probe)
  and a Canvas2D `getImageData` readback warning caused by this audit's pixel reads
  (`*-console.txt`, `regression-result.json`).
- **Report numbers are derived, not invented**: the summary line and KPI tiles changed consistently with the
  newly acknowledged engine incident; no hard-coded count was observed.

---

## Reproduce

```bash
cd /home/restlessstone/Coding/LocalSight-prep/qa-functional/frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
PW_PAGES_PORT=4341 PW_PORT=4341 node e2e/pages/server.mjs   # terminal 1
cd /tmp/opencode/qa2 && node zones-core.mjs                  # zones, fps, malformed, delete
node threads.mjs                                             # threads + no-COI + clamp
node blur-compare.mjs && node blur-metric.mjs                # same paused frame, ON vs OFF
node incident-runs.mjs                                       # incidents, snapshot, ack, report
node overlaps.mjs                                            # duplicate event ids
node regressions.mjs                                         # switch, webcam, deep link, 375, 1024
node extras.mjs && node engineon-race.mjs && node zone-card.mjs
```

Scripts are read-only harnesses; they build and serve the unmodified `dist/`. The `Worker` wrapper is
installed by the test page to record `init`/`config` payloads and to send the malformed-zone fault; no source
file in the repository was changed for this audit.

## Limitations

- The snapshot comparison is visual + zone-pixel counts; the precise person-box detector used for the canvas
  metric does not survive JPEG compression reliably, so the quantitative blur proof is the same-frame canvas
  comparison and the identical torso control.
- FPS numbers are from an idle 16-core machine in headless Chromium; ±0.6 fps run-to-run variance means the
  zone-drawing cost verdict is “no measurable effect”, not a precise constant.
- F1 was reproduced through the zone editor; it is a consequence of the event-id formula (`camera_ms_track`),
  so any overlapping/nested configuration on one camera can trigger it, not only the test polygons.
