# Benchmark detectoare — EfficientDet-Lite0/Lite2 pe clipurile demo actuale

**Data:** 3 noiembrie 2026 · **Branch:** `prep/detector-benchmark` · **Commit măsurat:** `477f6fd`
(baza `main` la data rulării; documentul se adaugă într-un commit separat, fără cod de aplicație).
**Build:** `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`, servit local sub
`/LocalSight/` cu COOP/COEP (`serve-test.mjs --coi`), deci document `crossOriginIsolated` și
WASM pe 4 fire.
**Browser:** Chromium 156 din Playwright 1.64.1, headless, WASM, fără WebGPU.
**Sistem:** Bazzite 44 (Kinoite), Linux 7.2.11.
**Mașină:** `restlessdesk`, AMD Ryzen 7 7840HS (16 fire), 27 GB RAM. Load average 9–13 în
timpul rulării (alte sesiuni ale utilizatorului), deci fps-ul absolut e o limită inferioară,
nu o cifră de catalog.
**Verdict scurt:** Lite0 e rapid (mediană 6,1–8,1 fps) dar ratează toți muncitorii vizibili
din CAM-01/CAM-02; Lite2 e cu ~30–60% mai lent (median ~49%; 3,4–4,2 fps) și **nu**
recuperează acei muncitori — adaugă doar o cutie cu încredere mică, care nu e un muncitor. Doar CAM-03
(bagaje) detectează persoana și declanșează incidentul local. Alinierea a fost activă în
100% din cadre, fără erori de aplicație, fără 404/CORS la modele.

## 1. Ce măsoară și ce nu

Măsoară, pe build-ul livrat și pe clipurile demo generate din still-uri:

- fps-ul raportat de cardul motorului și fps-ul calculat din timestamp-urile rezultatelor
  worker-ului;
- numărul de `PERSOANE`, `FEȚE` și `INCIDENTE` din card, plus evenimentele reale din worker
  (tip, severitate, zonă, durată, `event_id`);
- starea alinierii (`aliniere: activă` / `aliniere pierdută`) și erorile de consolă/pagină;
- timpul până la `ready` și până la primul cadru, plus răspunsurile HTTP pentru modele.

**Nu** măsoară:

- mAP, precizie sau recall pe un set etichetat. Nu există ground truth pentru aceste clipuri,
  iar cifra de recall de mai jos e un **spot check vizual pe 2–3 cadre**, nu o metrică de
  dataset;
- calitatea detectorului pe footage real de aeroport. Clipurile CAM-01/CAM-02 sunt pan/zoom
  pe un still Unsplash, iar CAM-03 pe un still CC0; rezultatele nu se transferă automat pe
  o cameră reală;
- comportamentul pe WebGPU (nu se livrează) sau pe un GPU real.

## 2. Metodă

- Un singur build, același server local pentru toate rulările. Pentru fiecare detector am
  deschis un context Chromium nou, am scris în `localStorage` exact cele două chei pe care le
  scrie aplicația:
  `localsight.liveEngine='1'` și
  `localsight.engineSettings='{"wasmThreads":4,"safetyBlur":true,"detector":"efficientdet"}'`
  (sau `"efficientdet-lite2"`). Motorul pornește singur, ca la un vizitator care a lăsat
  motorul pornit.
- Pentru fiecare cameră (`stand12`, `taxiway-b`, `baggage-area`) am schimbat camera din
  `select#live-camera-select`, am așteptat noul `<video>` și primele cadre, apoi am măsurat
  **35 s**. Fereastra de 35 s exclude primele ~2 s de așezare, dar nu exclude încălzirea
  modelului (aceea se termină înainte de prima măsurătoare).
- Instrumentarea a fost doar în page context: un wrapper în jurul `window.Worker` care
  înregistrează mesajele worker-ului (`result`, `ready`, `status`, `error`). Nu s-a modificat
  niciun fișier al aplicației; wrapper-ul doar citește mesajele, nu le schimbă.
