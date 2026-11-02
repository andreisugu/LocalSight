# Privacy regression — LocalSight static build

**Branch:** `prep/privacy-regression` · **Date:** 2 November 2026 · **Author:** QA subagent (read-only).
**Build under test:** `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build` (production bundle, unchanged code).
**Serving:** Vite preview on `http://127.0.0.1:4344/LocalSight/`, Pages-like history fallback (`PW_PORT=4344`).
**Browser:** Chromium headless (Playwright 1.64.1, `chromium-1248`), 1600×1000, no WebGPU adapter → engine on
WASM, 4 threads once the COOP/COEP service worker isolates the document.
**Clip:** `frontend/public/media/stand12.mp4` (1920×1080, 8.77 s, three workers with visible faces), the
shipped demo clip; camera `stand12` is the default Live camera.
**No application change, no test hook.** One file is added by this task: this report. All scripts, screenshots
and measurements are in `/tmp/qa-privacy/` and are described per check below.

---

## Verdict

**Yes — with the in-browser engine running, this build keeps every frame inside the tab and blurs the
head/face region before the frame is drawn, stored as a snapshot or sent anywhere.** No upload path, no
third-party request, no unblurred processed frame and no face readable by the app's own YuNet model was found
in any checked surface. The rewrite's privacy guard is **fail-closed**: with either ONNX model blocked the
screen shows an opaque error placeholder, and the canvas bitmap is a generated placeholder, not the clip.

One caveat keeps the absolute sentence “no unblurred frame ever reaches the screen” from being literally true:
**when the browser engine is OFF, the raw clip plays by design** (it is the state of a fresh visit on a
browser without WebGPU, and the state after “Oprește motorul în browser”). Fullscreen is only reachable in
that state, and it is labelled. So the honest claim is the conditional one:

> *While the browser engine is on, no unblurred frame reaches the screen or the network. The raw clip is
> visible only when the engine is off, with an on-screen note.*

No privacy regression was found in the paths below; the four critical findings of the pre-rewrite audit
(`docs/qa/privacy-findings.md`) are fixed (fail-open blur, fullscreen with the engine on, the 2.5–3 s raw
window on start, blur limited to YuNet hits).

---

## Summary table

