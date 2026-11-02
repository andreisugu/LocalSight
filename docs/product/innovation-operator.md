# LocalSight — operator features worth building

**Initial proposal; the queue parts are implemented.** 2 November 2026 · branch `prep/innovation-operator` · worktree
`LocalSight-prep/innovation-operator` · base `63551a1`.

Read-only analysis: this branch adds this file and nothing else. No application code, test,
configuration or other worktree was touched.

**Status (2 November 2026).** The triage queue, episode grouping, WARNING-only holds and the
coverage receipt are now implemented in the product: `frontend/src/components/live/TriageQueue.jsx`
and `TriageRow.jsx` read the tested `utils/triage.js` core, and `CoverageRibbon` is mounted in
Rapoarte. The rest of this document remains a proposal.

**Question.** The pipeline is proven; the demo works. What would a shift supervisor actually use
on a real apron, and which of those ideas would make a 60-second demo visibly better without
turning it into theatre?

**Method.** Built the exact Pages configuration (`VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run
build`), served `dist/` under `/LocalSight/` on `127.0.0.1:4348`, and drove it with Playwright
Chromium (headless, no WebGPU adapter → WASM, `crossOriginIsolated: true` after the COOP/COEP
service-worker reload). Clicked Live, Incidents, the incident detail, Reports, Zones and Sistem &
Audit at 1440×900. Read `README.md`, `demo/run_sheet_browser.md`, `docs/product/feature-gaps.md`,
`docs/qa/ui-findings.md`, `docs/architecture/review.md`, `docs/contract.md`, and the operator,
store, feed and report modules under `frontend/src/`.

---

## 1. What the operator actually gets today

The current screen is a **monitor with a feed attached**. That is the right shape for a demo and
the wrong shape for a shift, and the difference is not a missing widget — it is a missing model of
the work.

Measured on the build above:

| Observation | Evidence |
|---|---|
| The feed is in insertion order. There is no priority rule, no deadline, no "next". | `IncidentFeed` renders `filteredEvents`; `filterEvents` filters only. The only incident sort in the codebase is `incidentList.js:58`, newest-first. |
| Acknowledgement is a button on a card, not an action on a queue. | `IncidentFeedCard` → `onAcknowledge`; the guard against double-ack (`shouldAcceptAck`) exists because cards *move under the cursor*. |
| Eight incidents are one flat list, even when several belong to the same walk-through. | Fixtures in `data/incidents.js`; the simulator adds one row per click (QA measured 13 unique incidents from 5 rapid simulations). |
| The incident detail is one still, five timeline steps and a template report. | Screenshot `11-detail.png`; no before/after context, no operator action record. |
| Opening an incident stops monitoring. | Feature-gaps §2.1 measured the worker terminated on navigation. A shift has no beginning or end in the UI. |
| Nothing survives a reload. | Feature-gaps §4.3; `localStorage` holds theme, engine preference, operator name, bench runs. |
| A new critical is a polite toast, not an alert. | Feature-gaps §4.2; no `Notification`, no engine sound, no wake lock. |

So the gap this document addresses is **operator workflow**, not pipeline capability: the human
side of triage, evidence, handover and accountability. `feature-gaps.md` already owns the
infrastructure that makes the record possible (camera ingestion, persistence, notifications,
identity, report accuracy). Everything below is deliberately built *on top of* that layer, and
§8 is the explicit cross-check.

### 1.1 One shift, as it is actually worked

This is the loop the UI should serve, and the reference for every proposal:

1. **Take over.** What is open, what is unfinished, what changed since the last shift, was the
   system even watching?
2. **Watch.** Two to six cameras, one screen, an alert that reaches the operator when they look away.
3. **Triage.** Which alert first, is it real, what is the deadline, what did it look like two
   seconds before.
4. **Act.** Call the crew on the radio, log what was done, acknowledge, or mark a false positive
   with a reason.
5. **Recover.** Interruptions, phone calls, a walk to the stand; the queue must survive them.
6. **Hand over.** A short brief, a signature from each side, the unfinished items carried forward.
7. **Account.** At the end: a report that reconciles with the record, a coverage figure, evidence a
   safety officer can open and verify.
8. **Learn.** The same false positive every evening should turn into a zone change, not a habit.

Steps 1, 3, 4, 6 and 8 are where the product is thinnest, and where a browser is an advantage
rather than a limitation.

### 1.2 Filters every idea had to pass

1. **A supervisor would use it on a real apron**, not only on a stage.
2. **It is visible in 60 seconds** and adds to the existing run sheet rather than replacing it.
3. **Browser-only is an enabler**, not an apology: local evidence, zero install, instant onboarding,
   nothing uploaded.
4. **Nothing is faked.** If a number cannot be derived, the UI says so. Synthetic events are
   labelled as synthetic on the event itself, not only in a footnote.
5. **It does not weaken a safety property** (no silent suppression, no auto-ack, no raw frames, no
   identity).
6. **Small enough to be a diff**, not a rewrite.

Ideas that failed filter 4 or 5 are in §7, with the reason.

---

## 2. The twelve ideas

Order here is thematic, not ranked; the ranking is in §3. Effort uses the same scale as
`feature-gaps.md`: **S** ≤ 3 days, **M** ≈ 1–2 weeks, **L** > 2 weeks, for one developer who knows
this codebase.

---

### 2.1 Triage queue — "Coada de lucru"

**Story.** As a dispatcher, I want the next thing to do and the reason it is next, so that I triage
by rule instead of by scrolling.

**Why it matters.** A control room works a queue, not a feed. The current list mixes a 4-hour-old
warning with a critical that escalates in 40 seconds, and the only ordering signal is "newest
first". Worse, the feed *moves under the cursor* when a card is acknowledged — QA F1 exists because
of exactly that. A queue with a visible rule, a deadline and a stable order is the difference
between "we have alerts" and "we are working alerts".

