# Third-party licences

An audit of what this repository actually depends on, written for someone who intends to
**sell** or **host** LocalSight (formerly SafeSight). It answers one question per line: *may I
ship this, and what does it cost me?*

Audit date: **2026-11-02** · branch `prep/third-party` · not legal advice — read the two
sections marked **copyleft** with a lawyer before you sign a customer contract.

## Bottom line

1. **`ultralytics` is AGPL-3.0 and it is on the critical path.** Every real detection path in
   `ml/` imports it, including the ncnn backend (it reuses Ultralytics' ByteTrack). Shipping or
   hosting this product as-is means either open-sourcing the whole thing under AGPL-3.0 or
   buying an Ultralytics Enterprise License. The repository's BSL 1.1 does not change that.
2. **The demo clips have no recorded provenance.** `data/videos/README.md` still says
   `de completat` for source, licence, camera operator on all six clips. Unresolved.
3. Everything else — the FastAPI backend, the React frontend, NumPy/ONNX Runtime/OpenCV,
   Pillow, the YuNet face model — is permissive (MIT / BSD / Apache-2.0 / ISC) and ships fine
   with the usual notice file. Two smaller loose ends: the Linux OpenCV wheel bundles an
   LGPL-2.1 FFmpeg, and the CUDA wheels are NVIDIA-proprietary.

## How the versions and licences were established

- **Versions** are read from the lockfiles, never from the semver ranges:
  `backend/uv.lock`, `ml/uv.lock` (uv locks include optional extras, so the `yolo` and `ncnn`
  extras are resolved), and `frontend/package-lock.json` (lockfileVersion 3).
- **Licences** are read from the installed wheel metadata (`License-Expression`, falling back to
  `License` and the `Classifier: License ::` fields) at exactly those locked versions, from
  `license` fields in `package-lock.json`, or from the upstream `LICENSE` file for model weights.
- `transformers` is **not** a dependency of this repository: it appears in neither
  `ml/pyproject.toml` nor `ml/uv.lock`. If it shows up on a slide, it is wrong.

Legend for *commercial impact*: **OK** = permissive, ship with notices · **requires action** =
needs a notice, an EULA check or a legal read, but does not force you to open-source · **copyleft**
= forces source disclosure or a commercial licence.

## Main table

| Component | Version | License (SPDX) | Commercial impact |
|---|---|---|---|
| **Application** | | | |
| LocalSight / SafeSight (this repo) | — | BSL-1.1 | **requires action** — production use needs a commercial licence from the Licensor; converts to Apache-2.0 on 2030-11-02 |
| **Backend (direct deps, `backend/pyproject.toml`)** | | | |
| `fastapi` | 0.162.0 | MIT | OK |
| `uvicorn` | 0.54.0 | BSD-3-Clause | OK |
| `sqlmodel` | 0.0.48 | MIT | OK |
| `pydantic` / `pydantic-core` | 2.14.2 / 2.50.2 | MIT | OK |
| `pydantic-settings` | 2.16.2 | MIT | OK |
| `pillow` | 13.0.0 | MIT-CMU | OK — MIT-CMU, not MIT: reproduce the CMU/PIL permission notice |
| `httpx` | 0.28.1 | BSD-3-Clause | OK |
| `python-multipart` | 0.0.32 | Apache-2.0 | OK |
| `tzdata` | 2026.6 | Apache-2.0 | OK |
| **Edge / ML (direct deps, `ml/pyproject.toml`)** | | | |
| `numpy` | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | OK |
| `opencv-python-headless` | 5.0.0.93 | Apache-2.0 | **requires action** — the wheel also bundles FFmpeg (LGPL-2.1): ship its notice and a source offer, or build OpenCV yourself |
| `onnx` | 1.23.2 | Apache-2.0 | OK |
| `onnxruntime` | 1.31.1 | MIT | OK |
| `pydantic` | 2.14.2 | MIT | OK |
| `httpx` | 0.28.1 | BSD-3-Clause | OK |
| `ultralytics` (extra `yolo`) | 8.4.194 | AGPL-3.0 | **copyleft** — see the AGPL section |
| `lap` (extra `yolo`) | 0.5.13 | BSD-2-Clause | OK |
| `ncnn` (extra `ncnn`) | 1.0.20261020 | BSD-3-Clause | OK |
| **Pulled in by the `yolo` extra (transitive, but material)** | | | |
| `ultralytics-thop` | 2.2.3 | AGPL-3.0 | **copyleft** |
| `ultralytics-platform` | 0.1.102 | AGPL-3.0-only | **copyleft** |
| `torch` | 2.15.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND ISC AND MIT AND Zlib | OK |
| `torchvision` | 0.29.2 | BSD-3-Clause | OK |
| `triton` | 3.9.0 | MIT | OK |
| `nvidia-*` (cublas, cudnn, nccl, cupti, …) | see appendix | LicenseRef-NVIDIA-Proprietary (NVIDIA CUDA EULA) | **requires action** — redistributing these binaries is only allowed under NVIDIA's EULA: keep their licence text and do not strip notices |
| `polars` | 2.1.0 | MIT | OK |
| `matplotlib` | 3.11.2 | PSF-based custom licence (no SPDX expression in metadata) | OK — BSD-compatible, but ambiguous: reproduce `matplotlib`'s own licence text rather than an SPDX id |
| `certifi` | 2026.10.23 | MPL-2.0 | OK — file-level copyleft only: keep it unmodified and ship its notice |
| `tqdm` | 4.70.1 | MPL-2.0 AND MIT | OK — same MPL caveat |
| **Frontend (`frontend/package.json`)** | | | |
| `react` / `react-dom` | 18.3.1 / 18.3.1 | MIT | OK |
| `lucide-react` | 0.344.0 | ISC | OK |
| `vite` | 5.4.21 | MIT | OK — build-time only |
| `@vitejs/plugin-react` | 4.7.0 | MIT | OK — build-time only |
| `tailwindcss` | 3.4.19 | MIT | OK — build-time only |
| `postcss` / `autoprefixer` | 8.5.32 / 10.6.2 | MIT | OK — build-time only |
| `caniuse-lite` | 1.0.30001820 | CC-BY-4.0 | OK — attribution required; build-time only, not in `dist/` |
| **Model weights** | | | |
| YuNet `face_detection_yunet_2023mar.onnx` | 2023mar | MIT (© 2020 Shiqi Yu) | OK — include the MIT notice when you redistribute the `.onnx` |
| YOLO26n weights (`yolo26n.pt`, `yolo26n.onnx`, `yolo26n_ncnn_model/`) | 26n | AGPL-3.0 | **copyleft** — same trigger as `ultralytics` |
| **Container images (`docker-compose.yml`, `backend/Dockerfile`)** | | | |
| `python:3.12-slim` | floating tag | PSF-2.0 plus Debian userland (mixed: GPL/LGPL binaries) | OK — obligations come from Debian's own notices, not from this repo |
| `bluenviron/mediamtx` | `:latest` (unpinned) | MIT | OK — but `:latest` makes the audit unreproducible; pin a tag |
| **Assets** | | | |
| `data/videos/*.mp4` (6 demo clips) | — | unknown — **not stated anywhere** | **requires action** — unresolved before any public or commercial release |
| `data/reference_frames/*.jpeg` (2 frames) | — | unknown | **requires action** — same provenance gap |
| `docs/assets/*.webp` (2 UI screenshots) | — | project-produced | OK — re-check that no unblurred face or third-party footage is visible |

## Ultralytics YOLO — AGPL-3.0

This is the only licence here that can sink a sale, so it gets its own section.

**What it covers**

- The Python package `ultralytics` (8.4.194) and the two Ultralytics sub-packages uv pulls with
  it, `ultralytics-thop` (2.2.3) and `ultralytics-platform` (0.1.102).
- The model architecture, training pipeline and exported inference code in that package.
- The tracker: `ml/safesight_ml/ncnn_detector.py` imports `ultralytics.trackers.byte_tracker.BYTETracker`
  and `ultralytics.engine.results.Boxes`, so even the "we only run an ONNX graph with ncnn" path
  is AGPL-covered. The ncnn backend is **not** an escape hatch.
- The weights: Ultralytics states all Ultralytics YOLO trained models, pretrained or fine-tuned,
  fall under AGPL-3.0, and so do the `.pt`, `.onnx` and ncnn exports.

**Where it sits in this repo**

- `ml/pyproject.toml` declares it as an optional extra (`yolo = ["ultralytics", "lap"]`), but
  every demo path enables that extra: `ml/safesight_ml/detector.py` imports `from ultralytics import YOLO`
  and the demo scripts sync it. `--skip-yolo` / the mock event path avoid it, but that is not the
  product.
- The AGPL trigger is not limited to distributing binaries. AGPL-3.0 §13 covers **network use**:
  if you host this as a service, users interacting with it over a network are entitled to the
  corresponding source of the whole derivative work.

**Why the BSL does not help**

`LICENSE` is Business Source License 1.1 (Licensor: Andrei Șugubete; Additional Use Grant: None;
Change Date: 2030-11-02; Change License: Apache-2.0). The BSL governs *this repository's own
code* — it cannot relicense third-party code that the repository embeds. A commercial licence
sold under the BSL therefore grants nothing with respect to Ultralytics: either the buyer also
holds an Ultralytics Enterprise Licence, or the combined work must be released under AGPL-3.0
(source included, including model weights). The two licences stack; they do not cancel.

**Ultralytics' own position** (their licensing page, checked 2026-11-02): an Enterprise Licence is
required for "any commercial product or service", "proprietary / closed-source software",
"SaaS platforms, APIs, or cloud systems that use YOLO behind the scenes", "embedded deployments
in hardware, edge devices, robotics, cameras", and "using custom-trained or fine-tuned YOLO
models in a proprietary or commercial setting". Compliant AGPL use means publicly releasing the
complete corresponding source of the entire derivative work.

## Model weights

**YuNet — MIT.** `ml/models/face_detection_yunet_2023mar.onnx` is not tracked in git
(`models/` and `*.onnx` are in `.gitignore`); `scripts/dev.py` downloads it from
`https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`.
The opencv_zoo repository as a whole is Apache-2.0, but each model directory carries its own
licence, and `models/face_detection_yunet/LICENSE` is **MIT, Copyright (c) 2020 Shiqi Yu**.
So: the face-blur model is fine commercially; keep the MIT notice with the file. Note the
`int8bq` variant named in `ml/safesight_ml/privacy.py`'s error hint is the same licence, and is
not used.

**YOLO26n — AGPL-3.0.** `yolo26n.pt` is not tracked either; Ultralytics downloads it on first
use, and the ncnn export (`yolo26n_ncnn_model/`) is gitignored. Per Ultralytics' FAQ, "all
Ultralytics YOLO trained models fall under the AGPL-3.0 License by default. The AGPL-3.0 License
covers the training code and the models produced by that training code." Exporting to ONNX or
ncnn does not change the licence of the weights. Fine-tuning on your own footage does not change
it either.

## Assets

**The demo clips are an open item.** `data/videos/README.md` lists six clips, and every row still
reads `de completat` under *Sursă*, *Licență* and *Cine a filmat*. The files are not in git
(`*.mp4` is ignored), so this repository cannot vouch for them at all. Before any public demo,
sale or hosted deployment:

- fill in source, licence, camera operator and date for each clip;
- obtain written consent from any volunteer visible in the footage (`data/videos/README.md`
  already requires this);
- confirm the airport/operator consented to the apron footage being shown publicly;
- blur faces before publication — which the pipeline does, but re-check the exported cuts by hand.

`data/reference_frames/` has the same gap: the README says provenance belongs "in the video
README or here", and it is in neither. `docs/assets/demo-app.webp` and `demo-apron.webp` are
project-produced screenshots, but they contain frames of that footage — treat them as covered by
the same unresolved question.

Two smaller asset notes: the clip `2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4`
has a double dot in its name that the README already flags, and the PPE clip promised in the
READMEs does not exist. Neither is a licence problem; both will embarrass you in a due-diligence
folder.

## What to do before selling

1. **Decide the Ultralytics question first** — it sets the shape of the deal.
   - Buy an **Ultralytics Enterprise License** covering the project scope and keep
     `ultralytics` in the stack; or
   - **Replace the detector** with a non-AGPL family (for example YOLOX or RT-DETR, both
     Apache-2.0) *and* replace the tracker, since ByteTrack is imported from `ultralytics` in
     `ncnn_detector.py`. Retraining alone is not a replacement: weights produced by Ultralytics
     code stay AGPL. This is real work — budget it as a task, not a config change.
2. **Resolve the clips.** Fill the provenance table in `data/videos/README.md`, or replace the
   six clips with footage you own. Do the same for `data/reference_frames/`.
3. **Keep the BSL in place and intact.** `LICENSE` must stay at the repo root, with the same
   parameters (Licensor, Additional Use Grant: None, Change Date 2030-11-02, Change License
   Apache-2.0) and conspicuously displayed on every copy — BSL 1.1 requires it. If you sell
   commercial licences, that is the Licensor's right to grant, and it covers only BSL-licensed
   code, not the AGPL dependency.
4. **Ship a third-party notices file** with any distribution: MIT/BSD/Apache texts for the
   backend and frontend stack, MIT-CMU for Pillow, MIT for YuNet, the LGPL-2.1 FFmpeg notice and
   written source offer for the OpenCV wheel, and the NVIDIA CUDA EULA text for any CUDA wheels
   you redistribute.
5. **If you only host it**, remember AGPL §13 still applies to the Ultralytics part — hosting is
   not a way around it.
6. **Pin what floats.** `bluenviron/mediamtx:latest` and `python:3.12-slim` both move; a buyer
   will ask what exactly they are getting, and today the answer changes weekly.

## Ambiguities we did not paper over

- `colorama` 0.4.6: the wheel metadata in this lockfile carries no `License` field. Its project
  classifiers and source headers say BSD-3-Clause, so it is listed as such, but this is a
  classifier-level claim, not an SPDX expression from the artefact.
- `matplotlib` 3.11.2: ships a custom PSF-derived licence with no SPDX expression in metadata.
  BSD-compatible in practice; reproduce its licence text.
- `cuda-toolkit` 13.2.2 is a metapackage with no licence field of its own; its components are the
  `nvidia-*` wheels, which are NVIDIA-proprietary.
- The OpenCV wheel's licence field says only Apache-2.0, but the built wheel ships FFmpeg
  binaries under LGPL-2.1. Treat the wheel — not the metadata — as the thing you distribute.
- `numpy`'s expression is a conjunction of five permissive licences; all are compatible, none
  are copyleft.
- `README.md` badges say React 19, while `frontend/package.json` and the lockfile resolve
  React 18.3.1. A version-accuracy problem, not a licence problem — but the audit table follows
  the lockfile.

## Appendix — every resolved package and its licence

Union of `backend/uv.lock` and `ml/uv.lock` (optional extras included), deduplicated. The two
first-party packages (`safesight-backend`, `safesight-ml`, both 0.1.0) are omitted: they are
covered by `LICENSE`.

| Package | Version | License |
|---|---|---|
| `annotated-doc` | 0.0.5 | MIT |
| `annotated-types` | 0.8.0 | MIT |
| `anyio` | 4.15.1 | MIT |
| `certifi` | 2026.10.23 | MPL-2.0 |
| `charset-normalizer` | 3.5.2 | MIT |
| `click` | 8.5.0 | BSD-3-Clause |
| `colorama` | 0.4.6 | BSD-3-Clause |
| `contourpy` | 1.4.0 | BSD-3-Clause |
| `cuda-bindings` | 13.4.4 | Apache-2.0 |
| `cuda-pathfinder` | 1.8.5 | Apache-2.0 |
| `cuda-toolkit` | 13.2.2 | NVIDIA proprietary |
| `cycler` | 0.12.1 | BSD-3-Clause |
| `fastapi` | 0.162.0 | MIT |
| `filelock` | 4.2.5 | MIT |
| `flatbuffers` | 25.12.19 | Apache-2.0 |
| `fonttools` | 4.68.0 | MIT |
| `fsspec` | 2026.9.0 | BSD-3-Clause |
| `h11` | 0.16.0 | MIT |
| `httpcore` | 1.0.9 | BSD-3-Clause |
| `httptools` | 0.9.0 | MIT |
| `httpx` | 0.28.1 | BSD-3-Clause |
| `idna` | 3.20 | BSD-3-Clause |
| `iniconfig` | 2.3.1 | MIT |
| `jinja2` | 3.1.6 | BSD-3-Clause |
| `kiwisolver` | 1.5.1 | BSD-3-Clause |
| `lap` | 0.5.13 | BSD-2-Clause |
| `markupsafe` | 3.0.4 | BSD-3-Clause |
| `matplotlib` | 3.11.2 | PSF-based custom licence (no SPDX expression) |
| `ml-dtypes` | 0.6.0 | Apache-2.0 |
| `mpmath` | 1.3.0 | BSD-3-Clause |
| `ncnn` | 1.0.20261020 | BSD-3-Clause |
| `networkx` | 3.7 | BSD-3-Clause |
| `numpy` | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| `nvidia-cublas` | 13.4.1.3 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cuda-cccl` | 13.3.4.3.1 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cuda-cupti` | 13.2.86 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cuda-nvrtc` | 13.2.86 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cuda-runtime` | 13.2.86 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cudnn-cu13` | 9.26.0.51 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cufft` | 12.2.0.57 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cufile` | 1.17.1.22 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cusolver` | 12.2.0.11 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cusparse` | 12.7.10.12 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-cusparselt-cu13` | 0.8.1 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-ml-py` | 13.615.71 | BSD-3-Clause |
| `nvidia-nccl-cu13` | 2.30.7 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-nvjitlink` | 13.4.92 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-nvshmem-cu13` | 3.7.2 | LicenseRef-NVIDIA-Proprietary |
| `nvidia-nvtx` | 13.2.86 | LicenseRef-NVIDIA-Proprietary |
| `onnx` | 1.23.2 | Apache-2.0 |
| `onnxruntime` | 1.31.1 | MIT |
| `opencv-python` | 5.0.0.93 | Apache-2.0 |
| `opencv-python-headless` | 5.0.0.93 | Apache-2.0 |
| `opentelemetry-api` | 1.45.2 | Apache-2.0 |
| `packaging` | 26.3 | Apache-2.0 OR BSD-2-Clause |
| `pillow` | 13.0.0 | MIT-CMU |
| `pluggy` | 1.7.0 | MIT |
| `polars` | 2.1.0 | MIT |
| `polars-runtime-32` | 2.1.0 | MIT |
| `portalocker` | 4.4.2 | BSD-3-Clause |
| `protobuf` | 7.36.2 | BSD-3-Clause |
| `psutil` | 7.2.2 | BSD-3-Clause |
| `pydantic` | 2.14.2 | MIT |
| `pydantic-core` | 2.50.2 | MIT |
| `pydantic-settings` | 2.16.2 | MIT |
| `pygments` | 2.21.0 | BSD-2-Clause |
| `pyparsing` | 3.3.3 | MIT |
| `pytest` | 9.2.0 | MIT |
| `python-dateutil` | 3.0.0 | Apache-2.0 OR BSD-3-Clause |
| `python-dotenv` | 1.2.4 | BSD-3-Clause |
| `python-multipart` | 0.0.32 | Apache-2.0 |
| `pyyaml` | 6.0.3 | MIT |
| `requests` | 2.34.2 | Apache-2.0 |
| `setuptools` | 84.2.1 | MIT |
| `six` | 1.17.0 | MIT |
| `sqlalchemy` | 2.1.6 | MIT |
| `sqlmodel` | 0.0.48 | MIT |
| `starlette` | 1.10.0 | BSD-3-Clause |
| `sympy` | 1.14.0 | BSD-3-Clause |
| `torch` | 2.15.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND ISC AND MIT AND Zlib |
| `torchvision` | 0.29.2 | BSD-3-Clause |
| `tqdm` | 4.70.1 | MPL-2.0 AND MIT |
| `triton` | 3.9.0 | MIT |
| `typing-extensions` | 4.16.0 | PSF-2.0 |
| `typing-inspection` | 0.4.4 | MIT |
| `tzdata` | 2026.6 | Apache-2.0 |
| `ultralytics` | 8.4.194 | AGPL-3.0 |
| `ultralytics-platform` | 0.1.102 | AGPL-3.0-only |
| `ultralytics-thop` | 2.2.3 | AGPL-3.0 |
| `urllib3` | 2.8.0 | MIT |
| `uvicorn` | 0.54.0 | BSD-3-Clause |
| `uvloop` | 0.23.0 | MIT |
| `watchfiles` | 1.3.0 | MIT |
| `websockets` | 17.4 | BSD-3-Clause |

Frontend (`frontend/package-lock.json`, 178 packages total): 162 MIT, 11 ISC, 3 Apache-2.0,
1 BSD-3-Clause, 1 CC-BY-4.0 (`caniuse-lite`). No copyleft in the frontend tree.
