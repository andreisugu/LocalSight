# Motorul din browser — notă de proiect

LocalSight mută pipeline-ul SafeSight din procesul Python de edge în tab. Documentul
descrie ce se portează, în ce modul JS ajunge fiecare piesă, ce se măsoară și ce rămâne
afară. Nu conține cod. Surse: `ml/safesight_ml/{pipeline,zones,privacy,detector,
ncnn_detector,ppe}.py`, `docs/performance.md`, `docs/contract.md`,
`frontend/src/services/api.js`, `frontend/src/engine/`, `frontend/scripts/prepare-models.py`,
`.github/workflows/pages.yml`.

## 1. Scop și constrângere

Scopul: același traseu demo (persoană în zona motorului → eveniment → incident cu
dovadă blurată → confirmare), dar fără backend, fără upload și fără proces pe server.

Constrângerile sunt fixe, nu preferințe:

| Constrângere | Consecință directă |
|---|---|
| Hosting static (GitHub Pages, `VITE_BASE=/LocalSight/` în `.github/workflows/pages.yml`, vezi `frontend/vite.config.js`) | Nu există `POST /edge/events`, nici `GET /events`; starea trăiește în memorie |
| Fără anteturi custom | Fără `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` ⇒ fără `SharedArrayBuffer` ⇒ WASM single-thread (secțiunea 5) |
| Fără upload, fără stocare | Cadrele nu părăsesc niciodată tab-ul; nici măcar snapshot-ul nu se salvează pe disc |
| Fără descărcare de modele la runtime | Cele două ONNX sunt urmărite în `frontend/public/models/` (excepție țintită în `.gitignore`) și Vite le copiază în `dist/` la build (secțiunea 4) |

Afirmația de confidențialitate devine literală: **nimic nu părăsește tab-ul**. Formularea
onestă, pentru UI și demo:

- cadrele, tensorii și snapshot-urile trăiesc doar în memoria tab-ului;
- blur-ul de fețe rulează înainte ca vreun cadru să fie desenat în snapshot sau în
  înregistrare, exact ca în `pipeline.py:191-202` (blur → shrink → overlay, în ordinea asta);
- ce pleacă pe rețea sunt doar fișierele statice ale aplicației (JS, `yolo26n.onnx`,
  `yunet.onnx`) și clipul demonstrativ — în jos, nu în sus. Un tab închis nu lasă nimic
  pe server, pentru că nu există server.

Limita care trebuie spusă, nu ascunsă: modelul și clipul se descarcă de pe origin-ul
Pages, deci un observator al traficului vede *ce* aplicație rulezi, nu ce vede camera.

## 2. Arhitectură

```text
main thread (React 19)                     Web Worker (engine)
┌──────────────────────────┐               ┌──────────────────────────────────────┐
│ <video loop muted>       │  ImageBitmap  │ frame loop (rVFC-paced)              │
│  clip .mp4 sau           │ ────────────► │  drawImage → OffscreenCanvas         │
│  getUserMedia(webcam)    │               │  detector (ORT-web) → tracker        │
│ controale: zonă, engine  │ ◄──────────── │  zones → RuleEngine → eveniment      │
│ listă incidente, KPI     │  events JSON  │  privacy (YuNet) → render + snapshot │
│ editor de zone           │  config JSON  │  in-memory store + metrics           │
└──────────────────────────┘               └──────────────────────────────────────┘
        ▲                                            │
        └──── canvas transferat (transferControlToOffscreen, țintă) ◄── desen adnotat
```

**Starea de azi.** Spike-ul de la `/lab` acoperă doar detectorul și blur-ul: `useEngine.js`
taie cadre din `<video>` (clip din `VITE_DEMO_VIDEO` sau fișier ales) și le trimite în
worker ca `ImageBitmap`; worker-ul întoarce cadrul adnotat, iar main thread-ul îl
desenează pe un canvas 2D. Tracker-ul, zonele, store-ul și `transferControlToOffscreen`
sunt încă ținta, nu cod.