| # | Check | Method | Result | Evidence |
|---|---|---|---|---|
| 1 | No frame upload / no third party | Playwright request log for the whole session (boot → toggle → 8 canvas samples → incident detail), method + resource type + POST body | **PASS** — 20 requests, **all GET**, 18 same-origin + 2 `blob:`; no POST/PUT, no body, no third-party host | `/tmp/qa-privacy/run-a/results.json` (`net`, `bad`, `posts`, `withBody`) |
| 2a | Raw clip hidden from the click | Opacity + `checkVisibility` + pixel means of stage screenshot vs the video frame at the same instant | **PASS** — video opacity `0` at t=0, 250 ms, 1 s and until the first processed frame; stage centre mean **1.7** vs video **160.9** | `run-a/screen-{t0-click,250ms,1000ms}.png`, `run-a/video-*.png` |
| 2b | Opaque placeholder while the first frame loads | DOM: placeholder `absolute inset-0` + `background rgb(0,0,0)`; canvas still 300×150 transparent | **PASS** — first processed frame at **1275 ms** after the click; until then the stage is black with “fluxul brut rămâne ascuns…” | `run-a/results.json` (`screen.t0`, `marks`, `beforeFirstDraw`, `firstDrawMs`) |
| 2c | Fullscreen disabled with the engine on | Button state and title | **PASS** — `disabled=true`, title explains it would show the raw clip | `run-a/results.json` (`screen.fullscreen`) |
| 2d | Engine error / unsupported keeps the raw hidden | Block `**/models/yunet.onnx`, block `**/models/yolo26n.onnx`, delete `Worker`+`OffscreenCanvas`; screenshot + canvas vs video pixel diff | **PASS** — video opacity `0`; canvas hidden (`opacity: 0`); visible stage centre mean **1.5**; canvas bitmap mean **12.5** vs video **157.5** (MAE **145.1**, corr **0.07**) | `/tmp/qa-privacy/run-bcd/*`, `results.json` |
| 3a | Face/head region smoothed in every sampled frame | 8 canvas samples over ~10 s; person boxes read back from the canvas; Laplacian variance of the top-35 % head band (the rectangle `blurHeads` covers) vs the same person's body band | **PASS** — **26/26** measured head bands: **0.00–2.16**; body bands **1292–7345** (≈10³×); YuNet finds **0** faces ≥0.6 in 8/8 canvases | `/tmp/qa-privacy/run-a/blur-proof.json`, `blur-analysis.json` |
| 3b | Blocked models → placeholder, no rate claim | As 2d + text scan for engine fps | **PASS** — canvas is the guard bitmap, not the frame; badge “motor indisponibil · flux brut ascuns”; no engine fps anywhere (only the camera spec “1080p 30FPS” in the HUD) | `run-bcd/blocked*-stage.png`, `results.json` |
| 4 | Incident snapshot: page-owned blob, blurred, 960×540, survives worker termination | Open the engine incident's detail (unmounts Live → terminates the worker); inspect `img`, fetch the blob in-page, decode with `createImageBitmap`, analyse pixels | **PASS** — `blob:http://127.0.0.1:4344/…`, JPEG **83 129 B**, **960×540**, `complete`, download link; worker `terminated=1`; head bands **3.3 / 7.8 / 20.9** vs bodies **1949–3144**; YuNet **0** faces; no `blob:pending` request | `run-a/results.json` (`snapshot`), `run-a/snapshot.jpg` |
| 5 | localStorage: keys, sizes, corrupt values | Enumerate after the flow; type an operator name; then write corrupt values into every known key, reload, open `/bench` | **PASS** — engine flow writes 2 keys (`localsight.liveEngine` 1 B, `localsight.theme` 4 B); operator name 10 B; no binary; corrupt boot renders Live and Bench with **0 page errors**, theme falls back to `dark` | `/tmp/qa-privacy/run-bcd/results.json` (`storage`), `run-storage.mjs` |
| 6 | Service worker caches nothing; touches only navigations + worker scripts | `caches.keys()`; deploy a changed JS chunk in a temp copy and plain-reload; compare response headers per request type | **PASS** — `caches: []`; changed chunk served (sha256 `b3afdd…` → `6f5820…`, marker present); document gets COEP/COOP/CORP, model `fetch` gets **none**, worker script gets COEP | `/tmp/qa-privacy/run-e/results.json`, `run-e2.mjs`, `server-b.mjs` |
| 7 | Blur happens before draw and before `postMessage`; no path posts a raw bitmap | Source reading of `worker.js`, `useEngine.js`, `MediaStage.jsx` | **PASS** — blur at `worker.js:697-700`, boxes after it, snapshot from the blurred canvas `753-761`, `transferToImageBitmap`/`post` only at `763-779`; guard bitmap is the only alternative payload | line map below |

---

## 1. Network

Recorded with `page.on('request')` for the whole session (boot, one service-worker reload, engine start, 8
canvas samples, incident detail). `serviceWorkers: 'allow'`; requests are the ones the page actually makes,
including those proxied by the isolation worker.

| Host | Requests | Types |
|---|---|---|
| `127.0.0.1:4344` (origin) | 18 | document 2 (initial + one isolation reload), script 7, stylesheet 2, image 2 (`logo.svg` once per document), media 2 (`media/stand12.mp4` ×2), fetch 3 (`models/yolo26n.onnx`, `models/yunet.onnx`, `assets/ort-wasm-….wasm`) |
| `blob:` (scheme, no host) | 2 | `image` (the incident snapshot `<img>`) and one `fetch` performed by the audit to read that blob |

- **Methods: GET ×20. POST/PUT/PATCH/DELETE: 0. Requests with a body: 0.**
- No third-party host, no CDN, no font, no analytics, no WebSocket handshake. The old mock fixtures that
  pulled images from Unsplash/Wikimedia are gone (`src/data/media.js` uses local stills).
- The two model files, the clip, the WASM runtime, the worker chunk and the ORT chunk are the expected
  downloads. Nothing is uploaded: the only `fetch` with a request body in the codebase is the real-backend
  client (`src/services/http.js`), and this build uses the mock transport (`src/services/api.js:16`).
- **No `blob:pending` request** at any point; `SafeImage` short-circuits that marker
  (`src/components/common/SafeImage.jsx:12`).

## 2. Screen

Measured on a real click of “Pornește motorul în browser”, not on a preference.