**Demo beat (60 s).** Four open incidents. The top row shows `CRITICAL · escaladează în 00:42` and
a draining bar. Press `A`; the row leaves, the KPI drops 4 → 3, the next row takes focus and the
countdown continues. Say: "the operator never scrolls; the system ranks, the human decides."

**Browser-only sketch.** A pure comparator in `utils/incidentQueue.js`, no new state library:

```
1. status = escalated            (someone must act now)
2. severity CRITICAL > WARNING
3. deadline remaining ascending  (detected_at + escalate_after_s; unknown last)
4. age descending                (oldest first)
5. event_id ascending            (stable tie-break)
```

Lexicographic and explainable in one line, deliberately **not** a weighted score: an operator must
be able to say why row 1 is row 1. The UI prints the reason from the first criterion that differs.
Queue mode is a tab inside the existing feed panel ("Coadă" / "Flux"), so the full list is always one
click away. Position is shown in the detail view. `Hold` is allowed **only** for WARNING, requires a
reason from a fixed list, lasts at most 15 minutes, and the row stays visible with a `ținut până la
HH:MM` chip. A CRITICAL cannot be held or snoozed.

**Effort.** **S** (2 days for the scoped version, tests included).

**Deps / risks.** `escalate_after_s` is missing on browser-engine events today (architecture P1-4,
one line plus a test) — without it the queue must print "termen necunoscut" rather than invent one.
Re-ranking while the operator is reading is its own usability hazard: freeze the order while focus
is inside the queue and no action has happened for 5 s, and re-rank immediately after an action.
Keyboard shortcuts must not fire while typing in search or notes.

**Honest limit.** It orders attention; it does not decide. The comparator is a policy, not a risk
model, and the incident list remains the source of truth. Session-only until the local store lands.

---

### 2.2 Episode grouping — one incident, one story

**Story.** As a dispatcher, when one person triggers six alerts in ninety seconds, I want one
episode with a count, not six rows that bury the next camera's critical.

**Why it matters.** Alarm floods are the classic reason operators stop trusting a system. The demo
already reproduces it: five rapid simulations produce thirteen rows (QA, repeated actions). On a
real apron a single worker walking past a nacelle can fire `RESTRICTED_ZONE` on every cooldown
expiry. Collapsing the presentation — while keeping every event actionable — is a genuine control
room technique, and it makes the demo look intelligent instead of noisy.

**Demo beat (60 s).** Fire five simulated events. The feed shows `1 episod · 5 detecții ·
19:32:40–19:32:52 · maxim CRITICAL`. Expand, and all five raw rows are there with their own ack.
Say: "grouping changes what I read first, never what the system recorded."

**Browser-only sketch.** `groupEpisodes(events, { windowS: 120 })` in `utils/`: same `camera_id` +
`zone_id` + `type`, or same `track_id`, within the window; episode severity is the maximum, never a
downgrade; the row shows the severity breakdown (`3 CRITICAL · 2 WARNING`); "confirmă toate" is a
secondary, explicit action that acks each event through the existing store path, so the audit stays
per-event. Persisted events group by the same rule after reload.

**Effort.** **S**.

**Deps / risks.** A CRITICAL hidden inside a WARNING-looking row would be a safety defect — the
episode must carry the maximum severity and the worst countdown. Clustering can merge unrelated
events; always expandable, and the rule is stated in the row's title attribute. Do not use it to
suppress notifications: it is a reading aid.

**Honest limit.** Presentation only. It does not deduplicate the record, and it cannot tell whether
five detections were one person or five.

---

### 2.3 Incident filmstrip — evidence with a before and an after

**Story.** As an operator, I need the ten seconds around the event, not one still, so that I can
decide whether it was real before I escalate it to a crew.

**Why it matters.** A still frame answers "was someone there" and nothing else. The questions that
actually decide an ack are: did they stop at the line, did they walk through, did the vest badge
flip, was the engine on the whole time. The detail screen currently shows one frame and five
timestamps. A short, already-blurred filmstrip turns evidence into something an operator can judge,
and it is the single most convincing thing a safety officer can look at.

**Demo beat (60 s).** Open an incident and drag the scrubber back five seconds: the person walks in,
the box appears, the badge flips `PPE ?` → `FĂRĂ VESTĂ`, then the event. The report's "când" line
highlights the matching frame. Say: "every frame here is the processed frame — blurred before it was
ever drawn."

**Browser-only sketch.** While the engine runs, the worker already renders a canvas; add an optional
low-rate snapshot sequence for the active camera (2 fps at 640 px, 20 s ring, already blurred, never
a raw frame). The page keeps `Blob`s and builds an object URL per frame; a `Filmstrip` component
reuses the detail layout. Markers come from the event and the local record: entered zone, PPE flip,
escalated, acked, operator logged an intervention. After the persistence build, the strip can come
from OPFS and be attached to the incident.

**Effort.** **M**.

**Deps / risks.** Frame budget: 20 s × 2 fps × 50–150 kB ≈ 2–6 MB per camera, acceptable; the
inference loop must not pay for it. On the demo clips the pipeline clock is `video.currentTime`,
which resets on loop (architecture P2-1) — the UI must say "clip demo · timp media" instead of
pretending it is wall clock. When the engine was off there are no frames: show "fără cadre", never a
placeholder that looks like evidence. Persisted frames are personal data and fall under retention.

**Honest limit.** It is a ring buffer, not an NVR: seconds, one camera, and it stops when the tab is
hidden. It cannot show what the model did not process.

---

### 2.4 Intervention log — the human half of the record

**Story.** As an operator, the system saw the event and I called the crew; I want both in the same
timeline, so that the record shows what was actually done.

**Why it matters.** Every real incident is resolved by a human action that happens off-screen: a
radio call, a phone call to the stand, a walk to the apron, a "stand clear" confirmation. Today the
record ends at "acknowledged". The report can count acknowledgements but cannot say what anyone did.
This is also the cheapest way to make the product feel like a tool rather than a detector.

