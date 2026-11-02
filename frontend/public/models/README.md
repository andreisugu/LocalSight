# Modele ONNX pentru build-ul static

Grafurile pe care frontend-ul le încarcă în pagină cu ONNX Runtime Web. Sunt servite ca
fișiere statice: `Vite` copiază `public/` în `dist/`, deci în cod se ajunge la ele prin
`` `${import.meta.env.BASE_URL}models/<nume>.onnx` `` (base-ul nu e mereu `/`, vezi
`vite.config.js`).

**Niciun model AGPL nu face parte din build.** Detectorul de persoane e EfficientDet-Lite0
sau Lite2 — greutăți Apache-2.0 (Google), conversie ONNX CC BY 3.0 (Namas Bhandari) — iar
garda de privacy e YuNet, MIT. Detaliile legale și lanțul complet de proveniență:
[`docs/legal/model-provenance.md`](../../../docs/legal/model-provenance.md) și
[`THIRD_PARTY.md`](../../../THIRD_PARTY.md).

| Fișier | Mărime | Rol | Input | Output |
| --- | --- | --- | --- | --- |
| `efficientdet_lite0.onnx` | 13 796 655 B (13,2 MiB) | detectorul de persoane, varianta rapidă | `uint8 [1, 320, 320, 3]` (NHWC, RGB) | 25 detecții |
| `efficientdet_lite2.onnx` | 22 948 355 B (21,9 MiB) | detectorul de persoane, varianta pentru oameni mici în cadru | `uint8 [1, 448, 448, 3]` (NHWC, RGB) | 25 detecții |
| `yunet.onnx` | 232 598 B (0,2 MiB) | garda de privacy: blur pe fețe înainte de orice afișare | `[1, 3, "height", "width"]` | 12 tensori (3 stride-uri) |

SHA-256 (verificat pe 2026-11-03, față de fișierele upstream):

```
eb67a97b6dfd3d5d1a80011c72d55effb9d4b57e7f214836f6af0ac4a108b635  efficientdet_lite0.onnx
ae663a7cb537b6a5eca0f2c45d39b10563993d84aadcc52d19e0fb345442cde6  efficientdet_lite2.onnx
d1cd25851fba0e96d59f25548f072db7d114182c952605f509d14af502438dfb  yunet.onnx
```

## `efficientdet_lite0.onnx` și `efficientdet_lite2.onnx`