| Moment | Video opacity / visible | Canvas | Stage centre mean (screenshot) | Raw video centre mean |
|---|---|---|---|---|
| Engine off (fresh visit) | `1` / `true` | none | **162.1** (raw clip visible, by design) | 160.9 |
| Click +0 ms | **`0` / `false`** | 300×150, transparent | **1.7** | 160.9 |
| +250 ms | `0` / `false` | 300×150, transparent | **1.7** | 160.5 |
| +1000 ms | `0` / `false` | 300×150, transparent | **1.7** | 159.9 |
| First processed frame +1275 ms | `0` / `false` | **1280×720**, opaque | 158.8 (processed frame) | — |

The opaque placeholder is a separate `absolute inset-0 bg-black` layer between the video and the canvas
(`EngineOverlayBadges.jsx:60`), and the canvas only receives worker bitmaps
(`useEngine.js:135-150`). Two independent layers hide the video from the click, before the first model
frame. Fullscreen is disabled while the engine is on (`CameraToolbar.jsx:141-149`) and `LiveView` also drops
out of that mode if the preference flips while it is open (`LiveView.jsx:117-120`).

Edge case: with `Worker`/`OffscreenCanvas` missing the page shows the unsupported message and the black
placeholder (stage centre mean **1.5**), the canvas stays 300×150 and hidden. With a model blocked the same
holds (stage centre mean **1.5**).

## 3. Blur on the processed frame

The measurement is made on the pixels the engine itself produced, not on a re-rendered frame:

- person boxes are read back from the yellow annotation the worker drew (label band + stroke), so the head
  band is aligned with the frame that was blurred;
- `head` = top 35 % of the person box, the exact rectangle `blurHeads` covers (`src/engine/blur.js:16-30`);
- `body` = 45–85 % of the same box — same frame, same person, never blurred;
- annotation strokes (yellow/cyan) are masked out and dilated, so the number is about the blur, not about the
  drawn boxes;
- metric: variance of the 4-neighbour Laplacian on the 8-bit grey crop.

| Sample | Person boxes measured | Head Laplacian variance | Body Laplacian variance | Raw-video head variance (YOLO boxes, matched frame) |
|---|---|---|---|---|
| 0 | 4 | 0.00, 1.83, 1.77, 1.83 | 5037, 2019, 5201, 765 | 540, 2524, 2847, 2655 |
| 1 | 3 | 0.00, 1.89, 1.95 | 7345, 1819, 3392 | 1735, 2445, 3934 |
| 2 | 3 | 0.46, 1.86, 1.96 | 5604, 2086, 4246 | 1995, 3753, 2314 |
| 3 | 4 (3 measurable) | 0.14, 2.16, 1.81 | 5135, 1542, 4181 | 2051, 3308, 2387 |
| 4 | 2 | 0.00, 1.81 | 4954, 2635 | 3050, 1632, 2743, 3476 |
| 5 | 4 | 0.00, 1.78, 1.80, 1.98 | 6546, 4682, 3075, 2413 | 1088, 2746, 2783, 2723 |
| 6 | 4 | 0.00, 2.14, 1.84, 1.64 | 5557, 2352, 3645, 1293 | 647, 2052, 2912, 2291 |
| 7 | 3 | 0.50, 1.85, 1.72 | 4868, 2037, 4580 | 2119, 2657, 2278 |

- **26 head bands, all 0.00–2.16; the same persons' body bands 1292–7345.** Blur is present in every sampled
  frame, not just where YuNet fired: samples 1, 2, 3 and 7 have **zero** YuNet faces on the matched raw frame
  and still have every head band flat, because the head band comes from the person box (`worker.js:467-480`).