- Fps-ul din card e eșantionat o dată pe secundă din atributul `data-fps`; fps-ul „din cadre”
  e calculat din diferența dintre timestamp-urile rezultatelor worker-ului. Ambele sunt
  raportate, ca să se vadă dacă EMA-ul cardului ascunde ceva.
- Pentru incidente, cardul dă numărul, iar o rulare de confirmare de 20 s pe `baggage-area`
  a capturat obiectul evenimentului și rândul din coada de triaj. Motivul: primul incident
  apare la ~2 s după schimbarea camerei, adică în fereastra de așezare, iar buffer-ul folosit
  pentru fps se resetează după ea. Cardul și coada din rularea principală arată același
  incident; rularea de confirmare dă `event_id`-ul și durata exactă.
- Pentru comparația opțională `inputSize` 640 vs 1280 am folosit pagina existentă `/bench`
  (Lite0, `stand12.mp4`, 10 s, două rulări alternative pe fiecare mărime). `<video>`-ul din
  `/bench` e `hidden`, iar Chromium headless nu îl autoplay-ează; harness-ul a apelat
  `video.play()` în page context, fără să atingă codul aplicației. Fără acest apel pagina
  rămâne în „se încarcă modelele” la nesfârșit în headless.

## 3. FPS și stare pe cameră × detector

Fiecare rând e o rulare de 35 s. „Interval” e min–max din cele 36 de eșantioane ale cardului;
„cadre/s” e calculat din timestamp-urile worker-ului. `PERSOANE`/`FEȚE` sunt max / mediană
peste cadrele procesate (nu peste eșantioanele de 1 s).

| Cameră | Detector | fps mediană (interval) | cadre/s | PERSOANE max / median | FEȚE max / median | INCIDENTE | Aliniere | Erori |
|---|---|---:|---:|---:|---:|---:|---|---:|
| CAM-01 `stand12` | Lite0 | 6,1 (4,3–8,6) | 6,02 | 0 / 0 | 0 / 0 | 0 | 212/212 activă | 0 |
| CAM-01 `stand12` | Lite2 | 4,2 (3,2–4,5) | 4,12 | 1 / 1 ¹ | 0 / 0 | 0 | 145/145 activă | 0 |
| CAM-02 `taxiway-b` | Lite0 | 7,8 (4,9–8,6) | 7,24 | 0 / 0 | 0 / 0 | 0 | 253/253 activă | 0 |
| CAM-02 `taxiway-b` | Lite2 | 4,0 (3,2–4,4) | 3,76 | 1 / 1 ¹ | 0 / 0 | 0 | 132/132 activă | 0 |
| CAM-03 `baggage-area` | Lite0 | 8,1 (6,1–8,7) | 7,87 | 1 / 1 | 0 / 0 | **1** WARNING | 276/276 activă | 0 |
| CAM-03 `baggage-area` | Lite2 | 3,4 (2,7–4,3) | 3,33 | 1 / 1 | 0 / 0 | **1** WARNING | 117/117 activă | 0 |

¹ Cutia raportată de Lite2 pe CAM-01/CAM-02 are încredere 0,37–0,38 și cade lângă trenul de
aterizare / centrul cadrului, nu pe un muncitor din prim-plan. E o detecție de tip „persoană”
din model, dar nu e unul dintre cei patru muncitori vizibili; nu declanșează zona armată.
Vezi secțiunea 4.

Total: 741 cadre măsurate cu Lite0 și 394 cu Lite2 (1 135). Toate cele 1 135 au avut
`aligned=true`; zero erori de consolă/pagină în afara avertismentelor ONNX cunoscute pentru
YuNet. Fps-ul absolut e sub cifrele din `docs/browser-engine.md` (8,8 / 4,8) pentru că gazda
avea load 9–13; raportul dintre detectoare rămâne vizibil: Lite2 e la ~0,42–0,69 din fps-ul
Lite0 pe aceleași camere (median ~0,53).

## 4. Ce detectează, de fapt

