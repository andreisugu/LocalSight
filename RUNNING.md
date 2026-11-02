# Rularea implementării de referință — Linux, macOS sau Windows

> **Implementarea de referință (SafeSight), nu produsul.** Produsul merge în browser: [`docs/browser-engine.md`](docs/browser-engine.md).
> Showcase-ul static pornește din [`README.md`](README.md).

Un singur script cross-platform, cu Python 3.12+. Nu are nevoie de bash, make sau Docker.
Ghidul de față pornește pipeline-ul Python din `ml/` + `backend/`, pe care portul din browser
îl urmează; nu descrie build-ul static.

## Cerințe

| Unealtă | De ce | Instalare |
|---|---|---|
| Python 3.12+ | rulează scriptul, backend-ul și ML-ul | [python.org](https://www.python.org/downloads/) |
| `uv` | instalează și rulează backend-ul + ML | `curl -LsSf https://astral.sh/uv/install.sh \| sh` (macOS/Linux) sau PowerShell de pe [astral.sh/uv](https://astral.sh/uv) |
| Node.js 18+ + npm | frontend Vite | [nodejs.org](https://nodejs.org/) sau `winget install OpenJS.NodeJS.LTS` |
| `ffmpeg` | opțional, doar pentru RTSP | `brew install ffmpeg`, `apt install ffmpeg`, `winget install Gyan.FFmpeg` |

Verificare rapidă:

```bash
python scripts/dev.py doctor
```

## Setup, o singură dată

```bash
python scripts/dev.py setup
```

Instalează dependențele backend, ML (`ultralytics` inclus) și frontend, apoi descarcă modelul YuNet pentru blur. Dacă vrei un setup mai rapid, fără detecție reală:

```bash
python scripts/dev.py setup --skip-yolo
```

## Demo complet

```bash
python scripts/dev.py demo
```

Pornește:

- backend-ul pe `http://localhost:8000`;
- frontend-ul pe `http://localhost:5173`;
- câte un edge pentru fiecare cameră demo, fiecare pe clipul lui din `data/videos/`, cu zona lui și aliniere; scriu evenimente în backend și live frame pentru `/stream`:

| Cameră | Clip | Zonă |
|---|---|---|
| `stand12` (CAM-01) | `restricted-zone_cam01_persoana-langa-motor` | `ml/fixtures/zones.stand12.json` |
| `taxiway-b` (CAM-02) | `broll_cam01_marshaller-conuri-apron` | `ml/fixtures/zones/broll-cam01.json` |
| `baggage-area` (CAM-03) | `broll_cam02_avion-la-poarta-bagaje` (4K, citit la 1920 px cu `--max-size`) | `ml/fixtures/zones/broll-cam02.json` |

Ctrl-C oprește tot. Dacă backend-ul nu e gata, scriptul așteaptă `/health` înainte de edge.

Variante:

```bash
python scripts/dev.py demo --no-ml          # doar backend + frontend
python scripts/dev.py demo --mock           # backend mock, fără model
python scripts/dev.py demo --cameras stand12,taxiway-b   # doar o parte din camere
python scripts/dev.py demo --clip data/videos/<clip>.mp4
python scripts/dev.py demo --rtsp rtsp://127.0.0.1:8554/stand12
```

`--clip` și `--rtsp` se exclud și pornesc un singur edge, pe `--camera-id` (implicit `stand12`), cu `zones.stand12.json`. Trei edge-uri pe CPU înseamnă FPS mai mic pe fiecare; dacă laptopul nu ține, folosește `--cameras`. Un clip lipsă e sărit cu un mesaj, celelalte camere pornesc. Clipul rulează în buclă până la Ctrl-C și dă cel mult o alertă pe minut (`--loop-cooldown-s` în `ml`); fluxul RTSP rulează continuu până la Ctrl-C. Pentru un RTSP local din clip, vezi `ml/README.md` (mediamtx + `ml/scripts/rtsp-loop.sh`). Credențialele din URL-ul RTSP nu apar în terminal (`rtsp://***@host/...`).

## Fallback demo

Dacă edge-ul, clipul sau modelul pică, backend-ul poate primi un eveniment demo prin aceleași rute edge. Backend-ul trebuie să ruleze deja.

```bash
python scripts/dev.py fallback
python scripts/dev.py fallback --type NO_PPE
python scripts/dev.py fallback --snapshot /path/to/already-blurred.jpg
```

`--snapshot` trebuie să fie un JPEG **deja blurat**. Nu folosi cadrele din `data/reference_frames/` — acelea conțin fețe neblurate. Scriptul folosește tokenul din `.env`/mediu și API-ul de pe `localhost:8000`; `--api-url` și `--backend-port` sunt disponibile pentru alt port.

## Ce vezi după fiecare comandă

- `python scripts/dev.py demo` — UI + API + câte un edge pe fiecare cameră, în buclă. În Live, meniul **Cameră** schimbă feed-ul MJPEG; fiecare cameră arată clipul ei („Sursă demo”) și evenimentele intră în lista de incidente. Frontend-ul pornește doar după ce `/health` răspunde.
- Pe un clip, `demo` pornește edge-ul cu `--align-reference <clip>`: zona e desenată pe primul cadru și urmărește camera când clipul se rotește sau face zoom (detalii în `ml/README.md`, „Zone pe fiecare clip”). Pe `--rtsp` alinierea e oprită.
- Edge-urile citesc zonele și starea motorului din backend la fiecare 2 s (`--remote-config`). Butonul **MOTOR ON/OFF** și **Salvează Zona** din editor se văd pe feed în ~2 s: cu motorul oprit zona devine gri și nu mai apar incidente. Fișierele de zone din `ml/fixtures/` rămân doar rezervă, dacă backend-ul nu răspunde.
- La prima pornire, `demo` pune în backend zona calibrată pe clip pentru fiecare cameră; o zonă care are deja cadru de referință (deci a fost pornită o dată și poate editată din UI) nu mai e suprascrisă. Edge-ul urcă primul cadru al clipului, blurat, ca fundal pentru editorul de zone: zona se desenează pe el și urmărește camera din el.
- Imaginea live se generează doar pentru camera deschisă în UI (`--live-when-watched`): după schimbarea camerei, prima imagine nouă apare în ~1 s. Detecția și alertele rulează pe toate camerele.
- O cameră fără edge (de exemplu cu `--cameras` sau `--clip`) apare în meniu cu „fără feed în demo”, iar Live explică pe ce camere rulează edge-ul; nu arată un cadru gol fără explicație.
- `python scripts/dev.py all` — doar UI + API. Vezi camerele și starea Edge, dar fără cadre live; banner-ul îți spune să pornești `demo` sau edge-ul.
- `python scripts/dev.py backend` / `frontend` — doar procesul respectiv, pentru debug.

Dacă UI-ul apare gol, nu reîncărca în buclă: verifică întâi că backend-ul răspunde la `http://localhost:8000/health`.

## Pornire pe bucăți

```bash
python scripts/dev.py backend               # doar API
python scripts/dev.py frontend              # doar UI
python scripts/dev.py all                   # backend + frontend
python scripts/dev.py ml -- --source ../data/videos/<clip>.mp4 --zones fixtures/zones.stand12.json
```

`ml` forwardează argumentele după `--` către `safesight_ml.run`. Pentru RTSP, vezi `ml/README.md`.

## Verificare

```bash
python scripts/dev.py check
```

Rulează testele backend, testele ML, smoke-ul `automation` și build-ul frontend. Numărul de
teste crește; nu-l cita din memorie, ci din output.

## Windows

Din `cmd.exe`:

```bat
py -3 scripts\dev.py setup
py -3 scripts\dev.py demo
```

sau, dacă `python`/`py` e în PATH:

```bat
run.cmd demo
```

## macOS / Linux

```bash
./run.sh setup
./run.sh demo
```

sau direct `python3 scripts/dev.py ...`.

## Porturi și mediu

```bash
python scripts/dev.py all --backend-port 8000 --frontend-port 5173
```

Dacă un port este deja ocupat, launcher-ul se oprește cu mesaj clar; nu mai pornește Vite pe 5174 în silențiu. Oprește procesul vechi sau folosește `--backend-port` / `--frontend-port`.

`.env` la rădăcină este opțional; backend-ul are default-uri sigure. Pentru Slack, Groq sau alte chei:

```bash
cp .env.example .env
# editează .env
```

Scriptul forțează `USE_MOCK=false` pe `all`/`demo`; `--mock` pornește doar backend-ul cu evenimente false. UI-ul rămâne mereu pe API-ul real (`VITE_USE_MOCK=false`), ca evenimentele mock și ack-urile să treacă prin backend.

Launcher-ul citește `EDGE_TOKEN` și `SNAPSHOT_DIR` din `.env` (sau din mediu); restul cheilor rămân pentru backend. Dacă `SNAPSHOT_DIR` e relativ, calea se rezolvă față de `backend/`, iar live frame-ul se scrie în `SNAPSHOT_DIR/live`. `--edge-token` are prioritate față de `.env`.

## Dacă ceva nu merge

- `uv: command not found` → instalează `uv` și redeschide terminalul.
- `npm: command not found` → instalează Node.js LTS.
- `address already in use` → schimbă portul cu `--backend-port` / `--frontend-port`.
- `model lipsește` → rulează `python scripts/dev.py setup`.
- `clipul lipsește` → pune clipul în `data/videos/` sau folosește `backend/scripts/demo_event.py` ca fallback.
- Windows: dacă `py -3` nu e disponibil, folosește `python scripts\dev.py ...`.