Trei reguli de structură:

1. **Un singur traseu de cadre.** `<video>` primește un clip în buclă (URL din
   `VITE_DEMO_VIDEO` sau fișier ales); `getUserMedia` rămâne de adăugat. Restul codului
   nu știe care e sursa. Ritmul îl dă `requestVideoFrameCallback` (cu `requestAnimationFrame`
   ca fallback), nu `setInterval`: un cadru se procesează o singură dată, chiar dacă
   redarea are 30 fps și modelul duce 15.
2. **Worker-ul procesează pixelii.** Fiecare cadru ajunge în worker ca `ImageBitmap`
   (transferabil, fără copie prin structured clone) și iese tot ca `ImageBitmap`, pe care
   main thread-ul îl desenează. Ținta e `canvas.transferControlToOffscreen()`, ca main
   thread-ul să nu atingă pixelii deloc; un `body` de 8 MB pe cadru ar fi mai scump decât
   inferența.
3. **Un singur worker.** Fără `SharedArrayBuffer` nu există memorie partajată; un al
   doilea worker ar însemna o a doua sesiune ONNX și doi tensori de 1080p în RAM.

Sursa se schimbă din UI fără reload: se înlocuiește `src`-ul clipului, iar worker-ul reia
cadrele la noua dimensiune. Pentru `getUserMedia` rămân de făcut oprirea `MediaStream`-ului
și mesajul `{type: 'source', width, height}`.

Modulele din `frontend/src/engine/` (spike-ul):

| Fișier | Rol |
|---|---|
| `worker.js` | bucla de cadre, un singur cadru în zbor, YOLO + YuNet + blur, mesaje |
| `detectors.js` | încărcare ORT-web (`webgpu` cu fallback WASM), letterbox 640, `runYolo` / `runYuNet`, `rgbaToNchw` |
| `decode.js` | decodare YOLO26n (640, conf 0.35, NMS 0.45, clasa 0) și YuNet (stride 8/16/32, NMS 0.3) |
| `useEngine.js` | hook React: worker, `requestVideoFrameCallback`, canvas, statistici |

Restul planului de port nu există încă: `tracker.js`, `zones.js`, `privacy.js`,
`pipeline.js`, `render.js`, `store.js`, `metrics.js`, `protocol.js`.

## 3. Ce se portează, funcție cu funcție