| Cameră | Ce se vede în clip (spot check) | Lite0 | Lite2 | Incident |
|---|---|---|---|---|
| CAM-01 `stand12` | 4 muncitori: unul relativ aproape, lângă tractor, trei la distanță (unul pe cărucior, doi lângă cartul din dreapta). Niciunul mare, în prim-plan; primul e în zona `engine-left`. | 0 cutii în 212 cadre | 1 cutie (mediană 1), 0,37–0,38, lângă trenul de aterizare/centru; **nu** e un muncitor | nu |
| CAM-02 `taxiway-b` | Același still, alt crop/pan: 4 muncitori vizibili, toți deasupra benzii de siguranță din partea de jos. | 0 cutii în 253 cadre | 1 cutie (mediană 1), 0,37–0,38, în zona centrală; **nu** e un muncitor | nu |
| CAM-03 `baggage-area` | 1 persoană, în picioare, pe partea dreaptă a holului, lângă coloană; profil, fără vestă. | 1 cutie (mediană 1 în 276 cadre) | 1 cutie (mediană 1 în 117 cadre) | **da**, WARNING |

Concluzia pe detecție: pe CAM-01/CAM-02, Lite0 nu vede niciunul dintre cei patru muncitori, iar
Lite2 nu îi recuperează — singura cutie e o detecție slabă în zona avionului, nu un muncitor.
Pe CAM-03, ambele detectoare văd persoana și evenimentul chiar se declanșează. Diferența nu e
dată de pragul de încredere (0,35): la 320/448 px, un muncitor de 30–60 px din cadrul 1280×720
ajunge la ~7–15 px în tensor, sub ce poate separa modelul. E explicația cea mai plauzibilă,
nu o măsurătoare separată a mărimii cutiilor.

## 5. Recall spot-check pe persoane vizibile

Am extras câte trei cadre cu `ffmpeg` la t = 1 s, 4 s și 7 s din fiecare clip și am numărat
ochiometric persoanele. Numărul de detecții din coloanele Lite0/Lite2 vine din rularea de 35 s,
nu din cadrul fix; comparația e intenționat grosieră.

| Cameră | Persoane vizibile (t=1 / 4 / 7 s) | Detecții Lite0 | Detecții Lite2 | Recall spot |
|---|---|---|---|---|
| CAM-01 `stand12` | 4 / 4 / 4 | 0 | 0 relevante (1 cutie ne-muncitor) | **0/4** |
| CAM-02 `taxiway-b` | 4 / 4 / 4 | 0 | 0 relevante (1 cutie ne-muncitor) | **0/4** |
| CAM-03 `baggage-area` | 1 / 1 / 1 | 1 | 1 | **1/1** |

Asta **nu** e mAP și nu e recall pe un dataset: e un spot check pe 9 cadre, ca să știm dacă
„0 detecții” înseamnă „nu e nimeni” sau „sunt oameni, dar modelul nu îi vede”. Înseamnă al
doilea lucru pentru CAM-01/CAM-02.

## 6. Incidente

| Cameră | Detector | Incident local | Tip | Severitate | Zonă | Durată | `event_id` |
|---|---|---|---|---|---|---|---|
| CAM-03 | Lite0 | **da** | `RESTRICTED_ZONE` | `WARNING` | `baggage-area` | 2,033 s | `evt_baggage-area_1793695120711_1` |
| CAM-03 | Lite2 | **da** | `RESTRICTED_ZONE` | `WARNING` | `baggage-area` | 2,08 s | `evt_baggage-area_1793695146306_1` |
| CAM-01/CAM-02 | ambele | nu | — | — | — | — | — |

Cardul din rularea principală arată `INCIDENTE 1` pe CAM-03 pentru ambele detectoare, iar
coada de triaj are un rând `local` cu textul „Persoană în zona restricționată Zona bagaje —
banda 2.” Evenimentul apare în primele secunde după schimbarea camerei (fereastra de 15 cadre
+ `debounce_s = 2`), adică în fereastra de așezare a măsurătorii; de aceea `event_id`-ul și
durata exactă vin din rularea de confirmare, nu din buffer-ul de fps.