**Demo beat (60 s).** On the detail, add `Sunat TETRA 3 · 19:34` from a short action list, optionally
with a 140-character note. The timeline grows to six steps; the report tile changes to
`2 intervenții consemnate`. Say: "the acknowledgement stops the timer; the intervention log says
what stopped the risk."

**Browser-only sketch.** An app-side record on the incident — **not** new fields on the edge
envelope, which `docs/contract.md` forbids. Fixed action types (radio, telefon, dispecerat, oprit
activitatea, verificat la fața locului, fără acțiune), actor from the operator session, timestamp,
optional short note. Rendered by the existing timeline component; counted by `buildShiftReport` as a
separate line, never folded into a KPI that implies verification. Persisted with the incident after
the store lands.

**Effort.** **S**.

**Deps / risks.** Free text is personal data: cap the length, ask for channels and roles rather than
names, and keep it out of the default export unless evidence is explicitly requested. It must be
labelled as an operator statement. Without persistence it dies with the tab, which makes it a demo
feature only — sequence it with the local store.

**Honest limit.** It records what the operator says they did. It cannot verify it, and it must never
be presented as proof of action.

---

### 2.5 Handover brief — "what changed since my last shift"

**Story.** As the incoming operator at 14:00, I want one screen that says what is unfinished, what
changed and what I am inheriting, and I want to sign that I received it.

**Why it matters.** Shift handover is where safety records usually break: a verbal briefing, a
printout, and an incident that nobody mentions. This is also the feature that makes the product
*operational* rather than a monitoring toy — it is the moment a supervisor decides whether to trust
the tool. And it is pure projection over data the local store will already hold, so it is cheap once
§4.3 of `feature-gaps.md` exists.

**Demo beat (60 s).** Switch the operator in the header. A brief appears: `3 nedesluite · 1
escaladat · 1 zonă modificată (v3, motiv: 9 FP) · CAM-03 gap 12 min · 2 intervenții`, with two
signature rows — `predau: Dispecer, 13:58` and `preiau: Șef tură, 14:02`. Say: "the handover is a
diff, not a summary that hides the gap."

**Browser-only sketch.** `buildHandover({ events, audit, coverage, zones, operator, now })` as a pure
module with a fixed clock; the screen is a projection with four blocks: *unfinished* (open/escalated
with owner and age), *changed* (zone versions, model/build, camera sources), *watched* (coverage and
gaps, §2.6), *carried* (notes to the next shift, three structured lines). Two signatures stored as
records with actor and time. No legal e-signature claim.

**Effort.** **M**.

**Deps / risks.** Requires the local store (§4.3) and operator identity (§4.5); building it earlier
would mean inventing the record it reads. A brief that claims completeness while coverage was
partial is worse than no brief — the coverage block is mandatory, not optional. Notes are personal
data and need retention. Cross-device handover is impossible by design; say so.

**Honest limit.** Covers only this kiosk's record. It is a local briefing receipt, not an
organisation-signed shift log, and it cannot prove the outgoing operator actually said any of it.

---

### 2.6 Coverage receipt — were we actually watching?

**Story.** As a supervisor, when something happened at 03:40 I need to know whether the system was
monitoring then, and for how long it was not.

**Why it matters.** This is the honesty feature, and it is uniquely browser-native: the browser's
own throttling is the thing that creates the gaps, so the product must show them. Feature-gaps §4.4
asks for a coverage *number* in the report; this asks for a coverage *artifact* that is visible
during the shift, at handover and in the export. It also protects the product from its worst
failure mode: a frozen frame that looks live (architecture P2-4).

**Demo beat (60 s).** A ribbon under the KPI strip: one row per camera, green while frames were
processed, amber when fps fell below the threshold, red where the tab was hidden, grey where the
engine was off; incident ticks above the ribbon. Point at the red segment: "we are telling you where
we were blind, not hiding it." Say the number out loud: "47 of 52 minutes covered."

**Browser-only sketch.** The engine provider (§7.1 of feature-gaps) emits a sample every 10 s:
`{ camera_id, from, to, state, fps, reason }`, derived from real frame timestamps, not wall clock.
`buildCoverage(samples, events)` merges adjacent equal states and returns segments plus totals; an
SVG ribbon renders it (no dependency). The same data feeds the report, the handover brief and the
evidence packet.

**Effort.** **S/M** (S once the engine provider exists).

**Deps / risks.** Must be derived from processed frames, never from "the tab was open". Visibility
transitions need the `hidden`/frozen distinction that §4.2 already designs. Long shifts aggregate to
10 s buckets. Time-zone and DST handling stays with `constants/shiftReport.js`, which already owns
the operational day.

**Honest limit.** Proves frames were processed, not that a human was watching. It is bounded by the
browser, which is precisely what it is reporting.

---

### 2.7 False-positive review → a zone proposal a human accepts

**Story.** As a supervisor, the same corner fires every evening; show me the pattern and propose the
zone change, with the evidence, and let me accept it.

**Why it matters.** "Mark as false positive" currently writes a status and a toast that says
"feedback înregistrat pentru modelul AI" — which is not true in this build and is exactly the kind of
claim that destroys trust. The honest version is better: keep the local FP history, show where it
clusters, and turn it into a *geometry* change with a visible before/after. Operators already tune
zones in week one; this gives them data instead of intuition.

**Demo beat (60 s).** `11 fals pozitive pe engine-left · 9 în colțul de jos`. The frame shows the FP
boxes as a dot layer over a zone outline; a draft polygon shrinks past the cluster; a diff panel
says `ar fi eliminat 9 FP · ar fi păstrat 7 incidente reale din istoric`. Accept → zone v4 with
author and reason. Say: "the system proposed; the supervisor decided; the version records why."

