# LocalSight

Pipeline-ul de siguranță de pe platformă, mutat în browser: detecția persoanelor, zonele,
regulile, blur-ul pe fețe și incidentele rulează într-un singur tab, fără server, iar
cadrele nu pleacă pe rețea. LocalSight este forkul proiectului SafeSight, construit la un
hackathon: în loc de un edge box care trimite evenimente unui backend, tot traseul devine
cod de frontend.

Linkul public este un **showcase static** — UI-ul React rulează pe date mock
(`VITE_USE_MOCK=true`), iar clipurile demo se redau în buclă, fără inferență. Motorul
propriu-zis e scris în [`frontend/src/engine/`](frontend/src/engine/) și se poate rula din
[`/lab`](#pagini) și [`/bench`](#pagini); în Live e opțional și lent (vezi mai jos).
Pipeline-ul Python din `ml/` + `backend/` rămâne implementarea de referință pe care portul
o urmează.

Demo static: <https://andreisugu.github.io/LocalSight/>

## Stare

| Ce | Stare | Unde se vede |
|---|---|---|
| UI React + Vite pe date mock | funcționează | [`frontend/`](frontend/), linkul de sus |
| Showcase static cu clipurile demo | funcționează, fără backend | linkul de sus |
| Build și deploy static (GitHub Pages) | funcționează, la fiecare push pe `main` | [`.github/workflows/pages.yml`](.github/workflows/pages.yml) |
| Modele ONNX servite din repo | funcționează | [`frontend/public/models/`](frontend/public/models/) (9,9 MB + 232 KB) |
| Implementare de referință CPU | funcționează | [`ml/`](ml/) + [`backend/`](backend/) |
| Motor browser: YOLO + YuNet + tracker + zone + evenimente | funcționează în Live, `/lab` și `/bench` | [`frontend/src/engine/`](frontend/src/engine/) |
| Detecție de vestă hi-vis (PPE) | funcționează; starea intră în regulile de zonă | [`frontend/src/engine/vest.js`](frontend/src/engine/vest.js), apelat din `worker.js`; `NO_PPE` cere un om de ≥150 px în cadru |
| Camere | 3 clipuri demo + camera browser (getUserMedia) | selectorul de cameră din Live |
| Blur pe fețe înainte de desenare | funcționează pe cadrul din canvas | `worker.js`; snapshot-ul de incident nu e conectat |
| Motor browser în Live | opt-in, ~1,8–3 fps pe WASM | comutatorul „Procesează în browser” |
| Backend, Slack, MJPEG, SQLite | în afara scopului | rămân în repo ca referință |

Cifrele de browser sunt măsurate pe hardware-ul de dezvoltare, WASM single-thread (fără
fire, din cauza anteturilor lipsă de pe Pages): ~1,8 fps la intrare de 640 px și ~3 fps la
960 px. WebGPU nu a fost testat pe această mașină, deci nu are cifră. Sub 2 fps, panoul din
Live avertizează după 10 s de rulare.

Teste: 82 Node în `frontend/src/engine/*.test.mjs` (`node --test`) și 5 E2E Playwright; CI
rulează backend, ml, build-ul de frontend, e2e și o gardă pentru subpath-ul de Pages.

## Pagini

Toate rutele sunt client-side, definite în `VIEW_PATHS` din
[`frontend/src/context/SecurityContext.jsx`](frontend/src/context/SecurityContext.jsx).

| Rută | Ce face |
|---|---|
| `/` | Live: 3 clipuri demo sau camera locală, panoul de incidente și comutatorul „Procesează în browser” |
| `/incidents` | lista de incidente, cu severitate, status și dovadă |
| `/zones` | editorul de zone, poligon desenat pe cadrul de referință |
| `/reports` | raportul de tură: KPI și rezumat |
| `/lab` | motorul pe un clip ales sau pe webcam: fps, persoane, fețe, incidente |
| `/bench` | fps/p50/p95 pe provider și mărime de intrare, istoric în `localStorage` |

## Capturi

![Live: feed-ul camerei CAM-01 cu zona motorului și incidentele detectate](docs/assets/localsight-live.png)
*Live: feed-ul camerei CAM-01 cu zona motorului și incidentele detectate.*

![Incidente: lista completă, cu severitate, status și dovada foto](docs/assets/localsight-incidents.png)
*Incidente: lista completă, cu severitate, status și dovada foto.*

![Configurare zone: poligonul pe canvas și parametrii regulii](docs/assets/localsight-zones.png)
*Configurare zone: poligonul pe canvas și parametrii regulii.*

## Pornire rapidă

Showcase-ul static, local (Node 20+):

```bash
cd frontend
npm ci
VITE_USE_MOCK=true npm run build
npm run preview
```

Se deschide la <http://localhost:4173>, iar modelele sunt servite din `dist/models/`.
Fără `VITE_USE_MOCK=true`, build-ul așteaptă API-ul pe `localhost:8000`.

Stack-ul de referință (Python 3.12+, `uv`, `npm`):

```bash
./run.sh setup   # o singură dată: dependențe backend, ML și frontend
./run.sh demo    # API :8000, UI :5173, un edge pe fiecare cameră demo
```

Pe Windows: `run.cmd setup`, apoi `run.cmd demo`. Regulile de lucru pentru autori sunt în
[`AGENTS.md`](AGENTS.md).

## Arhitectură

Referința Python separă edge-ul de backend: camera → [`ml/`](ml/) (YOLO26n, tracking,
reguli de zonă, blur YuNet) → [`backend/`](backend/) (FastAPI, SQLite, WebSocket, MJPEG) →
UI React. Cifrele măsurate pe CPU sunt în [`docs/performance.md`](docs/performance.md).

Traseul, așa cum e scris azi:

```text
<video> (clip în buclă sau getUserMedia)
   └─ ImageBitmap ─► Web Worker: ONNX Runtime Web (WebGPU, fallback WASM)
                        detector → tracker → zone/reguli → blur → eveniment
                     ├─ cadru adnotat (ImageBitmap) ─► canvas 2D
                     └─ evenimente în memorie ─► UI React
```

Nimic nu urcă pe rețea: se descarcă doar fișierele statice (JS, `yolo26n.onnx`,
`yunet.onnx`, clipul). Starea trăiește în tab și se pierde la reload. Deciziile, inclusiv
de ce WASM cu fire nu este posibil pe GitHub Pages, sunt în
[`docs/browser-engine.md`](docs/browser-engine.md).

## Harta repo-ului

| Folder | Rol |
|---|---|
| [`frontend/`](frontend/) | produsul: UI React + Vite, modelele statice, build-ul de Pages |
| [`ml/`](ml/) | pipeline-ul Python de referință: detecție, tracking, zone, blur |
| [`backend/`](backend/) | API FastAPI de referință: ingestie, stocare, WebSocket, stream |
| [`automation/`](automation/) | textele de raport și Slack din versiunea veche; nu se portează |
| [`docs/`](docs/) | contract, nota motorului de browser, media, performanță |
| [`scripts/`](scripts/) | `dev.py` (launcher), pregătirea clipurilor, preflight |

Modelele se regenerează cu `python3 frontend/scripts/prepare-models.py`; clipurile web cu
[`scripts/prepare-demo-media.sh`](scripts/prepare-demo-media.sh), descris în
[`docs/media.md`](docs/media.md).

## Licență

**Business Source License 1.1**, textul integral în [`LICENSE`](LICENSE).

- copiere, modificare și uz neproductiv: permise;
- uz în producție, inclusiv găzduire sau încorporare într-un serviciu: necesită licență
  comercială de la Licensor;
- la **2 noiembrie 2030** licența devine Apache 2.0.

## Third-party

- **Ultralytics YOLO este AGPL-3.0.** `yolo26n.onnx` din repo provine din greutățile
  Ultralytics, iar build-ul static îl distribuie ca fișier descărcabil. Un produs
  proprietar sau găzduit are nevoie de licență enterprise Ultralytics ori de conformare
  AGPL pe tot ansamblul. BSL-ul acestui repo nu schimbă asta.
- **YuNet este MIT** (OpenCV Zoo); se redistribuie cu nota de copyright.
- Clipurile demo nu sunt în git (`.mp4` este ignorat) și nu fac parte din opera licențiată.

## Credite

Proiectul a fost construit la un hackathon ca **SafeSight**, de Andrei, Max, Dalina și
Ariana; README-urile modulelor păstrează numele celor care le-au scris. Acest fork
păstrează pipeline-ul și dovada că merge pe CPU, dar îl mută în browser și scoate din
produs backend-ul, alertarea și raportarea.
