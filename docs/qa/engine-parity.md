# Paritatea motorului din browser cu referința Python

Test diferențial: aceleași intrări prin `frontend/src/engine/` (Node/Chromium) și prin
`ml/safesight_ml/`, apoi comparație de ieșiri. Nu s-a modificat niciun cod de aplicație;
scenariile și scripturile au stat în `/tmp/opencode/qa-parity/` și nu se comit.

Două întrebări, tratate separat:

1. **Logică pură** (geometrie, membership, rule engine, cooldown, `event_id`, tracker):
   aceleași date prin ambele implementări, dif pe biți.
2. **Detectori pe cadre reale**: YOLO26n și YuNet, ultralytics/`privacy.py` vs decodarea
   din `decode.js`, pe 30 de cadre reale de apron, 1920×1080.

## 1. Metodă

### 1.1 Mediul

| Partea | Ce a rulat |
|---|---|
| Python | `.venv` din checkout-ul principal (`/var/home/.../craiova-hack-2026/ml/.venv`): Python 3.13.12, ultralytics 8.4.194, torch 2.15.0, onnxruntime 1.31.1, opencv 5.0.0 |
| Browser | Chromium 156 headless prin Playwright 1.64.1 (executabilul din `~/.cache/ms-playwright/chromium-1248`), onnxruntime-web 1.31.1, **wasm, un singur thread** (`crossOriginIsolated=false`, exact ca build-ul static de pe Pages) |
| Node | 20+ (`v26.7.0`) pentru modulele pure (`zones.js`, `events.js`, `tracker.js`, `decode.js`) |

`onnxruntime-node` nu era instalat și nu s-a atins `package.json`. Detectorii au rulat în
**browserul real**, nu în Node: un harness servit local importă fișierele din branch
(`/engine/decode.js`, `/engine/detectors.js`) și rulează pașii din `worker.js`
(`detectPersons`/`detectFaces`, copiați cuvânt cu cuvânt din liniile 192–246), cu aceiași
parametri ca demo-ul: YOLO conf 0.35 / NMS 0.45 / clasă 0, letterbox 640 cu padding 114,
YuNet conf 0.6 / NMS 0.3, cadru nativ (fără `frameLimit`). Singurul shim este linia Vite
`?url` + `import.meta.env.BASE_URL` din `detectors.js`, rescrisă de serverul local.

### 1.2 Cadrele

30 de cadre reale, 1920×1080, din clipul de apron `~/Downloads/1.mp4` (worker cu veste
hi-vis lângă motor, persoane la împingerea aeronavei), eșantionate la fiecare 8 cadre
(0, 8, …, 232). Nu sunt în repo (`.mp4` e interzis), deci testul se reface cu orice clip.

PNG-urile au fost rescrise fără `cICP`/`gAMA`: prima extragere păstra metadatele de culoare
ale ffmpeg, Chromium le interpretează (conversie de gamut), `cv2.imread` nu, iar pixelii
ajungeau diferiți înainte de model. Cu metadate, browserul a găsit 25 de fețe în loc de 27
la același conținut. După rescriere, **decodarea este identică pe biți**: FNV-1a peste RGBA
la 1920×1080 a coincis pe **30/30** de cadre, iar tensorul 640×640 trimis la YOLO a fost
identic cu `cv2.resize(INTER_LINEAR)` + padding 114 (0 octeți diferiți, cadrele 1 și 18).
Asta separă „motorul diferă” de „intrarea diferă”.

### 1.3 Potrivirea cutiilor

Recall/precizie prin potrivire greedy pe IoU ≥ 0.5 (sortat descrescător, un-și-unu). Pentru
persoane, cutiile Python sunt normalizate de `YoloDetector.people()`, cele din browser
împărțite la lățime/înălțime; pentru fețe, ambele în pixeli.

## 2. Logică pură

### 2.1 Geometrie: `pointInPolygon` / `signedDistance`

100 de poligoane aleatoare (3–8 vârfuri, stea simplă, în 0.001–0.999), 50 de puncte fiecare
(30 uniforme, 10 exact pe muchii, 5 în vârfuri, 5 la ±1e-4 de muchie), deci **5 000 de
puncte** × 2 aspecte. Fixture: `fixtures/geometry.json`.

| Aspect | Puncte | max \|Δ distanță\| | Neînțelegeri de semn | Neînțelegeri `pointInPolygon` |
|---|---|---|---|---|
| 1.0 | 5 000 | 3.14e-08 | 1 (la 2.5e-9 de muchie) | 0 |
| 16/9 | 5 000 | 5.96e-08 | 0 | 0 |

