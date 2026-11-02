# LocalSight — innovation engine

**What the browser engine could do next, without a backend.**

2 November 2026 · branch `prep/innovation-engine` · read-only proposal: this document is the only
change. No application code, tests, dependencies or other worktrees were modified.

This is the sequel to [`feature-gaps.md`](feature-gaps.md). That document asks *what is missing
between the demo and a pilot*; this one asks *what the engine could do that it cannot do today,
that an apron team would actually use, and that still runs in one tab on a laptop*. The two
constraints are non-negotiable: **no backend** and **nothing leaves the tab**. Anything that
needs a server, a secret, a 300 MB download or a new event type is either out or explicitly
deferred.

---

## 0. Verdict

The engine is already good at the hard part: person detection, tracking, zone rules, PPE colour,
fail-closed blur, contract-shaped events, at **3.7–5.6 fps** on four WASM threads at 1280 px
(measured, `feature-gaps.md` §2.1). The next gains are not "a bigger model". They are **more
meaning per detection** and **claims that can be checked**.

**Signature capability:** a **metric ground plane** — four clicked ground points turn the
existing tracker's foot points into metres, so the engine reports speed, distance and
time-to-zone instead of only "inside/outside". It needs **no new model, no new dependency and no
contract change**, and it is measurable in two days (§4.1).

**Top three by value per day:**

1. **Metric ground plane** (signature) — speed, distance, ETA; makes every later number physical.
2. **Unattended / stationary object** — the existing YOLO already sees bags and vehicles; decode
   the classes it is throwing away, add a stationarity + owner-proximity rule.
3. **Second opinion on event frames** — an independent Apache-2.0 detector confirms or disputes
   an incident, at almost zero fps cost because it only runs on event frames.

**The spectacle alternative**, if the next milestone is a stage demo rather than a pilot: **batch
replay of a recorded clip** (§2.5) and **zone-intrusion prediction** (§2.2). Both are honest and
visible; replay is the one that makes the engine useful without a live camera.

Every demo moment below is a proposal, not a measurement. Where an action is staged — a bag left
on the apron, a fall, a speed run — the screen must say so, in the same spirit as the `demo` chip
and the `șablon` label. A staged clip presented as a real detection is the one failure that costs
more than a missed feature.

**What would be fake and is not proposed:** FOD detection, smoke/fire detection, face
recognition, person re-identification across cameras, tracking across clips without appearance,
"climbing a fence" action recognition, LLM-written reports, and a shipping WebNN backend. Reasons
in §5, with the condition that would make each real.

---

## 1. Where the engine is today

### 1.1 Measured baseline

| What | Value | Where it comes from |
|---|---|---|
| End-to-end, WASM 4 threads, 1280 px | **3.7–5.6 fps** | `feature-gaps.md` §2.1, probe on the Pages build |
| End-to-end, 1280 px, Chromium / Firefox | **5.2–6.0 / 5.2 fps** | `docs/browser-engine.md` §5 (four-thread path) |
| End-to-end, single thread, 1080p | **1.5–1.8 fps**; 1.52 fps over 13 min headless | `browser-engine.md` §5; `docs/qa/perf-findings.md` |
| Person recall vs Ultralytics / ncnn | **98.06% / 100%**; IoU mean 0.9938 / 0.9998 | `docs/qa/engine-parity.md` |
| Face recall (27 faces) | **100%**, precision 100% | `docs/qa/engine-parity.md` |
| YOLO26n ONNX | **9,930,308 B** (9.9 MB), fp32, 640×640, 80 COCO classes | `frontend/public/models/` |
| YuNet ONNX | **232,598 B** (232 KB), dynamic H×W | `frontend/public/models/` |
| ORT Web WASM binary | **28.7 MB** asyncify / 29.5 MB jsep (npm 1.31.1) | `docs/ort-web-notes.md` §5 |
| YOLO int8 (QDQ) native | **62.9 ms vs 26.7 ms** fp32 — 2.4× slower | `docs/performance.md` |
| 720p downscale | face recall **62 → 8** | `docs/performance.md` |
| `imgsz` 512 / 448 | person recall **94% / 97%** on one clip, **15% / 0%** on another | `docs/performance.md` |

These are one laptop, one or two clips, no WebGPU, and they are enough to size ideas — not to
promise numbers. A tablet will be slower; a WebGPU laptop may be faster; a venue network can make
the cold start worse.

### 1.2 Numbers discipline

Every performance or accuracy number in this document is one of three things, and is labelled:

- **measured in this repo** — cited to a file and a section;
- **quoted from a source** — cited to a URL (model sizes, browser versions, throughput from
  published benchmarks);
- **hypothesis** — a budget to measure, written as "≈" or "target", never as a result.

No benchmark was run for this report. No fps, recall or latency below is presented as new
measurement. If an idea needs a number to be believed, the success criterion says how to measure
it before it ships.

### 1.3 Constraints that decide the design

| Constraint | Consequence |
|---|---|
| Static GitHub Pages, no custom headers | COOP/COEP only through the cache-less service worker; WASM falls back to one thread; no server endpoints |
| No backend, no upload | No cloud inference, no push, no Slack, no server-side re-ID, no LLM API |
| Models same-origin, no runtime download from third parties | A new model is a build artefact with a licence and a size, not a URL |
| One engine worker, one source at a time | No worker pool as a free win; multi-camera means sampling, not parallelism |
| Fail-closed blur | A frame that cannot be blurred never leaves the worker; an evaluation or replay path must blur too |
| Contract is closed | Event types are `RESTRICTED_ZONE`, `NO_PPE`, `SMOKING`, `CAMERA_OFFLINE`; new types and new `context` fields need a separate PR |

### 1.4 How this was assessed

Read: `docs/browser-engine.md`, `docs/qa/engine-parity.md`, `docs/qa/perf-findings.md`,
`docs/architecture/review.md`, `docs/product/feature-gaps.md`, `docs/contract.md`,
`docs/performance.md`, `docs/ort-web-notes.md`, and the engine modules
`frontend/src/engine/{worker,useEngine,detectors,decode,tracker,zones,pipeline,blur,vest}.js`.
Checked browser support against caniuse, MDN, the W3C specs, Chrome/Firefox/Safari release notes
and vendor docs (November 2026). The URLs are in Appendix A.

---

## 2. Twelve capabilities

Each idea has the same shape: capability, user value, demo moment, technical sketch, effort,
dependency/licence, risk, fallback. Effort is for one developer who knows this codebase:
**S** ≤ 3 days, **M** ≈ 1–2 weeks, **L** > 2 weeks — except where a scoped prototype is explicitly
smaller.

### 2.1 Metric ground plane: pixels → metres (signature)

**Capability.** A per-camera calibration of four ground points defines a homography from image
coordinates to apron coordinates in metres. Every track's foot point is mapped to the ground,
so the engine can report speed (m/s), distance to a zone or line (m), and time-to-zone (s),
not just "inside/outside".

