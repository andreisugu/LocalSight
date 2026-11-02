# Verificare de confidențialitate — „nicio față neblurată nu ajunge pe ecran sau în rețea”

**Branch:** `prep/qa-privacy` · **Build testat:** `VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`,
servit static pe `http://127.0.0.1:4212/LocalSight/` (preview Vite, comportament de Pages pentru subpath).
**Browser:** Chromium headless (Playwright 1.64), viewport 1600×1000, fără adapter WebGPU ⇒ motorul a rulat
pe WASM single-thread (~1 fps). **Data:** 2 noiembrie 2026. **Autor:** QA privacy (subagent), fără modificări
de cod de aplicație.

**Verdict scurt:** jumătatea „rețea” a afirmației rezistă — nu am găsit niciun upload, niciun POST, niciun
cadru trimis. Jumătatea „ecran” **nu** rezistă: există cel puțin patru căi reproductibile prin care clipul brut,
cu fețe clare, apare pe ecran, iar garda de blur e **fail-open** când modelul YuNet nu se încarcă.

---

## 1. Mediu și metodă

- Build de producție (nu dev server), exact ca Pages: `VITE_USE_MOCK=true VITE_BASE=/LocalSight/`.
  Pentru testul de blur am adăugat `VITE_MEDIA_VIDEO=/LocalSight/media/qa-test-faces.mp4`, o singură
  variabilă de mediu care schimbă doar URL-ul clipului; codul de randare e identic. Am repetat testul cheie
  și pe clipul livrat în repo (`media/stand12.mp4`) fără override.
- Clip de test cu fețe: `2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4` (sursă demo,
  3840×2160), transcodat la 1920×1080, 8 s, fără audio, în `frontend/public/media/` **doar pentru test**
  (șters după rulare, nu e în commit).
- Instrumentare: Playwright, interceptarea tuturor request-urilor (`page.on('request')`), capturi de ecran
  programate, citirea pixelilor din canvas cu `getContext('2d').getImageData`, `toDataURL`, măsurare în pagină
  a momentului primului desen pe canvas (`canvas.width` trece de la 300 la dimensiunea bitmap-ului).
- Pentru blur: YuNet (`models/yunet.onnx`, exact modelul aplicației) rulat offline cu OpenCV pe fiecare cadru
  al clipului; fiecare eșantion de canvas a fost aliniat la cadrul video corespunzător prin potrivire de
  imagine (eroare MAE 1,8–3,0 față de 12–21 pentru al doilea candidat), apoi comparat în cutia feței.

---

## 2. Ce am verificat

### 2.1 Rețea — nicio imagine trimisă

Am înregistrat **102 request-uri** în trei scenarii (Live cu motorul pornit, pornire din buton, pagini
`/incidents` + `/lab`). Toate au fost `GET`; **zero `POST`**, zero request-uri cu body.

| Host | Nr. | Tip | Observație |
|---|---|---|---|
| `127.0.0.1:4212` (origin) | 102 | document, script, stylesheet, image, media, fetch | numai active statice ale aplicației |
| `images.unsplash.com` | 1 | image | fixture mock de incident, **download**, nu upload |
| `thumb.wikimedia.org` | 2 | image | fixture mock de incident, **download** |
| `blob:` | 3 | image, media | URL-uri locale (`blob:pending`, fișier ales în `/lab`) — fără rețea |

Descărcările de runtime sunt toate same-origin: `models/yolo26n.onnx` (9,9 MB), `models/yunet.onnx`
(232 KB), `assets/ort-wasm-simd-threaded.asyncify-*.wasm` (28,7 MB), chunk-ul ORT și worker-ul.
Nu există CDN, font extern sau analytics. **Niciun cadru, bitmap, tensor sau snapshot nu pleacă în rețea.**

Singura abatere de la formularea „doar fișierele statice ale aplicației” din `docs/browser-engine.md` §1:
build-ul mock aduce trei imagini de fixture de pe Unsplash/Wikimedia când se deschide lista/detaliul de
incidente. Sunt descărcări, nu conțin cadre din camera ta, dar vizitatorul își expune IP-ul către terți.

### 2.2 Canvas în regim stabil — blur-ul chiar se aplică

Pe clipul de test, 22 de eșantioane de canvas luate la ~1,4 s pe parcursul a ~31 s, cu motorul pornit:

- **18/18** fețe detectate de YuNet (prag 0,6) în cadrele video potrivite au fost acoperite de o cutie de față
  desenată de motor (IoU 0,66–0,81) și interiorul a fost aplatizat: varianța Laplaciană a scăzut de la
  **431–9000** (video brut) la **0,0–1,3** (canvas).
- **Nicio** față cu scor ≥ 0,6 nu a fost detectabilă în canvas (detecții doar 0,42–0,58, provocate de conturul
  cutiilor; pragul aplicației e 0,6).
- Pe clipul livrat `media/stand12.mp4`: 12 eșantioane, 10 fețe în cadrele potrivite, **10/10** acoperite,
  varianță în interior 0,0–1,3.
- Canvasul desenat e opac: alpha = 255 la toate cele 5 puncte eșantionate, `position:absolute; inset:0`,
  același `object-cover` ca videoclipul. După primul cadru procesat, clipul brut nu se vede prin canvas.

Observație cosmetică (nu e scurgere): blur-ul iese aproape negru, nu „încețoșat”, pentru că patch-ul se
micșorează de 8× (2–3 px la fețele mici) și filtrul `blur()` e aplicat pe un canvas atât de mic. Fața e
distrusă ireversibil, dar arată ca un pătrat negru.

### 2.3 Ferestre în care se vede clipul brut pe ecran

Canvasul există în DOM imediat ce motorul e cerut, dar contextul 2D și primul desen apar abia la primul
rezultat din worker (`useEngine.js:113-125`). Până atunci canvasul e 300×150, transparent, iar `<video>` de
dedesubt rulează nestingherit. Măsurat:

| Moment | Primul desen pe canvas | Fereastră cu clip brut |
|---|---|---|
| Încărcare pagină, motor pornit din preferință | 2 954 ms după navigare | **~2,87 s** (video pornește la 85 ms) |
| Click pe „Pornește motorul în browser” | 2 691 ms după click | **~2,67 s** |
| Ieșire din fullscreen (motorul repornește) | 2 509 ms după ieșire | **~2,5 s** |

Capturi la 250, 600, 1000, 1400, 1800, 2200, 2800 ms după încărcare: până la 2200 ms se vede clar clipul brut
(canvas 300×150), cu fețele lucrătorilor neblurate; la 2800 ms canvasul are 1920×1080.

### 2.4 Fullscreen, motor oprit, browser fără worker

- **Fullscreen** (`LiveView.jsx:301-397`): se randează doar `<video>`, fără canvas — `canvasCount = 0`,
  video 1920×1080. Clipul brut umple ecranul, cu fețele clare; există doar eticheta „detecția este oprită —
  cutiile nu urmăresc video”. Nu e o scurgere accidentală, dar contrazice literal „nicio față neblurată pe ecran”.
- **Motor oprit** (butonul „Oprește motorul în browser”): canvasul dispare complet, clipul brut rămâne.
- **Browser fără `Worker`/`OffscreenCanvas`** (simulat): panoul zice „browser neacceptat”, badge-ul de pe
  video zice „procesat local · — fps”, dar canvasul rămâne gol și clipul brut rulează, fără niciun avertisment
  că ceea ce vezi e brut (`useEngine.js:86-93`, `LiveView.jsx:673-677`).
- **Implicit pe browsere fără adapter WebGPU** (`LiveView.jsx:159-164`): motorul pornește **oprit**, deci
  vizitatorul vede clipul brut cu fețe indefinit, până apasă butonul. În headless, `navigator.gpu` există dar
  `requestAdapter()` întoarce null — exact cazul măsurat: 0 canvas, video redat.

### 2.5 Fail-open la modelul de fețe (critic)

Am blocat `models/yunet.onnx` (`route.abort()`). Rezultat: worker-ul intră pe ramura de passthrough
(`worker.js:351-369`) și trimite cadrul **neblurat** la 16–22 fps. Panoul arată „eroare / cannot fetch
…/yunet.onnx”, dar canvasul afișează clipul brut.

Dovadă numerică, aceeași regiune 240×120 citită din canvas și din `<video>`: **diferență medie absolută 0,0,
100 % pixeli identici**, varianță Laplaciană 1335 în ambele. Adică pixelii afișați sunt exact cadrul brut.

