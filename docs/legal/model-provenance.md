# Model provenance and licence dossier

**Status:** current; the detector swap is in `main` as of 2026-11-03 (EfficientDet-Lite0/Lite2 replace YOLO26n).
**Audit date:** 2026-11-03.
**Not legal advice.** This is an engineering dossier with sources attached: every claim names
the file, URL or hash it comes from, so counsel can verify it rather than trust it. We are not
lawyers and this document is not a legal opinion.

It is written in English on purpose: it is the version you hand to a buyer's counsel or to
your own lawyer. The rest of `docs/` is in Romanian. `THIRD_PARTY.md` is the audit of record
for *all* dependencies; this file covers the one artefact that is a derivative of someone
else's model, plus the gaps that a licence table cannot fix.

---

## 1. What ships

The product is a static build. `frontend/public/` is copied into `dist/` by Vite, so every
file listed here is served to every visitor and is a distribution of that artefact.

| File in `dist/` | Bytes | Role | Licence |
|---|---|---|---|
| `models/efficientdet_lite0.onnx` | 13 796 655 | person detector, 320×320 | Apache-2.0 (weights) + CC BY 3.0 (ONNX conversion) |
| `models/efficientdet_lite2.onnx` | 22 948 355 | person detector, 448×448 | Apache-2.0 (weights) + CC BY 3.0 (ONNX conversion) |
| `models/yunet.onnx` | 232 598 | face detector for the privacy blur | MIT (© 2020 Shiqi Yu) |
| `models/LICENSE-APACHE-2.0.txt` | — | full Apache-2.0 text | notice file |
| `models/LICENSE-CC-BY-3.0.txt` | — | full CC BY 3.0 legal code + attribution | notice file |
| `NOTICE` | — | visitor-facing summary, linked from the sidebar | notice file |
| `LICENSES.txt` | — | full runtime MIT/ISC/BSD/Apache notices, linked from `NOTICE` | notice file |
| `media/stand12.mp4`, `taxiway-b.mp4` | — | generated pan/zoom from the Unsplash apron still | Unsplash License |
| `media/baggage-area.mp4` | — | generated pan/zoom from the CC0 baggage still | CC0 |
| `media/stills/zone-*.jpg` | — | frames from the generated clips | project-generated from Unsplash/CC0 |

No AGPL-licensed artifact is part of this list. The Ultralytics YOLO26n graph that earlier
builds served is removed by the detector swap that this dossier accompanies — from the tree,
from the engine and from the notice. `origin/main` at `968200c` still carried it, so a build
of that commit still served AGPL weights; the history of the decision is in `THIRD_PARTY.md`
§ "Ultralytics YOLO — AGPL-3.0 (historical)".

**Versions are pinned by content, not by a tag.** The model files carry no version string we
control, so the identity of what ships is the SHA-256 of the file:

```
eb67a97b6dfd3d5d1a80011c72d55effb9d4b57e7f214836f6af0ac4a108b635  efficientdet_lite0.onnx
ae663a7cb537b6a5eca0f2c45d39b10563993d84aadcc52d19e0fb345442cde6  efficientdet_lite2.onnx
d1cd25851fba0e96d59f25548f072db7d114182c952605f509d14af502438dfb  yunet.onnx
```

The two EfficientDet hashes were recomputed on 2026-11-03 from the files published upstream
(size and SHA-256 both match the served files); the YuNet hash is the patched local file,
whose only difference from the opencv_zoo release is the rewritten input shape.

## 2. Provenance chain

```text
Google: EfficientDet-Lite0 / Lite2 weights and architecture
  EfficientDet: Tan, Pang, Le, CVPR 2020 (arXiv:1911.09070)
  "EfficientDet-lite checkpoints" released from github.com/google/automl
  TFLite models published by Google (MediaPipe / TF Hub distribution)
  Licence: Apache-2.0, Copyright 2020 Google LLC
        │
        │  TFLite → ONNX conversion by Namas Bhandari
        ▼
namas191297/efficientdetlite: onnx_models/efficientdet_lite{0,2}.onnx
  Licence: CC BY 3.0 (the repository's LICENSE is the CC BY 3.0 legal code)
        │
        │  byte-for-byte copy; only the filename and the serving path change
        ▼
LocalSight: frontend/public/models/efficientdet_lite{0,2}.onnx
  Distributed under both licences, with both attributions in NOTICE
```

