# Third-party licences

An audit of what this fork actually depends on, written for someone who intends to
**sell** or **host** LocalSight (formerly SafeSight). It answers one question per line: *may I
ship this, and what does it cost me?*

Audit date: **2026-11-02** · browser-only fork, as merged into `main` · not legal advice —
read the two sections marked **copyleft** with a lawyer before you sign a customer contract.

> **Scope change.** This fork ships one artefact: the static build in `frontend/`. The
> SafeSight reference stack (`backend/`, `ml/`, `automation/`, `docker-compose.yml`) was
> removed; its Python and container audit is kept below as a marked historical section. What
> still needs a decision is the model weight that the static build serves and the provenance
> of the demo footage.

## Bottom line

1. **The YOLO26n weights are AGPL-3.0 and they ship.** `frontend/public/models/yolo26n.onnx`
   is committed and served to every browser that opens the demo; the detector architecture
   and the weights both come from Ultralytics. Shipping or hosting them as-is means either
   open-sourcing the whole thing under AGPL-3.0 or buying an Ultralytics Enterprise License.
   The repository's BSL 1.1 does not change that.
2. **The demo clips have no recorded provenance.** `data/videos/README.md` still says
   `de completat` for source, licence, camera operator on all six clips. Unresolved.
3. Everything else — the React frontend, ONNX Runtime Web, the Vite/Tailwind build tooling,
   the YuNet face model — is permissive (MIT / BSD / Apache-2.0 / ISC) and ships fine with
   the usual notice file.

## How the versions and licences were established

- **Versions** are read from lockfiles, never from the semver ranges: today only
  `frontend/package-lock.json` (lockfileVersion 3).
- **Licences** are read from the `license` fields in `package-lock.json`, from the upstream
  `LICENSE` file of each project, or from the installed wheel metadata at the locked version
  for the removed Python stack.
- `transformers` was **not** a dependency of this repository: it appeared in neither
  `ml/pyproject.toml` nor `ml/uv.lock`. If it shows up on a slide, it is wrong.

Legend for *commercial impact*: **OK** = permissive, ship with notices · **requires action** =
needs a notice, an EULA check or a legal read, but does not force you to open-source · **copyleft**
= forces source disclosure or a commercial licence.

## Main table — what this fork ships today

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
| **Model weights** | | | |
| YuNet `yunet.onnx` | 2023mar | MIT (© 2020 Shiqi Yu) | OK — include the MIT notice when you redistribute the `.onnx` |
| YOLO26n weights (`yolo26n.onnx`) | 26n | AGPL-3.0 | **copyleft** — see the AGPL section |
| **Assets** | | | |
| `docs/assets/*.png` (3 UI screenshots) | — | project-produced | OK — re-check that no unblurred face or third-party footage is visible |
| `frontend/public/media/*.mp4` (3 web cuts) | — | derived from the clips above | **requires action** — same unresolved question as their sources |
| `frontend/public/media/stills/apron-stand.jpg` | — | Unsplash License | OK — no attribution required; credit Unsplash in the demo |
| `frontend/public/media/stills/taxiway-heathrow.jpg` | — | CC BY-SA 2.0, © Derek Harper (Geograph) | **attribution required**; the file stays CC BY-SA, the code is unaffected |
| `frontend/public/media/stills/baggage-hall.jpg` | — | CC0 (djedj, Pixabay) | OK |
| `frontend/public/media/stills/zone-stand12.jpg` | — | derived from the demo clips | **requires action** — same unresolved provenance as `stand12.mp4`; no licence claimed |
| `frontend/public/media/stills/zone-taxiway-b.jpg` | — | derived from the demo clips | **requires action** — same unresolved provenance as `taxiway-b.mp4`; no licence claimed |
| `frontend/public/media/stills/zone-baggage-area.jpg` | — | derived from the demo clips | **requires action** — same unresolved provenance as `baggage-area.mp4`; no licence claimed |

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
sidebar footer. It carries the Ultralytics AGPL-3.0 notice, the YuNet MIT notice and a
pointer to this file; it is a summary, not a substitute for the audit below.

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

None of those packages ship now, so none of their notices are needed for this artefact. Two
things survive the removal and are listed above: the **YOLO26n weights** (still AGPL-3.0,
still distributed) and the **YuNet weights** (still MIT, still distributed). If you restore
the Python stack from git history, that audit applies again — in particular the OpenCV/FFmpeg
and CUDA notice obligations.

## Ultralytics YOLO — AGPL-3.0

This is the only licence here that can sink a sale, so it gets its own section.

**What it covers**

- The model architecture, training pipeline and exported inference code.
- The weights. Ultralytics states all Ultralytics YOLO trained models, pretrained or
  fine-tuned, fall under AGPL-3.0, and so do the `.pt`, `.onnx` and ncnn exports.
- The tracker: the removed `ml/safesight_ml/ncnn_detector.py` imported
  `ultralytics.trackers.byte_tracker.BYTETracker` and `ultralytics.engine.results.Boxes`.
  The browser engine in `frontend/src/engine/tracker.js` is a separate implementation, so the
  tracker itself is not an AGPL import any more — but the weights it consumes still are.

**Where it sits in this repo**

- `frontend/public/models/yolo26n.onnx` is tracked on purpose: GitHub Pages cannot regenerate
  it at build time, so the file is committed and served from `dist/models/`. Every visitor
  downloads AGPL-licensed weights.