Aceasta e exact situația în care garda de confidențialitate ar trebui să se închidă: `AGENTS.md` cere
fail-closed („dacă modelul de fețe nu se încarcă, nu se produce imagine”), codul face fail-open.
A doua cale, mai subtilă: dacă `detectFaces`/`runYuNet` aruncă în timpul unui cadru, `catch`-ul de la
`worker.js:401-404` lasă `faces = []`, iar `blurFaces` de la linia 406 nu are ce blura — cadrul pleacă
neblurat cu `error` setat.

### 2.6 localStorage

În Live, după pornirea motorului: **un singur** lucru — `localsight.liveEngine` = `"1"` (1 octet).
Pe `/incidents`: niciun key scris. Nu există pixeli, cadre, snapshot-uri, nume de fișiere sau coordonate.

Din cod (nu declanșate în test):
- `localsight.operator` — numele operatorului, doar dacă îl tastează cineva în Setări (`SecurityContext.jsx:18-35,
  130-137`). E un nume de persoană, dar local, nu un cadru.
- `localsight.bench` — după o rulare `/bench`: provider, dimensiune, fps, p50/p95/mean, număr de cadre,
  `navigator.userAgent`, `hardwareConcurrency` (`BenchView.jsx:10, 187-199`). Amprentă de dispozitiv, fără imagini.

Nimic personal nu ajunge acolo în fluxul demo implicit.

### 2.7 `snapshot_url` și `blob:pending`

- Motorul setă `snapshot_url: "blob:pending"` (`pipeline.js:34-38`, trimis din `worker.js:430`).
- Detaliul incidentului încearcă să-l încarce: `<img src="blob:pending">` (`IncidentDetailView.jsx:161-166`).
  Rezultat măsurat: `naturalWidth = 0`, imagine ruptă; browserul emite doar un request de schemă `blob:`
  (fără host, fără HTTP). **Nicio cerere de rețea.**
- **Niciun cod nu creează un snapshot real** din cadre: `createObjectURL`/`toDataURL`/`toBlob` apar doar pentru
  export CSV (`ReportsView.jsx:49`), fișiere alese local în `/bench` și `/lab` (`BenchView.jsx:323,333`,
  `LabView.jsx:259`) și upload-ul de cadru de referință din editorul de zone (`ZoneEditorView.jsx:478`).
  Deci azi nu poate exista un snapshot neblurat — dar nici unul blurat: facilitatea nu e implementată.

### 2.8 Ordinea blur → draw → `postMessage` în cod

`worker.js`, `handleFrame`:

1. `frameCtx.drawImage(bitmap)` — cadrul brut intră în `frameCanvas` (linia 348).
2. Detectoare: YOLO (379-388), YuNet (390-400).
3. `blurFaces(frameCtx, faces, width, height)` — **linia 406**, înainte de orice desen final.
4. `drawBoxes(...)` pentru persoane și fețe (407-408) — peste blur, nu sub el.
5. Pipeline/evenimente (413-436), cu `snapshotUrl: SNAPSHOT_PENDING`.
6. `frameCanvas.transferToImageBitmap()` și `post({type:'result', bitmap})` — **438-451**.

Nu există nicio cale în care un bitmap **procesat** să fie postat înainte de linia 406. Singura excepție este
ramura de eroare de la liniile 351-369, care postează `frameCanvas` direct, fără detectare și fără blur —
fail-open-ul de la 2.5. `useEngine.js:224-232` trimite cadrul brut către worker (main → worker, în tab), ceea
ce nu e nici ecran, nici rețea; worker-ul serializează cadrele cu `queue` (454-499) și aruncă frame-urile cât
timp unul e în lucru (`inFlight`, 211), deci nu există o cursă între două cadre.

---

## 3. Constatări clasate