Sources checked on 2026-11-03:

- `https://github.com/namas191297/efficientdetlite` — `LICENSE` (CC BY 3.0 legal code) and
  README § License ("This project is licensed under the Creative Commons Attribution 3.0").
- `https://github.com/namas191297/efficientdetlite/tree/main/onnx_models` — the `.onnx` files
  themselves; sizes 13 796 655 B and 22 948 355 B, matching what this repository serves.
- `https://www.apache.org/licenses/LICENSE-2.0.txt` — the Apache-2.0 text shipped in
  `frontend/public/models/LICENSE-APACHE-2.0.txt`.
- `https://creativecommons.org/licenses/by/3.0/legalcode` — the CC BY 3.0 text shipped in
  `frontend/public/models/LICENSE-CC-BY-3.0.txt`. The upstream repository ships the same
  legal code without the Creative Commons preamble.
- `https://github.com/google/automl` — the EfficientDet repository, Apache-2.0, which
  announces the EfficientDet-lite checkpoints.
- `https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector` — Google's
  description of EfficientDet-Lite0 (320×320, EfficientNet-Lite0 backbone, COCO) and Lite2
  (448×448, EfficientNet-Lite2 backbone, COCO).

### Why two licences, and what each one obliges

The `.onnx` file is not a Google artefact. Google authored the weights and the architecture;
the converter authored the file that is actually distributed, and chose CC BY 3.0 for it.
Both layers travel with the file:

| Layer | Licence | Obligation | Commercial use |
|---|---|---|---|
| Weights and architecture | Apache-2.0 | keep the copyright notice and the licence text; state changes if you modify | permitted |
| ONNX conversion | CC BY 3.0 | credit Namas Bhandari, link the licence, do not imply endorsement, indicate modifications if any | permitted |

We make no modifications, so there is nothing to indicate beyond the attribution itself.
Neither licence is copyleft in the AGPL sense: neither forces source disclosure of the
application, and neither reaches the React code, the tracker or the rest of the build.

### Attribution that must ship

Verbatim, in `frontend/public/NOTICE` (served as `dist/NOTICE`):

> Model and weights: EfficientDet-Lite0 (320x320) and EfficientDet-Lite2 (448x448), from
> Google. Copyright 2020 Google LLC. Licensed under the Apache License, Version 2.0.
>
> ONNX conversion: the ONNX export of those weights by Namas Bhandari,
> https://github.com/namas191297/efficientdetlite. (c) Namas Bhandari. Licensed under the
> Creative Commons Attribution 3.0 licence (CC BY 3.0).

### The one claim that rests on repository-level evidence

The Apache-2.0 layer is established from Google's upstream repositories and model
documentation (EfficientDet and MediaPipe are Apache-2.0 projects; the lite checkpoints are
released from `google/automl`), **not** from a per-file model card for the exact `.tflite`
build that was converted. If a buyer needs artefact-level proof, download the MediaPipe
`.tflite` release and archive its model card with the deal. We state this instead of
smoothing it over.

If a conversion with an Apache-only licence appears, the CC BY 3.0 layer disappears and this
section collapses to one licence. Until then, both attributions stay.

## 3. What the BSL covers, and what it does not

`LICENSE` at the repository root is **Business Source License 1.1**: Licensor Andrei
Șugubete, Additional Use Grant: None, Change Date 2030-11-02, Change License Apache-2.0.

- It covers **this repository's own code** — the React application, the engine, the tracker,
  the rules, the docs.
- It does **not** relicense third-party artefacts. The EfficientDet weights stay Apache-2.0,
  the ONNX conversion stays CC BY 3.0, YuNet stays MIT, whatever the BSL says.
- Therefore a commercial licence sold under the BSL grants rights in BSL code only. It is not
  a sublicense of the model files, and it does not need to be: those licences already permit
  commercial use, with attribution as the only condition.
- The reverse also holds: permissive third-party licences do not loosen the BSL. A customer
  who buys nothing may still not use this code in production before the Change Date.
- BSL 1.1 requires the licence to be conspicuously displayed on every copy. Keep `LICENSE` at
  the root and keep it in the artifact's documentation.

### 3.1 Upstream code and contributor rights — unresolved