Cauza: `cv2.pointPolygonTest` primește conturul ca float32, iar portul face `Math.fround`
pe coordonate; restul diferenței e ordinea operațiilor în double. 6e-8 din înălțimea
cadrului înseamnă ~0.00006 px la 1080p. Singurul punct cu semn schimbat e la 2.5e-9 de
muchie: ambele implementări îl văd practic pe graniță, iar marja de 0.10 înălțimi de om
din `ZoneMembership` face diferența irelevantă.

### 2.2 `ZoneMembership.update` + `RuleEngine.observe`

Scenariu scriptat de 760 de cadre la 30 fps (`fixtures/sequence.json`): 4 zone (una
`RESTRICTED always` cu debounce 1.0, una `RESTRICTED engine_on` cu 0.5, două
`PPE_REQUIRED` cu debounce 0), 5 track-uri, intrări/ieșiri, picioare tăiate de marginea
de jos (`y2 = 0.99`), o absență de 10.3 s ca să expire cooldown-ul de prezență, comutarea
`engine_on` oprită 560–620, stări de vestă alternante care umplu fereastra temporală mixt.

| Cadru | t (s) | Track | Zonă | seen/window | duration_s | Python | Browser |
|---|---|---|---|---|---|---|---|
| 51 | 1.700000 | 1 | engine-left | 15/15 | 1.000000 | ✔ | ✔ |
| 91 | 3.033333 | 2 | engine-left | 15/15 | 1.000000 | ✔ | ✔ |
| 106 | 3.533333 | 5 | flutter | **5/6** | 0.166667 | ✔ | ✔ |
| 344 | 11.466667 | 3 | vest-bay | **5/5** | 0.133333 | ✔ | ✔ |
| 465 | 15.500000 | 4 | engine-right | 15/15 | 0.500000 | ✔ | ✔ |
| 671 | 22.366667 | 1 | engine-left | 15/15 | 1.000000 | ✔ | ✔ |

- Aceleași 6 decizii, în aceleași cadre, cu aceleași `seen`/`window`.
- `duration_s` identic bit cu bit (Δ maxim **0.0**).
- Tranziții de membership: **15** în ambele (intrare, ieșire, re-intrare după cooldown).
- Al doilea eveniment al lui track 1 (cadrul 671) apare doar pentru că starea a fost
  ștearsă după 10 s în afara zonei: re-intrarea e tratată la fel în ambele.

### 2.3 Cooldown, `event_id`, tracker

**Cooldown.** 58 de verificări pe marginea ferestrei (60 s și 2 s, plus `window_s = 0`),
inclusiv exact la graniță: **56/58 identice**. Cele 2 divergențe sunt sub-milisecundă:

| Emis la | Verificat la | Fereastră | Python | Browser |
|---|---|---|---|---|
| 1.0009 | 3.0001 | 2.0 s | blocat (1.9992 < 2) | permis (3000 − 1000 = 2000 ms) |
| 10.0009 | 12.0001 | 2.0 s | blocat | permis |

Cauza: `IncidentCooldown.allow` trunchiază ambele momente la milisecunde întregi
(`toEpochMs`), Python compară double-urile în secunde. Când părțile fracționare diferă,
diferența poate sări de la 1.9992 s la 2.000 s. Efect: un incident poate fi redeschis cu
cel mult **1 ms** mai devreme. Nicio consecință vizibilă.

**`event_id`.** 100 de cazuri (5 camere × 5 timestamp-uri × 4 track-uri), comparate cu
formula din `pipeline.py` (`evt_{camera}_{int(epoch*1000)}_{track}`) și cu regexul
backendului (`^evt_[a-z0-9-]+_\d{13}_\d+$`, `backend/app/schemas.py:58`):

- **80/80** identice unde timestamp-ul e un epoch valid de 13 cifre.
- 20/20 cazuri cu `epoch = 0`: browserul aruncă `RangeError` (cere 13 cifre), Python
  construiește `evt_stand12_0_0`, pe care regexul backendului îl respinge (422). Browserul
  e mai strict, nu diferit: nu poate produce un id pe care API-ul să-l refuze.

**Tracker.** Nu are corespondent Python (ByteTrack), deci i-am verificat invarianții.
**10/10** trec:

