# Rularea LocalSight — static, în browser

Produsul e build-ul static din `frontend/`: UI-ul React plus motorul de inferență care
rulează în tab. Nu există backend, coadă, bază de date sau proces Python de pornit.
Design-ul motorului e în [`docs/browser-engine.md`](docs/browser-engine.md); scenariul de
prezentare, în [`demo/run_sheet_browser.md`](demo/run_sheet_browser.md).

> **Notă istorică:** până la fork, `RUNNING.md` descria stack-ul Python de referință
> (`./run.sh`, `scripts/dev.py`, `ml/`, `backend/`). Acele fișiere au fost șterse din acest
> repo; instrucțiunile vechi rămân în istoricul git.

## Cerințe

| Unealtă | De ce | Verificare |
|---|---|---|
| Node.js 20+ | Vite, build-ul static, testele Node și Playwright | `node --version` |
| npm | vine cu Node | `npm --version` |
| `ffmpeg` | **opțional**, doar pentru re-encode de clipuri demo | `ffmpeg -version` |

Python nu e necesar pentru produs. Singurele scripturi Python rămase sunt unelte de
întreținere: `scripts/provenance.py` (raportul de proveniență) și
`frontend/scripts/prepare-models.py` (regenerarea modelelor ONNX).

## Dezvoltare

```bash
cd frontend
npm ci
npm run dev        # Vite pe http://localhost:5173
```

Fără `VITE_USE_MOCK=true`, UI-ul folosește `src/services/api.js` și așteaptă un API la
`VITE_API_URL`; în acest fork nu există unul, deci pentru orice demo pornește build-ul mock.

## Build-ul static (ce se livrează)

```bash
cd frontend
VITE_USE_MOCK=true npm run build
npm run preview    # http://localhost:4173
```