| Python | Sursă | Modul JS | Ce se schimbă la port |
|---|---|---|---|
| `Pipeline.process` | `pipeline.py:141` | `pipeline.js` | `np.ndarray` → `ImageBitmap`/`OffscreenCanvas`; timpul vine din `video.currentTime` convertit în secunde |
| `Pipeline._in_cooldown` | `pipeline.py:134` | `pipeline.js` | neschimbat: un incident per tip+zonă la 60 s |
| `StageTimer` | `pipeline.py:54` | `metrics.js` | aceleași nume de etape (`detect`, `blur`, `overlay`, `snapshot`, `emit`) ca să fie comparabile cu `--metrics-json` |
| `annotated()` | `pipeline.py:191` | `render.js` | ordinea se păstrează: blur, apoi shrink la `max_width`, apoi overlay |
| calea `AsyncLiveWriter` | `pipeline.py:204-223` | `worker.js` | „drop, nu coadă”: dacă un cadru nou sosește cât timp se renderizează, cel vechi se aruncă |
| `point_in_polygon` | `zones.py:43` | `zones.js` | ray casting identic, coordonate normalizate |
| `signed_distance` | `zones.py:62` | `zones.js` | fără `cv2.pointPolygonTest`: distanță minimă punct–segment, semn din paritate, `aspect = w/h` ca la Python |
| `TRUNCATED_BOTTOM = 0.985` | `zones.py:59` | `zones.js` | constantă; când `y2 >= 0.985` starea de membru îngheață |
| `ZoneMembership` (marjă 0.10, ttl 10 s) | `zones.py:71` | `zones.js` | aceeași bandă `margin * (y2-y1)`; histerezisul e ce oprește flicker-ul pe marginea poligonului |
| `RuleEngine.observe` (fereastră 15, minim 5, ratio 0.8, cooldown 10 s) | `zones.py:139` | `zones.js` | fereastra se numără în **cadre procesate**, cooldown-ul în secunde — la fel ca azi; `emitted` rămâne „un eveniment per prezență” |
| `triggers_event`, `EVENT_TYPE_BY_RULE` | `pipeline.py:23,35` | `zones.js` | `RESTRICTED` → oricine; `PPE_REQUIRED` → doar `no_vest`; `unknown` tăcut |
| `Zone` (validare 0..1, `debounce_s`, `severity`) | `zones.py:18` | `zones.js` | validarea rămâne la marginea de intrare, nu în UI |
| `_Yunet.detect` + padding multiplu de 32 | `privacy.py:73` | `privacy.js` | `Float32Array` NCHW, BGR, fără medie; pad cu zerouri, fără rescalare |
| `_decode_yunet` + `_nms` | `privacy.py:119,156` | `privacy.js` | `sqrt(cls*obj)`, stride 8/16/32, NMS 0.3 — identic, doar pe typed arrays |
| `_dynamic_input` | `privacy.py:106` | build step | nu se face în browser; modelul se patch-uiește înainte de publicare (secțiunea 4) |
| `_strong_blur` (shrink 8×, blur, up) | `privacy.py:275` | `privacy.js` | `drawImage` la 1/8 cu `imageSmoothingQuality: 'high'`, `ctx.filter = 'blur(3.1px)'` pe canvasul mic, apoi înapoi; fallback pe box-blur 3×3 dacă `filter` lipsește |
| `_blur_box` (marjă 0.2, bandă de cap 0.35) | `privacy.py:225-252` | `privacy.js` | plasa de siguranță pentru fețe mici rămâne obligatorie |
| `FaceBlurrer` fail-closed | `privacy.py:179` | `privacy.js` | dacă `yunet.onnx` nu se încarcă: fără snapshot, fără înregistrare, banner explicit |
| `detector.letterbox` + `decode` (640, fill 114, conf 0.35, NMS 0.45, clasa 0) | `ncnn_detector.py:32,49` | `detector.js` | aceiași parametri; decodarea anulează letterbox-ul înainte de pipeline |
| ByteTrack | `detector.py:106` | `tracker.js` | **înlocuit**, vezi mai jos |
| `vest_sample` / `VestTracker` | `ppe.py` | `vest.js`, apelat din `worker.js` | HSV pe `ImageData` din cadrul brut, înainte de blur; `vestStates` intră în `pipeline.step()`. Fără `cv2.inRange`, doar aritmetică pe `Uint8ClampedArray` |
| `FaceBlurrer.blur_with_faces` (banda de cap 0.35) | `privacy.py:200-235` | `worker.js` | după blurul pe fețe, se blurează topul de 35% al fiecărei persoane — plasa de siguranță pentru fețele ratate de YuNet |
| `Sink.store_snapshot` | `sink.py` | `store.js` | `convertToBlob({type:'image/jpeg', quality:0.8})` → `URL.createObjectURL`, revocat la închiderea incidentului |

**Trackerul IoU care înlocuiește ByteTrack.** ByteTrack are două stagii (detecții
încrezătoare, apoi cele slabe) și un Kalman care nu merită portat pentru o singură cameră.
Portul minim: potrivire lacomă pe IoU ≥ 0.3 între cutiile cadrului anterior și cele
actuale, ordonate după scor; un track nematch-uit supraviețuiește 30 de cadre, apoi moare;
id-urile cresc monoton și nu se refolosesc. Consecința de măsurat: la o ocluzie lungă id-ul
se schimbă, iar `(track_id, zone.id)` din `RuleEngine` și `ZoneMembership` repornește de la
zero — un eveniment poate întârzia cu o fereastră, nu se pierde și nu se dublează
(cooldown-ul de 60 s per tip+zonă rămâne plasa de siguranță). Id-urile sunt valabile doar
în sesiunea tab-ului; nu se compară între reload-uri.