**Browser-only sketch.** Requires boxes to be stored with the event (app-side local record; the
contract envelope has no box field today). `proposeZoneAdjustment(fpBoxes, events, zone)` computes a
simple, explainable adjustment — subtract a grid region where FP centroids concentrate, or shrink to
the convex hull of confirmed hits — and **always** reports the counterfactual over the stored history:
how many confirmed incidents the new polygon would also have excluded. Acceptance goes through the
existing zone draft/reducer path, creating a version with author, timestamp and reason.

**Effort.** **M**.

**Deps / risks.** Needs persistence (§4.3), attribution (§4.5) and zone versions (§4.6). Small
samples lie: refuse to propose under ~8 FPs and say why. A proposal that removes real detections is a
safety regression, so the counterfactual is mandatory and the accept is explicit. No threshold
tuning in the same action — geometry only, so the change is reviewable.

**Honest limit.** It is not model training and must never be described as learning. It edits a
polygon for one camera on one site, and the estimate is only as good as the local labels.

---

### 2.8 Dwell map and shift fingerprint — where it actually happens

**Story.** As a supervisor, I want to see where people actually walk and when the alerts cluster, so
that I can brief the crew, place the cones, and design a zone that matches reality.

**Why it matters.** A polygon drawn on a still frame encodes an assumption. Six weeks of detections
encode where people really go. This is also the cheapest "insight" feature that is not a dashboard
for its own sake: it changes a zone, a briefing and a staffing decision. It is browser-only in the
best sense — the raw positions never leave the tab, and only aggregates are retained.

**Demo beat (60 s).** Toggle `Hartă` over the live frame: a glowing dwell map over the apron, with
the zone outline on top. A small strip below: `18:00–19:00 · engine-left · 61 % din alertele
săptămânii`. Say: "this is the last six shifts on this kiosk, aggregated; no images, no identities."

**Browser-only sketch.** The worker posts a low-rate position sample (`x, y` normalized, timestamp,
camera, zone) — coordinates only, no crops, no track persistence. The page buckets into a coarse
grid (e.g. 32×18) per camera and zone version, keeps counts, and discards the raw samples. A canvas
overlay renders the heat; a 24 h × zone histogram uses the same bucket store. Keyed by
`camera_id + zone_version` so a moved camera invalidates its history honestly.

**Effort.** **M**.

**Deps / risks.** Camera geometry changes invalidate history — key and label it. Positions are
behavioural data: aggregate, never render a track over time, never keep per-track history. Sampling
cost is trivial but must not touch the inference path. A heat map over a looped demo clip will look
"suspiciously stable"; label it as demo footage when it is.

**Honest limit.** Shows where *detections* happened, not where people work. The camera framing and
the sample rate decide the picture, and a quiet corner may simply be out of frame.

---

### 2.9 Evidence packet — one incident, sealed, verifiable

**Story.** As the safety officer, I want the incident file, and I want to be able to check that
nobody edited it after export.

**Why it matters.** The shift report is for the shift; an incident packet is for the investigation,
the insurer, or the training session. It is the artifact that leaves the kiosk, so it must be
self-contained, readable without LocalSight, and honest about what it can prove. Hashing is cheap in
the browser and turns "trust me" into "recompute it yourself".

**Demo beat (60 s).** Export one incident. Open `verify.html` from the folder in a fresh tab, offline:
`integritate: OK · 7 fișiere · fețe blurate · YOLO26n · build 63551a1 · operator: Dispecer`. Change
one byte of `incident.json`, reload: `fișier modificat: incident.json`. Say: "the seal proves the
packet was not edited after export; it does not pretend to prove the camera was honest."

**Browser-only sketch.** `incident.json` (contract-shaped event + the local record: interventions,
queue history, zone version, model/build), `evidence.jpg` (the blurred snapshot), optional
`filmstrip/*.jpg`, `timeline.md`, `notes.md`, `manifest.json` with SHA-256 per file and a
`verify.html` that inlines the manifest and re-digests via `crypto.subtle`. Written through
`showDirectoryPicker` when available, otherwise one download per file. No zip dependency.

**Effort.** **M**.

**Deps / risks.** File System Access API is Chromium-only; the download fallback must not silently
produce a partial packet. Exporting personal data must be an explicit, audited action (§4.5, §4.8).
A hash chain over the packet is enough; do not reach for a ledger.

**Honest limit.** Sealed, not signed, and with no trusted timestamp: it proves integrity after
export, not capture authenticity, and not who was behind the keyboard.

---

### 2.10 Kiosk / wall mode — the one thing that matters, from across the room

**Story.** As a supervisor, I want the screen on the office wall to show the current critical, the
time left, and the next two, so that anyone walking in understands the state in two seconds.

**Why it matters.** The app is dense because it is a workstation. A wall display is a different
product surface with a different job: glanceability. This also solves a demo problem — the current
fullscreen shows the *raw clip* and is blocked while the engine runs, so there is no way to show the
processed feed big. A wall mode that shows the processed canvas is both useful and a better demo.

**Demo beat (60 s).** Press `W`: chrome disappears, the processed feed stays, the current CRITICAL
takes the right third with a countdown, the clock and the health chip sit at the bottom. A new
critical arrives; the wall updates; `A` acknowledges without leaving the wall. `Esc` returns.

**Browser-only sketch.** A layout mode, not a route: CSS grid + Fullscreen API + Wake Lock. Priority
comes from §2.1, episodes from §2.2. A `pin` lets the operator hold a camera or an incident while
investigating, so the wall does not steal focus. No auto-rotation by default — rotation hides the
alert that mattered. A persistent `MOD PERETE` chip and an exit hint.

**Effort.** **S**.

**Deps / risks.** Fullscreen can be exited by the OS, screens sleep, and kiosk browsers often
suppress notifications (§4.2). The wall must keep the camera visible, otherwise it is a ticket
printer. Do not auto-rotate.

**Honest limit.** A glanceable display, not an alarm panel. It cannot guarantee that anyone is
looking, and it is not a substitute for the notification path.

---

### 2.11 Drill mode — labelled rehearsal, not fake production