- The AGPL trigger is not limited to distributing binaries. AGPL-3.0 §13 covers **network
  use**: if you host this as a service, users interacting with it over a network are entitled
  to the corresponding source of the whole derivative work. A static demo is still a
  distribution of the weights to each visitor.

**Why the BSL does not help**

`LICENSE` is Business Source License 1.1 (Licensor: Andrei Șugubete; Additional Use Grant: None;
Change Date: 2030-11-02; Change License: Apache-2.0). The BSL governs *this repository's own
code* — it cannot relicense third-party weights that the repository embeds. A commercial
licence sold under the BSL therefore grants nothing with respect to Ultralytics: either the
buyer also holds an Ultralytics Enterprise Licence, or the combined work must be released
under AGPL-3.0 (source included, including model weights). The two licences stack; they do not
cancel.

**Ultralytics' own position** (their licensing page, checked 2026-11-02): an Enterprise Licence is
required for "any commercial product or service", "proprietary / closed-source software",
"SaaS platforms, APIs, or cloud systems that use YOLO behind the scenes", "embedded deployments
in hardware, edge devices, robotics, cameras", and "using custom-trained or fine-tuned YOLO
models in a proprietary or commercial setting". Compliant AGPL use means publicly releasing the
complete corresponding source of the entire derivative work.

## Model weights

**YuNet — MIT.** `frontend/public/models/yunet.onnx` is the opencv_zoo
`face_detection_yunet_2023mar.onnx` model with the declared input rewritten to a dynamic
shape (see `frontend/scripts/prepare-models.py`). The opencv_zoo repository as a whole is
Apache-2.0, but each model directory carries its own licence, and
`models/face_detection_yunet/LICENSE` is **MIT, Copyright (c) 2020 Shiqi Yu**. So: the
face-blur model is fine commercially; keep the MIT notice with the file. The `int8bq`
variant named in the removed Python error hint is the same licence, and is not used.

**YOLO26n — AGPL-3.0.** `yolo26n.onnx` is a 640 px ONNX export of the Ultralytics weights.
Per Ultralytics' FAQ, "all Ultralytics YOLO trained models fall under the AGPL-3.0 License by
default. The AGPL-3.0 License covers the training code and the models produced by that
training code." Exporting to ONNX or ncnn does not change the licence of the weights.
Fine-tuning on your own footage does not change it either.

## Assets

**The demo clips are an open item.** `data/videos/README.md` lists six clips, and every row still
reads `de completat` under *Sursă*, *Licență* and *Cine a filmat*. The files are not in git
(`*.mp4` is ignored), so this repository cannot vouch for them at all. The three web cuts in
`frontend/public/media/` **are** committed (a targeted `.gitignore` exception) and are served
by the static build, so they are distributed even when the 4K sources are not. Before any
public demo, sale or hosted deployment:

- fill in source, licence, camera operator and date for each clip;
- obtain written consent from any volunteer visible in the footage (`data/videos/README.md`
  already requires this);
- confirm the airport/operator consented to the apron footage being shown publicly;
- blur faces before publication — which the pipeline does, but re-check the exported cuts by hand.

`data/reference_frames/` has the same gap: the README says provenance belongs "in the video
README or here", and it is in neither. The `docs/assets/*.png` screenshots are project-produced,
but they contain frames of that footage — treat them as covered by the same unresolved question.

Two smaller asset notes: the clip `2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4`
has a double dot in its name that the README already flags, and the PPE clip promised in the
READMEs does not exist. Neither is a licence problem; both will embarrass you in a due-diligence
folder.

## What to do before selling

1. **Decide the Ultralytics question first** — it sets the shape of the deal.
   - Buy an **Ultralytics Enterprise License** covering the project scope and keep serving
     `yolo26n.onnx`; or
   - **Replace the weights** with a non-AGPL family (for example YOLOX or RT-DETR, both
     Apache-2.0) and re-export to ONNX. Retraining alone is not a replacement: weights produced
     by Ultralytics code stay AGPL. This is real work — budget it as a task, not a config change.
2. **Resolve the clips.** Fill the provenance table in `data/videos/README.md`, or replace the
   six clips with footage you own. Do the same for `data/reference_frames/` and the web cuts in
   `frontend/public/media/`.
3. **Keep the BSL in place and intact.** `LICENSE` must stay at the repo root, with the same
   parameters (Licensor, Additional Use Grant: None, Change Date 2030-11-02, Change License
   Apache-2.0) and conspicuously displayed on every copy — BSL 1.1 requires it. If you sell
   commercial licences, that is the Licensor's right to grant, and it covers only BSL-licensed
   code, not the AGPL weights.
4. **Ship a third-party notices file** with any distribution: MIT/BSD/Apache texts for the
   frontend stack (including ONNX Runtime Web), MIT for YuNet, the AGPL-3.0 text or an
   Ultralytics Enterprise Licence for the YOLO weights, and the CC BY-SA attribution for the
   Heathrow still.
5. **If you only host it**, remember AGPL §13 still applies to the YOLO weights — hosting is
   not a way around it.

## Ambiguities we did not paper over

- The audit table follows the versions resolved by `frontend/package-lock.json`, not the
  ranges in `package.json` or prose elsewhere.
- `caniuse-lite` is CC-BY-4.0 and is a build-time dependency: it does not end up in `dist/`,
  but its attribution travels with the lockfile and any `node_modules` you redistribute.
- The removed Python appendix (union of `backend/uv.lock` and `ml/uv.lock`) is intentionally
  not reproduced here; it lives in git history with those lockfiles.
