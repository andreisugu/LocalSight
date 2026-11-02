# LocalSight — ghid pentru agenți AI

LocalSight pornește de la SafeSight (detecție pe edge, API FastAPI, UI React, construit la
un hackathon) și merge într-o direcție diferită: pipeline-ul întreg — detecție, zone,
blur de fețe, incidente — trebuie să ruleze **în browser**, cu `onnxruntime-web` pe WebGPU,
publicat static pe GitHub Pages. Nicio imagine nu pleacă din tab.

**Starea de azi:** există un build static mock live
(`https://andreisugu.github.io/LocalSight/`, `VITE_USE_MOCK=true`). Motorul din browser
**nu e scris încă**: există un branch de spike și designul din `docs/browser-engine.md`.
Până aterizează portul, codul Python din `ml/` și `backend/` este implementarea de
referință din care se portează.

Acest fișier e sursa de adevăr pentru agenți. `CLAUDE.md` doar trimite aici. Citește-l
înainte să modifici ceva și actualizează-l în același commit când o regulă durabilă se
schimbă.

## Harta repo-ului

- `frontend/` — **produsul**. React 18 + Vite + Tailwind, JavaScript, servit static.
  Aici crește motorul din browser (`docs/browser-engine.md` propune `frontend/src/engine/`).
  Build-ul static ia modelele din `frontend/public/models/` și clipurile din
  `frontend/public/media/`.
- `ml/` — pipeline-ul Python de edge (YOLO26n, YuNet, zone, tracker). **Implementarea de
  referință pentru port**; nu crește folderul decât dacă taskul o cere explicit.
- `backend/` — API-ul FastAPI + SQLite. Tot referință pentru port (stocare în memorie,
  fără ingest); nu adăuga feature-uri aici fără un motiv legat de port.
- `automation/` — Slack și escaladare pe server; în browser nu se portează (un webhook
  în bundle-ul public e un secret public).
- `docs/` — `browser-engine.md` (design-ul portului), `media.md` (clipurile demo),
  `performance.md` (măsurători și ce s-a închis), `contract.md` (plicul evenimentului).
- `scripts/` — `prepare-demo-media.sh` (encodează clipurile), `dev.py` (runner local),
  `bench.sh`, `agent-preflight.sh`.
- `data/` — clipuri și adnotări locale, în afara git în afară de README-uri.

## Comenzi care funcționează

Frontend (Node 20 în CI; `npm ci` o dată):

```bash
cd frontend
npm ci
npm run dev                                              # Vite pe :5173
npm run build                                            # build normal; UI-ul cere API real la runtime
VITE_USE_MOCK=true npm run build                         # build static, fără backend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build  # exact ce face pages.yml
```

Testele Python, prin `uv` (nu pip, nu venv manual):

```bash
cd backend && uv sync && uv run pytest -q
cd ml && uv sync --extra yolo && uv run pytest -q
```

Testele care au nevoie de greutăți sau de clipuri se sar singure când fișierele lipsesc;
asta e normal, nu un eșec.

Modele și media (binare, regenerate, nu inventate):

```bash
python3 frontend/scripts/prepare-models.py   # rescrie yolo26n.onnx + yunet.onnx
bash scripts/prepare-demo-media.sh --check   # doar listează ce s-ar encodea
bash scripts/prepare-demo-media.sh           # scrie în frontend/public/media/
```

Înainte de a încheia: rulează verificarea modulului atins (`npm run build` pentru
`frontend`, `uv run pytest -q` pentru `ml`/`backend`). Dacă nu poți, spune exact ce comandă
a eșuat și de ce.

## Ce citești înainte de lucrul pe motor

1. `docs/browser-engine.md` — ce se portează, modul cu modul, și ce rămâne afară.
2. `docs/media.md` — cum ajung clipurile în build fără să intre în git.
3. `docs/performance.md` — cifrele măsurate; nu optimiza după intuiție.
4. `docs/contract.md` — plicul evenimentului (`event_id`, `confidence`, severitate).
   Abaterea acceptată în browser: `snapshot_url` devine `blob:`.

## Reguli de lucru

- Citește fișierul înainte să-l editezi. Implementează doar scopul cerut.
- Fără dependențe noi fără să întrebi (mai ales în `frontend/`: fiecare KB ajunge pe Pages).
- Nu slăbi și nu șterge un test ca să treacă ceva. Repară sau raportează.
- Un singur subiect per commit; diff-uri mici. `main` rămâne rulabil.
- Nu lăsa niciodată arborele pe detached HEAD; lucrează pe un branch numit.
- Nu face commit la modele, clipuri, `.env` sau baze de date locale. `.gitignore` prinde
  `*.onnx`, `*.pt`, `*.mp4`, `*.db`; singura excepție sunt cele două ONNX din
  `frontend/public/models/`, deja urmărite pentru build-ul static. Nu adăuga altele.
- Fără secrete în cod, în fixtures sau în istoric.
- Nu forța push, nu `reset --hard`, nu șterge fișiere fără să întrebi.
- Commit/push/merge doar când umanul cere explicit.

## Granițe care contează aici

- **Licența BSL 1.1 rămâne.** Vezi `LICENSE`: copierea și uzul neproducție sunt permise;
  producția (inclusiv serviciu găzduit sau embedded) cere licență comercială. Nu schimba
  licența și nu adăuga cod sub altă licență fără aprobare.
- **Ultralytics YOLO este AGPL-3.0 — capcană comercială.** BSL-ul acestui repo nu
  suprascrie AGPL-ul. Un build comercial are nevoie fie de licența Enterprise de la
  Ultralytics, fie de alt detector. Nu livra YOLO, în tăcere, într-un produs plătit.
- **Nicio față neblurată în niciun asset commitat** — cadre, snapshot-uri, clipuri,
  capturi pentru docs. Blur-ul rulează înainte de salvare sau afișare, cu plasă de
  siguranță pe banda capului; dacă modelul de fețe nu se încarcă, nu se produce imagine
  (fail-closed).
- Fără nume, fără recunoaștere de emoții, fără upload de cadre. Afirmația „nimic nu
  părăsește tab-ul" trebuie să rămână literală.

## Când ești blocat

Citește documentul relevant și fișierele atinse; propune un plan de 3 linii; pune o singură
întrebare de clarificare; nu ghici. Dacă găsești o inconsecvență (de exemplu între
`docs/browser-engine.md` și cod), oprește-te și raportează în loc să o ocolești.

## Descoperire progresivă

`docs/browser-engine.md` · `docs/media.md` · `docs/performance.md` · `docs/contract.md` ·
`frontend/README.md` · `frontend/public/models/README.md` · `demo/run_sheet.md`