**Story.** As a shift lead, I want to run a new operator through a realistic burst on the real UI,
and I want the demo to be able to show a busy shift without pretending it was real.

**Why it matters.** A real apron is a bad training ground and a worse demo stage. Today there are
two options: fixtures (honest, but static) and the `Simulare` menu (injects one fabricated event into
the *real* list, with no session boundary). A drill session is the honest third option: same store,
same queue, same detail, a visible boundary, and a scorecard at the end. It is also the morally
cleaner version of the "demo director" idea, because the label is part of the product, not the
presentation.

**Demo beat (60 s).** `Începe exercițiul` → six incidents in ten seconds, a striped `EXERCIȚIU`
banner, triage them. End: `timp median până la confirmare 11 s · 0 critice ratate · 4 intervenții
consemnate`. Exit, and the real shift is untouched. Say: "the drill used the same engine and the same
queue; only the events were synthetic, and every one of them says so."

**Browser-only sketch.** Promote `useSimulation` into a scenario player: a bundled array of beats
(`{ at_s, type, severity, camera, zone }`) driven by timers, writing into a **separate** in-memory
list with `session: 'drill'`. A global banner and a distinct accent colour; drill snapshots carry a
watermark; export is disabled for drill rows; the scorecard is computed by the existing pure KPI
helpers. No new data path, no new dependency.

**Effort.** **M**.

**Deps / risks.** The one real risk is a drill incident being mistaken for a real one: the banner,
the watermark, the disabled export and the separate store are all mandatory, not polish. A drill
must not run on a live camera without saying so on the tile. The scorecard measures interaction
speed, not judgement — word it that way.

**Honest limit.** Synthetic events are synthetic. The scorecard says how fast the operator used the
UI, not whether the decision was right.

---

### 2.12 Demo director — a stage tool, explicitly labelled

**Story.** As the presenter, I want the 60 seconds to land even if the venue wifi or the model fails,
without pretending the product did something it did not.

**Why it matters.** The existing `Simulare` menu already injects events and already plays a sound; it
is a seed, not a liability, as long as the result is labelled *on the incident*. The demo's
credibility rests on "we say what is real" (run sheet, README), so the director must make the label
louder, not quieter.

**Demo beat (60 s).** A presenter panel (`?director=1`, build-flag gated) lists the run-sheet beats
with a timer, a "next beat" button, "inject critical", "pause engine", "reset demo state", and a
"fallback: recording" link. Every injected card carries `INJECTAT · DEMO` in the same yellow as
`date demo`. Say, unprompted: "this one is injected; here is the real engine incident next to it."

**Browser-only sketch.** One component, one query flag, one env gate; it calls the existing
`simulateIncomingWsEvent`, adds the label to the event's `report.source` or a local `origin` field,
and shows a global banner while active. `reset` clears only demo rows. No new data path.

**Effort.** **S**.

**Deps / risks.** It can hide a broken product, which is why the label must live on the record, not
on the presenter's screen, and why the run sheet needs a closing "what was real" line. Strip it from
pilot builds with an env flag, and never let an injected event enter a report or an evidence packet
as if it were captured.

**Honest limit.** Theatre with a label. It does not make the product work, and it must never be
counted in a KPI.

---

## 3. Ranked shortlist (impact × effort)

Ordering rule: **operator impact first**, then effort, then demo value. "Impact" is what a
supervisor would miss after a week; "demo" is how much the 60 seconds improves.

| # | Idea | Operator impact | Demo | Effort | Blocked by | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Triage queue** (§2.1) | 5/5 | 5/5 | S | nothing (one-line `escalate_after_s` fix) | **Build now** |
| 2 | **Episode grouping** (§2.2) | 4/5 | 4/5 | S | nothing | **Build now** |
| 3 | **Coverage receipt** (§2.6) | 4/5 | 4/5 | S/M | engine provider | **Build with the store** |
| 4 | **Handover brief** (§2.5) | 5/5 | 4/5 | M | store + identity | **Build right after** |
| 5 | **Intervention log** (§2.4) | 4/5 | 3/5 | S | store (to be durable) | Cheap, high trust |
| 6 | **Evidence packet** (§2.9) | 4/5 | 4/5 | M | store + build identity | Do before a pilot |
| 7 | **Filmstrip** (§2.3) | 4/5 | 5/5 | M | engine frame buffer | Biggest demo jump |
| 8 | **FP → zone proposal** (§2.7) | 4/5 | 4/5 | M | store + zone versions | Do after 3 weeks of data |
| 9 | **Kiosk wall** (§2.10) | 3/5 | 4/5 | S | nothing | Good, not urgent |
| 10 | **Dwell map** (§2.8) | 3/5 | 5/5 | M | store + samples | Insight, later |
| 11 | **Drill mode** (§2.11) | 3/5 | 3/5 | M | nothing | Training, after handover |
| 12 | **Demo director** (§2.12) | 1/5 | 5/5 | S | nothing | Stage tool only |

Why this order and not the obvious one:

- **The queue and grouping are the only two ideas that make the existing demo better on day one**
  without touching the architecture. They are also the two that a supervisor would notice within an
  hour of use.
- **The coverage receipt ranks above the filmstrip** despite less spectacle, because it is the
  feature that makes every other number believable. A report that cannot say when it was blind is
  not a record.
- **The handover brief is the highest-impact feature in the list**, but it is a projection over a
  record that does not exist yet. It is the first thing to build *after* the local store, not before.
- **The dwell map is the most spectacular and the least urgent.** It is a briefing tool, and it
  needs weeks of data to be interesting.

**Top three, in build order:** triage queue, episode grouping, coverage receipt.

---

## 4. Signature feature: the operator queue

**Triage queue (§2.1).** Two days, no dependency, no contract change, no new library, and it is the
single change that turns the screen from "a feed of detections" into "a shift being worked". It is
also the foundation the other ideas plug into: grouping feeds it, handover summarises it, the wall
mode renders it, the drill scores against it.