**Evenimentul** păstrează plicul din `docs/contract.md:13` — `event_id` cu formatul
`evt_<camera>_<unix_ms>_<track>`, `confidence` ca
`{ detector, temporal: { seen, window } }`, severitate doar `CRITICAL`/`WARNING`.
Un singur câmp se abate de la contract: `snapshot_url` devine `blob:` în loc de URL HTTP
(`docs/contract.md:41`), pentru că nu există server care să servească `/snapshots/`.
Abaterea e limitată la build-ul static și trebuie notată în README-ul lui, nu în contract.

## 4. Active de model

| Fișier | Mărime | Licență | Intrare | De ce așa |
|---|---|---|---|---|
| `yolo26n.onnx` | 9,9 MB (9 930 308 B) | AGPL-3.0 (Ultralytics) | 1×3×640×640 fp32 | exportat din `yolo26n.pt`; fp32 pentru că int8 QDQ a ieșit de 2,4× mai lent pe CPU (`docs/performance.md`, rândul „YOLO int8”) și pentru că WebGPU nu are suport bun pentru cuantizare |
| `yunet.onnx` | 232 KB (232 598 B) | MIT (OpenCV Zoo, `face_detection_yunet_2023mar`) | H×W dinamic, multiplu de 32 | modelul publicat declară 640×640 fix; `privacy.py:106-116` îl face deja dinamic |

**De ce patch-ul dinamic e obligatoriu.** Graful YuNet are straturi de fuziune care cer
ca ambele laturi să fie multipli de 32 (`privacy.py:17-20`). Dacă inputul rămâne 640×640,
singura variantă în browser ar fi să redimensionăm fiecare cadru 1080p la 640 — exact
scurtătura pe care `docs/performance.md` o respinge: 1920 → 720p a tăiat fețele găsite
de la 62 la 8. Deci: dims `height`/`width` simbolice în graful ONNX, cadru real umplut cu
zerouri până la multiplu de 32, fără rescalare. Patch-ul e un pas de build
(`frontend/scripts/prepare-models.py`, Python + `onnx`), nu cod de runtime.

**Cum ajung fișierele pe Pages.** Cele două `.onnx` sunt urmărite în
`frontend/public/models/` — excepția țintită din `.gitignore`; restul modelelor rămâne
ignorat — și se regenerează cu `python3 frontend/scripts/prepare-models.py`. Vite copiază
`public/` în `dist/`, deci job-ul din `.github/workflows/pages.yml` nu descarcă nimic:
`npm run build` le include same-origin, fără CORS și fără pas separat de copiere. Un fetch
dintr-un release extern ar adăuga o dependență de rețea în calea critică de pornire.

## 5. Runtime

- `onnxruntime-web`, două sesiuni în același worker: `detector` și `privacy`.
- Provideri în ordine: `['webgpu', 'wasm']`. Se decide o singură dată, la pornire, după
  `navigator.gpu` și după ce `requestAdapter()` întoarce un adaptor real (nu software).
  Alegerea se afișează în UI: „WebGPU” sau „WASM (fără accelerare)”.
- Un warm-up obligatoriu: o inferență pe un tensor zero înainte de primul cadru real;
  prima rulare include compilarea shader-elor și nu reprezintă performanța.
- WebGPU cere build-ul `jsep` al ORT-web (îl include pe cel WASM); mărimea livrată e de
  verificat, nu presupusă. `executionMode: 'parallel'` nu ajută fără fire.