| # | Severitate | Constatare | Dovadă / reproducere | Cod |
|---|---|---|---|---|
| 1 | **CRITIC** | **Fail-open:** dacă `yunet.onnx` nu se încarcă (sau YuNet aruncă), canvasul afișează cadrul brut, pixel-identic, la 16–22 fps. | Blochează `**/models/yunet.onnx`, pornește motorul: panoul zice „eroare”, canvasul arată clipul brut; diff 0,0 față de `<video>`. | `worker.js:351-369`, `401-406` |
| 2 | **CRITIC** | **Fullscreen arată clipul brut**, fără canvas, cu fețe clare, doar cu o etichetă. | Butonul de fullscreen pe feed: `canvasCount = 0`, video 1920×1080. | `LiveView.jsx:301-397` (video 356-368, etichetă 387-391) |
| 3 | **CRITIC** | **Fereastră de 2,5–3 s cu clip brut la fiecare pornire** a motorului (încărcare pagină, toggle ON, ieșire din fullscreen): canvasul e gol până la primul rezultat. | Capturi la 250–2200 ms după încărcare arată video brut, canvas 300×150; primul desen la 2 954 ms. | `LiveView.jsx:643-649`, `useEngine.js:113-125` |
| 4 | **MAJOR** | **Blur-ul acoperă doar fețele detectate.** Cu 3 oameni în cadru, YuNet a găsit 1 față; al doilea lucrător are fața (profil) vizibilă și ascuțită pe canvasul „procesat”. | Eșantion de canvas 1920×1080 din clipul de test: o cutie de față pentru 3 persoane; decupajul capului neacoperit arată fața clar. | `worker.js:390-408` (prag `FACE_CONF = 0.6`, linia 24) |
| 5 | **MAJOR** | **Browser fără `Worker`/`OffscreenCanvas`:** motorul e „pornit” în UI, dar canvasul rămâne gol și clipul brut rulează, fără avertisment. | `Worker`/`OffscreenCanvas` șterse înainte de încărcare: panou „browser neacceptat”, badge „procesat local · — fps”, canvas 300×150, video redat. | `useEngine.js:86-93`, `LiveView.jsx:238-249, 673-677` |
| 6 | **MAJOR** | **Implicit, pe browsere fără adapter WebGPU, motorul e OPRIT** și clipul brut (cu fețe) rulează la nesfârșit până la click. | Vizită nouă, fără preferință stocată: 0 canvas, overlay „detecția este oprită”, video redat. | `LiveView.jsx:139-164` |
| 7 | **MINOR** | Mock-ul aduce imagini de fixture de pe `images.unsplash.com` și `thumb.wikimedia.org` (GET, fără date de la cameră). Contrazice „doar fișierele statice ale aplicației”. | Lista/detaliul de incidente: 3 request-uri către terți. | `constants/mockData.js:86-90` |
| 8 | **MINOR** | **Upload de cadru de referință fără blur în browser** (build cu API real): un JPEG ales de operator e convertit și trimis prin `POST /zones/reference-frame`. UI-ul doar cere „folosește un cadru deja blurat”. | Cod: `canvas.toBlob` → `File` → `captureReferenceFrame`; în mock nu se execută. | `ZoneEditorView.jsx:466-483`, `services/api.js:306-313` |
| 9 | **INFO** | Detaliul unui incident de motor afișează o imagine ruptă (`blob:pending`, `naturalWidth 0`). Bug de UI, fără impact de confidențialitate. | Click pe „Detalii Incident” pentru un eveniment produs de motor. | `IncidentDetailView.jsx:161-166`, `pipeline.js:34-38` |
| 10 | **INFO** | Blur-ul iese ca un dreptunghi aproape negru, nu ca un blur natural. Confidențialitate OK, estetică nu. | Decupaj din canvas: interior uniform (std 0,24, varianță 0,4). | `worker.js:256-282` |

**Trec, verificate:** rețeaua (niciun upload, niciun POST), opacitatea canvasului după primul cadru, blur-ul
efectiv pe fețele detectate (28/28 în două rulări), schimbarea rapidă de cameră (canvasul păstrează cadrul
blurat anterior, fără fereastră brută), redimensionarea ferestrei (canvas 1920×1080 afișat la 626×351,
`object-cover`, fără scurgere), `/lab` (video ascuns, doar canvasul vizibil), `/lab` cu camera
(`getUserMedia`, video ascuns, canvas 1280×720), localStorage fără date de imagine.

---

## 4. Ce NU am putut verifica (explicit)

- **WebGPU real.** Headless-ul nu are adapter, deci tot ce s-a măsurat e calea WASM (~1 fps). Calea WebGPU
  folosește același worker și același `blurFaces`, dar ferestrele de pornire ar fi mai scurte; nu le-am măsurat.