### 4.1 Flow, as the operator experiences it

```
┌ INCIDENTE ──────────────────────────────────────────────┐
│  [ Coadă ]  Flux                                        │
│  4 deschise · 1 escaladează în 00:42                    │
│  ordine: escaladat → severitate → termen → vechime      │
├─────────────────────────────────────────────────────────┤
│ 1  CRITICAL  stand12 · engine-left                      │
│    „persoană sub motor, motor pornit"                   │
│    termen 00:42 ██████████░░░░  0 intervenții           │
│    [Confirmă A]  [Fals pozitiv F]  [Deschide ↵]         │
├─────────────────────────────────────────────────────────┤
│ 2  CRITICAL  taxiway-b · holding-point                  │
│    termen 01:10 ███████░░░░░░░  1 intervenție           │
├─────────────────────────────────────────────────────────┤
│ 3  WARNING   baggage-area · belt-2                      │
│    termen necunoscut · ținut până la 19:50 (motiv: …)   │
└─────────────────────────────────────────────────────────┘
```

1. **Enter Live.** The queue tab is default when anything is open; the first row has focus. The
   countdown ticks once per second; the order does **not** shuffle while the operator reads.
2. **Press `A`.** The row is acknowledged through the existing store path (so the audit, the toast
   and the double-press guard are unchanged), it leaves the tab, the next row takes focus within
   ~100 ms, the KPI decrements. No mouse movement.
3. **Press `F`.** Same, with a reason picker (fixed list: prea mic în cadru, obiect, umbră, altă
   persoană în afara zonei, alte). The reason is stored locally — it is the input §2.7 needs later.
4. **Press `H` on a WARNING.** A 15-minute hold with a required reason; the row stays in place with
   a chip. On a CRITICAL the key does nothing and the UI says why: `criticele nu pot fi amânate`.
5. **Press `Enter`.** Opens the detail; the header shows `poziția 1 din 4` and the same reason line,
   so the context does not disappear.
6. **Nothing open.** The empty state is a next step, not a celebration:
   `Nimic deschis · verifică acoperirea (47/52 min)`.

### 4.2 The ranking rule, stated in one line

```
escalated  →  CRITICAL before WARNING  →  nearest deadline  →  oldest  →  event_id
```

No weights, no score, no model. Every row can explain itself by naming the first criterion that
differs from the row above it, which is what an operator needs when they are asked "why did you
handle that one first?".

### 4.3 Data it needs

| Field | Source | Use |
|---|---|---|
| `event_id`, `severity`, `status` | event (contract) | ordering, action gating |
| `detected_at` | event (contract) | age; deadline base |
| `escalate_after_s` | event / zone fallback | deadline; **must be carried into engine events** (architecture P1-4) |
| `escalated_at`, `acked_at`, `acked_by` | local record | top criterion, ownership line |
| `camera_id`, `zone_id`, `type` | event (contract) | row context, grouping later |
| `confidence.temporal.seen/window` | event (contract) | "14/15 cadre" line, rank reason detail |
| `duration_s`, `track_id` | event (contract) | context; never used to rank |
| `queue.pinned`, `queue.hold{reason,until,by}`, `queue.focus_id` | local, session | stability and hold |
| `fp_reason` | local, session | input to §2.7 |

No new contract field. The queue is a **read model** over events plus a small local session record.

### 4.4 Two-day plan

**Day 1 — the rule, with tests.**
- `frontend/src/utils/incidentQueue.js`: `deadlineFor(event)`, `remainingS(event, now)`,
  `rankReason(a, b)`, `orderQueue(events, now, { pinned })`, `canHold(event)`. Pure, injected clock.
- `frontend/src/utils/incidentQueue.test.mjs` (Node): escalated first; CRITICAL before WARNING even
  with a later deadline; unknown deadline last within its severity; stable tie-break; a CRITICAL
  cannot be held; a held WARNING stays present; no input row disappears.
- Wire it into the provider as a derived value (`useIncidentQueue`), alongside the existing
  `filteredEvents`. No new global state.

**Day 2 — the surface.**
- Queue tab inside `IncidentFeed` (default when `open + escalated > 0`), row with countdown bar and
  reason line; `aria-live="polite"` summary, not per-second announcements.
- Keyboard map scoped to the queue container: `J/K`, `A`, `F`, `H`, `Enter`, `Esc`. Ignore keys while
  a text input or the note dialog has focus.
- Freeze/re-rank policy: no reorder while focus is inside the queue and no action for 5 s; re-rank
  immediately after an action or when the operator returns to the tab.
- Queue position chip in the incident detail header.
- E2E: acknowledge from the queue with the keyboard only; assert exactly one incident changed, the
  next row is focused, and the count decremented.
- Run sheet: replace the "click a card" beat with "press A", and add one line to the honesty table —
  the ranking is a policy, not a prediction.

**Explicitly not in this scope:** persistence, notifications, multi-camera, a new route, a chart, a
"risk score". Those are separate builds and would turn two days into two weeks.

### 4.5 Acceptance criteria

- With 2 CRITICAL and 2 WARNING open, the first row is the CRITICAL with the nearest deadline, and
  the row prints that reason.
- Acknowledging the first row removes it and focuses the next within 100 ms, with no mouse input.
- A double press of `A` within 300 ms acknowledges exactly one incident (reuses `shouldAcceptAck`).
- A CRITICAL exposes no hold/snooze affordance and the logic refuses the action.
- With a fixed clock, re-rendering does not change the order; only an action or a new event does.
- An engine incident with a null `escalate_after_s` shows `termen necunoscut` and is not ranked above
  a CRITICAL that has a deadline.
- Every event that was in the feed is still reachable in `Flux`; the queue filters nothing silently.
- Unit tests pass (`npm run test:unit`), the build passes, and the e2e smoke ack path is green.

### 4.6 The honest limit, in the product's own words