The upstream repository (`DaVecTORzzz/craiova-hack-2026`, public) had **no LICENSE** at the
audited commit. This fork adds BSL 1.1 with Licensor Andrei Șugubete. On 2026-11-03 the
current tree's 535 teammate code lines were replaced by a project-author rewrite;
`scripts/provenance.py` now reports **0 lines from other authors**. The code-copyright gap in
the current tree is therefore addressed. This is not a clean-room legal opinion and does not
automatically transfer the upstream docs/design; the README still credits Andrei, Max, Dalina
and Ariana.

For commercial licensing, confirm in writing that the docs/design and the upstream project are
covered, or rewrite them. A starting template is in
[`contributor-assignment-template.md`](contributor-assignment-template.md); a lawyer should
adapt it. This remains a **blocking** item for the docs/design and upstream credit, independent
of the model licence.

### 3.2 Runtime libraries and notices — resolved

The served JavaScript/WASM bundle contains permissive runtime libraries. The production tree
has no GPL/AGPL/LGPL dependency (audited from `frontend/package-lock.json`):

| Family | Packages | Licence |
|---|---|---|
| UI | react, react-dom, scheduler | MIT |
| Icons | lucide-react | ISC |
| Inference | onnxruntime-web, onnxruntime-common | MIT |
| Serialization | protobufjs, @protobufjs/* | BSD-3-Clause |
| Helpers | flatbuffers, long | Apache-2.0 |
| Small helpers | platform, js-tokens, loose-envify, undici-types, @types/node | MIT |
| Other | guid-typescript | ISC |

The full copyright lines and licence texts ship in `frontend/public/LICENSES.txt`
(`dist/LICENSES.txt`), linked from `NOTICE`; the build guard checks the file. The COOP/COEP
service-worker pattern is inspired by gzuidhof/coi-serviceworker (MIT, Copyright (c) 2021
Guido Zuidhof); the implementation is ours and the MIT notice ships in `LICENSES.txt`.
Build-time-only packages (Vite, Tailwind, PostCSS, Playwright, caniuse-lite) are not in the
served artifact; their versions and licences are in `THIRD_PARTY.md`.

The current demo clips are generated from the Unsplash/CC0 stills and are distributed under
the still licences/project authorship; the old unresolved clips are no longer in the current
tree. The old clips remain in history and are not covered by the BSL or the model licences.

## 4. Demo footage: current clips generated from licensed stills

The current `stand12.mp4` and `taxiway-b.mp4` are pan/zoom derivatives of the Unsplash
`apron-stand.jpg`; `baggage-area.mp4` is a pan/zoom derivative of the CC0 `baggage-hall.jpg`.
The `zone-*.jpg` stills are frames from those generated clips. The Unsplash licence permits
modification and commercial use without attribution; CC0 has no restrictions. There is no
third-party airport video with unknown provenance in the current tree or build.

The **old** 4K clips and the web cuts derived from them were removed from the current tree and
build; they remain in git history and in the shared Drive. Do not reuse them without recording
source, licence, camera operator and consent. A new repository without the old history removes
those blobs. See §5.

### Footage checklist for any future clip

- [ ] **Source** — who owns the camera / the recording; the airport or operator name.
- [ ] **Licence or permission** — written, with the scope; "they said it was fine" is not a licence.
- [ ] **Camera operator** — the person who filmed it, named.
- [ ] **Date and location** — clip date; apron / terminal area.
- [ ] **Consent for identifiable people** — written consent from volunteers; blur is a
      mitigation, not a consent substitute.
- [ ] **Third-party content in frame** — airline livery, logos, plates, screens.
- [ ] **Derived files** — web cuts, zone stills, screenshots, GIF and social preview.
- [ ] **Re-check the export by hand** — no unblurred face.

## 5. The gap model licensing does not close either: git history

Deleting `frontend/public/models/yolo26n.onnx` from the current tree stops the build from
serving it. It does **not** remove the blob from the history of a public repository: the
object is still fetchable by commit, and forks and caches may hold copies. A repository that
once distributed AGPL weights is not the same thing as a repository that never did.

The current build being AGPL-free is **necessary but not sufficient** for a fully clean public
repository. Three options, and they are not equivalent:

1. **New repository with filtered history — recommended.** Clone the repo as a mirror,
   `git filter-repo` to remove the AGPL blob and the old clip blobs, and
   push the filtered history into a **new, empty** repository. Nothing is force-pushed, no
   cached object survives, authorship and most history are preserved, but every commit hash
   changes. Archive the old repository with a pointer to the new one. The AGPL and old-clip
   questions end here; the current generated clips are already clean (see §4).
2. **New repository from the current tree.** Publish only the current tree with no imported
   history. Simplest operationally; contribution history does not travel — keep a
   `docs/provenance.md` snapshot and the old URL.
3. **History rewrite in place.** `git filter-repo` or BFG to drop the blob from every commit,
   then a force-push of **all** refs and tags, then a request to GitHub Support to
   garbage-collect unreachable objects (forks and caches can outlive the rewrite). This
   rewrites commit hashes, breaks every clone, link and review thread, and needs explicit
   owner approval: `AGENTS.md` forbids a force push without it.

**No history rewrite and no force push has been performed for this change, and an agent must
not perform one.** Which option to take is a business decision; that it must be decided is
not.

Note that a fresh repository keeps whatever is copied into it. The current generated clips
are clean; the old clips must not be copied back in. Rights are fixed by §4, not by changing
which repository serves the files.

## 6. Commercial release checklist

Model licensing is done; the remaining work is footage and paperwork.

- [ ] **No AGPL model in the artifact.** `dist/models/` must not contain `yolo26n.onnx`, and
      no code path may load a YOLO/Ultralytics graph. Do not reintroduce YOLO weights,
      including fine-tuned exports — the licence follows the weights.
- [ ] **Model and runtime notices present in `dist/`.** `NOTICE`, `LICENSES.txt`,
      `models/LICENSE-APACHE-2.0.txt`, `models/LICENSE-CC-BY-3.0.txt`. The sidebar
      "Licențe" link opens `NOTICE`; `NOTICE` links the runtime texts. The build guard
      checks all four files and rejects a `yolo26n.onnx` in `dist/models/`.
- [ ] **Attribution intact.** The Apache-2.0 line (Google, 2020) and the CC BY 3.0 line
      (Namas Bhandari, licence URL) both survive any copy edit of `NOTICE`.
- [ ] **Model files unmodified, hashes match.** If they are re-exported or re-quantised, the
      licence analysis must be redone — a modified graph is a modified work, and CC BY 3.0
      then requires an indication of the change.
- [ ] **Current clips are the generated Unsplash/CC0 derivatives**; the old unresolved clips
      are not copied back in. A new repository removes the old history (§5).
- [ ] **BSL intact.** `LICENSE` at the root, same Licensor / Additional Use Grant / Change
      Date / Change License, conspicuously displayed on every copy.
- [ ] **Contributor rights settled for docs/design.** The code was rewritten (0 teammate
      lines); the docs/design and upstream credit remain. Get written assignments/CLAs or
      rewrite them; the BSL file alone is not proof. See §3.1.
- [ ] **History decision taken per §5**, and written down where a buyer can see it.
- [ ] **Legal review.** Hand this file, `THIRD_PARTY.md` and the two licence text files to a
      lawyer; they are written to be checked, not believed.

## 7. What is real, what is unresolved

| Item | State |
|---|---|
| Person detector licence | **Resolved** — Apache-2.0 weights, CC BY 3.0 conversion, both attributed |
| Runtime JS/WASM notices | **Resolved** — permissive; full texts in `LICENSES.txt`; no GPL/AGPL |
| Code contributor rights | **Resolved in the current tree** — 535 teammate lines rewritten on 2026-11-03; provenance 0; docs/design still credited (§3.1) |
| Face detector licence | **Resolved** — YuNet, MIT |
| Runtime and build tooling | **Resolved** — MIT / ISC / Apache-2.0, notices shipped |
| AGPL in the current build | **Resolved** — no AGPL model ships; the detector swap removes it from tree, engine and notice |
| AGPL blob in git history | **Unresolved** — needs a fresh repository or an approved rewrite (§5) |
| Current demo clips | **Resolved** — generated from Unsplash/CC0 stills; no unknown footage in the current tree (§4) |
| Old demo clips in git history | **Unresolved history** — removed from the current tree; a new repository without the old history removes them (§5) |
| Per-file model card for the converted `.tflite` | **Not verified** — repository-level Apache-2.0 evidence only (§2) |
| Legal review | **Not done** — this document is not legal advice |