- **Cameră fizică cu fețe reale.** Am testat doar dispozitivul fals Chromium (model colorat, fără fețe) și
  calea de cod e aceeași ca la clip. Nu pot afirma nimic despre fețele dintr-o cameră reală.
- **Safari/Firefox** și comportamentul `OffscreenCanvas`/`requestVideoFrameCallback` acolo.
- **Bugetul de cadre.** Eșantionare la ~1,4 s, nu cadru cu cadru: la 1 fps worker-ul a produs ~30 de cadre în
  30 s și le-am verificat pe toate cele eșantionate. Nu exclud o rată de blur ratat între eșantioane.
- **Build-ul cu API real** (fără `VITE_USE_MOCK`): upload-ul de cadru de referință și `captureReferenceFromLive`
  nu au fost executate.
- **Fețele din afara clipurilor demo** (unghiuri, ocluzii, fețe foarte mici). Rezultatul 4/4 arată că garda
  depinde de detector, nu e o garanție geometrică.
- **Comportamentul CDN-ului GitHub Pages** (compresie, cache, antete); preview-ul local aproximează servirea statică.

---

## 5. Verdict

**Nu putem susține azi, onest, afirmația „nicio față neblurată nu ajunge niciodată pe ecran sau în rețea”.**

Jumătatea despre rețea este adevărată și verificată: toate cele 102 request-uri din scenariile testate au fost
`GET` same-origin (plus trei imagini de fixture de la terți), zero `POST`, zero body-uri, niciun cadru sau
snapshot trimis. Snapshot-urile de incident nu există deloc (`blob:pending` e un URL mort), deci nu există nici
un snapshot neblurat care să poată pleca.

Jumătatea despre ecran este falsă în forma literală. Clipul brut cu fețe apare: (a) implicit, cât timp motorul
e oprit — inclusiv pe orice browser fără adapter WebGPU, unde starea implicită e oprit; (b) în fullscreen, unde
canvasul nici nu e randat; (c) 2,5–3 secunde la fiecare pornire a motorului și la ieșirea din fullscreen, până
la primul cadru procesat; (d) în browser fără `Worker`/`OffscreenCanvas`, unde UI-ul zice „procesat local” dar
arată brutul; și (e) **cel mai grav**, când `yunet.onnx` nu se încarcă sau YuNet eșuează: worker-ul face
passthrough și afișează cadrul brut pixel-identic, la 16–22 fps. Ultima e exact condiția pe care garda de
confidențialitate trebuie să o trateze fail-closed, iar `AGENTS.md` o cere explicit.

Chiar și în regimul bun (motor pornit, WASM, primul cadru desenat), blur-ul acoperă doar fețele pe care YuNet
le detectează peste pragul 0,6. Am demonstrat un cadru în care 3 oameni sunt în imagine, detectorul găsește o
singură față, iar fața celui de-al doilea lucrător rămâne ascuțită pe canvas. Afirmația absolută cere fie o
gardă geometrică (blur pe toată zona capului/persoanei sau pe tot cadrul), fie reformularea onestă:
„fețele detectate sunt blurate înainte de afișare; clipul brut se vede când motorul e oprit sau în fullscreen”.

Până atunci, formularea potrivită pentru demo este cea din `docs/browser-engine.md` §1 pentru rețea
(„nimic nu pleacă în sus”) plus o limită explicită pentru ecran. Afirmația „nicio față neblurată nu ajunge pe
ecran” trebuie scoasă din materiale sau însoțită de condițiile de mai sus.

---

## Anexă — comenzi și fișiere

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
VITE_BASE=/LocalSight/ npx vite preview --host 127.0.0.1 --port 4212 --strictPort
# test: Playwright (chromium headless) + OpenCV/YuNet offline pentru cutiile de față
```

Fișiere de cod citate: `frontend/src/engine/worker.js`, `frontend/src/engine/useEngine.js`,
`frontend/src/components/views/LiveView.jsx`, `frontend/src/components/views/IncidentDetailView.jsx`,
`frontend/src/components/views/ZoneEditorView.jsx`, `frontend/src/components/views/LabView.jsx`,
`frontend/src/components/live/EnginePanel.jsx`, `frontend/src/engine/pipeline.js`,
`frontend/src/services/api.js`, `frontend/src/constants/mockData.js`, `frontend/src/context/SecurityContext.jsx`.