> Coada ordonează atenția, nu decide. Ordinea e o regulă explicită — escaladat, severitate, termen,
> vechime — nu un model de risc. Lista completă rămâne la un click.

Put a shorter version of that in the tab's title attribute and in the run sheet. It costs one
sentence and it is the difference between a tool and a claim.

---

## 5. What a 60-second demo looks like after the top three

Same product, same pipeline, better story — and every new claim is either measured or labelled.

| Time | Action | Line |
|---|---|---|
| 0–10 s | Live, engine running, queue tab open | "Camerele devin o coadă de lucru, nu un zid de alerte." |
| 10–20 s | Countdown on row 1 drains | "Fiecare alertă are un termen; ordinea e o regulă pe care o poți citi." |
| 20–30 s | Press `A`, next row focuses | "Un operator lucrează din tastatură; ecranul nu se mișcă sub el." |
| 30–40 s | Fire a burst; three rows collapse into one episode | "Grupăm ce e aceeași poveste; nimic nu dispare din evidență." |
| 40–52 s | Open the incident, scrub the filmstrip | "Aceleași cadre procesate, înainte și după; fețele erau blurate înainte de desenare." |
| 52–60 s | Coverage ribbon, red gap visible | "Și spunem unde nu am văzut: 47 din 52 de minute acoperite." |

The old beats (real detection, blurred evidence, template report, local-only) stay; the queue,
grouping and coverage are additive and each answers a question the old demo left open: *who is
working this, what is one story, and were we watching?*

---

## 6. Sequencing against the existing roadmap

The three builds in `feature-gaps.md` §7 remain correct. This is how the operator features slot in
without reordering them:

| Phase | feature-gaps build | Operator features that become possible | Why here |
|---|---|---|---|
| Now (this week) | — | Queue (§2.1), episode grouping (§2.2), kiosk wall (§2.10), demo director (§2.12) | No dependency; improves the demo immediately |
| Build 1 | Durable session shell | Coverage receipt (§2.6), intervention log (§2.4) | Both need the session record and the engine provider |
| Build 1.5 | — | Handover brief (§2.5) needs identity too; build it with Build 3 | A brief without a signature is a summary |
| Build 2 | Camera onboarding | Filmstrip per camera (§2.3), dwell map (§2.8) | Multi-camera makes both worth the memory |
| Build 3 | Operator session + shift record | Handover signatures, FP → zone proposal (§2.7), evidence packet (§2.9) | Attribution and zone versions are prerequisites |
| After a pilot month | — | Drill mode (§2.11) with real scenarios | Training needs the queue and the handover to be real |

One ordering note: **do not** build the handover brief before the coverage receipt. A handover that
lists incidents but not blind spots teaches the next operator to trust a partial picture.

---

## 7. Not now / would be a gimmick

| Idea | Why not |
|---|---|
| **Fatigue, attention or emotion detection** | Explicitly excluded by the product's own privacy line (no emotion recognition), and unreliable even in good conditions. It would turn the strongest differentiator into the weakest claim. |
| **Face recognition or person re-identification across cameras** | Out of scope in `feature-gaps.md` §6 and in the fork's ethics. It also breaks the only promise that matters: nothing identifies a person. |
| **A predictive risk score ("87 % chance of an incident")** | No training data, no validation, no way to explain a number. A precise-looking score that nobody can audit is worse than a rule. |
| **Automatic dispatch, auto-ack or radio integration** | The human in the loop is the product's ethical core, and there is no server to send anything to. Auto-ack would also erase the one record that proves someone acted. |
| **LLM-written incident reports** | Out of scope, and pointless in this build: a template that says `șablon` is more honest than a model that invents a cause. An on-device LLM would add tens of MB for a worse, unverifiable paragraph. |
| **Always-on microphone / voice notes** | Apron noise makes it unusable, and an open mic in a control room is a privacy problem with no upside over structured notes (§2.4). |
| **Operator leaderboard / gamified ack speed** | Incentivises fast acknowledgement over correct triage, which is precisely the failure mode a safety record must not reward. |
| **Auto-rotating camera carousel on the wall** | Rotation hides the critical at the moment it matters. A wall display must be stable; use priority, not a slideshow (§2.10). |
| **3D digital twin of the apron** | Expensive, needs site geometry nobody will maintain, and adds nothing an operator can act on in a browser. Demo glitter. |
| **Thermal/IR camera simulation** | A fake sensor. If a site has a thermal feed, it is just another source (§4.1 of feature-gaps), not a feature. |
| **Blockchain-anchored audit** | A local hash chain already detects a deleted row (§4.5 of feature-gaps). A ledger adds cost, latency and a network dependency for no additional guarantee on one kiosk. |
| **Cloud sync or backup of incidents and evidence** | Contradicts "nothing leaves the tab", which is the product. Export a packet (§2.9) when something must leave. |
| **A chatbot over the incident list** | Invites confident wrong answers inside a safety record. If a question is worth asking, it deserves a computed answer with a visible source. |
| **Mood / wellbeing dashboard for operators** | Same problem as fatigue detection, with extra personal data. |
| **FOD detection, smoking expansion, crowd analytics** | Out of scope, not demonstrated, and each one would be a claim without footage. |
| **Native mobile app** | Out of scope; the browser is the distribution strategy. A PWA (§4.11 of feature-gaps) is the honest version. |
| **Multi-camera priority mosaic as a standalone feature** | The *policy* is cheap, but the plumbing (registry, adapters, scheduler) is the real work and is already §4.1. Building a mosaic over one real source and three clips would be a demo, not a product. Do it when Build 2 lands, with the scheduler's measured capacity. |

Two entries in the mission's list therefore get an explicit *yes, but later*: **multi-camera** is
owned by the gap doc and should not be duplicated as a UI feature now; **role-based views** are part
of the identity build (§4.5), and a role switch that only hides buttons would be security theatre.

---

## 8. Cross-check against `docs/product/feature-gaps.md`