## 7. Context: mărimi de model și mAP vendor

| Model | ONNX | Intrare | mAP COCO (vendor) | Măsurat aici |
|---|---:|---|---:|---|
| `efficientdet_lite0.onnx` | 13 796 655 B (13,2 MiB) | 320×320, `uint8` NHWC | 25,7 | 6,1–8,1 fps; 0/4, 0/4, 1/1 |
| `efficientdet_lite2.onnx` | 22 948 355 B (21,9 MiB) | 448×448, `uint8` NHWC | 34,0 | 3,4–4,2 fps; 0/4, 0/4, 1/1 |
| `yunet.onnx` | 232 598 B (0,2 MiB) | dinamic, multiplu de 32 | — | 0 fețe în toate rulările |

Cifrele 25,7 și 34,0 sunt **mAP-ul COCO declarat de vendor** (Google/MediaPipe), pe setul de
validare COCO, nu pe aceste clipuri. Nu se compară cu numărătoarea de mai sus: un mAP de 34,0
nu spune câți dintre cei patru muncitori mici îi vede modelul pe un cadru 1280×720 după
letterbox. Aici contează numai detecțiile măsurate.

**Prima încărcare (localhost):** `ready` la 1,16 s (Lite0) și 1,28 s (Lite2); primul cadru
`running` la 1,52 s / 1,77 s. Toate cererile pentru modele au răspuns 200:
`efficientdet_lite0.onnx`, `yunet.onnx`, `ort-wasm-simd-threaded.asyncify.wasm`, plus chunk-ul
de worker. Zero 404, zero CORS, zero `requestfailed`. Timpii sunt de localhost, nu de Pages;
pe rețea reală se adaugă cei ~42,7 MB (Lite0 + YuNet + ORT) sau ~51,8 MB (Lite2 + YuNet + ORT).

## 8. `inputSize` 640 vs 1280 (opțional, Lite0)

Pagina `/bench`, `stand12.mp4`, 10 s, două rulări alternative pe fiecare mărime (1280, 640,
1280, 640), aceeași mașină:

| `inputSize` | fps (rulările) | p50 (ms) | p95 (ms) | persoane |
|---|---:|---:|---:|---:|
| 1280 | 6,1 / 5,7 | 136 / 141 | 156 / 173 | 0 |
| 640 | 6,0 / 5,5 | 139 / 137 | 168 / 476 | 0 |

Nu există un câștig măsurabil: p50 e practic identic, iar diferența de fps e în zgomotul
gazdei (un p95 de 476 ms la 640 arată cât de încărcată era mașina). Motivul e structural:
intrarea EfficientDet e fixă (320/448), deci `inputSize` schimbă doar decodarea, letterbox-ul
și YuNet, nu inferența care domină bugetul. Nu are sens să coborâm `inputSize` ca „optimizare”
pentru aceste modele.

## 9. Concluzie

1. **Lite0 e rapid, dar orb la muncitorii mici.** Median 6,1–8,1 fps pe cele trei clipuri;
   zero detecții pe CAM-01/CAM-02, deși în cadre se văd patru muncitori. Nu e o problemă de
   prag: cutiile lor devin prea mici la 320/448 px.
2. **Lite2 nu rezolvă gap-ul pe aceste clipuri.** E cu ~30–60% mai lent (median ~49%;
   3,4–4,2 fps) și produce doar o cutie slabă (0,37–0,38) lângă avion pe CAM-01/CAM-02; nu
   vede muncitorii mici din cadru. Pe CAM-03 ambele detectoare văd persoana și declanșează
   incidentul.
3. **Camera care merge azi e CAM-03.** Incidentul local `WARNING` / `baggage-area` apare cu
   ambele detectoare, în ~2 s. CAM-01/CAM-02 nu pot demonstra incidentul de zonă restricționată
   pe clipurile generate: niciun muncitor nu e aproape de cameră, iar cei din depărtare nu sunt
   detectați.
