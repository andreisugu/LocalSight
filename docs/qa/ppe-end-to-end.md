# NO_PPE end to end: a vest-free person in a `PPE_REQUIRED` zone

**Role:** proof of the last unproven link in the vest work — does `no_vest` actually raise
`NO_PPE` in the browser engine, in the Live list and in `/incidents`?
**Date:** 2 November 2026
**Branch:** `prep/ppe-proof` (worktree `LocalSight-prep/ppe-proof`)
**Build:** `cd frontend && VITE_USE_MOCK=true VITE_BASE=/LocalSight/ VITE_MEDIA_VIDEO=/LocalSight/media/ppe-proof.mp4 npm run build`
**Serving:** local static server on `127.0.0.1:4783` under `/LocalSight/` (no-cache, SPA
fallback). The harness, clips, traces and screenshots live in `/tmp/opencode/ppe-proof/`
and are **not** committed.
**Browser:** Playwright 1.64.1, Chromium 1248 headless, no WebGPU adapter → the engine runs
on WASM single-thread at 1.5–2.2 fps, like the static Pages build.
**Changed in the repo:** only this file. No application code, engine, mock data or zone
fixture was edited; the test zone and the frame/event capture were injected from Playwright
(a `Worker` wrapper in `addInitScript`), not from source.

## Verdict

1. **The chain works.** On a clip where the person clears the size gate, the engine emitted
   `NO_PPE` (`evt_stand12_1793631999204_1`, CRITICAL, `duration_s` 2.635) and the incident
   appeared in `engine.events`, in the Live incident list and in `/incidents`, with a detail
   page and timeline. No fake event, no mock insertion: it came out of `pipeline.js`.
2. **On the clip the task names (1280×720 marshaller) it cannot fire.** The single blocking
   gate is `MIN_PERSON_PX_NO_VEST = 150`: the marshaller is **116.5 px** tall at the median
   (111.7–124.3 px over the clip). Every other `no_vest` condition passes with margin.
3. **The control proves the doctor is what changed the state.** On the unmodified clip the
   same zone and engine say `vest` on 12 processed frames; on the doctored clip, never.
4. **Person detection is intact.** Same single person, same box: median height 119.4 px on
   both clips, median detector confidence 0.68 vs 0.67.

The doctored clips are **synthetic controls, not product assets**: no shipped footage shows
a worker without a hi-vis vest, so the vest pixels were repainted grey. They must never be
used as demo media or as evidence about real footage.

## 1. The synthetic control clip

Built from `data/videos/2026-10-30_broll_cam01_marshaller-conuri-apron.mp4`
(1280×720, 29.97 fps, 366 frames, 12.21 s) with `doctor.py`:

- per frame, `cv2.cvtColor(frame, COLOR_BGR2HSV)` — the same 8-bit quantisation
  `frontend/src/engine/vest.js` reproduces — and the three exact ranges:
  H 3–22 / S≥140 / V≥140, H 23–65 / S≥100 / V≥120, H 23–65 / S≥45 / V≥170;
- every masked pixel is repainted neutral grey, RGB 105–115 (a fixed 7/13 dither, no
  colour left for the gate to match);
- re-encoded H.264 / yuv420p, 1280×720, 29.97 fps, 366 frames, no audio, `+faststart`.

Masking volume: 2,285,928 px over 366 frames (≈0.7 % of the frame, i.e. the vest and a few
bright-yellow objects). Side effect: the green Flair tail fin also falls in the yellow-green
range, so it turns grey too; it is background, not a person. After H.264, the decoded clip
still contains 43,543 hi-vis px in total (max 251 px in one frame, 0.027 % of the frame),
all chroma ringing outside the torso bands — visible in the ratio numbers below (max 0.0145,
below `NO_VEST_MAX = 0.03`).

`clip/marshaller_no_hivis_1080p.mp4` is the same doctored clip upscaled 1.5× to 1920×1080
(lanczos). It adds **no detail**; it exists only to move the person's box over the 150 px
gate so the rest of the chain can be observed. It is labelled a positive control everywhere.

## 2. Harness

