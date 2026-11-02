# Rularea LocalSight — static, în browser

Produsul e build-ul static din `frontend/`: UI-ul React plus motorul de inferență care
rulează în tab. Nu există backend, coadă, bază de date sau proces Python de pornit.
Design-ul motorului e în [`docs/browser-engine.md`](docs/browser-engine.md); scenariul de
prezentare, în [`demo/run_sheet_browser.md`](demo/run_sheet_browser.md).

**Acesta este documentul canonic pentru pornire, testare și deploy.** `README.md`,
`CONTRIBUTING.md` și `frontend/README.md` trimit aici; comenzile nu se copiază în alt fișier.

> **Notă istorică:** până la fork, `RUNNING.md` descria stack-ul Python de referință. Acele
> fișiere au fost șterse din acest repo; instrucțiunile vechi rămân în istoricul git și în
> documentele marcate `Material istoric — nu se mai rulează`.

## Cerințe

| Unealtă | De ce | Verificare |
|---|---|---|
| Node.js 20+ | Vite, build-ul static, testele Node și Playwright | `node --version` |
| npm | vine cu Node | `npm --version` |
| `ffmpeg` | **opțional**, doar pentru re-encode de clipuri demo | `ffmpeg -version` |

Python nu e necesar pentru produs. Singurele scripturi Python rămase sunt unelte de
întreținere: `scripts/provenance.py` (raportul de proveniență) și
`frontend/scripts/prepare-models.py` (regenerarea modelelor ONNX).

## Pornire rapidă

Dezvoltare, cu reîncărcare la cald:

```bash
cd frontend
npm ci             # o dată, din package-lock.json
npm run dev        # Vite pe http://localhost:5173
```

Build-ul static, exact ce se livrează:

```bash
cd frontend
VITE_USE_MOCK=true npm run build
npm run preview    # http://localhost:4173
```

Fără `VITE_USE_MOCK=true`, UI-ul folosește `src/services/api.js` și așteaptă un API la
`VITE_API_URL`; în acest fork nu există unul, deci pentru orice demo pornește build-ul mock.
`VITE_USE_MOCK=true` înlocuiește apelurile de API cu fixturile, ca pagina să meargă fără
niciun server.

## Teste

```bash
cd frontend
npm run test:unit       # node --test, doar logica pură
npm run test:e2e        # Playwright, 5 teste, baza `/`
npm run e2e:pages       # 5 teste pe /LocalSight/, COI + motor
npm run e2e:persistence # suita lentă: IndexedDB după reload
```

O dată, pentru Playwright: `npx playwright install chromium`.

A doua suită construiește exact ca Pages (`VITE_USE_MOCK=true VITE_BASE=/LocalSight/`),
servește `dist/` sub `/LocalSight/` cu fallback `404.html` și fără COOP/COEP, apoi verifică
`crossOriginIsolated` după reload și pornește motorul pe clip (canvas, status `rulează`,
fps > 0). CI rulează cinci joburi independente: unit, build, smoke e2e, Pages e2e și garda
de subpath (`check-base.mjs`).

### Bucla rapidă (canonic)

> Pentru lucrul în paralel (un worktree per agent, porturi unice, ordinea de merge și
> curățenia) vezi [`docs/ops/agent-workflow.md`](docs/ops/agent-workflow.md) și scripturile
> `scripts/agent-preflight.sh`, `agent-worktree.sh`, `agent-status.sh`, `agent-cleanup.sh`.
> Comenzile de mai jos rămân sursa canonică pentru build și teste.

`npm run verify` este comanda pentru „am terminat o schimbare": unit, build-urile reale și
ambele suite, cu tabel de timpi la final și cod de ieșire nenul la primul pas roșu.
Serverele ascultă pe port 0, deci două worktree-uri nu se mai calcă pe 4173/4317.

```bash
cd frontend
npm run verify                          # unit + smoke (5) + Pages (5)
npm run verify -- --with-persistence    # + suita de persistență (minute, nu secunde)
npm run verify:fast                     # doar unit + build, fără browser
```