- YuNet (the app's own graph, threshold 0.6) finds **1–2 faces at 0.606–0.855 on 4 of the 8 matched raw
  frames**, and **0 faces on all 8 processed canvases** and on the snapshot. The blur is strong enough that
  the detector that drives it no longer sees a face.
- Visible surface: with the clip paused on a processed frame, the canvas element screenshot and the canvas
  buffer agree in the unobstructed area (MAE 1.63, correlation 0.996); head bands on the screenshot measured
  **0.00 / 2.08 / 2.66** vs body **2125–4808**. (A fourth person clipped by the bottom edge sits under the
  HUD footer and is not measurable.)
- Blocked models: canvas bitmap mean **12.5** (dark placeholder with text), raw clip mean **157.5**,
  **MAE 145.1**, correlation **0.073** → the canvas is not the raw frame. The view additionally hides the
  canvas entirely (`opacity: 0`) and shows an opaque error placeholder.
- No engine rate is claimed while broken: the badge reads “motor indisponibil · flux brut ascuns”, the card
  shows the error status and no fps chip; the only “FPS” string in the page is the camera spec
  “1080p 30FPS”.

## 4. Incident snapshot

The engine produced a real incident (`local` badge, `RESTRICTED_ZONE`, footprint “5/5 cadre”).

| Property | Measured |
|---|---|
| `snapshot_url` | `blob:http://127.0.0.1:4344/7be85d8b-…` — created **by the page** from the worker's `Blob` (`useEngine.js:175-180`); the worker never creates the object URL |
| Format / size | `image/jpeg`, **83 129 B** |
| Dimensions | **960×540** (long side 960, `worker.js:37`) |
| Detail view | `img.complete = true`, `naturalWidth/Height = 960/540`, download link present |
| Worker at open time | `workers: 1`, `terminated: 1`, Live canvas gone — the snapshot **survives worker termination** |
| `blob:pending` | no request, no placeholder text; caption “Momentul incidentului • fețe blurate în browser” |
| Blur | head bands **3.3 / 7.8 / 20.9** vs bodies **1949–3144**; YuNet **0** faces ≥0.6 |
| Source | captured from `frameCanvas` **after** the blur and the annotations (`worker.js:753-761`), never from the incoming bitmap |

## 5. localStorage

| Key | Bytes | Written when | Content |
|---|---|---|---|
| `localsight.theme` | 4 | first paint | `dark` |
| `localsight.liveEngine` | 1 | engine toggle | `1` |
| `localsight.operator` | 10 | operator types a name | `I. Popescu` |

Known keys that this flow did not produce: `localsight.bench` (provider, size, fps/p50/p95, frame count,
user agent, `hardwareConcurrency` — `BenchView.jsx:10,53-64`; not executed here) and
`localsight.sidebarCollapsed` (`Sidebar.jsx:21`). No key held binary data or an image-like string
(`data:image`, `base64`, PNG/JPEG magic): **false** for all values.

Corrupt-value test: `liveEngine=yes`, `theme=__nope__`, `bench={"runs": [ not json`,
`sidebarCollapsed=maybe`, `operator` = 10 000 chars, `coi.reload=1`, plus a 3 000-char legacy
`safesight.operator`. After a reload the header and Live render, `/bench` renders, **0 page errors**, the
invalid theme falls back to `dark`, and the long name is displayed truncated to 80 characters while the
stored value is left alone. Nothing leaked and nothing crashed.

## 6. Service worker

- The worker is registered by `main.jsx:13-40`; it reloads the tab **once** on the first visit (guarded by
  `sessionStorage['localsight.coi.reload']`). The network log shows exactly the expected second document load.
- **Caches nothing.** `await caches.keys()` → `[]`. The fetch handler has no Cache API at all
  (`public/coi-serviceworker.js:60-75`); every request is `fetch(request)` against the network.
- **Changed-asset test** (temp copy of `dist` on port 4345, Pages-like server without COOP/COEP, `no-store`):
  load → SW installs and isolates → append a marker to `assets/index-*.js` → plain `page.reload()`.
  The page then fetches the chunk with the marker: length 407 504 → 407 540, sha256
  `b3afdd86…` → `6f582030…`. A caching worker would have served the old bytes.
- **Only same-origin navigations and worker scripts are touched** (`coi-serviceworker.js:62-74`), verified by
  response headers: documents `COEP: require-corp`, `COOP: same-origin`, `CORP: same-origin`; the main JS
  chunk `null`; `models/yunet.onnx` and `models/yolo26n.onnx` (fetch) `null`; the engine worker script
  `COEP: require-corp`, `CORP: same-origin`.

## 7. Blur → draw → `postMessage` (source map)

`frontend/src/engine/worker.js`, `handleFrame`:

1. `606-610` — if a model failed, **nothing from the camera is read**; post the guard placeholder.
2. `615-616` — the raw frame is copied into the worker-private `frameCanvas` (never leaves the worker).
3. `657-661` — if detection failed, blank the frame and post the guard placeholder.
4. `674-690` — PPE colour is read from the raw pixels **inside the worker**; only counts leave.
5. **`697-700`** — `blurFaces` + `blurHeads` run **before** `drawBoxes`; the boxes are drawn on top of the
   blur, never the other way round.
6. `707-711` — if the blur pass throws, blank the frame and post the guard placeholder.
7. `730-745` — the pipeline sees boxes/numbers only, `snapshotUrl` is the `blob:pending` marker.
8. `753-761` — the snapshot is taken **from `frameCanvas` after the blur**, then downscaled to 960 px.
9. **`763-779`** — the only normal-path `transferToImageBitmap` + `post` happens here, after the blur; the
   bitmap transferred is `frameCanvas`.
10. `311-337` — `guardBitmap` draws only on `guardCanvas`, a canvas that **never receives a source frame**;
    `349-365` posts it with `fps: 0`.

`frontend/src/engine/useEngine.js`:

- `135-150` — the main thread paints the canvas **only** from `message.bitmap`; a missing bitmap leaves the
  previous processed frame, never video.
- `175-180` — the page creates the `blob:` URL from the worker's `Blob`; only the string enters the store.
- `265-272` — raw frames travel main thread → worker (`postMessage` inside the tab, not network); the worker
  returns processed frames only.

`MediaStage.jsx:78-81` hides the video from the click; `EngineOverlayBadges.jsx:60-84` is the opaque
placeholder plus the worker canvas (hidden when `error`/`unsupported`); `liveMedia.js:281-296` is the badge
copy that never claims a rate while broken.

---

## Findings

| Severity | Finding | Status |
|---|---|---|
| — | No leak found: no upload, no third-party request, no unblurred processed frame, no fail-open blur, no blob URL created by the worker, no cache in the SW. | **None** |
| INFO | The raw clip is visible whenever the browser engine is off (fresh visit without a WebGPU adapter, or after stopping it); fullscreen is only reachable in that state. By design and labelled in the UI, but it makes the absolute sentence “no unblurred frame ever reaches the screen” false. | Documented limitation; wording recommendation below |
| INFO | `elementFromPoint` at the stage centre returns the `opacity: 0` video, because the placeholder and the canvas are `pointer-events-none`. It has no visual effect today, but any future click handler placed on the video would receive clicks over the processed frame. | Note for future work |

**Wording recommendation:** keep “the frames never leave the tab” unconditionally, and scope the blur claim:
“with the in-browser engine on, faces are blurred before drawing; the raw feed is only shown when the engine
is off.” The README already describes the engine as opt-in, so this is a copy fix, not a code fix.

## What I could not verify

- **WebGPU.** Headless Chromium has no adapter; everything above is the WASM path (4 threads,
  `crossOriginIsolated = true`, 4.5–5.9 fps, first frame 1.28 s). The worker and `blurFaces` are the same on
  WebGPU, but the timing — and therefore the warm-up window — was not measured.
- **A physical camera.** The `getUserMedia` path (webcam camera in Live, `/lab`) was not exercised; only the
  clip path. The screen boundary is the same `<video>`/canvas pair, but this is an inference.
- **Per-frame coverage.** 8 canvas samples at ~1.2 s intervals plus the snapshot; not all ~30 processed
  frames, and not other clips or fast motion. A frame that slipped between samples would not have been seen.
- **Firefox/Safari** and their `OffscreenCanvas`/`requestVideoFrameCallback` behaviour.
- **The real-backend build** (`VITE_USE_MOCK` unset): the zone reference-frame `POST` (`backendApi.js:63-67`)
  was not executed. In the mock build the same call is a local no-op (`mockApi.js:57-63`).
- **GitHub Pages itself** (compression, cached HTML, headers); the local preview approximates static Pages
  serving, and the temp-copy test used a custom no-header server.

## Commands

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
VITE_BASE=/LocalSight/ npx vite preview --host 127.0.0.1 --port 4344 --strictPort
# Playwright sessions: /tmp/qa-privacy/run-a.mjs, run-bcd.mjs, run-e.mjs, run-e2.mjs, run-f.mjs, run-g.mjs
# Image/ONNX analysis: /tmp/qa-privacy/analyze.py, analyze2.py, surface.py (onnxruntime CPU, app's own graphs)
```

Raw evidence lives in `/tmp/qa-privacy/run-a` (network JSON, stage/video screenshots, 8 canvas PNGs,
snapshot JPEG, `blur-proof.json`), `/tmp/qa-privacy/run-bcd` (blocked/unsupported/storage),
`/tmp/qa-privacy/run-e` (service worker), `/tmp/qa-privacy/run-f` and `/tmp/qa-privacy/run-g` (visible
surface).
