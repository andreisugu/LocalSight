# Modele ONNX pentru build-ul static

Cele două grafuri pe care frontend-ul le încarcă în pagină cu ONNX Runtime Web.
Sunt servite ca fișiere statice: `Vite` copiază `public/` în `dist/`, deci în cod
se ajunge la ele prin `` `${import.meta.env.BASE_URL}models/<nume>.onnx` `` (base-ul
nu e mereu `/`, vezi `vite.config.js`).

Se regenerează cu `python3 frontend/scripts/prepare-models.py`; scriptul are
argumente pentru cele două surse și pentru directorul de ieșire.

| Fișier | Mărime | Rol | Input |
| --- | --- | --- | --- |
| `yolo26n.onnx` | 9 930 308 B (9,5 MB) | detectorul de persoane din zona Live | `[1, 3, 640, 640]` |
| `yunet.onnx` | 232 598 B (0,2 MB) | garda de privacy: blur pe fețe înainte de orice afișare | `[1, 3, "height", "width"]` |

SHA-256:

```
a456b5889f8948aa4caf7ab0f367131cdb22d64a054c28e102daa645d7b00d75  yolo26n.onnx
d1cd25851fba0e96d59f25548f072db7d114182c952605f509d14af502438dfb  yunet.onnx
```

## `yolo26n.onnx`

Copia exactă a exportului folosit de edge-ul Python (fișierul `ml/yolo26n.onnx` din
istoricul git, ignorat acolo de git). Nu se modifică nimic în graf: browserul rulează
aceleași greutăți ca referința.

Export:

```bash
yolo export model=yolo26n.pt format=onnx imgsz=640
```

Intrare `[1, 3, 640, 640]`, ieșire `[1, 84, 8400]`, opset 18.

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

## Licențe

- **YuNet** — MIT, Shiqi Yu / [opencv_zoo](https://github.com/opencv/opencv_zoo)
  (`models/face_detection_yunet`). Copierea și redistribuirea sunt permise cu
  păstrarea notei de copyright.
- **YOLO26n** — greutățile și codul Ultralytics sunt **AGPL-3.0**. Build-ul
  static le distribuie ca fișier descărcabil, deci AGPL se aplică întregului
  ansamblu servit: oricine îl folosește are dreptul la sursa corespunzătoare.
  Uzul comercial fără obligațiile AGPL cere o licență enterprise Ultralytics.
  Pentru un demo de hackathon, AGPL-ul e acceptabil; pentru un produs, nu fără
  decizie explicită.
