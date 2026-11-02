# Cap pe inputul detectorului de fețe (YuNet)

**Data:** 2 noiembrie 2026 · **Branch:** `prep/perf-tuning` · **Commit:** `6f03a4f`
**Build:** `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`, servit local sub
`/LocalSight/` cu COOP/COEP (document `crossOriginIsolated`, deci WASM pe 4 fire).
**Clip:** `frontend/public/media/stand12.mp4`, oprit la 1280 pe latura lungă (aceeași limită
pe care o pune `LiveView` motorului din Live; `/bench` o alege explicit).
**Browser:** Chromium headless (Playwright 1.64.1), WASM, fără WebGPU.
**Mașină:** `restlessdesk`, 16 fire. Load average 7–20 în timpul măsurătorilor (alte sesiuni
rulau pe aceeași mașină), de aceea rulările „înainte” și „după” sunt intercalate, nu în serii.

Instrumentarea de profil a fost temporară și **nu** e în commit: `worker.js` a scris pe
consolă durata fiecărei etape, iar un driver Playwright a adunat liniile. Codul livrat nu
conține niciun cârlig de test.

## 1. Profilul cadrului (înainte)

1280×720, 4 fire, 3 rulări × 20 s, 251 cadre. Mediane per etapă, în milisecunde:

| Etapă | Mediană | p90 | Observație |
|---|---:|---:|---|
| YOLO: pregătire (letterbox + `getImageData` + NCHW) | 11,0 | 17,8 | 640×640 fix |
| YOLO: inferență | 111,4 | 161,5 | 56% din cadru |
| YOLO: decode | 0,04 | 0,12 | |
| YuNet: pregătire (copie + NCHW) | 14,2 | 19,7 | la 1280×736 |
| YuNet: inferență | 49,4 | 70,6 | 25% din cadru |
| YuNet: decode | 0,16 | 0,22 | |
| desen cadru în canvas | 3,2 | 5,4 | |
| PPE (citire culoare) | 0,4 | 3,6 | un `getImageData` per persoană |
| blur fețe + bandă de cap + cutii | 3,7 | 8,5 | |
| badge-uri PPE + zone | 0,07 | 0,12 | |
| `pipeline.step` | 0,07 | 0,13 | |
| snapshot JPEG | 0,0 | 0,0 | doar pe cadrul cu eveniment |
| `transferToImageBitmap` | 0,4 | 0,6 | |
| **total worker** | **198,3** | 285,7 | |

Decodarea `createImageBitmap(video)` se face pe firul principal, în afara worker-ului:
mediană 9,3–12,5 ms per cadru (30 eșantioane per rulare), independentă de `inputSize`.

Concluzia: două treimi din cadru e YOLO, o treime YuNet. YuNet decide doar ce dreptunghiuri
se blurează, iar la 1280 rulează pe tot cadrul.

## 2. Optimizarea A — copie mică pentru YuNet

`perf.js` decide geometria și politica; `worker.js` o aplică. Cât timp `safetyBlur` e ON,
YuNet primește o copie cu latura lungă de 640 px (1280×720 → 640×360, paduit la 640×384,
multiplu de 32). Cutiile se întorc în pixeli de cadru (`scaleFaceBoxes`, factor separat pe
fiecare axă), iar blurul, overlay-ul și snapshot-ul rămân la rezoluția cadrului.

Cu `safetyBlur` OFF, detectorul primește cadrul întreg: acolo singurul blur e cutia feței,
deci un cap ratat nu mai e acoperit de nimic și nu e loc de compromis.

Verificat pe build-ul livrat, cu o sondă temporară care loga dimensiunea reală a inputului:

| `safetyBlur` | input YuNet | copie |
|---|---|---|
| ON (implicit) | 640×384 | 640×360 |
| OFF | 1280×736 | 1280×720 |

## 3. Recall: ce pierde capul

Pe 83 cadre din același clip, am rulat pe fiecare cadru **ambele** detectoare (copie și cadru
întreg) și am potrivit cutiile cu IoU ≥ 0,5. Persoanele vin din YOLO, deci pot spune dacă o
față pierdută era sau nu acoperită de banda de cap (top 35% din cutia persoanei, cu marja de
20% din `blur.js`).

| Măsură | Valoare |
|---|---|
| Detecții YuNet pe cadru întreg | 22 (lățimi 9–20 px, mediană 18) |
| Detecții YuNet pe copie | 3 (toate potrivite, 0 în plus) |
| Recall general | **13,6%** |
| Detecții aflate în banda de cap | **22 / 22** |
| Detecții în afara benzii de cap | **0** |
| Recall pe fețele din afara benzii | **niciuna nu există în clip, deci niciuna nu s-a pierdut** |