- Mock build, camera `stand12` (CAM-01), clip forced with `VITE_MEDIA_VIDEO`; the doctored
  file was swapped in and out at `dist/media/ppe-proof.mp4` per run and deleted afterwards
  (it was never committed; `git status` is clean apart from this file).
- The zone was injected into the engine messages from the page, with the fields the task
  asks for: `rule_type: 'PPE_REQUIRED'`, `required_ppe: ['hi_vis_vest']`,
  `severity: 'CRITICAL'`, `debounce_s: 1.0`, `active_when: 'always'`,
  `escalate_after_s: null`, full-frame polygon (0.02 inset), `camera_id: 'stand12'`.
  The worker received it in both `init` and `config`.
- The `Worker` wrapper recorded every result message (`persons`, `faces`, `vest`, `events`)
  and every event object. Engine on for 30 s per run; the clip loops (~2.4 passes).
- The zone was injected rather than drawn: `/zones` can edit the store's zones, but a
  headless polygon draw adds no coverage of the engine, and `mockData.js` was out of scope.
  The injected object is shape-identical to what LiveView derives for the worker
  (`id`, `camera_id`, `rule_type`, `active_when`, `required_ppe`, `severity`, `debounce_s`,
  `escalate_after_s`, `polygon`), and the page captured the two messages it travelled in
  (`init`, `config`). Everything downstream of the message — tracker, membership, rule
  engine, cooldown, store — is the shipping code path.

## 3. Results

Three runs, 30 s of engine time each, same zone:

| Run | Clip | Processed frames | Processed span | fps |
|---|---|---|---|---|
| A | doctored 720p | 56 | 32.2 s | 1.7 |
| B | unmodified 720p (control) | 54 | 32.3 s | 1.7 |
| C | doctored 720p → 1080p (positive control) | 50 | 32.6 s | 1.5 |

### 3.1 Per-state frame counts from the worker's `vest` summary

`vest` is the count of tracks the `VestTracker` called `vest`, `noVest` the count called
`no_vest`, `unknown` the rest; frames with no detection report 0/0/0.

| Run | `vest` | `no_vest` | `unknown` | frames with 0 persons |
|---|---|---|---|---|
| A — doctored 720p | **0** | **0** | **50** | 6 |
| B — unmodified 720p | **12** | **0** | **33** | 9 |
| C — doctored 1080p (positive control) | 0 | **37** | 9 | 4 |

A second, independent run of A (71 frames, 32.3 s) gave 0 `vest` / 0 `no_vest` / 62
`unknown`, 9 empty frames — same result.

Reading: the mask moved every judged frame from `vest` (run B) to `unknown` (run A), so the
colour gate did its job; `no_vest` still needed something run C has and A does not.

### 3.2 The incident — positive control (run C)

Exactly one event, from the pipeline, at t≈2.6 s of processed media time:

```json
{ "event_id": "evt_stand12_1793631999204_1", "type": "NO_PPE", "severity": "CRITICAL",
  "status": "open", "camera_id": "stand12", "zone_id": "ppe-proof-full-frame",
  "track_id": 1, "confidence": { "detector": 0.599, "temporal": { "seen": 5, "window": 5 } },
  "duration_s": 2.635, "context": { "engine_on": true }, "snapshot_url": "blob:pending",
  "model": "yolo26n", "detected_at": "2026-11-02T15:06:39.204Z",
  "notified_at": null, "escalated_at": null, "acked_at": null, "acked_by": null,
  "report": null }
```

| Place | Result |
|---|---|
| `engine.events` (worker result messages) | 1 × `NO_PPE` — the object above |
| Live incident list | present as the first card: `Echipament lipsă · CRITICAL · Deschis · CAM-01 • stand12 · zona ppe-proof-full-frame`; the engine panel prints `fără PPE critic track 1 2.63 s`, `INCIDENTE 1`; open-incident KPI 4 → 5 |
| `/incidents` | present, list count 8 → 9, same row; detail page opens `EVT_STAND12_1793631999204_1`, `Durata: 2.635s`, `Model detecție: yolo26n`, `Track ID: #1`, timeline 1 Detecție / 2 Print / 3 Notificat / 4 Escaladat / 5 Confirmat |