Fiecare suită are propriul build, pentru că fiecare măsoară altă formă a artefactului:
smoke rulează la baza `/` (`page.goto('/incidents')`, `^/incidents/<id>$`), iar Pages rulează
pe `/LocalSight/`. `VITE_BASE` se compilează în bundle, deci un singur artefact nu poate
servi ambele onest. La final `dist/` rămâne build-ul Pages.

#### Iterare: un build, un server, mai multe rulări

Când editezi doar teste sau UI, nu reconstrui la fiecare rulare. Pornește serverul o dată și
rulează suita de câte ori vrei împotriva lui:

```bash
# build o dată, ca Pages
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
cp dist/index.html dist/404.html
npm run e2e:serve       # tipărește http://127.0.0.1:<port liber>/LocalSight/
# în alt terminal, de câte ori vrei:
PW_BASE_URL=http://127.0.0.1:<port>/LocalSight/ npm run e2e:pages
```

Cu `PW_BASE_URL` setat, configurările Playwright nu mai pornesc nici build, nici server:
`webServer` dispare, iar serverul e al tău. Fără el, comportamentul e cel de dinainte —
build + server propriu, neresuscitat, exact ce rulează CI. Pentru smoke (baza `/`) pornește
`npm run serve:test` (fără `--base`) și rulează
`PW_BASE_URL=http://127.0.0.1:<port>/ npm run e2e:smoke`.

`npm run serve:test` servește `dist/` fără dependențe: acceptă `--base /LocalSight/`, ascultă
implicit pe un port liber (`--port 0`), are fallback SPA, MIME corect pentru
`.wasm/.onnx/.mp4`, Range pentru video și `SIGTERM` curat. Fallback-ul are statusul formei
servite: 200 la rădăcină (ca
`vite preview`; smoke-ul cere zero erori în consolă, iar Chromium loghează un document 404),
404 cu `404.html` sub prefix (ca Pages). `--coi` trimite COOP/COEP pentru teste de UI care nu
vor să aștepte service worker-ul; implicit e oprit, ca suita Pages să măsoare calea reală.

Variabile de mediu, într-un singur loc:

| Variabilă | Config | Efect |
|---|---|---|
| `PW_PORT` | `playwright.config.js`, `playwright.persistence.config.js` | portul serverului propriu când `PW_BASE_URL` nu e setat (implicit 4173 / 4352) |
| `PW_PAGES_PORT` | `playwright.pages.config.js` | idem, pentru suita Pages (implicit 4317) |
| `PW_BASE_URL` | toate trei | rulează împotriva unui server existent: fără build, fără `webServer` |

#### Worktree nou: nu rula `npm ci`

Un worktree proaspăt poate împrumuta `node_modules` din checkout-ul principal printr-un
symlink, atâta timp cât `package-lock.json` e identic — scriptul compară fișierele și refuză
dacă au divergat:

```bash
bash frontend/scripts/link-node-modules.sh
```

Nu rula `npm ci` într-un worktree legat: ar scrie prin symlink în checkout-ul principal.
Când lock-ul diferă, scriptul cere `npm ci` local.

## Deploy