| Invariant | Rezultat |
|---|---|
| un rezultat per detecție, în ordinea intrării | ✔ |
| id-uri unice într-un cadru, pornind de la 1 | ✔ |
| id stabil peste o detecție lipsă de un cadru | ✔ |
| fără reutilizare de id după drop (`maxAgeFrames` depășit) | ✔ |
| track care coastă nu e returnat | ✔ |
| determinist la IoU aproape egal | ✔ |
| egalitate exactă → id-ul cel mai mic câștigă | ✔ |
| id-uri strict crescătoare în sesiune | ✔ |
| `maxAgeFrames` numărat în cadre, nu în timp | ✔ (cod) |
| potrivire greedy un-și-unu | ✔ (cod + teste) |

## 3. Detectori pe cele 30 de cadre

### 3.1 Persoane: ultralytics `YoloDetector` vs browser

| Cadru | Python | Browser | Potrivite | IoU min | IoU mediu |
|---|---|---|---|---|---|
| 001 | 4 | 4 | 4 | 0.993 | 0.995 |
| 002 | 4 | 4 | 4 | 0.993 | 0.996 |
| 003 | 3 | 3 | 3 | 0.985 | 0.992 |
| 004 | 3 | 3 | 3 | 0.995 | 0.996 |
| 005 | 4 | 4 | 4 | 0.993 | 0.995 |
| 006 | 4 | 4 | 4 | 0.985 | 0.992 |
| 007 | 4 | 4 | 4 | 0.978 | 0.991 |
| 008 | 4 | 4 | 4 | 0.972 | 0.989 |
| 009 | 4 | 4 | 4 | 0.991 | 0.992 |
| 010 | 4 | 4 | 4 | 0.992 | 0.995 |
| 011 | 4 | 4 | 4 | 0.993 | 0.995 |
| 012 | 4 | **3** | 3 | 0.990 | 0.994 |
| 013 | 4 | 4 | 4 | 0.988 | 0.992 |
| 014 | 3 | 3 | 3 | 0.976 | 0.989 |
| 015 | 4 | 4 | 4 | 0.991 | 0.995 |
| 016 | 4 | 4 | 4 | 0.994 | 0.996 |
| 017 | 4 | 4 | 4 | 0.976 | 0.992 |
| 018 | 4 | **3** | 3 | 0.995 | 0.996 |
| 019 | 3 | 3 | 3 | 0.978 | 0.990 |
| 020 | 2 | 2 | 2 | 0.939 | 0.968 |
| 021 | 3 | 3 | 3 | 0.994 | 0.996 |
| 022 | 3 | 3 | 3 | 0.995 | 0.996 |
| 023 | 3 | 3 | 3 | 0.995 | 0.996 |
| 024 | 3 | 3 | 3 | 0.996 | 0.997 |
| 025 | 3 | 3 | 3 | 0.997 | 0.997 |
| 026 | 2 | 2 | 2 | 0.995 | 0.997 |
| 027 | 3 | 3 | 3 | 0.990 | 0.995 |
| 028 | 3 | 3 | 3 | 0.996 | 0.996 |
| 029 | 3 | 3 | 3 | 0.996 | 0.997 |
| 030 | 3 | 3 | 3 | 0.997 | 0.997 |

**Total: 103 persoane în Python, 101 în browser, 101 potrivite → recall 98.06%,
precizie 100%.** IoU: min 0.9393, median 0.9959, mediu 0.9938. Diferența de scor pe
perechile potrivite: medie 0.0046, maxim 0.0174 (niciuna ≥ 0.05).

**Aceeași comparație cu backendul ncnn** (`ncnn_detector.py`, de unde provin parametrii
portului: letterbox pătrat 640, fill 114, NMS 0.45):

| Referință | Cutiile ref | Cutiile browser | Potrivite | Recall | Precizie | IoU min | IoU mediu | Δscor |
|---|---|---|---|---|---|---|---|---|
| ultralytics (`YoloDetector`) | 103 | 101 | 101 | 98.06% | 100% | 0.9393 | 0.9938 | max 0.0174 |
| ncnn (`NcnnDetector` + `decode`) | 101 | 101 | 101 | **100%** | **100%** | **0.9889** | **0.9998** | **0.0000** |

Adică: portul este fidel **căii ncnn**, iar cele două diferențe față de ultralytics sunt
exact cele două diferențe dintre cele două căi Python.

### 3.2 Fețe: `privacy.py` (YuNet) vs `decodeYuNet`

YuNet e dinamic în ambele (cadru întreg 1920×1088, padding cu zerouri, BGR brut, fără
normalizare), exact ca în `privacy.py`.