Screenshots (in `/tmp/opencode/ppe-proof/runs/`, not committed):
`upscale1080-live.png`, `upscale1080-incidents.png`, `upscale1080-detail.png`.

Gaps visible in that detail page are the known static-build deviations, not this test:
`snapshot_url` is the placeholder `blob:pending` (the engine has no renderer-produced
snapshot), `report` is `null` (no LLM in the browser), and the row's "Deschis" badge is the
local store default.

### 3.3 Control on the unmodified clip (run B)

- `NO_PPE` count: **0** (`engine.events` empty, no row added to Live or `/incidents`).
- `vest` state on 12 frames, `no_vest` on 0: the tracker sees the real vest.
- Torso-band hi-vis ratio: median **0.084**, max **0.171** (doctored: 0.0015 / 0.0145).
  Against `HIVIS_MIN = 0.1`, the vest is correctly recognised; against `NO_VEST_MAX = 0.03`
  the doctored clip is below by ~2×.

So the test is not vacuous: the same engine, zone, clip and cadence produce `vest` on the
original and `unknown` on the doctored file.

### 3.4 The blocking gate on the 720p clip (run A)

The trace re-built the worker's per-frame inputs with the same ONNX model and the same maths,
then fed them through the **real** `tracker.js` + `vest.js` in Node (`replay.mjs`). Validation:
Python's hi-vis ratio and `vest.js`'s `hivisRatio` agree to ≤2e-6 on three dumped frames.
Everything is one stable track (id 1), so the sample count is not fragmented.

One-line cause: **`MIN_PERSON_PX_NO_VEST = 150` — the marshaller is 111.7–124.3 px tall
(median 116.5 px, 16 % of the 720p frame), so `median(recentPx) >= 150` is false on every
frame and the track can never leave `unknown`.**

Gate-by-gate at the first frame with `MIN_SAMPLES_NO_VEST` samples (t = 1.80 s, 10 samples):

| Condition in `VestTracker.state()` | Constant | Value | Passes? |
|---|---|---|---|
| `samples >= MIN_SAMPLES` | 5 | 10 (reaches 53 by the end) | yes |
| `score < HIVIS_MIN` (not a vest) | 0.1 | 0.0038 | yes |
| `samples >= MIN_SAMPLES_NO_VEST` | **10** (not 5 — see §5) | 10 | yes |
| `percentile(recent, 90) < NO_VEST_MAX` | 0.03 | 0.0063 (max over run 0.0113) | yes |
| `median(recentPx) >= MIN_PERSON_PX_NO_VEST` | **150 px** | **121.0 px** (run median 116.5) | **NO** |
| `confidence >= MIN_CONFIDENCE_NO_VEST` | 0.5 | 0.627 (dips to 0.489 at t≈4.3 s, recovers to 0.651) | yes, marginal |

`frameCountsForVest` also gates the sample: height ≥ `MIN_PERSON_PX = 80` (120 px → yes) and
no edge contact (`x1 0.760, y1 0.385, x2 0.799, y2 0.553` → yes), so samples accumulate
instead of being nulled.

Per-frame trace (every 6th processed frame; full run in `runs/replay_doc.txt`):

| t (s) | person px | hivis ratio | p90 | EMA conf | samples | state | failing condition |
|---|---|---|---|---|---|---|---|
| 0.00 | 120.8 | 0.0035 | 0.0035 | 0.690 | 1 | unknown | samples < 5 |
| 1.20 | 122.5 | 0.0028 | 0.0054 | 0.655 | 7 | unknown | px 121.2 < 150 |
| 1.80 | 119.3 | 0.0062 | 0.0063 | 0.627 | 10 | unknown | px 121.0 < 150 |
| 3.00 | 124.0 | 0.0027 | 0.0062 | 0.575 | 13 | unknown | px 121.9 < 150 |
| 4.40 | 120.6 | 0.0039 | 0.0062 | 0.495 | 19 | unknown | px 121.5 < 150; conf 0.495 < 0.5 |
| 6.41 | 121.7 | 0.0000 | 0.0063 | 0.588 | 25 | unknown | px 121.5 < 150 |
| 8.81 | 115.4 | 0.0018 | 0.0062 | 0.734 | 37 | unknown | px 121.4 < 150 |
| 10.01 | 118.3 | 0.0053 | 0.0054 | 0.637 | 43 | unknown | px 120.3 < 150 |
| 11.21 | 113.9 | 0.0143 | 0.0095 | 0.704 | 49 | unknown | px 118.4 < 150 |
| 12.01 | 111.7 | 0.0061 | 0.0113 | 0.651 | 53 | unknown | px 116.5 < 150 |

