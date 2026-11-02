# Third-party licences

An audit of what this fork actually depends on, written for someone who intends to
**sell** or **host** LocalSight (formerly SafeSight). It answers one question per line: *may I
ship this, and what does it cost me?*

Audit date: **2026-11-03** · browser-only fork · **not legal advice** — we are not lawyers.
Every claim below names the file, URL or hash it comes from so that counsel can check it
instead of trusting us.

> **Scope change.** This fork ships one artefact: the static build in `frontend/`. The
> SafeSight reference stack (`backend/`, `ml/`, `automation/`, `docker-compose.yml`) was
> removed; its Python and container audit is kept below as a marked historical section.
> The detector swap covered by this revision replaces the AGPL model with Apache-2.0
> weights; what still needs a decision is the provenance of the demo footage.

## Bottom line

1. **No AGPL model ships.** The person detector is an ONNX export of Google's
   **EfficientDet-Lite0 / Lite2**. The **weights and model are Apache-2.0** (Copyright 2020
   Google LLC); the **ONNX conversion is a separate work under CC BY 3.0** (Namas Bhandari).
   Apache-2.0 and CC BY 3.0 both allow commercial use; both require attribution, and this
   repository ships it. Nothing in the shipped bundle is copyleft.
2. **YOLO26n is removed by the detector swap.** The current tree and build delete
   `frontend/public/models/yolo26n.onnx`; a build of an older commit still served AGPL
   weights. The Ultralytics section below is kept as **history**, not as current state. The
   blob stays reachable in the public git history — a separate, real gap; see
   [Remaining gaps](#remaining-gaps).
3. **The demo clips and the stills re-encoded from them still have no recorded provenance.**
   `data/videos/README.md` still says `de completat` for source, licence and camera operator
   on all six clips. No licence is claimed for them, they are not part of the BSL-licensed
   work, and they are **not cleared** for commercial redistribution.
4. Everything else — the React frontend, ONNX Runtime Web, the Vite/Tailwind build tooling,
   the YuNet face model — is permissive (MIT / BSD / Apache-2.0 / ISC). The runtime notices
   ship in `frontend/public/LICENSES.txt` (served as `dist/LICENSES.txt`), linked from
   `NOTICE`, and the build guard refuses a bundle without it.
5. **The upstream repository had no LICENSE, and this fork asserts BSL 1.1 with a single
   Licensor.** The provenance report still shows 535 lines from other contributors. Public
   visibility is not a licence; before commercial licensing, obtain written assignments/CLAs
   from the contributors or replace their code. This is a separate, blocking gap; see
   [Remaining gaps](#remaining-gaps).

## How versions and licences were established

- **Versions** are read from lockfiles, never from the semver ranges: today only
  `frontend/package-lock.json` (lockfileVersion 3).
- **Licences** are read from the `license` fields in `package-lock.json`, from the upstream
  `LICENSE` file of each project, or from the installed wheel metadata at the locked version
  for the removed Python stack.
- **Model licences** are read from the upstream `LICENSE` files, not from blog posts:
  `https://github.com/namas191297/efficientdetlite/blob/main/LICENSE` (Creative Commons
  Attribution 3.0), `https://www.apache.org/licenses/LICENSE-2.0.txt` (Apache-2.0, the
  licence of Google's EfficientDet release), `models/face_detection_yunet/LICENSE` in
  opencv_zoo (MIT).
- **Model files** were verified by downloading the upstream `.onnx` files on 2026-11-03 and
  hashing them locally; the sizes and SHA-256 values below are the result of that check, not
  a copy of someone's README.
- `transformers` was **not** a dependency of this repository: it appeared in neither
  `ml/pyproject.toml` nor `ml/uv.lock`. If it shows up on a slide, it is wrong.

Legend for *commercial impact*: **OK** = permissive, ship with notices · **requires action** =
needs a notice, an EULA check or a legal read, but does not force you to open-source ·
**copyleft** = forces source disclosure or a commercial licence (none of these ship now).

## Main table — what this fork ships

The two EfficientDet rows describe the current build; the detector swap removed
`yolo26n.onnx` from the tree and the engine.

| Component | Version | License (SPDX) | Commercial impact |
|---|---|---|---|
| **Application** | | | |
| LocalSight / SafeSight (this repo) | — | BSL-1.1 | **requires action** — production use needs a commercial licence from the Licensor; converts to Apache-2.0 on 2030-11-02 |
| **Frontend (`frontend/package.json`)** | | | |
| `react` / `react-dom` | 18.3.1 / 18.3.1 | MIT | OK |
| `lucide-react` | 0.344.0 | ISC | OK |
| `onnxruntime-web` | 1.31.1 | MIT | OK — its WASM/WebGPU artifacts are shipped in `dist/`, keep the notice |
| `vite` | 5.4.21 | MIT | OK — build-time only |
| `@vitejs/plugin-react` | 4.7.0 | MIT | OK — build-time only |
| `tailwindcss` | 3.4.19 | MIT | OK — build-time only |
| `postcss` / `autoprefixer` | 8.5.32 / 10.6.2 | MIT | OK — build-time only |
| `@playwright/test` | 1.64.1 | Apache-2.0 | OK — test-time only |
| `caniuse-lite` | 1.0.30001820 | CC-BY-4.0 | OK — attribution required; build-time only, not in `dist/` |
| **Model weights and graphs** | | | |
| EfficientDet-Lite0 `efficientdet_lite0.onnx` | 320×320 ONNX export · 13 796 655 B (13,2 MiB) · SHA-256 `eb67a97b6dfd3d5d1a80011c72d55effb9d4b57e7f214836f6af0ac4a108b635` | Apache-2.0 (weights, © 2020 Google LLC) **+** CC BY 3.0 (ONNX conversion, © Namas Bhandari) | OK — **attribution required** for both layers; texts in `frontend/public/models/LICENSE-APACHE-2.0.txt` and `LICENSE-CC-BY-3.0.txt` |
| EfficientDet-Lite2 `efficientdet_lite2.onnx` | 448×448 ONNX export · 22 948 355 B (21,9 MiB) · SHA-256 `ae663a7cb537b6a5eca0f2c45d39b10563993d84aadcc52d19e0fb345442cde6` | Apache-2.0 (weights, © 2020 Google LLC) **+** CC BY 3.0 (ONNX conversion, © Namas Bhandari) | OK — same two notices |
| YuNet `yunet.onnx` | 2023mar · 232 598 B · SHA-256 `d1cd25851fba0e96d59f25548f072db7d114182c952605f509d14af502438dfb` | MIT (© 2020 Shiqi Yu) | OK — include the MIT notice when you redistribute the `.onnx` |
| **Assets** | | | |
| `docs/assets/*.png` (5 UI screenshots, including the model selector) | — | project-produced | OK — re-check that no unblurred face is visible; they contain frames of the demo footage, so the footage question applies |
| `frontend/public/media/*.mp4` (3 web cuts) | — | derived from the clips above | **requires action** — unresolved provenance, same question as their sources |
| `frontend/public/media/stills/apron-stand.jpg` | — | Unsplash License | OK — no attribution required; credit Unsplash in the demo |
| `frontend/public/media/stills/taxiway-heathrow.jpg` | — | CC BY-SA 2.0, © Derek Harper (Geograph) | **attribution required**; the file stays CC BY-SA, the code is unaffected |
| `frontend/public/media/stills/baggage-hall.jpg` | — | CC0 (djedj, Pixabay) | OK |
| `frontend/public/media/stills/zone-*.jpg` (3) | — | derived from the demo clips | **requires action** — same unresolved provenance as `stand12.mp4`, `taxiway-b.mp4`, `baggage-area.mp4`; no licence claimed |

The served runtime notices are in `frontend/public/LICENSES.txt` (`dist/LICENSES.txt`):
MIT for React/ReactDOM/scheduler, ONNX Runtime Web/Common, platform, js-tokens, loose-envify,
undici-types and @types/node; ISC for lucide-react and guid-typescript; BSD-3-Clause for
protobufjs and the @protobufjs/* packages; Apache-2.0 for flatbuffers and long. The
COOP/COEP service-worker pattern is inspired by gzuidhof/coi-serviceworker (MIT,
Copyright (c) 2021 Guido Zuidhof); the implementation is ours and the MIT notice ships there.

Not in the table because they are not model weights: `frontend/public/models/README.md`,
`LICENSE-APACHE-2.0.txt` and `LICENSE-CC-BY-3.0.txt` are documentation/notice files served
by the static build, not licensed assets.

The three `zone-*.jpg` files are re-encoded frames of the committed web cuts, used by
the zone editor as reference backgrounds (`frontend/src/data/media.js`). They are not
separate licensed assets: fixing the clip provenance above fixes them too.

### Source material not in git

These files are referenced by the project but are not tracked, so they are not part of the
shipped artifact:

| Path | License | Impact |
|---|---|---|
| `data/videos/*.mp4` (6 demo clips, in the shared Drive) | unknown — **not stated anywhere** | **requires action** — unresolved before any public or commercial release |
| `data/reference_frames/*.jpeg` (2 frames, in the shared Drive) | unknown | **requires action** — same provenance gap |

The static build ships `frontend/public/NOTICE` as `dist/NOTICE`, linked from the
sidebar footer. It carries the Apache-2.0/CC BY 3.0 model notices, the YuNet MIT notice and
a pointer to this file; it is a summary, not a substitute for the audit below.

## Model provenance

The detector is the only artefact here that is a derivative of someone else's model, so the
chain is written out in full. Nothing in this chain is copyleft.

```text
Google EfficientDet-Lite0 / Lite2            Apache-2.0   © 2020 Google LLC
  (EfficientDet paper: Tan, Pang, Le, CVPR 2020;
   "EfficientDet-lite checkpoints", google/automl)
        │  TFLite export published by Google (MediaPipe / TF Hub distribution)
        ▼
Namas Bhandari, onnx_models/*.onnx           CC BY 3.0    © Namas Bhandari
  (github.com/namas191297/efficientdetlite — the ONNX conversion itself)
        │  byte-for-byte copy, only the filename changes
        ▼
frontend/public/models/efficientdet_lite{0,2}.onnx   Apache-2.0 + CC BY 3.0
```

| Layer | What it is | Licence | Source | Verification |
|---|---|---|---|---|
| Weights and architecture | EfficientDet-Lite0 (320×320, EfficientNet-Lite0 backbone) and Lite2 (448×448, Lite2 backbone), 80 COCO classes | Apache-2.0 | `https://github.com/google/automl` (§ "EfficientDet-lite checkpoints"), model documentation at `https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector` | Apache-2.0 text in the repository `LICENSE`; see the caveat below |
| ONNX conversion | The `.onnx` graph we ship, exported from the TFLite model | CC BY 3.0 | `https://github.com/namas191297/efficientdetlite` — `LICENSE` at the repo root, README § License | `LICENSE` fetched 2026-11-03; it is the CC BY 3.0 legal code |
| Shipped files | `efficientdet_lite0.onnx`, `efficientdet_lite2.onnx` | both of the above | this repository | size and SHA-256 recomputed from the upstream files on 2026-11-03 |

**The two layers are cumulative.** The ONNX file is not a Google artefact: converting a model
changes who authored the file you distribute, and the converter chose CC BY 3.0. CC BY 3.0
allows commercial use, modification and redistribution; it requires attribution to the author
and a link to the licence, and that you do not imply endorsement. So the shipped `.onnx`
carries **Apache-2.0 (weights) + CC BY 3.0 (conversion)** — both attributed in
`frontend/public/NOTICE`.

**Caveat on the Apache-2.0 layer.** We verified the licence at the level of Google's
upstream repositories and model documentation (EfficientDet and MediaPipe are Apache-2.0
projects, and the EfficientDet-lite checkpoints are released from `google/automl`), not by
opening a per-file model card for the exact `.tflite` build that was converted. If a buyer
needs that artefact-level proof, download the MediaPipe `.tflite` release and archive its
model card with the deal. This is the one licence claim in this file that rests on
repository-level rather than file-level evidence, and it is stated here rather than smoothed
over.

**If a cleaner conversion appears** — an Apache-only ONNX export of the same weights — the
CC BY 3.0 layer disappears and this section shrinks to one licence. Until then, both
attributions stay.

## Removed from this fork — Python and container stack (historical)

`backend/`, `ml/`, `automation/`, `docker-compose.yml`, `run.sh`, `run.cmd` and
`scripts/dev.py` were deleted from this fork; nothing in the static app executes them. For
the record, the audit they carried (lockfiles `backend/uv.lock` and `ml/uv.lock`, images
`python:3.12-slim` and `bluenviron/mediamtx:latest`) found:

- Backend: `fastapi`, `uvicorn`, `sqlmodel`, `pydantic`, `pydantic-settings`, `pillow`
  (MIT-CMU), `httpx`, `python-multipart`, `tzdata` — all permissive.
- Edge: `numpy` (permissive conjunction), `opencv-python-headless` (Apache-2.0 wheel that
  bundles FFmpeg under LGPL-2.1), `onnx`, `onnxruntime`, `ultralytics` + `lap` + `ncnn`.
- `ultralytics` (8.4.194, AGPL-3.0) pulled `ultralytics-thop`, `ultralytics-platform` and
  `torch` (~1 GB), which in turn pulled NVIDIA CUDA wheels under the NVIDIA EULA.
- Containers: `python:3.12-slim` (PSF-2.0 plus Debian userland) and
  `bluenviron/mediamtx:latest` (MIT, unpinned).

None of those packages ship now, so none of their notices are needed for this artefact. What
survives the removal is the **YuNet weights** (MIT, still distributed) and, until the
detector swap, the **YOLO26n weights** — which this change removes; see the historical
section. If you restore the Python stack from git history, that audit applies again — in
particular the OpenCV/FFmpeg and CUDA notice obligations.

## Ultralytics YOLO — AGPL-3.0 (historical, removed from the shipped artifact)

This section is kept because the model was in this repository for months and because
prospects ask about it. **It does not describe the build after the detector swap.** The AGPL
weights are no longer copied into `frontend/public/models/` and no longer referenced by the
engine: `origin/main` at commit `968200c` still carried `yolo26n.onnx` and loaded it, and the
code change that switches to EfficientDet removes it from the tree. The notice no longer
names Ultralytics.

**What it covered while it was here**

- The model architecture, training pipeline and exported inference code.
- The weights. Ultralytics states all Ultralytics YOLO trained models, pretrained or
  fine-tuned, fall under AGPL-3.0, and so do the `.pt`, `.onnx` and ncnn exports.
- The tracker: the removed `ml/safesight_ml/ncnn_detector.py` imported
  `ultralytics.trackers.byte_tracker.BYTETracker` and `ultralytics.engine.results.Boxes`.
  The browser tracker in `frontend/src/engine/tracker.js` was always a separate
  implementation, so the tracker itself was never an AGPL import — but the weights it
  consumed were.

**Why it had to go**

- The trigger is not limited to distributing binaries. AGPL-3.0 §13 covers **network use**:
  hosting the app as a service entitles users interacting with it over a network to the
  corresponding source of the whole derivative work. A static demo is still a distribution
  of the weights to each visitor.
- `LICENSE` is Business Source License 1.1 (Licensor: Andrei Șugubete; Additional Use Grant:
  None; Change Date: 2030-11-02; Change License: Apache-2.0). The BSL governs *this
  repository's own code* and cannot relicense third-party weights embedded in it. The two
  licences stacked; they did not cancel. Buyers of a BSL commercial licence received
  nothing with respect to Ultralytics.
- Ultralytics' own licensing page (checked 2026-11-02) requires an Enterprise Licence for
  "any commercial product or service", "proprietary / closed-source software", "SaaS
  platforms, APIs, or cloud systems that use YOLO behind the scenes", "embedded deployments
  in hardware, edge devices, robotics, cameras", and "custom-trained or fine-tuned YOLO
  models in a proprietary or commercial setting". Compliant AGPL use means publicly
  releasing the complete corresponding source of the entire derivative work.

**What replaced it, and why that is a real replacement.** EfficientDet-Lite0/Lite2 is not a
re-export of Ultralytics code: different architecture, different training code, different
weights, different licence chain (`Google → TFLite → ONNX`). Retraining a YOLO model would
**not** have been a replacement — weights produced by Ultralytics code stay AGPL. The
measured cost of the swap is in `docs/browser-engine.md` §4 and §6.

**What is left of it.** The `.onnx` blob is still in the git history of this public
repository. Removing it from the working tree did not remove it from the object store; see
[Remaining gaps](#remaining-gaps).

## Model weights

**EfficientDet-Lite0 / Lite2 — Apache-2.0 weights, CC BY 3.0 conversion.** Two ONNX graphs
serve the person detector: Lite0 at 320×320 for speed, Lite2 at 448×448 for reach on small
figures. Both take `uint8 NHWC [1, H, W, 3]` RGB, both return 25 detections (normalized
`[ymin, xmin, ymax, xmax]`, class ids, scores, count), both use COCO class 0 for person. The
license basis and the attribution text are in [Model provenance](#model-provenance); the
runtime contract is in `frontend/public/models/README.md`. Commercial use is permitted; the
obligation is attribution, not source disclosure.

**YuNet — MIT.** `frontend/public/models/yunet.onnx` is the opencv_zoo
`face_detection_yunet_2023mar.onnx` model with the declared input rewritten to a dynamic
shape (see `frontend/scripts/prepare-models.py`). The opencv_zoo repository as a whole is
Apache-2.0, but each model directory carries its own licence, and
`models/face_detection_yunet/LICENSE` is **MIT, Copyright (c) 2020 Shiqi Yu**. So: the
face-blur model is fine commercially; keep the MIT notice with the file. The `int8bq`
variant named in the removed Python error hint is the same licence, and is not used.

## Assets

**The demo clips are an open item and the single biggest hole in this audit.**
`data/videos/README.md` lists six clips, and every row still reads `de completat` under
*Sursă*, *Licență* and *Cine a filmat*. The files are not in git (`*.mp4` is ignored), so
this repository cannot vouch for them at all. The three web cuts in
`frontend/public/media/` **are** committed (a targeted `.gitignore` exception) and are served
by the static build, so they are distributed even when the 4K sources are not. Before any
public demo, sale or hosted deployment:

- fill in source, licence, camera operator and date for each clip;
- obtain written consent from any volunteer visible in the footage (`data/videos/README.md`
  already requires this);
- confirm the airport/operator consented to the apron footage being shown publicly;
- blur faces before publication — which the pipeline does, but re-check the exported cuts by
  hand.

`data/reference_frames/` has the same gap: the README says provenance belongs "in the video
README or here", and it is in neither. The `docs/assets/*.png` screenshots are project-produced,
but they contain frames of that footage — treat them as covered by the same unresolved question.

Two smaller asset notes: the clip `2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4`
has a double dot in its name that the README already flags, and the PPE clip promised in the
READMEs does not exist. Neither is a licence problem; both will embarrass you in a due-diligence
folder.

## Remaining gaps

Ordered by how much they cost to fix, not by how loud they are.

### 1. Demo footage provenance — unresolved, blocking for commercial redistribution

Six clips, three committed web cuts, three stills derived from them, plus two reference
frames and the UI screenshots that show them. No source, no licence, no camera operator, no
written consent on file. See the checklist in [Assets](#assets). **Not cleared**, and this
document does not clear them.

### 2. The AGPL blob is still in git history — necessary but not sufficient

Deleting `frontend/public/models/yolo26n.onnx` from the current tree stops the build from
serving it, but the object is still in the history of a **public** repository: anyone can
fetch the blob by commit. A public repo that once contained AGPL weights — even a repo whose
current build is AGPL-free — is not the same thing as a clean distribution. Three ways out:

1. **New repository with filtered history (recommended).** Clone the repo as a mirror,
   `git filter-repo` to remove the AGPL blob (and the clips if they are being replaced), and
   push the filtered history into a **new, empty** repository. Nothing is force-pushed, no
   cached object survives, authorship and most history are preserved, but every commit hash
   changes. The old repository is archived with a pointer to the new one.
2. **New repository from the current tree.** Publish only the current tree with no imported
   history. Simplest and cleanest operationally; the contribution history
   (`scripts/provenance.py` output) does not travel, so keep a `docs/provenance.md` snapshot
   and the old repo's URL.
3. **History rewrite in place.** `git filter-repo` or BFG to drop the blob from every commit,
   then a force-push of **all** refs and tags, then a request to GitHub Support to
   garbage-collect unreachable objects (forks and caches can outlive the rewrite). This
   breaks every existing clone and link, and `AGENTS.md` forbids a force push without
   explicit owner approval. **Not performed, and not to be performed by an agent.**

Which one is right is a business call, not a technical one. What is not a call: the current
build being AGPL-free is necessary but not sufficient for a clean public repository.

### 3. The clips in history have the same problem

A history rewrite would remove the AGPL blob; it would **not** remove the committed demo
clips, and it would not create rights that were never obtained. Even a fresh repository keeps
whatever is copied into it. Do not treat "fresh repo" as a way to launder the footage
question: rights are fixed by replacing the clips or documenting them, not by changing which
repository serves them.

### 4. Upstream code and contributor rights — unresolved, blocking for commercial licensing

The upstream repository (`DaVecTORzzz/craiova-hack-2026`, public) had **no LICENSE** at the
audited commit. This fork adds BSL 1.1 with Licensor Andrei Șugubete. The provenance report
shows **535 lines** from other contributors; the README credits Andrei, Max, Dalina and
Ariana. Public visibility does not grant reuse or relicensing rights. A BSL commercial licence
granted by one Licensor cannot bind code owned by other authors without their consent.

Action: obtain a written CLA/assignment (or an explicit licence) from every contributor, or
replace their code and document the replacement. Keep the evidence with the commercial
paperwork. Do not treat the BSL file as proof that the contributor rights are settled.

### 5. Claims we could not substantiate

- **Per-file model card for the exact `.tflite`** behind the ONNX conversion — see the caveat
  in [Model provenance](#model-provenance).
- **The footage** — everything about it.
- **The `docs/assets/*.png` screenshots** — project-produced, but they depict that footage.
- **Contributor assignments.** We did not see written CLAs from the other authors.
- **Anything about the buyer's jurisdiction.** CC BY 3.0 and Apache-2.0 are the licences read
  off the upstream files; moral rights, database rights and contractual restrictions in a
  specific country were not assessed.

## What to do before selling

1. **Model licensing is done.** EfficientDet-Lite0/Lite2 ships under Apache-2.0 weights with a
   CC BY 3.0 conversion. Keep `frontend/public/models/LICENSE-APACHE-2.0.txt` and
   `LICENSE-CC-BY-3.0.txt` next to the weights, and keep both attribution lines in
   `frontend/public/NOTICE`. Do not reintroduce YOLO/AGPL weights, including "just for a
   demo" and including fine-tuned exports — the licence follows the weights.
2. **Resolve the clips — this is now the blocking item.** Fill the provenance table in
   `data/videos/README.md`, or replace the six clips (and the web cuts, the three derived
   stills, the two reference frames and the screenshots that show them) with footage you own
   or have licensed in writing. Until then, say "demo footage, provenance not recorded" out
   loud and do not ship it to a customer.
3. **Keep the BSL in place and intact.** `LICENSE` must stay at the repo root, with the same
   parameters (Licensor, Additional Use Grant: None, Change Date 2030-11-02, Change License
   Apache-2.0) and conspicuously displayed on every copy — BSL 1.1 requires it. A commercial
   licence sold under the BSL covers BSL code only; it is not a sublicense of Apache-2.0 or
   CC BY 3.0 material, which need no sublicense because they are already permissive.
4. **Ship the notices with every distribution.** `dist/NOTICE` must contain: the
   EfficientDet-Lite Apache-2.0 attribution, the Namas Bhandari CC BY 3.0 attribution with
   the licence URL, the YuNet MIT notice, the ONNX Runtime Web MIT notice, and the CC BY-SA
   attribution for the Heathrow still. `dist/LICENSES.txt` must carry the runtime
   MIT/ISC/BSD/Apache notices. If you reuse the model files outside this repository, carry
   the two licence texts with them. The build guard checks both files.
5. **Decide the history question** (new repo with filtered history vs new repo from the
   current tree vs in-place rewrite) before calling a repository "clean". See
   [Remaining gaps](#remaining-gaps) §2.
6. **Settle contributor rights.** Get written assignments/CLAs from every contributor or
   replace their lines; the BSL file alone does not prove it. See
   [Remaining gaps](#remaining-gaps) §4.
7. **Get a lawyer to read this file.** It is an engineering audit with sources attached, not
   a legal opinion.

## Ambiguities we did not paper over

- The audit table follows the versions resolved by `frontend/package-lock.json`, not the
  ranges in `package.json` or prose elsewhere.
- `caniuse-lite` is CC-BY-4.0 and is a build-time dependency: it does not end up in `dist/`,
  but its attribution travels with the lockfile and any `node_modules` you redistribute.
- The removed Python appendix (union of `backend/uv.lock` and `ml/uv.lock`) is intentionally
  not reproduced here; it lives in git history with those lockfiles.
- CC BY 3.0 is a "some rights reserved" licence, not public domain: attribution and a licence
  link are conditions of the grant, not courtesies. The licence text shipped in
  `frontend/public/models/LICENSE-CC-BY-3.0.txt` is the canonical legal code; the upstream
  repository's `LICENSE` is the same text without the Creative Commons preamble.