**User value.** Apron safety is full of physical questions that a pixel box cannot answer:
how fast is that tug, is that worker running, how far is that person from the engine intake, how
long until they cross the line. It also makes incident reports quantitative: "entered at
3.2 m/s", not "entered the zone". And it is the foundation for speed limits, approach distance
and TTI.

**Demo moment.** A worker jogs toward the engine zone. The overlay reads **"3.4 m/s · 8.2 m to
zone · ETA 2.4 s"**. A second person walks at **1.3 m/s** and is labelled as walking. The incident
detail repeats the approach speed. The numbers are computed in the tab; nothing is uploaded.

**Technical sketch.** New pure module `engine/ground.js`:

- direct linear transform (DLT) from four image points to four ground points in metres; normalize
  coordinates before the 8×8 solve for conditioning; return a 3×3 homography. Four points fit
  exactly, so the useful error signal is a **fifth check point**: report its reprojection error,
  or a conditioning score when no check point is given;
- `toGround([x, y])`, `distanceM(a, b)`, `distanceToPolygonM(point, polygon)`,
  `speedFromSamples(samples, windowS)`;
- foot point = bottom-centre, exactly the `[(x1 + x2) / 2, y2]` that `ZoneMembership.update`
  already uses; **reject** a track whose bottom is truncated (`y2 ≥ 0.985`, the existing
  `TRUNCATED_BOTTOM`) or whose box is shorter than ~50 px; require at least 5 samples; smooth
  with a median over 1.5–2 s (at 5 fps, 7–10 samples);
- calibration stored per camera next to the zones: four normalized image points, four ground
  points in metres, an optional fifth check point, a label and the check-point error. A four-click
  UI in `/lab` first; Live later.

No model, no runtime, **0 new model/runtime bytes**, pure JavaScript. The hypothesis is
**< 0.2 ms per processed frame** for the homography plus smoothing, which is noise next to a
180–270 ms frame.

**Effort.** **S/M** — 1–2 days for `ground.js`, tests, a fixed calibration for the demo clip,
speed overlay and A/B timing; +1 day for the Live picker and persistence.

**Dependency / licence.** None. Uses the existing tracker, `zones.js` geometry and the worker
message protocol.

**Risk.** The foot point is the dominant error: feet are occluded, boxes are truncated at the
frame edge, and perspective error grows with distance. A bad calibration is worse than none. The
UI must show a confidence band and a check-point error (four points fit exactly, so a fifth point
is the only honest residual), and must never print a speed for a track that fails the gates.
Camera shake and a moved camera invalidate the calibration; store a hash of the calibration and
re-check it.

**Fallback.** Relative speed in **body-heights per second**, normalized by box height, with no
calibration. It cannot give metres, but it separates walking from running and still drives the
"running" badge. Label it as relative.

---

### 2.2 Zone-intrusion prediction (TTI)

**Capability.** Fit a constant-velocity model over the last 5–8 track positions, intersect the
trajectory with the zone polygon, and compute **time to intrusion**. Show it as an advisory
pre-alert before the real incident.

**User value.** A 1–3 s warning gives the operator a chance to call or wave; it also separates
"grazing the edge" from "walking straight in", which is the difference between a nuisance and a
real approach. It is the natural consumer of the metric plane.

**Demo moment.** An amber line appears before the red card: **"Approach: engine-left in 1.8 s"**.
Then the incident fires exactly when predicted. The audience sees the system think ahead without
pretending to be certain.

**Technical sketch.** No model. Reuse `pointInPolygon` and `signedDistance` from `zones.js`; add a
ray–polygon intersection in normalized space. A **line** is a segment rather than a polygon: the
sign of the signed distance gives which side a track is on, and a sign change between frames is a
crossing (do not pass a two-point "polygon" to `pointInPolygon`). Convert distance to seconds with
the metric plane (2.1) or body-heights/s without it. Only for tracks with ≥ 5 samples, a stable
velocity and a closing speed above a threshold; hysteresis so a person who turns away does not
re-arm every frame. **Advisory only**: not an event, not in the contract envelope.

**Effort.** **S** after 2.1 — 0.5–1 day.

**Dependency / licence.** None.

**Risk.** Prediction is a guess. A person who stops, turns or is occluded will produce a false
pre-alert. The UI must say "predicted", show the confidence, and never auto-escalate on it. Do
not put `predicted_at` into the incident without a contract PR.

**Fallback.** A "toward zone" arrow with no time, or no pre-alert at all; the incident still
works.

---

### 2.3 Multi-class decode from the model already loaded

**Capability.** Decode selected COCO classes in addition to person — `car` (2), `bus` (5),
`truck` (7), `backpack` (24), `handbag` (26), `suitcase` (28) — with per-class NMS, and track
objects separately from persons.

**User value.** The shipped YOLO26n already predicts 80 classes; the decoder reads **one**. That
is free information about vehicles, bags and equipment, and it enables the stationary-object rule
(2.4) and vehicle-in-walkway checks without a new model or a new download.

**Demo moment.** A toggle "all COCO classes" shows the same frame with a person, a truck and a
suitcase boxed. The line: **"we were throwing away 79 of 80 classes."** Then the unattended-bag
rule uses the suitcase track.

**Technical sketch.** `decode.js` currently reads only the class-0 score at offset
`4 * numAnchors`; add a class list and a loop over `(4 + c) * numAnchors`, then NMS per class.
Cost: ~59k extra float reads per frame for 7 classes over 8400 anchors — negligible against
inference. The tracker currently assumes persons; either run a second tracker instance for
objects or add a `classId` to the track and keep person ids stable (the PPE path already runs a
mirror tracker, so a second instance is an existing pattern).

**Effort.** **S** — 0.5–1 day.

**Dependency / licence.** Existing `yolo26n.onnx` (AGPL-3.0, Ultralytics). COCO class names are
data, not a new licence.

**Risk.** COCO classes are not apron equipment: a tug is not a `truck`, a belt loader is not a
`bus`, a chock is not a `suitcase`. The UI must label the source ("COCO class") so nobody
overclaims. Extra boxes can distract the operator; keep them off by default and make them a
layer.

**Fallback.** Person + `suitcase`/`backpack` only, behind a lab toggle.

---

### 2.4 Unattended / stationary object rule

**Capability.** For non-person tracks, measure displacement over a window. If an object is
stationary for N seconds and no person track is within R (metres via 2.1, or box heights without
it), raise a **"stationary object · no owner"** advisory; clear it when a person returns.

**User value.** A bag left in a movement area is a real hazard and, for a bag, a
security-relevant one; the same mechanism catches a vehicle stopped in a pedestrian zone. A tow
bar or a chock is **not** a COCO class, so those need a custom class (see §5); the demo should be
honest about which objects the model can actually see.