**De ce WASM cu fire nu e o opțiune pe Pages.** `onnxruntime-web` folosește
`SharedArrayBuffer` pentru `numThreads > 1`, iar `SharedArrayBuffer` cere
`crossOriginIsolated === true`, adică anteturile COOP/COEP. GitHub Pages nu permite
anteturi custom, iar `pages.yml` publică doar artefactul static — nu există unde pune
anteturile. Consecință: fallback-ul WASM e single-thread și semnificativ mai lent decât
cele 4 fire din `privacy.py:24`, care dădeau 26 ms la 1080p. Fallback-ul e pentru
corectitudine, nu pentru demo.

## 6. Buget de performanță

Referința sunt cifrele măsurate pe build-ul CPU (`docs/performance.md`, Ryzen 7 7840HS,
OpenCV 5.0, YOLO26n, YuNet 2023mar), o cameră la 1080p:

| Etapă | Python, torch | Python, ncnn (Vulkan) | Observație |
|---|---|---|---|
| citire cadru | 2 ms | 2 ms | în browser: `createImageBitmap` + transfer |
| detect (YOLO 640) | 28 ms ACTIVE / 55 ms PASSIVE | 17.9 ms | 85–90% din bucla de edge |
| blur (YuNet 1080p + blur) | 26 ms (4 fire) | 26 ms | doar pe cadrele scrise și la evenimente |
| overlay | 13–19 ms | 13–19 ms | doar pe cadrul scris |
| throughput, 3 camere | 14,4–14,8 fps | 20,0–20,1 fps | browserul rulează **o** sursă |

Ținte de verificat în browser — **ipoteze, nu fapte**:

| Măsurătoare | Ipoteză | De ce ar putea să nu țină |
|---|---|---|
| YOLO26n 640, WebGPU | 5–15 ms | upload fp32 640×640 (~4.9 MB) + readback; drivere care serializează |
| YOLO26n 640, WASM single-thread | 40–90 ms | ~4× mai lent decât 4 fire; sub 12 fps |
| YuNet 1080p, WebGPU | 20–50 ms | intrare fp32 1920×1080 = ~8.3 MB per cadru; modelul e mic, transferul domină (aceeași concluzie ca la iGPU + ncnn în `docs/performance.md`) |
| YuNet 1080p, WASM | 80–200 ms | un singur fir față de 4 |
| primul cadru după încărcare | < 3 s | depinde de cache; rece: 9,9 MB + runtime |
| memorie tab | < 300 MB | buffere 1080p + blob-uri de snapshot |

Reguli de buget care decurg din referință:

- **blur-ul nu rulează pe fiecare cadru**, ca în `pipeline.py:204-223`: o trecere pe
  cadrul afișat (câteva pe secundă) și una proaspătă la fiecare eveniment. Dacă blur-ul
  ajunge pe fiecare cadru, bugetul se dublează.
- **fereastra de 15 cadre rămâne în cadre**, nu în milisecunde: la 8 fps, 15 cadre înseamnă
  ~1.9 s, iar `debounce_s` din zonă (1 s implicit) devine limita reală. De notat în UI.
- **overlay-ul se desenează pe cadrul mic**, după shrink, ca în `pipeline.py:197-202`;
  metricile păstrează numele etapelor, ca tabelul din `docs/performance.md` să poată fi
  refăcut pentru browser fără traducere.

## 7. Ce rămâne în afara scopului

| Azi (server) | În browser | Notă |
|---|---|---|
| Slack (`automation/`) | nimic; evenimentul apare în listă | un webhook în bundle-ul public e un secret public, deci nu |
| MJPEG `/stream/{id}.mjpg` | canvas-ul adnotat | feed-ul e canvas-ul, nu un stream |
| SQLite + `backend/` | `store.js` în memorie | se pierde la reload; zona și `acked` pot merge în `localStorage` |
| Raport scris de LLM | șablon determinist (`what/where/when/severity_reason/recommended_action`) | aceleași câmpuri ca `mapEvent`/`regenerateReport` din `frontend/src/services/api.js` |
| PDF de tură | opțional, client-side (pdf-lib) sau `window.print()` cu stylesheet | nu e în demo |
| escaladare pe server | `setTimeout` în tab | moare la închiderea tab-ului; se spune în UI |
| WebSocket `/ws/events` | bus intern + `BroadcastChannel` | două tab-uri nu partajează evenimente |
| `X-Edge-Token`, ingest, idempotență, 3 camere simultan | nu există; o sursă odată | fără rețea nu există replay, iar bugetul de mai sus e per feed |