Deploy-ul e legat de CI, nu de `push`: [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
pornește pe `workflow_run` după `CI` pe `main` și construiește **doar** când
`github.event.workflow_run.conclusion == 'success'`. Un CI roșu nu publică; un
`workflow_dispatch` manual rămâne disponibil și folosește `github.sha`.

Build-ul pentru GitHub Pages, servit din subcale (exact ce face workflow-ul):

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ VITE_BUILD_SHA="$(git rev-parse --short HEAD)" npm run build
cp dist/index.html dist/404.html
npm run preview    # http://localhost:4173/LocalSight/
node scripts/check-base.mjs
```

`VITE_BASE` scrie prefixul în `index.html` și în `BASE_URL`; fără el, căile absolute de
assets dau 404 sub `/LocalSight/`. Copia `404.html` face ca `/zones` sau `/incidents/<id>`
să încarce aplicația, nu un 404, pentru că Pages servește acel fișier pe orice rută
necunoscută. `VITE_BUILD_SHA` se compilează în bundle și apare în footer-ul sidebar-ului ca
`build <sha>`; fără variabilă, un build local scrie `build dev`. Workflow-ul îl injectează
din commitul pe care l-a testat CI, iar footer-ul linkează și `NOTICE` (notificările
Apache-2.0 / CC BY 3.0 / MIT livrate în `dist/NOTICE`).

### Verificarea build-ului publicat

Înainte să arăți linkul:

1. `gh run list --limit 2` → atât `CI`, cât și deploy-ul sunt `success` pentru commitul
   care e live.
2. Footer-ul sidebar-ului arată `build <sha>`; compară-l cu
   `git rev-parse --short origin/main`. Dacă diferă, site-ul e în urmă — nu presupune că
   „workflow success" înseamnă că commitul e live.
3. `dist/NOTICE` există în artefact și linkul „Licențe" din footer îl deschide.
4. `/`, `/404.html`, `/coi-serviceworker.js` și ambele `/models/*.onnx` răspund `200`.

### Rollback

Nu există un buton de „undeploy"; două căi, ambele de ~4 minute:

- `gh run rerun <id>` pe ultimul run Pages verde — rescrie exact artefactul commitului bun;
- `git revert <sha>` pe `main` și push — CI și Pages rulează din nou pe revert.

Nu forța push și nu rescrie istoricul.

**Risc rezidual, necontrolabil de aici:** GitHub Pages servește `index.html` cu
`cache-control: max-age=600`, iar fiecare deploy șterge bundle-urile vechi. Un vizitator
care are shell-ul în cache poate lua un `404 text/html` pentru `assets/index-<hash>.js` și
să vadă pagină albă până expiră cache-ul (≤10 min). Nu se poate repara din workflow.

Preflight pentru demo:

- fără deploy în **15 minute** înainte de prezentare;
- deschide linkul **după** ultimul deploy și fă hard refresh (`Ctrl/Cmd+Shift+R`);
- pornește motorul o dată, ca să preîncălzești WASM-ul de 28,7 MB și modelele;
- confirmă `crossOriginIsolated === true` în console după primul reload automat.

## Motorul din browser

- În **Live**, comutatorul „Procesează în browser" pornește inferența pe clipul camerei
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

## Modele și media

```bash
python3 frontend/scripts/prepare-models.py --help   # argumentele curente; sursele se dau explicit
python3 frontend/scripts/prepare-models.py <argumentele din --help>
bash scripts/prepare-demo-media.sh --check   # doar listează ce s-ar encodea
bash scripts/prepare-demo-media.sh           # scrie în frontend/public/media/
```

Scriptul copiază cele două exporturi ONNX EfficientDet-Lite (neatinse) și rescrie doar
inputul YuNet la `[1, 3, "height", "width"]`. Sursele sunt publice și se dau ca argumente:
`https://github.com/namas191297/efficientdetlite/tree/main/onnx_models` pentru detector și
`https://github.com/opencv/opencv_zoo` (`models/face_detection_yunet`) pentru YuNet.

ONNX-urile din `frontend/public/models/` (EfficientDet-Lite0, Lite2, YuNet) sunt
singurele binare comise intenționat, ca Pages să le poată servi; cu ele merg și textele de
licență (`LICENSE-APACHE-2.0.txt`, `LICENSE-CC-BY-3.0.txt`). Licențele și proveniența:
[`docs/legal/model-provenance.md`](docs/legal/model-provenance.md).

## Dacă ceva nu merge

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Pagină albă după build | build fără `VITE_USE_MOCK` (așteaptă un API care nu există) sau `VITE_BASE` greșit | rebuild cu ambele variabile, apoi `npm run preview` |
| Pagină albă imediat după un deploy | shell `index.html` cache-uit (`max-age=600` pe Pages), bundle-urile vechi au fost șterse | hard refresh; nu e o eroare de build, vezi riscul rezidual de mai sus |
| 404 la `/zones` pe Pages | lipsește copia `404.html` din `dist/` | rulează `cp dist/index.html dist/404.html` |
| Modelele nu se încarcă | lipsesc fișierele din `frontend/public/models/` sau calea nu folosește `BASE_URL` | verifică folderul și `${import.meta.env.BASE_URL}models/...` |
| Motorul e lent | WASM pe un singur fir, cadru prea mare sau alt tab care consumă CPU/GPU | deschide pe un singur tab, verifică `/bench`, lasă service worker-ul activ |
| `npm: command not found` | Node.js lipsește | instalează Node.js LTS (20+) |