**Demo moment.** Place a backpack on the apron and walk away. After ~8 s the card turns amber:
**"stationary object · no owner within 3 m"**. Pick it up; the card clears. No new model, no
upload.

**Technical sketch.** Uses 2.3 for object tracks; a per-track history of foot points; stationarity
= displacement over the window below a threshold; owner proximity = nearest person foot point
within R; timer in **media seconds**, not frames. The rule belongs in `zones.js` as a new rule
type, and the **event type is also new** (`UNATTENDED_OBJECT` or `STATIONARY_OBJECT`); the
contract only allows four event types today, so both the rule type and the event type need a
separate contract PR. Prototype in `/lab` with a local rule and **no emission** first.

**Effort.** **M** — 1–2 days for the lab rule; +contract PR, UI and report wording.

**Dependency / licence.** Existing model; no new weights.

**Risk.** Small bags are missed at 640; a parked piece of equipment is a false positive by
design; the owner may be just outside the frame; a person standing next to a bag defeats the
proximity test. The threshold is site-specific and must be calibrated on the site's footage, not
on the demo clip.

**Fallback.** A lab-only "would have alerted" counter (shadow mode) with no operator-facing
alert; the operator sees the count, not a claim.

---

### 2.5 Batch replay of a recorded clip

**Capability.** Decode a local file (or a bundled clip) without presenting it live, feed the same
pipeline, and produce an incident list for the whole clip: progress, pause, cancel, and
timestamps labelled as replay time.

**User value.** Investigate a recorded incident, tune zones against what actually happened,
evaluate a model on a clip, or run a shift's footage through the engine without a camera. This is
the capability that makes the engine useful when there is no live source.

**Demo moment.** Drag a 10-minute clip onto the page; the incident list fills while the video is
not playing; **"no upload, no server"**. Run the same clip live and compare the two lists.

**Technical sketch.** Primary path: `HTMLVideoElement.playbackRate` + `requestVideoFrameCallback`
— no new dependency, works in Chrome/Firefox/Safari, and the existing frame pump already uses
rVFC. Advanced path: `VideoDecoder` + a small demuxer (`mp4box.js`, BSD-3-Clause) to decode
without playback. Inference remains the bottleneck. At 5 fps processed, 1 minute of 30 fps
footage takes ~1 minute at full parity; processing fewer frames per footage second gives 2–3×
with a measured event delta. The rule window is in processed frames, so the semantics match a
live run at the same processed cadence; `detected_at` must be the clip time or clearly
`replay`, or a shift report will lie.

**Effort.** **M** — 2–4 days for the playbackRate path; +2–3 days for WebCodecs and the demuxer.

**Dependency / licence.** None for the primary path; `mp4box.js` (BSD-3-Clause) only for the
WebCodecs path. No model.

**Risk.** Codec/container support; memory for long clips; the replay clock vs the media clock;
event parity is not guaranteed if the sampling changes. A replay incident must never be mixed
into a live shift without a marker.

**Fallback.** PlaybackRate only; every incident is labelled "replay" and the shift report excludes
it.

---

### 2.6 On-device evaluation harness + hard-example capture

**Capability.** Load a clip plus a labels JSON; run the pipeline; match detections to labels
(IoU ≥ 0.5) and events to expected events; compute precision/recall/F1 per class and per rule;
show false positives and false negatives as thumbnails; "add to hard set" stores the frame and
label in IndexedDB; export a dataset or a report.

**User value.** Proves recall on the site's own footage, not on a vendor's benchmark; finds the
frames the model misses; makes model and threshold changes measurable; supports active learning
without a backend. This is the honesty feature: it lets LocalSight say "94.1% on your clip, here
are the three misses" instead of "98% on ours".

**Demo moment.** The visitor's clip plus labels → **"person recall 94.1%, 3 misses, all beyond
18 m"**; click a miss and see the frame; export the hard set. The audience sees the system
criticise itself.

**Technical sketch.** Reuse `decode.js` and `pipeline.js`; labels are a small JSON with normalized
boxes and event windows. **Privacy:** evaluation frames are raw, so they must go through the same
`blur.js` face/head-band pass before they are displayed or stored — an evaluation harness that
shows unblurred frames would break the product's core promise. Store only blurred thumbnails and
metadata; keep the raw frame in worker memory only for the duration of the comparison.

**Effort.** **M** — 2–4 days.

**Dependency / licence.** None; IndexedDB and Web Crypto are built in.

**Risk.** Labelling is work; a small sample overfits; blurring the evaluation frame makes some
misses hard to judge, so the harness must show the box and the distance, not the face. A
"recall" number over 20 frames is not a safety case; state the sample size.

**Fallback.** Event-level diff between two runs (no labels), plus a manual "confirmed / false
positive" tag; that is already a useful regression check.

---

### 2.7 Second opinion on event frames

**Capability.** Run an independent detector (RTMDet-nano, Apache-2.0, ~1M params) only on frames
that produced an event or a low-confidence track; match boxes at IoU ≥ 0.5; mark the incident
**"confirmed 2/2"**, **"disputed"** or **"single source"**.

**User value.** Fewer false positives without throwing away recall; an honest confidence signal
for the operator; a way to retire a model that disagrees with an independent architecture. This
attacks the number-one operational complaint, "it cries wolf".

**Demo moment.** Split view "model A / model B"; an incident card shows **"confirmed by 2
models"** or **"disputed — review"**. Toggle the second model off and the dispute disappears;
the operator sees exactly what the second opinion bought.

**Technical sketch.** A second ONNX session, loaded on demand; only event frames (rare), so the
fps cost is ≈0. RTMDet-nano is an independent architecture, not another YOLO; export to ONNX,
verify the file size, hash it in the manifest. Store the verdict in the **local incident**, not
in the contract `confidence` object (that would be a contract change).

**Effort.** **M** — 2–4 days including the export and the UI.

**Dependency / licence.** RTMDet-nano (Apache-2.0, OpenMMLab) or another Apache-2.0 detector;
ORT Web is already there. Avoid YOLO-pose or any AGPL addition unless the licence is resolved.

**Risk.** Correlated errors: both models are trained on COCO, so they can be wrong together. A
second session doubles weight memory and can contend for the same four WASM threads. "Disputed"
needs a human; never auto-dismiss an incident on a second opinion. A model that is always right
on the demo clip is not evidence.

**Fallback.** Same-model test-time augmentation (flip/scale) on event frames; label it "TTA", not
"independent". Or a "needs review" flag with no second model.

---

### 2.8 Model hot-swap + shadow A/B

**Capability.** Load a second model variant (a smaller/larger YOLO26 export, a different
confidence profile, or the RTMDet candidate), run it in **shadow** on a sample of frames, compare
detections, events and latency, and switch the active model without stopping the engine.

**User value.** Choose the operating point on the site's hardware with numbers, not a hunch; roll
back a bad model mid-shift; A/B a threshold. This is the operational half of the model manifest
in `feature-gaps.md` §4.7.