`api.js` rămâne suprafața pe care o vede UI-ul: aceleași nume de metode
(`getCameras`, `getZones`, `getEvents`, `acknowledgeEvent`, `getKPIs`, `getShiftReport`),
implementate de `store.js` în loc de `fetch`. `connectEventsSocket` devine un abonament la
bus. Astfel componentele nu se rescriu, iar build-ul mock (`VITE_USE_MOCK=true`) rămâne al
treilea mod de rulare, util când WebGPU lipsește.

## 8. Riscuri și întrebări deschise

1. **WebGPU pe mașina privitorului.** Cel mai probabil mod de eșec al demonstrației.
   Fallback-ul WASM single-thread poate coborî sub 10 fps și face demo-ul să pară stricat.
   De decis: prag minim (dacă YOLO > 80 ms, se afișează explicit „rulează în mod lent”) și
   dacă demo-ul oficial cere Chrome/Edge pe desktop. De măsurat pe o placă integrată, una
   dedicată și un Mac.
2. **Costul YuNet la 1080p.** Ipoteza 20–50 ms poate fi optimistă dacă transferul domină;
   alternative dacă nu ține: blur pe banda de cap a cutiei de persoană ca mecanism
   principal (există deja ca plasă de siguranță, `privacy.py:225-231`) și YuNet doar pe
   regiunea persoanelor — dar decupajele pierd 21–46% din fețe (`docs/performance.md`),
   deci nu e o simplă optimizare.
3. **Încărcarea modelelor.** 9,9 MB + runtime ORT + compilare de shadere: primul cadru
   poate întârzia pe o conexiune de sală, iar fără cache fiecare reload plătește din nou.
   De decis dacă demo-ul are un ecran de încărcare cu progres real.
4. **Memoria.** Un cadru 1080p RGBA e 8.3 MB, tensorul fp32 NCHW al YuNet alți 8.3 MB,
   fiecare snapshot un blob. Fără `revokeObjectURL` și fără limită de snapshot-uri, tab-ul
   crește monoton într-o tură de 8 ore.
5. **Limitele Pages.** Sit de 1 GB, trafic lunar limitat, fișiere sub 100 MB — OK pentru
   10 MB de modele, dar un clip demo 1080p lung le poate atinge; fără anteturi custom,
   orice idee care are nevoie de un antet moare aici.
6. **Continuitatea id-urilor de track.** Un tracker IoU simplu schimbă id-ul la ocluzie;
   asta resetează fereastra de 15 cadre și poate întârzia un eveniment. De măsurat numărul
   de `transitions` per incident față de ByteTrack, pe aceleași clipuri.
7. **Baza de timp.** `RuleEngine` numără cadre, `debounce_s` și cooldown-ul numără secunde.
   În browser, secunda trebuie să vină din `video.currentTime` (ca un replay încetinit sau
   accelerat să nu mintă), nu din `performance.now()`. De confirmat cu un clip redat la 0.5×.
8. **`snapshot_url` ca `blob:`.** Abatere de la `docs/contract.md:41`, acceptabilă doar cât
   timp nu există consumatori HTTP. Dacă apare un backend lângă build-ul static, câmpul
   trebuie să redevindă URL HTTP și exportul să treacă prin `store.js`.
9. **Fallback-ul de blur.** `ctx.filter` nu e garantat identic peste tot; dacă lipsește,
   blur-ul de rezervă trebuie să fie cel puțin la fel de puternic, nu doar „ceva”. Regula
   din `privacy.py:179` se păstrează: mai bine fără imagine decât cu o față clară.
