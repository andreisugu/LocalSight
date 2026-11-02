# Cum contribui la LocalSight

LocalSight pornește de la SafeSight și mută pipeline-ul în browser: detecție, zone,
blur pe fețe și incidente rulează în tab, fără server și fără upload. Portul e în lucru.
**Artefactul produsului e build-ul static din `frontend/`**; Python-ul (`backend/`,
`ml/`, `automation/`) e referința care se portează.

## 1. Cerințe

| Unealtă | De ce | Verificare |
|---|---|---|
| Node.js 20+ | build-ul Vite; CI și Pages folosesc 20 | `node --version` |
| npm | vine cu Node | `npm --version` |
| `uv` | medii Python izolate pentru `backend/` și `ml/` | `uv --version` |
| Python 3.12+ | cerut de ambele `pyproject.toml`; `uv` îl descarcă singur dacă lipsește | `uv python list --only-installed` |
| `ffmpeg` | **opțional**, doar pentru re-encode de clipuri demo | `ffmpeg -version` |

Instalare `uv`: `curl -LsSf https://astral.sh/uv/install.sh | sh`. Dacă o comandă
nu răspunde, oprește-te aici: restul pașilor depind de ea.

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

## 3. Referința Python (se portează, nu e direcția viitoare)

```bash
cd backend && uv sync && uv run pytest -q           # API: ~137 teste
cd ml && uv sync --extra yolo && uv run pytest -q   # edge: ~110 teste, 5 sărite
```

`--extra yolo` aduce `ultralytics` și `torch` (~1 GB): fără el, tracking-ul și
backend-ul NCNN nu au ce importa. Testele care cer greutăți reale se sar singure.
Produsul complet, așa cum arată azi (API pe `:8000`, UI pe `:5173`, câte un edge
pe fiecare cameră demo): `./run.sh demo`. Rulează, dar **nu este ținta**: fiecare
piesă se mută rând pe rând în `frontend/` (vezi `docs/browser-engine.md`).

## 4. Modele și media

```bash
python3 frontend/scripts/prepare-models.py        # frontend/public/models/{yolo26n,yunet}.onnx
./scripts/prepare-demo-media.sh --check           # doar listează ce s-ar produce
./scripts/prepare-demo-media.sh [SURSĂ] [IEȘIRE] # encode H.264, fără audio, ≤ 20 s
```

- `prepare-models.py` copiază `ml/yolo26n.onnx` și rescrie inputul YuNet la
  `[1, 3, "height", "width"]`. Are nevoie de `pip install onnx` și de sursele din
  `ml/` (ignorate de git, aduse cu `ml/scripts/fetch_face_model.sh` și un export
  `yolo export model=yolo26n.pt format=onnx imgsz=640`).
- `prepare-demo-media.sh` citește `*.mp4` din directorul sursă și scrie versiunea
  web în `frontend/public/media/`. Implicitul e o cale absolută de pe mașina
  autorului: dă-ți directorul ca prim argument.
- Binarele generate **nu intră în git**: clipurile din `frontend/public/media/`,
  `ml/*.onnx`, `dist/`, bazele locale. Singura excepție sunt cele două ONNX din
  `frontend/public/models/`, ținute intenționat în repo pentru că Pages nu le
  poate regenera la build. Nu mai adăuga altele.

## 5. Deploy

Un push pe `main` pornește `.github/workflows/pages.yml`: `npm ci`, build cu
`VITE_USE_MOCK=true` și `VITE_BASE=/LocalSight/`, apoi `cp dist/index.html dist/404.html`;
site-ul iese la <https://andreisugu.github.io/LocalSight/>. Copia `404.html` face ca
`/zones` sau `/incidents/<id>` să încarce aplicația, nu un 404, pentru că Pages
servește acel fișier pe orice rută necunoscută. Pull request-urile rulează
`.github/workflows/ci.yml` (backend, ml, frontend) fără să publice nimic.

## 6. Depanare

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Pagină albă după build | build fără `VITE_USE_MOCK` (așteaptă API) sau `VITE_BASE` greșit | rebuild cu ambele variabile, apoi `npx vite preview` |
| 404 la `/zones` pe Pages | lipsește copia `404.html` din `dist/` | rulează pasul `cp dist/index.html dist/404.html` |
| Modelele nu se încarcă | lipsesc fișierele din `frontend/public/models/` sau calea nu folosește `BASE_URL` | verifică folderul și `${import.meta.env.BASE_URL}models/...` |
| Teste `ml` sărite | lipsesc modelele din `ml/models/` sau clipurile din `data/videos/` | rulează `ml/scripts/fetch_face_model.sh` și pune clipurile la loc |

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