4. **Următorul pas de acuratețe nu e un alt model COCO, ci un benchmark pe footage real.**
   E nevoie de clipuri cu muncitori aproape de motor/bandă, de un set etichetat și de
   precizie/recall/mAP măsurate pe el; abia apoi are sens fine-tuning-ul sau schimbarea
   detectorului. Cifrele vendor (25,7 / 34,0) rămân context, nu dovadă pentru demo.

## 10. Reproducere

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
node scripts/serve-test.mjs --base /LocalSight/ --coi --port 4411

# în alt shell
node /tmp/opencode/detbench/run-benchmark.mjs       # 6 rulări × 35 s, JSON + capturi
node /tmp/opencode/detbench/bench-inputsize.mjs     # opțional: 640 vs 1280 pe /bench
```

Harness-ul citește detectoarele din `localStorage`, nu din UI, exact ca aplicația:
`localsight.engineSettings` cu `detector` = `efficientdet` sau `efficientdet-lite2`,
`wasmThreads: 4`, `safetyBlur: true`; `localsight.liveEngine = '1'`. Pentru Lite2 se poate
folosi și radio-ul din Setări, dar rezultatul e același: worker-ul se repornește și încarcă
graful nou. Scripturile și capturile au stat în `/tmp/opencode/detbench/` și **nu** se comit.

## 11. Limitări

- O singură rulare de 35 s pe celulă; load average 9–13 pe gazdă. Cifrele absolute sunt mai
  mici decât pe o mașină liniștită (README: 8,8 / 4,8 fps), deci comparația contează mai mult
  decât valoarea absolută.
- COOP/COEP au venit din antetele `serve-test --coi`, nu din reload-ul service worker-ului.
  Starea rezultată (`crossOriginIsolated`, 4 fire) e aceeași cu Pages după reload; calea
  service worker-ului e acoperită separat de suita `pages`.
- Spot check-ul vizual e pe 3 cadre per clip, nu pe un set etichetat; nu susține recall,
  precizie sau mAP.
- Clipurile CAM-01/CAM-02 sunt generate din același still Unsplash, cu pan/zoom; nu conțin
  un muncitor în prim-plan. Rezultatele nu se extrapolează la o cameră reală de apron.
- Cutia Lite2 de pe CAM-01/CAM-02 e clasificată „persoană” de model, dar vizual nu e un
  muncitor; am numărat-o ca detecție în card, nu ca recall.
- Fețele măsurate sunt cele ale YuNet la inputul plafonat de `safetyBlur`; 0 fețe nu înseamnă
  „nu există fețe în clip”, ci „YuNet nu a găsit niciuna la acel input”. Pentru recall-ul de
  fețe există testul dedicat din [`perf-face-cap.md`](perf-face-cap.md).
- Timpii de descărcare sunt de localhost. Pe Pages se adaugă latența rețelei și cache-ul
  browserului; cifrele de aici nu sunt un buget de primă vizită.
- Comparația `inputSize` a folosit pagina `/bench`, al cărei `<video>` ascuns nu pornește
  singur în headless; harness-ul a apelat `video.play()`. Nu s-a modificat codul aplicației.

## Dovezi

Au stat în `/tmp/opencode/detbench/` (în afara git):

- `results.json` — cele 6 rulări de 35 s: fps, persoane, fețe, aliniere, erori, resurse;
- `confirm-baggage.json` — rularea de 20 s care capturează `event_id`-ul și rândul de triaj;
- `inputsize.json` — cele 4 rulări 640/1280 de pe `/bench`;
- `run.log`, `confirm.log` — progresul și rezumatul per rulare;
- `*.png` — capturi ale cardului și ale ecranului Live pentru fiecare cameră × detector;
- `*_t1.jpg`, `*_t4.jpg`, `*_t7.jpg` — cadrele folosite la numărătoarea vizuală.

Legături: [`../browser-engine.md`](../browser-engine.md) (modelul și runtime-ul),
[`../media.md`](../media.md) (proveniența clipurilor), [`perf-face-cap.md`](perf-face-cap.md)
(recall-ul YuNet), [`../README.md`](../README.md) (indexul documentelor).