Build-ul pentru GitHub Pages, servit din subcale (exact ce face
[`.github/workflows/pages.yml`](.github/workflows/pages.yml)):

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ VITE_BUILD_SHA="$(git rev-parse --short HEAD)" npm run build
cp dist/index.html dist/404.html
npm run preview    # http://localhost:4173/LocalSight/
node scripts/check-base.mjs
```

`VITE_USE_MOCK=true` înlocuiește apelurile de API cu fixturile, ca pagina să meargă fără
niciun server. `VITE_BASE` scrie prefixul în `index.html` și în `BASE_URL`; fără el, căile
absolute de assets dau 404 sub `/LocalSight/`. Copia `404.html` face ca `/zones` sau
`/incidents/<id>` să încarce aplicația, nu un 404, pentru că Pages servește acel fișier pe
orice rută necunoscută.

`VITE_BUILD_SHA` se compilează în bundle și apare în footer-ul sidebar-ului ca
`build <sha>`; fără variabilă, un build local scrie `build dev`. Workflow-ul îl
injectează din commitul pe care l-a testat CI, iar footer-ul linkează și `NOTICE`
(notificările AGPL/MIT livrate în `dist/NOTICE`).

## Motorul din browser

- În **Live**, comutatorul „Procesează în browser” pornește inferența pe clipul camerei
  selectate sau pe camera locală (`getUserMedia`).
- `/lab` rulează motorul pe un clip ales ori pe webcam și arată fps, persoane, fețe și
  incidente.
- `/bench` măsoară fps/p50/p95 pe provider și mărime de intrare, cu istoric în
  `localStorage`.

Pe Chrome/Edge se folosește WebGPU când există adapter; pe Firefox (intenționat) și pe
browsere fără WebGPU se folosește WASM. Thread-urile vin din
`frontend/public/coi-serviceworker.js`, care re-servește navigările cu COOP/COEP pentru că
GitHub Pages nu poate trimite antete custom. Fără service worker (dev, browser care îl
blochează) motorul cade pe un singur fir.

## Verificarea build-ului publicat

Deploy-ul e legat de CI, nu de `push`: [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
pornește pe `workflow_run` după `CI` pe `main` și construiește **doar** când
`github.event.workflow_run.conclusion == 'success'`. Un CI roșu nu mai publică; un
`workflow_dispatch` manual rămâne disponibil și folosește `github.sha`.

Înainte să arăți linkul:

1. `gh run list --limit 2` → atât `CI`, cât și deploy-ul sunt `success` pentru commitul
   care e live.
2. Footer-ul sidebar-ului arată `build <sha>`; compară-l cu
   `git rev-parse --short origin/main`. Dacă diferă, site-ul e în urmă — nu presupune că
   „workflow success" înseamnă că commitul e live.
3. `dist/NOTICE` există în artefact și linkul „Licențe" din footer îl deschide.
4. `/`, `/404.html`, `/coi-serviceworker.js` și ambele `/models/*.onnx` răspund `200`.

**Risc rezidual, necontrolabil de aici:** GitHub Pages servește `index.html` cu
`cache-control: max-age=600`, iar fiecare deploy șterge bundle-urile vechi. Un vizitator
care are shell-ul în cache poate lua un `404 text/html` pentru `assets/index-<hash>.js` și
să vadă pagină albă până expiră cache-ul (≤10 min). Nu se poate repara din workflow.

Preflight pentru demo:

- fără deploy în **15 minute** înainte de prezentare;
- deschide linkul **după** ultimul deploy și fă hard refresh (`Ctrl/Cmd+Shift+R`);
- pornește motorul o dată, ca să preîncălzești WASM-ul de 28,7 MB și modelele;
- confirmă `crossOriginIsolated === true` în console după primul reload automat.

## Teste

```bash
cd frontend
npm run test:unit       # node --test, 406 teste
npm run test:e2e        # Playwright, 5 teste, baza `/`
npx playwright test --config=playwright.pages.config.js   # 5 teste pe /LocalSight/, COI + motor
```

A doua suită construiește exact ca Pages (`VITE_USE_MOCK=true VITE_BASE=/LocalSight/`),
servește `dist/` sub `/LocalSight/` cu fallback `404.html` și fără COOP/COEP, apoi verifică
`crossOriginIsolated` după reload și pornește motorul pe clip (canvas, status `rulează`,
fps > 0). O dată: `npx playwright install chromium`.

## Modele și media

```bash
python3 frontend/scripts/prepare-models.py --yolo <export.onnx> --yunet <yunet.onnx>
bash scripts/prepare-demo-media.sh --check   # doar listează ce s-ar encodea
bash scripts/prepare-demo-media.sh           # scrie în frontend/public/media/
```

Cele două ONNX din `frontend/public/models/` sunt singurele binare comise intenționat, ca
Pages să le poată servi. Sursele lor, împreună cu restul stack-ului Python, se află în
istoricul git și în repo-ul upstream.

## Dacă ceva nu merge

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Pagină albă după build | build fără `VITE_USE_MOCK` (așteaptă un API care nu există) sau `VITE_BASE` greșit | rebuild cu ambele variabile, apoi `npm run preview` |
| Pagină albă imediat după un deploy | shell `index.html` cache-uit (`max-age=600` pe Pages), bundle-urile vechi au fost șterse | hard refresh; nu e o eroare de build, vezi riscul rezidual de mai sus |
| 404 la `/zones` pe Pages | lipsește copia `404.html` din `dist/` | rulează `cp dist/index.html dist/404.html` |
| Modelele nu se încarcă | lipsesc fișierele din `frontend/public/models/` sau calea nu folosește `BASE_URL` | verifică folderul și `${import.meta.env.BASE_URL}models/...` |
| Motorul e lent | WASM pe un singur fir, cadru prea mare sau alt tab care consumă CPU/GPU | deschide pe un singur tab, verifică `/bench`, lasă service worker-ul activ |
| `npm: command not found` | Node.js lipsește | instalează Node.js LTS (20+) |