Zone membership and debounce were never the problem: the full-frame polygon contains the
person from the first frame (feet at y = 0.553, signed distance **+0.357 person-heights**,
entry band only 0.017; `y2 = 0.553 < TRUNCATED_BOTTOM 0.985`), and the `RuleEngine` needs
5 frames / 1.0 s. It simply never accumulates, because `triggersEvent(zone, 'unknown')` is
`false` — `pipeline.js` feeds `inZone && triggersEvent(...)` into `observe()`. Feeding the
same boxes with `no_vest` gives a decision at 5/5 frames, 1.8 s, which is what run C
produced (2.635 s with the missed frames).

**Smallest honest fix (not applied):** use footage where the person is at least 150 px tall
in the processed frame — a closer/longer shot or a 1080p source; run C is the proof that
this alone flips the incident. A 720p-wide camera that wants this rule needs the gate to be
resolved differently (e.g. relative to frame height) — that is a separate, reviewed change,
because the constant exists precisely to keep small boxes from being called `no_vest`.
Lowering `MIN_PERSON_PX_NO_VEST` to ~110 for the demo would make this clip fire but re-opens
the false positives the 150 px floor was added for; that is why it is not the fix here.

### 3.5 Person detection after masking

| | doctored 720p (A) | unmodified 720p (B) |
|---|---|---|
| frames with 1 person | 50/56 (89 %) | 45/54 (83 %) |
| frames with 0 persons | 6 (person turns/miss) | 9 (same moments) |
| person box height, median | 119.4 px | 119.4 px |
| person box height, range | 111.7–124.3 px | 111.8–123.9 px |
| detector confidence, median | 0.683 | 0.671 |
| frames with a face | 43/56 | 41/54 |

The body is intact: the box is the same size to ±0.5 px and detection confidence does not
drop. Masking the vest does not hide the person.

## 4. What this proves, and what it does not

- **Proves** the browser chain `person track → vest colour → triggersEvent → membership →
  rule window → cooldown → event → Live store → /incidents → detail` works for `NO_PPE`,
  without touching the source, and names the exact number that stops the specified clip.
- **Does not prove** anything about real vest-free footage: both clips are synthetic. A real
  worker without a vest is still unobserved, and the colour heuristic is not a classifier.
- The positive control is an **upscale** of the same doctored frames, not a real 1080p
  capture. It adds no image detail; it only moves the box over the pixel gate. A genuine
  1080p vest-free clip would be better evidence for the fix.
- A second attempt with `2026-10-30_restricted-zone_cam01_persoana-langa-motor.mp4`
  (1920×1080, people 200–260 px tall) was **not** used as evidence: that clip has a strong
  orange cast, the hi-vis mask repaints most of the frame, and the torso band still measures
  2.6–3.7 % hi-vis after doctoring, so it fails `NO_VEST_MAX` instead. The doctor is only
  clean on colour-neutral footage.
- The static build cannot show a real snapshot (`blob:pending`) or an AI report (`report:
  null`); both are known and documented deviations, reproducible in run C's detail page.

## 5. Notes for the next reader

- `MIN_SAMPLES_NO_VEST` in `frontend/src/engine/vest.js` is **10**, not the 5 stated in the
  task. `MIN_SAMPLES` (5) is the separate warm-up gate. The trace uses the code's 10; it was
  reached at t = 1.80 s.
- The `vest` summary counts states per track per frame, so it is not a count of incidents.
- Run files: `runs/*.json` (per-frame worker messages and events), `runs/replay_*.txt`
  (gate traces), `runs/*.png` (screenshots), `doctor.py`, `trace.py`, `replay.mjs`,
  `run.mjs`, `serve.py`, all under `/tmp/opencode/ppe-proof/`.