Decizia: capul **se livrează**, pentru că regula de siguranță e îndeplinită — nicio detecție
din afara plasei de siguranță nu și-a pierdut blurul. Limita trebuie spusă: clipul nu conține
nicio față detectată în afara benzii de cap, deci nu putem demonstra pe el că pierderea e zero
și pentru un cadru în care YOLO ratează persoana. Tocmai de aceea capul e condiționat de
`safetyBlur`: cu plasa pornită, o față ratată de YuNet dintr-o persoană detectată rămâne
blurată; fără ea, detectorul revine la cadrul întreg.

## 4. A/B end-to-end

9 rulări per variantă (6 × 15 s + 3 × 20 s), intercalate (`B O`, `O B`, `B O`, `O B`, …),
aceeași mașină, același clip, 1280, COI, 4 fire.

| Metrică (mediană) | Baseline | Cu cap | Diferență |
|---|---:|---:|---:|
| fps | 5,3 | **6,0** | +0,7 (+13%) |
| p50 worker (ms) | 151 | **127** | −24 (−16%) |
| mean worker (ms) | 175,0 | 154,7 | −20,3 |
| cadre / rulare | 85 | 106 | +21 |

Zgomotul dintre rulări e mare (load average 7–20, alte sesiuni pe mașină): fps-ul de baseline
a variat 4,3–6,0, cel cu cap 5,3–7,3. De aceea cifra de care ne legăm e **p50 pe cadru**, nu
fps-ul: în setul de 20 s distribuțiile nu se suprapun (baseline 143–164 ms, cu cap
107–131 ms), iar în toate cele 9 perechi p50 a scăzut. Câștigul de fps e la marginea zgomotului
și e raportat ca atare, nu rotunjit în sus.

*Corecție față de mesajul commitului `6f03a4f`: acolo scrie „151 → 124 ms”; 124 era mediana
unei submulțimi amestecate. Mediana corectă pe cele 9 rulări per variantă este 151 → 127 ms,
iar pe subsetul de 20 s 145 → 121 ms. Concluzia nu se schimbă.*

## 5. Optimizarea B — respinsă

Ambele variante propuse — sar peste YuNet pe cadrele fără persoane, sau refolosesc ultimele
cutii de fețe cu asociere pe tracker — slăbesc exact cazul în care YuNet e singura plasă:
persoana pe care YOLO o ratează, deci nu are bandă de cap. Un cadru fără persoane detectate
nu înseamnă „fără fețe”, iar o cutie refolosită nu acoperă o față nou apărută. Nu se
livrează: câștigul nu merită o regresie de privacy, iar A e suficient.

## 6. Dovezi de privacy

- **Banda de cap, cu capul pornit (build-ul livrat, Live, 1280).** Varianta Laplacian pe
  luminanță, în interiorul celor două benzi ale aceleiași persoane (fără eticheta `PERSON`,
  desenată peste blur):
  - persoana 1: cap **3,62**, corp **11 778** (raport 3 254×);
  - persoana 2: cap **3,43**, corp **20 697** (raport 6 043×).
  În acel cadru YuNet (cu cap) a găsit **0** fețe, deci blurul vine din banda de cap — plasa
  de siguranță lucrează. Decupajele arată un dreptunghi fără nicio trăsătură facială la cap și
  picioare/vestă clare la corp.
- **Fail-closed cu `yunet.onnx` blocat (build-ul livrat).** Canvasul e 98,7% fundalul
  `#0B0B0B` al plaselor de gardă, cu 4 730 de pixeli din textul roșiatic; cardul scrie
  „eroare … cannot fetch /LocalSight/models/yunet.onnx”; `opacity` pe `<video>` rămâne 0.
  Niciun cadru brut nu ajunge pe ecran.
- **`safetyBlur` OFF.** Inputul YuNet revine la 1280×736 (tabelul din §2); politica e fixată
  și în `perf.test.mjs`.
- Breșa rămasă, neschimbată de acest commit: când motorul e oprit, clipul brut se joacă
  intenționat (vezi `qa/privacy-regression.md`).

## 7. Ce s-a schimbat în cod

| Fișier | Rol |
|---|---|
| `frontend/src/engine/perf.js` | geometrie pură (`cappedFaceInput`, `padToMultiple`, `scaleFaceBoxes`) și politica (`faceInputPlan`) |
| `frontend/src/engine/worker.js` | `detectFaces` primește planul; cutiile se scalează înapoi înainte de blur/overlay/snapshot |
| `frontend/src/engine/perf.test.mjs` | 21 de cazuri: scalare pe axe, fără upscaling, pad multiplu de 32, politică ON/OFF, fără mutație |

Fără dependențe noi, fără modificări de contract, fără cârlige de test. Verificări: 477 teste
unitare (456 înainte), build `VITE_USE_MOCK=true VITE_BASE=/LocalSight/`, smoke 5/5,
pages e2e 5/5.