**Demo moment.** **"Candidate: +12% persons, −30% fps"**; click "use candidate"; the feed
continues, the badge changes; "keep current" discards. No reload, no lost tracker state.

**Technical sketch.** Two ORT sessions, one active; the shadow runs on every Nth frame; the switch
swaps the session and rebuilds the pipeline's model label; the model manifest (id, version,
SHA-256, size, licence, input shape) is the prerequisite. Memory is the limit: two YOLO26n
sessions ≈ 20 MB of weights plus two arenas. Session creation pauses the loop, so warm the
candidate before the switch.

**Effort.** **M** — 2–4 days after the manifest exists.

**Dependency / licence.** A second model file; the same licence constraints as the active model
(AGPL for YOLO26, Apache-2.0 for RTMDet).

**Risk.** Memory and arena growth; a shadow model can starve the active one on four threads; a
switch mid-incident changes the meaning of the incident. Record the model id on every incident
and never swap during an open incident without a marker.

**Fallback.** Offline A/B in the evaluation harness (2.6), no live shadow.

---

### 2.9 Temporal motion semantics: running, sudden stop, fall-candidate

**Capability.** Derive motion states from track speed and acceleration (2.1) and, optionally, pose
keypoints; badge **"running"**, **"sudden stop"**, **"fall candidate"** with a 2 s window and
hysteresis.

**User value.** Running near aircraft, a fall on the apron, a person who stops abruptly in a
movement area. It gives the incident a narrative that a box cannot: "approach at 3.4 m/s, stopped
in 0.4 s".

**Demo moment.** A worker jogs; the badge turns **"RUNNING 3.4 m/s"**. A staged fall shows
**"FALL CANDIDATE"** with a skeleton overlay (optional). The word "candidate" is on screen, not
just in the docs.

**Technical sketch.** Speed-only first — no new model. Pose optional: RTMPose-t/s ONNX
(3.3–5.5 M params, Apache-2.0; the RTMPose-s ONNX listing is ≈22 MB fp32, RTMPose-t is smaller —
verify with `ls -l` before shipping), top-down on person boxes, 256×192; run on event frames or
every 5th frame, **not every frame**. Fall = torso angle + vertical velocity + a person-height
drop over ~0.5 s; a heuristic, not a medical claim.

**Effort.** **M** for speed-only; **L** for pose and fall.

**Dependency / licence.** RTMPose (Apache-2.0) or MediaPipe Pose (Apache-2.0); no AGPL. Model
size is a real cost against the 9.9 MB YOLO.

**Risk.** Pose cost on four WASM threads; false falls; a fall is rare in demo footage, so the
demo must be staged and labelled; keypoints are still personal data even without a face.

**Fallback.** Speed-only "running" / "sudden stop"; no fall badge.

---

### 2.10 Verifiable redacted evidence

**Capability.** Every exported evidence file gets a sidecar manifest: SHA-256 of the blurred JPEG,
the blur profile (face + head band, strength), model id/hash, app build, capture time and a
canonical JSON hash. A static `verify.html` recomputes the hash and shows **"unchanged"** or
**"modified"**.

**User value.** An incident bundle a supervisor, insurer or auditor can check without trusting the
app; it makes "we blurred it" inspectable. It is **evidence integrity**, not the operator audit
chain: `feature-gaps.md` §4.5 already hash-chains the audit rows; this hashes the bytes the
auditor actually receives.

**Demo moment.** Export an incident; drop the bundle into `verify.html`; green **"hash matches ·
blur profile face+head · bundle contains one blurred JPEG"**. Edit one byte; red **"modified"**.

**Technical sketch.** `crypto.subtle.digest('SHA-256', bytes)`; canonical JSON (sorted keys, fixed
number formatting); the manifest is a file, not an event field. The **redaction itself** is the
existing blur (and, optionally, a zone crop); this idea makes it verifiable, it does not make it
stronger. No signature: a hash proves integrity since export, not authorship; the audit chain and
operator identity provide attribution. Document that distinction in the verifier.

**Effort.** **S** — 0.5–1 day.

**Dependency / licence.** Web Crypto, built in.

**Risk.** A hash without a trusted head proves only "not changed since export"; a malicious
exporter can hash a doctored file. The manifest records the blur profile, but it **does not prove
the capture path obeyed it** — that is the fail-closed worker's job, and the two should be
described separately. Canonicalization bugs produce false "modified". Do not call it "chain of
custody".

**Fallback.** Manifest without the verifier page; document the `sha256sum` steps.

---

### 2.11 Frame-budget governor / quality ladder

**Capability.** Measure per-stage latency and fps; when p95 frame time exceeds a budget, step down
a ladder (input 1280 → 960 → 640, cadence, blur frequency, class set) and show the degraded state;
step back up when there is headroom.

**User value.** The engine stays at a usable cadence on unknown hardware instead of collapsing;
the operator sees "degraded", not a frozen feed; it supports the capacity promise in
`feature-gaps.md` §4.1 with a mechanism instead of a guess.

**Demo moment.** Add a second consumer or a heavier model; fps stays near 5; the badge says
**"960p · degraded"**; remove the load and it recovers. The alternative — a frozen feed that looks
live — is the failure this prevents.

**Technical sketch.** A controller in `worker.js`/`useEngine` with hysteresis and a cool-down. It
must respect the measured traps: 720p cut face recall 62 → 8, and `imgsz` 512/448 cut person
recall to 15%/0% on one clip. So the ladder keeps the **face pass at full resolution** (or blurs
the head band by default), never lowers the detector below 640 without a visible warning, and
prefers **cadence** over **resolution** for the person pass. The UI must say what changed and
why.

**Effort.** **M** — 2–3 days.

**Dependency / licence.** None.

**Risk.** Silent quality loss; a governor that lowers resolution can miss the person it is meant
to catch; a ladder that oscillates is worse than a fixed profile. Log every step change with the
measured trigger.

**Fallback.** Static profiles plus a manual "slow mode" (the current behaviour), with an explicit
banner.

---

### 2.12 Speech alerts (TTS)

**Capability.** Speak a short, queued alert for CRITICAL incidents — "Stand 12, engine zone,
person without vest" — using `speechSynthesis`; mute, rate limit, one voice per incident. **No
speech recognition in the default path.**

**User value.** Hands-free alert when the operator is looking at another screen, walking, or has
the sound off on the notification; an accessibility win. It is the difference between a toast
nobody sees and a voice in the room.

**Demo moment.** The operator turns away; the speaker announces the incident while the on-screen
toast stays polite. The voice reads the deterministic report template, not an LLM.

**Technical sketch.** `SpeechSynthesisUtterance`; pick a voice with `voice.localService === true`,
fall back to the system default; a queue with `onend`; text from `report.js`, RO/EN; no audio
upload. If recognition is ever added, require `processLocally === true` (Chrome 139+) and
feature-detect it: the default Chrome recognition path sends audio to Google, which would break
the privacy claim.