Every idea here either sits on top of a gap-doc build or is deliberately absent from it. Nothing
below repeats a gap-doc recommendation as if it were new.

| This document | Closest gap-doc section | What the gap doc already owns | What is new here |
|---|---|---|---|
| §2.1 Triage queue | §4.6 (zone editor), §4.13 (a11y) only tangentially | Nothing about ranking, deadlines or operator flow | The comparator, the deadline, the hold policy, keyboard-first queue, stability rule |
| §2.2 Episode grouping | — (absent) | — | Alarm-flood grouping with per-event audit preserved |
| §2.3 Filmstrip | §4.6 replay ring buffer (for **zone testing**) | A short in-memory buffer to test a polygon | Incident-scoped evidence scrubbing with markers, honest "no frames" gaps, media-clock labelling |
| §2.4 Intervention log | §4.5 audit log (system actions) | Append-only audit of ack/zone/export | Operator-declared interventions as part of the incident story, not a system event |
| §2.5 Handover brief | §4.4 report accuracy, §4.5 identity | Report scoping, sign-off, audit | The diff ("what changed since my shift"), the two-sided signature, carried notes |
| §2.6 Coverage receipt | §4.4 coverage KPI, §4.9 diagnostics | A coverage number in the report | A visible ribbon during the shift and at handover; gap reasons as a first-class artifact |
| §2.7 FP → zone proposal | §4.6 zone versions, §4.8 privacy | Versioning and revert | FP clustering, a proposed polygon with a counterfactual, human acceptance |
| §2.8 Dwell map | §4.6 replay, §4.9 diagnostics | Replay for testing | Aggregated dwell/heat and hour×zone fingerprint, counts only, keyed by zone version |
| §2.9 Evidence packet | §4.3 export bundle, §4.15 build identity | JSON bundle, build metadata | Per-incident sealed packet with a self-contained verifier |
| §2.10 Kiosk wall | §4.10 mobile/tablet, §4.2 wake lock | Wake lock, layout for tablets | A wall-specific layout with priority, pin and no rotation |
| §2.11 Drill mode | §4.12 onboarding (a 30 s test) | A first-run test incident | A full labelled session with a boundary, a scorecard and a separate store |
| §2.12 Demo director | §4.12 demo/live separation | A demo/live switch and a `local` chip | A presenter panel that labels every injected event **on the record** |

Deliberately **not** proposed here, because the gap doc already covers them and repeating them
would dilute the list: camera registry and adapters (§4.1), notification/audio/wake-lock plumbing
(§4.2), IndexedDB persistence and retention (§4.3), shift-scoped report arithmetic and export
(§4.4), operator PIN/WebAuthn and audit chain (§4.5), live zone editing and versions without the FP
analytics (§4.6), model manifest and thresholds (§4.7), privacy panel and reference auto-blur
(§4.8), diagnostics drawer (§4.9), tablet layout (§4.10), PWA/offline (§4.11), onboarding wizard and
readiness checklist (§4.12), accessibility fixes (§4.13), i18n extraction (§4.14), build metadata
and release flow (§4.15).

One correction to the gap doc's framing, offered as a finding rather than a feature: the
false-positive toast currently says `Marcat ca Fals Pozitiv. Feedback înregistrat pentru modelul AI.`
(`context/useIncidentStore.js:136`). In this build no model learns anything from that action. It is
one string, but it is exactly the kind of claim §2.7 is designed to replace with something true.

---

## 9. Open questions for the human

1. **Is the queue the operator's primary surface, or does a dispatcher still want the raw feed
   first?** The answer decides whether the queue tab is default or opt-in.
2. **Who signs a handover** — the outgoing operator, the incoming one, or both? Two signatures are
   proposed; one may be enough.
3. **How long is a "hold" allowed to last** before it becomes a suppression? 15 minutes is a guess,
   not a policy.
4. **Does the pilot site want incident evidence to leave the kiosk at all?** If not, §2.9 is a
   feature for a different customer.
5. **Which false-positive reasons are worth storing** for §2.7 to be useful? The list proposed is a
   starting point from the fixtures, not from real apron data.
6. **Should the demo director ship in the public build at all**, or only in a presenter branch? The
   label makes it honest; the flag makes it safe. Both is best.

---

## Appendix A — reproducibility

```bash
cd frontend
ln -s ../../LocalSight/frontend/node_modules node_modules   # local convenience, not committed
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
# dist/ served under /LocalSight/ on 127.0.0.1:4348, SPA fallback, no-store
# Playwright Chromium (headless, no WebGPU) at 1440x900:
#   Live, Incidents, incident detail, Reports, Zones, Sistem & Audit
#   crossOriginIsolated === true after the COOP/COEP service-worker reload
```

Build observed: `index-*.js` 410.2 kB (123.5 kB gzip), `worker-*.js` 30.7 kB,
`ort-wasm-*.wasm` 28.7 MB, `index-*.css` 49.8 kB. No console errors on the clicked paths.

Files read for the claims above: `README.md`, `AGENTS.md`, `demo/run_sheet_browser.md`,
`docs/contract.md`, `docs/product/feature-gaps.md`, `docs/qa/ui-findings.md`,
`docs/architecture/review.md`,
`frontend/src/components/views/{LiveView,IncidentDetailView,ReportsView,ZoneEditorView}.jsx`,
`frontend/src/components/live/{IncidentFeed,IncidentFeedCard,MediaStage,LiveEngineCard}.jsx`,
`frontend/src/context/{useIncidentStore,useKpis,useOperator,useSimulation}.jsx`,
`frontend/src/utils/{eventFeed,incidentList,reportExport,systemView}.js`,
`frontend/src/constants/shiftReport.js`, `frontend/src/services/{api,shift}.js`.

Probe scripts and screenshots stayed in `/tmp/opencode/innovation-operator/`; none of them are part
of the deliverable. No application code, tests, configuration or other worktree was modified.