| Cadru | Python | Browser | Potrivite | IoU min |
|---|---|---|---|---|
| 001 | 0 | 0 | 0 | — |
| 002 | 2 | 2 | 2 | 0.621 |
| 003 | 1 | 1 | 1 | 0.680 |
| 004 | 2 | 2 | 2 | 0.787 |
| 005 | 2 | 2 | 2 | 0.839 |
| 006 | 3 | 3 | 3 | 0.686 |
| 007 | 3 | 3 | 3 | 0.711 |
| 008 | 3 | 3 | 3 | 0.671 |
| 009 | 2 | 2 | 2 | 0.843 |
| 010 | 1 | 1 | 1 | 0.859 |
| 011 | 1 | 1 | 1 | 0.894 |
| 012 | 1 | 1 | 1 | 0.897 |
| 013 | 1 | 1 | 1 | 0.906 |
| 014 | 1 | 1 | 1 | 0.937 |
| 015 | 1 | 1 | 1 | 0.969 |
| 016 | 1 | 1 | 1 | 0.891 |
| 017 | 0 | 0 | 0 | — |
| 018 | 1 | 1 | 1 | 0.848 |
| 019 | 1 | 1 | 1 | 0.815 |
| 020–030 | 0 | 0 | 0 | — |

**Total: 27 fețe în ambele, 27 potrivite → recall 100%, precizie 100%.** IoU: min 0.6215,
media mediilor pe cadru 0.8438.

## 4. Discrepanțe și explicația fiecăreia

| # | Discrepanță | Mărime | Cauză (o linie) |
|---|---|---|---|
| 1 | O persoană lipsă în browser, cadrul 012 | 1 din 103 (0.97%) | Ultralytics folosește NMS IoU **0.7**, portul **0.45**: cutia duplicată (IoU 0.70 cu vecina) e suprimată doar în browser. Cu `iou=0.45`, Python dă exact 3 cutii. |
| 2 | O persoană lipsă în browser, cadrul 018 | 1 din 103 (0.97%), Δscor 0.085 | Ultralytics letterboxează **dreptunghilar 640×384**, iar graful ONNX din browser e fix **640×640** (padding 114 sus/jos). Persoana e tăiată de marginea de jos (`y2 = 0.999`), deci contextul diferă; scorul 0.354 scade la 0.269, sub prag. |
| 3 | Cooldown de incident la graniță | ≤ 1 ms mai devreme | `toEpochMs` trunchiază la milisecunde; Python compară double-uri în secunde. |
| 4 | `signedDistance` lângă muchie | max 5.96e-08 (≈ 6e-5 px la 1080p) | Conturul e float32 în OpenCV, `Math.fround` în JS; restul e ordinea operațiilor. |
| 5 | IoU minim la fețe 0.62 | doar pe fețe de 8×10 px | `privacy.py` trunchiază `(x, y, w, h)` la int; browserul întoarce float. 1 px pe o cutie de 8 px schimbă mult IoU, nu și blur-ul (marja e `max(1, 0.2·latura)`). |
| 6 | `event_id` pentru `epoch = 0` | 20/100 cazuri invalide | Browserul cere 13 cifre și aruncă; Python produce un id pe care regexul backendului îl respinge. Browserul e mai strict. |
| 7 | Pixeli diferiți la PNG cu `cICP`/`gAMA` | 25 vs 27 de fețe | Chromium aplică managementul de culoare, `cv2` nu. Nu e bug de motor: dispare când intrarea nu are metadate de culoare. |

Ce **nu** s-a găsit: nicio diferență în geometria zonelor, membership, rule engine, forma
evenimentului, `event_id`, cooldown (în afara sub-milisecundei) sau invarianții tracker-ului.
Modelul și decodorul sunt echivalente când primesc același tensor: pe tensorul exact al
browserului, `.pt` în PyTorch și ONNX-CPU dau aceleași scoruri (Δ maxim 1.8e-6 pe cele
8400 de ancore), iar ONNX-CPU și ORT-wasm dau aceleași cutii și scoruri la 4 zecimale pe
cadrele verificate. Diferențele de detecție vin din preprocesare (forma letterbox-ului), nu
din graf sau din decodor.

Două mecanisme des citate nu au fost exercitate de acest set, deci rămân riscuri teoretice,
nu rezultate: **tie-breaking-ul NMS** (nu au apărut scoruri exact egale în cele 30 de
cadre; `decode.js` sortează stabil, `np.argsort` din `privacy.py` nu e stabil) și
**rotunjirea letterbox-ului** (la 1920×1080 ambele dau exact 640×360, deci `Math.round` vs
rotunjirea OpenCV nu se vede; la alte rezoluții poate diferi cu 1 px).