**Effort.** **S** — 0.5 day.

**Dependency / licence.** Web Speech synthesis, built in; voices are OS-dependent.

**Risk.** A noisy apron; voices may be missing or network-backed; triple-announcement with a
screen reader and a system notification (`feature-gaps.md` §4.13); the wrong language; a voice
that talks over an urgent tone.

**Fallback.** A distinct tone plus a notification (`feature-gaps.md` §4.2), or a visual banner;
never block the incident on TTS.

---

## 3. Platform feasibility (November 2026)

Browser support moves. The table is a snapshot from caniuse/MDN/vendor docs; the source URLs are
the authority. "Consequence" is what it means for LocalSight, not a general verdict.

| API / capability | Chrome / Edge | Firefox | Safari | Limits, flags and traps | Consequence | Source |
|---|---|---|---|---|---|---|
| **WebGPU** | 113+ (Win/macOS/ChromeOS), Android 121+, Linux Intel Gen12+ 144+, NVIDIA Wayland 147+, AMD "others" behind flags | 141 Win, 145 macOS 26+, 147 all macOS; **Linux Nightly only** | 26+ | Secure context; `requestAdapter()` can return `null`; ORT WebGPU has no GPU kernel for `Shape`/`Reshape` (CPU fallback); graph capture needs static shapes | Demo on Chrome; WASM is the baseline; never promise WebGPU | [gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [Chrome 144](https://developer.chrome.com/blog/new-in-webgpu-144), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), [caniuse](https://caniuse.com/webgpu) |
| **WebNN** | Chromium only, `navigator.ml` since M112, behind `#web-machine-learning-neural-network`; Windows 11 24H2+ (Windows ML/ORT), macOS 14.4 Apple Silicon (Core ML), elsewhere LiteRT | No | No | Preview, not production; per-OS backend matrix; NPU drivers | Benchmark only; no product dependency | [webnn.io](https://webnn.io/en/api-reference/browser-compatibility/api), [Microsoft Learn](https://learn.microsoft.com/en-us/windows/ai/directml/webnn-overview), [W3C CRD](https://www.w3.org/TR/webnn/) |
| **WebCodecs** | 94+ | 130+ desktop; **not Android** | 16.4 `VideoDecoder`, 26 full | No demuxer/muxer (needs mp4box.js or equivalent); codec string; `VideoFrame.close()`; "limited availability" | Batch replay / advanced decode; playbackRate path is the fallback | [caniuse](https://caniuse.com/webcodecs), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder), [OpenPWA](https://openpwa.net/compatibility/webcodecs/) |
| **WebTransport** | 97+ | 114+ | 26.4+ | Needs an HTTP/3 server; not a peer-to-peer transport | Not applicable: no backend, and adding one contradicts the product | [caniuse](https://caniuse.com/webtransport), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) |
| **Web Speech — synthesis** | Broad | Broad | Broad | Voices are OS-dependent; `localService` not guaranteed; some voices are network-backed | TTS is viable with a local-voice check and a tone fallback | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API), [W3C](https://webaudio.github.io/web-speech-api/) |
| **Web Speech — recognition** | Chrome/Edge/Safari prefixed; Chrome default sends audio to Google; on-device mode since Chrome 139, full `available`/`install` surface observed in 154 | **No** | Apple speech service | Cloud by default; on-device language packs limited; Firefox absent | **Do not use** in the privacy path; if ever, require `processLocally` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API), [support survey](https://textintoaudio.com/speech-recognition-browser-support) |
| **WebLLM / Transformers.js** | WebGPU required for WebLLM | WebGPU limited; ~9 tok/s in published tests | 26+ | 0.5B q4 ≈ 278–350 MB download, ≈0.3–0.8 GB GPU memory; published 46–51 tok/s Chrome, 30–42 Safari, ~9 Firefox on the benchmark hardware; model licences vary; GPU contention | Not for the incident path; see §5 | [webllm.io](https://webllm.io/docs/guides/local-inference/), [WebLLM paper](https://arxiv.org/html/2412.15803v2), [HF card](https://huggingface.co/rubenz-org/qwen2-5-0-5b-instruct-mlc), [benchmark](https://arxiv.org/html/2604.02344v1) |
| **WASM threads + SIMD** | Yes, with COOP/COEP + `SharedArrayBuffer` | Yes, same requirement | Yes, same requirement | GitHub Pages sends no COOP/COEP; the service worker re-serves the document; SIMD is 128-bit; ORT default is `min(hc/2, 4)` | 1.5–1.8 fps single-thread vs 5.2–6.0 four-thread; the SW is an optimisation, not a dependency | [MDN SAB](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer), [web.dev COI](https://web.dev/articles/cross-origin-isolation-guide), [ORT env](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) |
| **`requestVideoFrameCallback`** | 83+ | 132+ | 15.4+ | Baseline since Oct 2024; rate is the lower of video and paint | Safe frame pump; keep the rAF fallback | [caniuse](https://caniuse.com/wf-request-video-frame-callback), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) |
| **`MediaStreamTrackProcessor`** | Partial, main-thread proprietary | **No** | 18+ | Worker-only in the spec, main-thread in Chrome; browser disagreement | Do not rely on it; use `createImageBitmap` / `VideoFrame` paths | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor), [caniuse](https://caniuse.com/mdn-api_mediastreamtrackprocessor) |
| **Web Crypto, Web Locks, BroadcastChannel** | Yes | Yes | Yes | Crypto needs a secure context; Locks/BroadcastChannel are same-origin | Evidence hash, single-alerting tab, multi-tab bus | [MDN SHA-256](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest), [MDN Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) |
| **IndexedDB / Cache Storage / OPFS** | Yes | Yes | Yes (OPFS partial in older versions) | Quota and eviction; private windows; no encryption at rest controlled by the app | Evaluation sets, replay cache, hard examples; not the live path | [MDN IDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [web.dev storage](https://web.dev/articles/storage-for-the-web) |
| **Notifications, Wake Lock, AudioContext** | Yes | Yes | Yes | Permission/policy; Wake Lock needs a secure context and a visible page; AudioContext needs a gesture | Alert delivery and TTS, not engine capability; see `feature-gaps.md` §4.2 | [MDN Notifications](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API), [MDN Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) |

**The two caveats that decide a demo:**

1. **WebGPU is not a promise.** On the target AMD/Linux laptop it may be behind flags; on a
   visitor's Mac it is Safari 26+; on Firefox Linux it is Nightly. The engine already has the
   right architecture — probe the adapter, fall back to WASM, show the choice — and every idea
   here is designed to work on the WASM path.
2. **The WASM path is the product.** Four threads need COOP/COEP, which needs the service
   worker. If the service worker fails, the engine still runs at 1.5–1.8 fps; that is a slow
   demo, not a broken one, but it must be labelled.

---

## 4. Ranked shortlist

Ranking is **value per engineering day**, not novelty. "Demo" is how visibly it lands; "pilot" is
how much it changes a real shift.

| # | Idea | Demo | Pilot | Effort | Main risk | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Metric ground plane** (2.1) | High | High | S/M | Foot-point calibration error | **Build next — signature** |
| 2 | **Unattended object** (2.3 + 2.4) | High | High | M | COCO recall on small bags; new event type | **Build second** |
| 3 | **Second opinion** (2.7) | High | High | M | Correlated errors; second model export | **Build third** |
| 4 | **Evaluation harness** (2.6) | Medium | High | M | Labelling effort | The measurement layer for #3 and #8 |
| 5 | **Batch replay** (2.5) | High | Medium | M | Clock/parity; codec | The spectacle alternative |
| 6 | **TTI** (2.2) | High | Medium | S | False pre-alerts | Cheap once #1 exists |
| 7 | **Multi-class decode** (2.3) | Medium | Medium | S | COCO ≠ apron equipment | First step of #2; useful alone |
| 8 | **Shadow A/B** (2.8) | Medium | High | M | Memory/thread contention | After the model manifest |
| 9 | **Motion semantics** (2.9) | High | Medium | M/L | Pose cost; false falls | Speed-only first |
| 10 | **Evidence manifest** (2.10) | Low | High | S | Hash semantics oversold | Cheap trust win |
| 11 | **Frame-budget governor** (2.11) | Medium | High | M | Silent quality loss | Do after #1/#2, with A/B |
| 12 | **Speech alerts** (2.12) | Medium | Low | S | Noise; voice availability | A garnish, not a foundation |

### 4.1 The one to prototype next: metric ground plane

**Why this one.** It is the only idea that changes *what the engine knows* without adding a model,
a dependency or a contract field. It uses the tracker that already exists, the blur path is
untouched, and the result is visible in the first ten seconds of a demo. It also unlocks TTI
(2.2), running (2.9) and metric zone tuning, so the two days compound.

**Two-day plan.**

| When | What | Done when |
|---|---|---|
| Day 1, AM | `engine/ground.js`: normalized DLT, `toGround`, `distanceToPolygonM`, `speedFromSamples`; unit tests: synthetic homography round-trip (< 1e-6), a known 10 m / 2 s track, a degenerate four-point set, a truncated box | `node --test src/engine/ground.test.mjs` passes |
| Day 1, PM | Calibration JSON for the demo clip (four ground points, a measured 10 m line); foot-point extraction from `tracked` boxes in `worker.js`; median speed over 1.5–2 s; overlay text; A/B timing with the feature on/off | Overlay shows m/s for a walking and a jogging person; the p50 overhead is measured |
| Day 2, AM | Four-click calibration in `/lab`; persistence per camera; gates (truncated bottom, box < 50 px, < 5 samples); a fifth check point and its error shown | A second clip can be calibrated without editing code |
| Day 2, PM | Record the demo; measure the success criteria; write the numbers into this document; if time, add the TTI teaser | The table below is filled with measured values, not targets |

**Success criterion (measurable, and the reason to stop or continue).**

| Metric | Target | How it is measured |
|---|---|---|
| Walking speed error | median ≤ **20%** over a 2 s window | 10.00 m ground line, stopwatch; engine speed over the same interval |
| Jogging speed error | median ≤ **15%** over a 2 s window | same line, faster run |
| Walking vs running | ≥ **8/10** labelled segments correct at a 2.2 m/s threshold | 10 hand-labelled segments, two people |
| Distance to zone | ≤ **0.5 m** at ≤ 12 m range | tape measure on the demo apron; compare the overlay |
| Cost | p50 **≤ 0.2 ms/frame**; no reproducible end-to-end fps drop | `performance.now()` around the call, 200 frames; 3 interleaved A/B pairs, same clip; compare against the ±0.2 fps run-to-run noise in `perf-findings.md` |
| Payload | **0 new model/runtime bytes**; **0 new dependencies** | `git diff --stat`, `npm ls` |
| Honesty | no speed printed for a truncated or small track; the unit and confidence are on screen | manual review of 20 tracks |

If a target is missed, report the measured value and the check-point error; do not tune the
threshold to make the table green.

**Out of scope for the two days.** Changes to the event envelope (`context.speed_mps` needs a
contract PR), vehicle speed, automatic calibration, report integration, a Live picker beyond
`/lab`. The prototype is allowed to be lab-only; the contract stays untouched.

**What could kill it.** A camera whose ground plane is not visible (a high, steep view with no
four coplanar points), a calibration that drifts when the camera moves, and feet that are
occluded by equipment. The gates and the check-point error are the mitigation; if the check-point
error is above ~10% of the frame, show "relative speed only".

**Four-hour version, if the hackathon clock is short.** A fixed calibration JSON for the demo
clip, speed + a naive ETA (distance / current speed) in the overlay, no UI, no persistence. That
is enough for the demo and enough to know whether the math survives real boxes.

### 4.2 Top three, in one sentence each

1. **Metric ground plane** — four points turn boxes into metres, so the engine can say how fast,
   how close and how soon, with no new model.
2. **Unattended / stationary object** — the model already sees the bag and the truck; decode the
   classes, add stationarity and owner proximity, and the engine watches the thing an apron team
   actually worries about.
3. **Second opinion on event frames** — an independent Apache-2.0 detector confirms or disputes
   an incident at almost no fps cost, which is how the product earns trust instead of asking for
   it.

If the next milestone is a stage demo rather than a pilot, swap #3 for **batch replay** (2.5): it
is the most visible "the engine works without a camera" story.

---

## 5. Not now / would be fake

The test is simple: can it be done **honestly** in a tab, with a model and a dataset that exist,
and can a sceptical engineer check it? If not, it is on this list.

| Idea | Why not now | What would make it real |
|---|---|---|
| **FOD detection** | Explicitly out of scope in `docs/contract.md` and `feature-gaps.md` §6. A 640 px detector has very low recall for a bolt or a washer; no apron FOD dataset exists in the repo; a demo would be a staged object at 2 m. | A dedicated small-object model, a labelled FOD dataset from the site, and a camera/lens that resolves the object; a separate product decision. |
| **Smoke / fire detection** | No validated free model for apron scenes; false alarms are catastrophic for trust; a generic image classifier is not a detector. | A site-labelled smoke/fire dataset, a temporal model, and an alarm policy agreed with the fire officer; not a hackathon add-on. |
| **Seatbelt / helmet detection** | COCO has no `helmet` or `seatbelt` class. A colour or aspect-ratio heuristic would be a fake classifier, and the current PPE check is already a colour heuristic that the docs correctly refuse to call a classifier. | A trained class on site footage, a reviewed dataset and a measured precision/recall; until then, no claim. |
| **Face recognition, emotion, identity** | Prohibited by the product's privacy promise and local data-protection posture; no upside for apron safety. | Nothing — this is a product boundary, not a missing model. |
| **Person re-identification across cameras** | Explicitly out of scope in `feature-gaps.md` §6; requires appearance embeddings, which are a surveillance capability and a privacy risk; there is no shared camera state across tabs by design (`BroadcastChannel` shares events, not frames). | A different product with a legal basis, a backend and consent — not this one. |
| **Tracking across clips / cameras** | Without appearance, "the same person" is a guess. A tracker that resets at a clip boundary is honest; one that claims continuity is re-ID by another name. | Appearance embeddings + a privacy review; see above. |
| **"Climbing a fence" action recognition** | No data, no validated model, and pose heuristics on 5 fps footage are brittle. A demo would be a single staged clip. | A labelled action dataset and a temporal model; then evaluate per action, not per demo. |
| **LLM-written incident reports** | `feature-gaps.md` §6 excludes them. Technically: a 0.5B q4 model is a 278–350 MB download and roughly 0.3–0.8 GB of GPU memory, WebGPU-only, with published decode at 46–51 tok/s on Chrome, 30–42 on Safari and ~9 on Firefox on the benchmark hardware; it competes with the detector for the GPU and can hallucinate a safety fact. | A tiny local model with a constrained template and a verifier, or a server — neither fits the current constraints. The deterministic `report.js` template is better and already honest. |
| **WebNN as a shipping backend** | Chromium-only, behind flags, per-OS backend matrix, "preview, not production" per Microsoft; Firefox/Safari absent. | WebNN shipping by default in at least two engines and ORT WebNN stable; benchmark then, not now. |
| **A new WebGPU/WebNN benchmarking harness** | `/bench` already measures provider, input size, fps and p50/p95, and `feature-gaps.md` §4.9 specifies the diagnostics drawer; a second harness would repeat existing work. WebNN is not shipable. | Extend `/bench` with the per-node EP proof (`disable_cpu_ep_fallback`) and the new idea's A/B, rather than a new page. |
| **Worker pool / two ONNX sessions in parallel** | `browser-engine.md` §2 already argues against a second application worker: two sessions, two 1080p tensors, and the same four WASM threads. Parallelism does not create cores; it creates contention. | More cores or a GPU backend with real concurrency, measured; then a scheduler with a queue, not a pool. |
| **Int8 as a speed win** | Measured natively at **62.9 ms vs 26.7 ms** (2.4× slower) and WebGPU quantisation support is poor; block-quantised face models did not run in ORT at all (`performance.md`). | A quantisation format that ORT Web/WebGPU executes well, measured A/B on the target laptop; until then, fp32. |
| **Multi-camera at full rate** | One engine at 3.7–5.6 fps on four threads; three full-rate cameras do not fit. `feature-gaps.md` §4.1 already says sample, don't parallelise. | A measured capacity budget, a scheduler with one active camera and sampled others; that is the honest version, not "four tiles at 5 fps". |
| **30 fps real-time on a laptop** | The measured ceiling is 3.7–5.6 fps at 1280 on four threads; WebGPU may help but is unmeasured. Promising 30 fps would be a lie. | A measured WebGPU run on the target hardware; even then, state the provider and the input size. |
| **Batching frames** | Measured natively at 1.07–1.12× (`performance.md`); the architecture cost is not worth it. | A measured browser result that shows a real gain at the same latency; unlikely. |
| **Selective unblurring for supervisors** | Breaks the fail-closed promise and creates a re-identification path; "blur everyone except the subject" is a different product with a different legal basis. | A policy decision, a WebAuthn-gated local reveal with an audit row, and a privacy review; not an engine feature. |
| **Anything with a backend** (Slack, push, cloud LLM, server re-ID, WebTransport telemetry) | A static Pages build has no server, no secrets and no upload; adding one changes the product's identity. | A separate deployment with a backend, a DPIA and an owner; out of scope here. |
| **Simulated detections in the demo** | The demo's credibility rests on "we say what is real"; a fake box is the fastest way to lose it. | A labelled fixture is fine; an unlabelled fake is not. Keep the `demo` chip. |

---

## 6. Cross-check against `feature-gaps.md`

The gap analysis already covers the *product plumbing*. This report deliberately does not
re-propose it; it adds capabilities that sit on top.

| This report | Relation to `feature-gaps.md` | Note |
|---|---|---|
| 2.1 Metric ground plane | **New** | Not in the gap catalogue. Uses the existing tracker and zones. |
| 2.2 TTI | **New** | Advisory UI; depends on 2.1. Not an event type. |
| 2.3 Multi-class decode | **New** | The decoder currently reads class 0 only; the model already has 80 classes. |
| 2.4 Unattended object | **New** | Needs a new event type → contract PR; lab prototype first. |
| 2.5 Batch replay | **Extends** §4.6 (replay ring buffer) | §4.6 replays the last N minutes inside Live for zone tuning; this replays an arbitrary file with no live source, for investigation/evaluation. |
| 2.6 Evaluation harness | **New** | §4.9 covers runtime diagnostics; this is accuracy evaluation and active learning. |
| 2.7 Second opinion | **New** | §4.7 covers model choice; this is an independent confirmation at event time. |
| 2.8 Shadow A/B | **Extends** §4.7 | §4.7 is the manifest/picker; this adds live shadow measurement and a no-reload switch. |
| 2.9 Motion semantics | **New** | §4.8 mentions pose cues only as a privacy trade-off; no action layer exists. |
| 2.10 Evidence manifest | **New** | §4.5 hash-chains operator audit rows; §4.8 covers blur and purge. This hashes the evidence bytes the recipient gets. |
| 2.11 Frame-budget governor | **Extends** §4.1 (capacity budget) | §4.1 says "surface a capacity budget"; this is the controller that enforces it. |
| 2.12 Speech alerts | **Extends** §4.2 / §4.13 | §4.2 covers sound and notifications; §4.13 covers announcement. TTS is a new channel with a mute and a queue. |
| Multi-camera tracking / re-ID | **Not proposed** | §4.1 is camera ingestion; cross-camera identity is excluded in §6. Multi-camera at full rate is a capacity problem (§5). |
| WebGPU/WebNN benchmarking, worker pool | **Not proposed** | `/bench` and §4.9 already cover measurement; a second harness and a worker pool are rejected in §5. |

**Dependencies already in the gap analysis, not re-proposed here:** camera ingestion (§4.1),
alerting when the tab is in the background (§4.2), persistence (§4.3), shift-report accuracy
(§4.4), operator identity/audit (§4.5), zone editing while running (§4.6), model manifest and
provider management (§4.7), privacy settings and retention (§4.8), diagnostics (§4.9), mobile
(§4.10), offline/PWA (§4.11), onboarding (§4.12), accessibility (§4.13), i18n (§4.14), deployment
and licensing (§4.15). The signature needs none of them to prototype, but a pilot needs §4.1,
§4.2, §4.3 and §4.7 before any of this is more than a lab.

**Explicitly excluded by the gap analysis and not re-proposed:** FOD, face recognition, emotion,
re-identification across cameras, a trained PPE classifier, an LLM report, cloud storage, a
backend, push notifications. This report agrees with §6 of that document.

---

## 7. Risks and open questions

1. **The fps baseline is fragile.** Every idea must be measured A/B on the same clip, interleaved,
   with the same provider and thread count; the existing perf work already shows a 2-minute run
   can invent a trend. A feature that "feels free" at 5 fps is 20% of the budget.
2. **Calibration trust.** Four points are only as good as the operator who clicked them. A wrong
   calibration produces confident, wrong metres, which is worse than no metres. A fifth check
   point and the confidence band are not optional.
3. **Contract discipline.** Speed, TTI, second-opinion verdicts and unattended objects all want a
   field or a type. The prototype keeps them local; each one needs a separate contract PR with
   all consumers, as `AGENTS.md` and `docs/contract.md` require.
4. **Privacy of evaluation and replay.** Raw frames in a harness, a hard-example set or a replay
   thumbnail must go through the same blur path before they are drawn or stored. A "debug" mode
   that shows raw frames is a product bug, not a convenience.
5. **Licensing.** YOLO26n is AGPL-3.0. RTMDet/RTMPose are Apache-2.0, mp4box.js is BSD-3-Clause,
   and LLM model licences vary. A new model is a legal decision as much as an engineering one;
   the model manifest is the place to record it.
6. **Demo hardware.** WebGPU on AMD/Linux may be behind flags; Safari 26 is the first Safari with
   WebGPU; Firefox Linux is Nightly. The demo should run on the WASM path by default and treat
   WebGPU as a bonus, not a dependency.
7. **The "spectacular" trap.** A staged bag, a staged fall or a staged speed run is fine if it is
   labelled as staged. The moment a staged clip is presented as a real detection, the product
   loses the only advantage it has over a black box.
8. **Who owns the calibration?** On a real camera, someone must click four points and keep them
   current. If that is the installer, it is a setup step; if it is the operator, it is a support
   call. Decide before the pilot.
9. **Does the report want metres?** A speed in the incident is useful only if the reader trusts
   the calibration. The report should show the method and the check-point error, or omit the
   number.

**Open questions for the human:**

- Is a four-point ground calibration acceptable on the pilot camera, or is the view too steep /
  the ground plane not visible?
- Which new event types are allowed, and who approves the contract PR (unattended object,
  speeding, running)?
- Is the next milestone a stage demo or a pilot? That changes the top three: replay/second
  opinion for the stage, evaluation/persistence for the pilot.
- Is a second model file (Apache-2.0, single-digit MB) acceptable in the Pages bundle, or is the
  bundle size already a constraint?

---

## Appendix A — sources

**Repo documents**

- `docs/browser-engine.md` — the port, the frame loop, the measured 5.2–6.0 fps path.
- `docs/qa/engine-parity.md` — 98.06% / 100% person recall, 100% face recall, IoU.
- `docs/qa/perf-findings.md` — 1.52 fps headless single-thread, 13-minute stability, memory.
- `docs/architecture/review.md` — engine/page boundary, worker lifetime, P0/P1 findings.
- `docs/product/feature-gaps.md` — the gap catalogue, §6 exclusions, §7 next builds.
- `docs/contract.md` — event envelope, event types, `confidence`, `context`.
- `docs/performance.md` — native reference: 28 / 17.9 ms detect, int8 2.4× slower, 720p face loss.
- `docs/ort-web-notes.md` — WebGPU support matrix, ORT sizes, COOP/COEP, memory limits.
- `frontend/src/engine/{worker,useEngine,detectors,decode,tracker,zones,pipeline,blur,vest}.js`.

**Browser and runtime**

- WebGPU implementation status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- Chrome 144, WebGPU on Linux: https://developer.chrome.com/blog/new-in-webgpu-144
- MDN WebGPU: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- caniuse WebGPU: https://caniuse.com/webgpu
- WebNN browser compatibility: https://webnn.io/en/api-reference/browser-compatibility/api
- Microsoft Learn, WebNN overview: https://learn.microsoft.com/en-us/windows/ai/directml/webnn-overview
- W3C WebNN CRD: https://www.w3.org/TR/webnn/
- caniuse WebCodecs: https://caniuse.com/webcodecs
- MDN VideoDecoder: https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
- OpenPWA WebCodecs support: https://openpwa.net/compatibility/webcodecs/
- caniuse WebTransport: https://caniuse.com/webtransport
- MDN WebTransport: https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- Web Speech API spec: https://webaudio.github.io/web-speech-api/
- Speech recognition support survey: https://textintoaudio.com/speech-recognition-browser-support
- MDN MediaStreamTrackProcessor: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor
- caniuse MediaStreamTrackProcessor: https://caniuse.com/mdn-api_mediastreamtrackprocessor
- caniuse requestVideoFrameCallback: https://caniuse.com/wf-request-video-frame-callback
- MDN requestVideoFrameCallback: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- MDN SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- web.dev cross-origin isolation: https://web.dev/articles/cross-origin-isolation-guide
- ORT Web env flags: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- ORT WebGPU operators: https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md
- ORT Web large models/memory: https://onnxruntime.ai/docs/tutorials/web/large-models.html
- `onnxruntime-web@1.31.1` package sizes: https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat

**Models and libraries**

- WebLLM: https://webllm.io/docs/guides/local-inference/
- WebLLM paper: https://arxiv.org/html/2412.15803v2
- WebLLM benchmark, Qwen2.5: https://arxiv.org/html/2604.02344v1
- Qwen2.5-0.5B MLC model card: https://huggingface.co/rubenz-org/qwen2-5-0-5b-instruct-mlc
- RTMPose model zoo: https://github.com/open-mmlab/mmpose/blob/main/projects/rtmpose/README.md
- RTMPose ONNX sizes: https://huggingface.co/bukuroo/RTMPose-ONNX
- mp4box.js: https://github.com/gpac/mp4box.js
- Transformers.js: https://github.com/huggingface/transformers.js

---

## Appendix B — reproducibility

**What was done.** Read the documents and modules listed above; checked browser support against
the sources; wrote this file. No `npm install`, no build, no benchmark, no code change, no other
worktree touched.

**How to check the claims without a GPU.**

```bash
cd frontend
npm run test:unit                      # the existing pure-engine tests
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build   # the Pages build; no backend
```

If the signature is built, add `src/engine/ground.test.mjs` and run it with
`node --test src/engine/ground.test.mjs`; the two-day plan in §4.1 is the scope.

**What would falsify the signature.** A median speed error above 20% on the measured 10 m line, a
p50 overhead above 0.2 ms/frame, or a check-point error above 10% of the frame. In that case,
ship the relative-speed fallback and do not put metres in the report.
