# Cum au fost făcute adnotările

> **Document istoric — SafeSight (date de antrenare).** Descrie cum s-au produs etichetele YOLO
> pentru demo-ul cu backend, nu motorul din browser. Etichetele rămân în `data/annotations/`;
> direcția actuală: [browser-engine.md](browser-engine.md).

Scop: 2 etichete YOLO pentru cadrele PPE din `data/reference_frames/`. Nu este un pipeline de producție; este un prim pas **local, semi-automat, cu verificare vizuală**. Etichetele au fost verificate de Dalina și validate vizual de Andrei pe 31 octombrie 2026. Setul rămâne mic, pentru demo/experiment, nu pentru antrenare de producție.

## Mediu

- Linux, Python 3.12, OpenCV, Ultralytics
- Model: `yolo26n.pt`
- Imagini: 2752×1536, în `data/reference_frames/`
- Clase: `data/annotations/classes.txt`
- Nu s-a folosit niciun serviciu cloud; imaginile și overlay-urile au rămas local.

## Fluxul agentic

A fost un ciclu scurt, nu un singur pas:

1. rulează detectorul / threshold-ul;
2. scrie o primă versiune de `.txt`;
3. randează overlay-uri peste imagine;
4. mă uit la overlay;
5. ajustez cutia dacă e prea strânsă/largă;
6. rulez din nou verificarea.

Pentru persoane, YOLO a dat cutia. Pentru vestă, threshold-ul HSV a dat un punct de pornire, dar cutia finală a fost ajustată vizual. Pentru cască, cutia a fost pusă manual după crop, pentru că nu a fost detectată curat.

## 1. Persoane — YOLO26n

```python
from ultralytics import YOLO
import cv2
from pathlib import Path

model = YOLO("yolo26n.pt")
img = cv2.imread("data/reference_frames/2026-10-30_no-ppe_cam01_fara-casca.jpeg")
h, w = img.shape[:2]
result = model.predict(img, conf=0.25, classes=[0], verbose=False)[0]

for box in result.boxes:
    x1, y1, x2, y2 = box.xyxy.cpu().numpy()[0]
    print("person", x1 / w, y1 / h, x2 / w, y2 / h)
```

Cutia `person` a fost folosită direct, cu coordonate normalizate 0–1.

## 2. Vestă — HSV, apoi ajustare manuală

```python
import cv2
import numpy as np

img = cv2.imread(path)
x1, y1, x2, y2 = 1264, 299, 1634, 1399  # cutia person
roi = img[y1:y2, x1:x2]
hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

# verde/galben high-vis
mask = cv2.inRange(hsv, (20, 80, 80), (45, 255, 255))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
box = cv2.boundingRect(max(contours, key=cv2.contourArea))
```

Threshold-ul a prins partea luminoasă a vestei, dar nu și zonele umbrite. Cutia finală a fost extinsă manual până la marginile vestei.

## 3. Cască — manual, după crop

Threshold-ul alb a prins și clădirea/cerul din fundal. Am folosit crop-ul persoanei și am poziționat manual cutia pe cască:

```text
hard_hat: x1=1368, y1=270, x2=1518, y2=380
```

## 4. Scrierea fișierelor YOLO

```python
def yolo_line(cid, x1, y1, x2, y2, w, h):
    xc = (x1 + x2) / 2 / w
    yc = (y1 + y2) / 2 / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h
    return f"{cid} {xc:.5f} {yc:.5f} {bw:.5f} {bh:.5f}"
```

Fișierele au același nume ca imaginea, cu `.txt`:

```text
2026-10-30_no-ppe_cam01_fara-casca.txt
2026-10-30_no-ppe_cam02_fara-vesta.txt
```

## 5. Verificarea cu overlay

Am randat cutiile direct din fișierele `.txt`, nu din valorile hardcodate:

```python
for line in label.read_text().splitlines():
    cid, xc, yc, bw, bh = line.split()
    cid = int(cid)
    # transformă în pixeli și desenează rectangle + numele clasei
```

Apoi am citit overlay-urile și am verificat:

- cutia `person` acoperă corpul, nu fața;
- `hi_vis_vest` acoperă vesta;
- `hard_hat` acoperă casca;

Overlay-urile sunt în `data/annotations/review/` și **nu se publică** — conțin fețe.

## 6. Verificare finală

- 2 imagini, 2 fișiere `.txt`;
- 4 cutii: 2 + 2;
- clase: `person=0`, `hi_vis_vest=1`, `hard_hat=2`;
- coordonate între 0 și 1;
- fără avion, bagaje, fețe sau alte clase.

## Rezultat

| Imagine | Conținut |
|---|---|
| `no-ppe_cam01_fara-casca` | `person`, `hi_vis_vest` |
| `no-ppe_cam02_fara-vesta` | `person`, `hard_hat` |

## Limitări

- Cutia de persoană vine de la YOLO; restul sunt manuale/asistate, nu ground truth.
- Nu am măsurat acuratețea pe un set de validare.
- Overlay-urile conțin fețe; rămân private, în Drive, și se blurează înainte de orice partajare publică.
- Pentru volum mare, Dalina ar trebui să folosească CVAT/Label Studio, nu scriptul acesta.

## Cum poate continua Dalina

1. Ia ZIP-ul `SafeSight_annotations_preliminary.zip` și urcă-l în `SafeSight/data/annotations/`.
2. Deschide overlay-urile din `review/` și confirmă cutiile.
3. Corectează în CVAT/Label Studio dacă e nevoie; exportă YOLO.
4. Păstrează aceeași ordine din `classes.txt`.
5. Trimite înapoi doar labels + README, nu imagini în git.