Copia exactă a exporturilor ONNX publicate de Namas Bhandari
([`namas191297/efficientdetlite`](https://github.com/namas191297/efficientdetlite),
`onnx_models/`). Nu se modifică nimic în graf: browserul rulează aceleași greutăți ca
fișierul upstream, iar potrivirea se face pe mărime și SHA-256, nu pe încredere.

Sursa greutăților e Google: EfficientDet-Lite0 (backbone EfficientNet-Lite0, 320×320) și
Lite2 (EfficientNet-Lite2, 448×448), antrenate pe COCO (80 de clase, clasa 0 = persoană).
Exportul TFLite e publicat de Google (MediaPipe / TF Hub), conversia în ONNX e a lui Namas
Bhandari.

**Contract de rulare** (ce face codul din `frontend/src/engine/`):

- intrare `uint8` NHWC `[1, H, W, 3]`, RGB 0..255, fără normalizare; cadrul se pune
  letterbox pătrat, cu umplutură **neagră** (nu gri 114 ca la YOLO);
- ieșiri: `boxes [1, 25, 4]` normalizate `[ymin, xmin, ymax, xmax]`, `classes [1, 25]`,
  `scores [1, 25]`, `count [1]`. Exportul le numește `StatefulPartitionedCall:3` (boxes),
  `:2` (classes), `:1` (scores); decodorul le potrivește după nume, apoi după ordinea din
  graf, apoi după tip (întreg = clasă, fracționar = scor), ca o redenumire să nu strice
  nimic;
- se păstrează doar clasa 0 (persoană) peste prag, apoi NMS; cutiile se readuc din
  letterbox în pixeli ai cadrului sursă.

Aplicația încarcă **un singur** graf, în funcție de setarea detectorului; ambele fișiere stau
în `dist/models/`, dar browserul descarcă doar modelul ales. YuNet se încarcă mereu, pentru blur.

**De ce două fișiere.** Lite0 la 320 px e varianta implicită: ~8,8 fps măsurat în browser pe
clipul demo, la cadru procesat 1280 px. Lite2 la 448 px coboară la ~4,8 fps, dar ține mai
bine oamenii mici în cadru — util pe un apron filmat larg, costisitor pe un laptop modest.
Lite0 e peste YOLO26n la viteză în aceeași măsurătoare (8,8 vs 6,9 fps), iar Lite2 e sub
(4,8 fps); prețul real e recall-ul pe oamenii mici/îndepărtați, nu fps-ul. Diferența se
spune în UI, nu se ascunde. Cifrele și contextul: `docs/browser-engine.md` §4 și §6.

## `yunet.onnx` — de ce input dinamic

Modelul publicat de opencv_zoo (`face_detection_yunet_2023mar.onnx`, fp32) are
inputul declarat fix la `[1, 3, 640, 640]`: asta cere `cv2.FaceDetectorYN`. Pe un
cadru de 1080p din apron e alegerea greșită — fie cadrul e strâns la 640x640 și
fețele mici își pierd pixelii exact când contează, fie se face un resize inutil
și costisitor.

Graful e complet convoluțional, deci limitarea e doar în metadate. Scriptul
rescrie dimensiunile declarate ale inputului în `[1, 3, "height", "width"]` și
lasă greutățile și operatorii neatinși. Fișierul acceptă apoi orice dimensiune,
cu o singură condiție: ambele laturi să fie multiplu de **32**, pentru că graful
fuzionează stride-urile 8, 16 și 32. Fosta referință Python proceda la fel în
`safesight_ml/privacy.py` (ștearsă din acest fork, acum doar în istoricul git), doar că
acolo patch-ul se aplica în memorie la încărcare.

Ieșirile (`cls_*`, `obj_*`, `bbox_*`, `kps_*`) păstrează în continuare mărimile
declarate pentru 640x640. ONNX Runtime le recalculează la rulare și scrie un
avertisment de tip „Expected shape from model ... does not match actual shape”.
Avertismentul e așteptat și inofensiv, la fel ca pe fosta referință Python; se poate stinge
cu `ort.env.logLevel = 'error'`.

Verificat: input `[1, 3, 'height', 'width']`, rulare la 640x640 și la 480x832
(ambele multiplu de 32) întoarce 12 ieșiri, cu grilele scalate corect
(`cls_8`: `[1, 6400, 1]`, respectiv `[1, 6240, 1]`).

## Cum se regenerează

```bash
python3 frontend/scripts/prepare-models.py --help
python3 frontend/scripts/prepare-models.py <argumentele curente>
```

Scriptul scrie în `frontend/public/models/` (sau în directorul dat ca argument): copiază
cele două fișiere EfficientDet **neatinse** și rescrie doar inputul YuNet. Nu descarcă
nimic — sursele se dau ca argumente. Numele exacte ale flagurilor se citesc din `--help`
sau din headerul scriptului: s-au schimbat când a intrat detectorul nou, deci nu le copia
din documente mai vechi.

Surse:

- `efficientdet_lite0.onnx`, `efficientdet_lite2.onnx` —
  `https://github.com/namas191297/efficientdetlite/tree/main/onnx_models` (descărcare
  directă din repo, fără build);
- `face_detection_yunet_2023mar.onnx` —
  `https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet`.

Necesită pachetul Python `onnx` (`pip install onnx`) doar pentru patch-ul YuNet; copierea
celor două EfficientDet nu are dependențe.

## Licențe și atribuire

- **EfficientDet-Lite0/Lite2 — greutăți Apache-2.0**, Copyright 2020 Google LLC. Textul
  complet: [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt). Sursa licenței:
  <https://www.apache.org/licenses/LICENSE-2.0>.
- **Conversia ONNX — CC BY 3.0**, Namas Bhandari,
  <https://github.com/namas191297/efficientdetlite>. Textul complet:
  [`LICENSE-CC-BY-3.0.txt`](LICENSE-CC-BY-3.0.txt); licența canonică:
  <https://creativecommons.org/licenses/by/3.0/legalcode>. CC BY 3.0 permite uz comercial
  și redistribuirea cu atribuire și link către licență; conversia e o operă separată de
  greutățile Apache-2.0, deci ambele straturi se atribuie.
- **YuNet** — MIT, Shiqi Yu / [opencv_zoo](https://github.com/opencv/opencv_zoo)
  (`models/face_detection_yunet`). Copierea și redistribuirea sunt permise cu
  păstrarea notei de copyright.

Atribuirea ajunge și la vizitator: `frontend/public/NOTICE` se publică în `dist/NOTICE` și
e linkuit din sidebar („Licențe”). Cele două fișiere `LICENSE-*.txt` se servesc din
`dist/models/`, lângă greutăți.

**Fără AGPL.** Build-ul nu mai încarcă niciun model YOLO/Ultralytics și nu mai are nevoie de
nicio licență comercială pentru detector. Dacă în arbore a rămas un `yolo26n.onnx`, e un
fișier care așteaptă ștergerea din commitul de schimbare a detectorului: nu e referit de cod,
nu se servește și nu are ce căuta într-un build. Nu reintroduce greutăți YOLO, nici măcar
fine-tunate — licența urmează greutățile.
