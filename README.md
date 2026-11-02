# LocalSight

Pipeline-ul de siguranță de pe platformă, mutat în browser: detecția persoanelor, zonele,
regulile, blur-ul pe fețe și incidentele ar trebui să ruleze într-un singur tab, fără
server și fără ca vreun cadru să plece pe rețea. LocalSight este forkul proiectului
SafeSight, construit la un hackathon, și duce pipeline-ul într-o altă direcție: în loc de
un edge box care trimite evenimente unui backend, tot traseul devine cod de frontend.

Ce există azi, concret: linkul public este un **showcase static** — UI-ul React
rulează pe date mock (`VITE_USE_MOCK=true`), fără inferență. Motorul din browser este în
curs de proiectare: există nota [`docs/browser-engine.md`](docs/browser-engine.md), dar
nu și cod. Până atunci, pipeline-ul Python din `ml/` + `backend/` rămâne implementarea de
referință pe care portul o urmează.

Demo static: <https://andreisugu.github.io/LocalSight/>

## Stare

| Ce | Stare | Unde se vede |
|---|---|---|
| UI React + Vite pe date mock | funcționează | [`frontend/`](frontend/), linkul de mai sus |
| Build și deploy static (GitHub Pages) | funcționează | [`.github/workflows/pages.yml`](.github/workflows/pages.yml) |
| Modele ONNX servite din repo | funcționează | [`frontend/public/models/`](frontend/public/models/) (9,5 MB + 0,2 MB) |
| Implementare de referință CPU | funcționează | [`ml/`](ml/) + [`backend/`](backend/) |
| Motor browser: detecție (ORT Web) | în lucru, doar proiect | [`docs/browser-engine.md`](docs/browser-engine.md) |
| Motor browser: zone și reguli | în lucru, doar proiect | idem |
| Motor browser: blur pe fețe | în lucru, doar proiect | idem |
| Backend, Slack, MJPEG, SQLite | în afara scopului | rămân în repo ca referință |

„În lucru” înseamnă aici proiectat, nu scris: nu există încă `frontend/src/engine/`.

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

Ținta este un singur traseu, într-un tab:

```text
<video> (clip în buclă sau getUserMedia)
   └─ ImageBitmap ─► Web Worker: ONNX Runtime Web (WebGPU, fallback WASM)
                        detector → tracker → zone/reguli → blur → eveniment
                     ├─ canvas adnotat (OffscreenCanvas, transferat)
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
