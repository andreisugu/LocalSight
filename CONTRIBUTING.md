# Cum contribui la LocalSight

LocalSight pornește de la SafeSight și mută pipeline-ul în browser: detecție, zone,
blur pe fețe și incidente rulează în tab, fără server și fără upload.
**Artefactul produsului e build-ul static din `frontend/`.** Stack-ul Python de referință
(`backend/`, `ml/`, `automation/`) a fost șters din acest fork; nu mai există comenzi de
rulat pentru el. Codul vechi rămâne în istoricul git și în repo-ul upstream SafeSight.

## 1. Cerințe

| Unealtă | De ce | Verificare |
|---|---|---|
| Node.js 20+ | build-ul Vite; CI și Pages folosesc 20 | `node --version` |
| npm | vine cu Node | `npm --version` |
| `ffmpeg` | **opțional**, doar pentru re-encode de clipuri demo | `ffmpeg -version` |
| Python 3.12+ | **opțional**, doar pentru uneltele de întreținere (`prepare-models.py` cere `onnx`, `provenance.py` e stdlib) | `python3 --version` |

Dacă o comandă din pașii de mai jos nu răspunde, oprește-te aici: restul pașilor depind de ea.

## 2. Build-ul static (ce se livrează)

```bash
cd frontend
npm ci                 # din package-lock.json, nu npm install
npm run build          # scrie frontend/dist/
npx vite preview       # http://localhost:4173/
```

Build-ul pentru GitHub Pages (servit din subcale):

```bash
VITE_BASE=/LocalSight/ VITE_USE_MOCK=true npm run build
npx vite preview       # http://localhost:4173/LocalSight/
```

`VITE_USE_MOCK=true` înlocuiește apelurile către API cu datele din fixtures, ca
pagina să meargă fără niciun backend. `VITE_BASE` scrie prefixul în `index.html`
și în `BASE_URL`; fără el, căile absolute de assets dau 404 sub `/LocalSight/`.

## 3. Motorul din browser (unde se lucrează)

Nu există un stack Python de pornit. Tot ce ține de produs e în `frontend/src/engine/`:
YOLO26n + YuNet + tracker + zone + reguli + blur + vestă hi-vis, în Web Worker prin ONNX
Runtime Web. Logica pură se testează în Node:

```bash
cd frontend
node --test src/engine/*.test.mjs src/utils/*.test.mjs src/constants/*.test.mjs
npm run test:e2e
```

Design-ul și deciziile sunt în `docs/browser-engine.md`. Comentariile din `frontend/src`
care citează `ml/` sau `backend/` sunt proveniență (din ce fișier s-a portat logica), nu
căi de rulat: fișierele acelea sunt doar în istoricul git.

## 4. Modele și media

```bash
python3 frontend/scripts/prepare-models.py --yolo <export.onnx> --yunet <yunet.onnx>
                                                 # frontend/public/models/{yolo26n,yunet}.onnx
./scripts/prepare-demo-media.sh --check           # doar listează ce s-ar produce
./scripts/prepare-demo-media.sh [SURSĂ] [IEȘIRE] # encode H.264, fără audio, ≤ 20 s
```

- `prepare-models.py` pornește de la exporturile YOLO26n și YuNet folosite de fosta
  referință Python (acum doar în istoricul git / upstream) și rescrie inputul YuNet la
  `[1, 3, "height", "width"]`. Dă sursele ca argumente `--yolo` / `--yunet` dacă nu sunt
  în locurile implicite; are nevoie de `pip install onnx`.
- `prepare-demo-media.sh` citește `*.mp4` din directorul sursă și scrie versiunea
  web în `frontend/public/media/`. Implicitul e o cale absolută de pe mașina
  autorului: dă-ți directorul ca prim argument.
- Binarele generate **nu intră în git**: clipurile din `frontend/public/media/`,
  `dist/`, bazele locale. Singura excepție sunt cele două ONNX din
  `frontend/public/models/`, ținute intenționat în repo pentru că Pages nu le
  poate regenera la build. Nu mai adăuga altele.

## 5. Deploy

Un push pe `main` pornește `.github/workflows/pages.yml`: `npm ci`, build cu
`VITE_USE_MOCK=true` și `VITE_BASE=/LocalSight/`, apoi `cp dist/index.html dist/404.html`;
site-ul iese la <https://andreisugu.github.io/LocalSight/>. Copia `404.html` face ca
`/zones` sau `/incidents/<id>` să încarce aplicația, nu un 404, pentru că Pages
servește acel fișier pe orice rută necunoscută. Pull request-urile rulează
`.github/workflows/ci.yml` (unit, frontend, e2e, pages-base) fără să publice nimic.

## 6. Depanare

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Pagină albă după build | build fără `VITE_USE_MOCK` (așteaptă API) sau `VITE_BASE` greșit | rebuild cu ambele variabile, apoi `npx vite preview` |
| 404 la `/zones` pe Pages | lipsește copia `404.html` din `dist/` | rulează pasul `cp dist/index.html dist/404.html` |
| Modelele nu se încarcă | lipsesc fișierele din `frontend/public/models/` sau calea nu folosește `BASE_URL` | verifică folderul și `${import.meta.env.BASE_URL}models/...` |
| Motorul e lent sau nu pornește | WASM pe un singur fir, alt tab consumă CPU/GPU, sau WebGPU indisponibil | verifică `/bench`, închide alte tab-uri, lasă service worker-ul COOP/COEP activ |

## 7. Reguli de contribuție

- **Un singur concern per commit.** Diff mic, mesaj care spune ce se schimbă.
- **Fără dependențe noi fără să întrebi.** Fiecare pachet în plus ajunge în build-ul
  static pe care îl descarcă utilizatorul.
- **Nu comite modele, clipuri, `.env` sau baze de date locale** (secțiunea 4).
- **Niciodată fețe neblurate în assets, teste sau capturi.** Blur-ul rulează înainte
  de orice scriere ori afișare; fără nume, emoții sau identificare de persoane.
- **Licența:** codul e **BSL 1.1** (`LICENSE`) — copiere și modificare libere,
  producție și serviciu găzduit doar cu licență comercială, conversie la Apache 2.0
  pe 2 noiembrie 2030. **YOLO/Ultralytics e AGPL-3.0**: build-ul servește greutățile,
  deci AGPL se aplică ansamblului distribuit; BSL-ul nu acoperă asta — pentru orice
  uz comercial, întreabă întâi.