## 5. Verdict

**Da, motorul din browser este echivalent comportamental cu referința pentru traseul demo.**
Zonele, regula „o prezență = un eveniment”, debounce-ul, fereastra temporală, cooldown-ul,
id-urile și tracker-ul produc aceleași decizii, în aceleași cadre, cu abateri sub 1e-7.
Detectorii găsesc aceleași persoane și aceleași fețe în 98.06%, respectiv 100% din cazuri,
cu IoU mediu 0.9938 / 0.8438 pe perechile potrivite.

Ce ar putea ajunge la utilizator:

- **Contorul de persoane** poate citi cu 1 mai puțin (sau, prin NMS 0.45, cu 1 mai mult)
  pe un cadru marginal. Nu schimbă niciun eveniment din demo: o persoană trebuie să stea
  peste 1 s și 15 cadre în zonă, iar ambele diferențe apar pe cutii de la marginea
  cadrului sau duplicate.
- **Nimic altceva.** Cooldown-ul cu 1 ms mai devreme și semnul distanței la 2.5e-9 de
  muchie nu pot fi observate de operator.

Un singur lucru de reținut ca risc latent, nu ca bug: portul urmează `ncnn_detector.py`
(letterbox pătrat, NMS 0.45), nu backendul ultralytics implicit (`YoloDetector`: letterbox
640×384, NMS 0.7). Față de ncnn paritatea e 101/101. Dacă cele două backenduri Python sunt
considerate interschimbabile, atunci diferența e de configurație și trebuie decis care e
referința canonică; dacă referința demo e ncnn, browserul e exact.

Limitele testului, ca să nu fie citit ca mai mult decât este: un singur clip, 30 de cadre,
doar 1080p, doar backendul wasm (fără WebGPU), fețe mici (8–30 px) și nicio ocluzie
prelungită. Nu s-a rulat aplicația completă în browser, ci modulele motorului cu
preprocesarea din `worker.js`; UI-ul, `useEngine.js` și randarea nu fac obiectul testului.

## 6. Reproducere

Scripturile sunt în `/tmp/opencode/qa-parity/` (necomise). `PY` este
`/var/home/restlessstone/Coding/craiova-hack-2026/ml/.venv/bin/python` (are ultralytics,
onnxruntime, opencv, ncnn). Comenzile, în ordine:

```bash
PY=/var/home/restlessstone/Coding/craiova-hack-2026/ml/.venv/bin/python
cd /tmp/opencode/qa-parity

# 0. cadre: 30 PNG 1920x1080, fara metadate de culoare
ffmpeg -i ~/Downloads/1.mp4 -vf "select='not(mod(n\,8))*lt(n\,240)',format=rgb24" \
  -vsync 0 -frames:v 30 -f rawvideo -pix_fmt rgb24 - \
  | $PY -c "import sys,numpy as np,cv2; d=sys.stdin.buffer.read(); n=len(d)//(1920*1080*3); \
      b=np.frombuffer(d,np.uint8)[:n*1920*1080*3].reshape(n,1080,1920,3); \
      [cv2.imwrite(f'/tmp/opencode/qa-parity/frames/frame_{i+1:03d}.png', b[i][:,:,::-1]) for i in range(n)]"

# 1. logica pura
$PY gen_fixtures.py             # fixtures/*.json
$PY py_logic.py                 # referinta Python -> py_logic.json
node run_js.mjs                 # modulele din branch -> js_logic.json
$PY compare_logic.py            # tabelele din sectiunea 2

# 2. detectori in browserul real
$PY serve.py &                  # serveste /engine, /models, /frames, /node_modules
node run_browser.mjs "" /tmp/opencode/qa-parity/br_detections.json

# 3. referintele Python pe aceleasi cadre
$PY py_detect.py                # ultralytics YOLO26n + privacy.FaceBlurrer
$PY py_ncnn.py                  # NcnnDetector: aceeasi cale ca portul
$PY compare_detections.py       # tabelele 3.1 si 3.2
$PY compare_ncnn.py             # randul ncnn din 3.1
$PY diagnose.py                 # cauzele celor doua diferente de persoane
```

`diagnose.py` verifică și cele două explicații: tensorul 640×640 al browserului vs
`cv2.resize` + padding (diferență 0 pe toți octeții), ieșirea `.pt` vs `.onnx` pe același
tensor (Δ maxim 1.8e-6) și faptul că intrarea reală a ultralytics este 640×384.
