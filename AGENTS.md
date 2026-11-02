# LocalSight — ghid pentru agenți AI

LocalSight pornește de la SafeSight (detecție pe edge, API FastAPI, UI React, construit la
un hackathon) și merge într-o direcție diferită: pipeline-ul întreg — detecție, zone,
blur de fețe, incidente — trebuie să ruleze **în browser**, cu `onnxruntime-web` pe WebGPU,
publicat static pe GitHub Pages. Nicio imagine nu pleacă din tab.

**Starea de azi:** site-ul static e live
(`https://andreisugu.github.io/LocalSight/`, `VITE_USE_MOCK=true`) și motorul din browser
rulează în tab: YOLO26n + YuNet + tracker + zone + reguli + blur + detectarea de vestă
hi-vis. Build-ul servit de `pages.yml` nu are backend. **Stack-ul Python de referință
(`backend/`, `ml/`, `automation/`) a fost șters din acest fork**; produsul e aplicația
statică din `frontend/`, iar codul Python vechi rămâne în istoricul git și în repo-ul
upstream SafeSight. Pe Firefox motorul alege intenționat WASM (WebGPU încă nu e stabil
acolo); pe Chrome/Edge folosește WebGPU când există adapter.

Acest fișier e sursa de adevăr pentru agenți. `CLAUDE.md` doar trimite aici. Citește-l
înainte să modifici ceva și actualizează-l în același commit când o regulă durabilă se
schimbă.

## Harta repo-ului

- `frontend/` — **produsul**. React 19 + Vite + Tailwind, JavaScript, servit static.
  Aici crește motorul din browser (`docs/browser-engine.md` descrie `frontend/src/engine/`).
  Build-ul static ia modelele din `frontend/public/models/` și clipurile din
  `frontend/public/media/`.
- `docs/` — `browser-engine.md` (design-ul portului), `media.md` (clipurile demo),
  `performance.md` (măsurători istorice), `contract.md` (plicul evenimentului).
- `scripts/` — `prepare-demo-media.sh` (encodează clipurile) și `provenance.py`
  (raportul de proveniență).
- `data/` — clipuri și adnotări locale, în afara git în afară de README-uri.
- `demo/` — `run_sheet_browser.md` (demo-ul curent) plus run sheet-urile istorice.
- `backend/`, `ml/`, `automation/` — **nu mai există în acest fork.** Nu le recrea; dacă
  ai nevoie de o bucată, o iei din istoricul git sau din upstream și o portezi în JS.

## Comenzi care funcționează

Frontend (Node 20 în CI; `npm ci` o dată):

```bash
cd frontend
npm ci
npm run dev                                              # Vite pe :5173
npm run build                                            # build normal; UI-ul cere API real la runtime
VITE_USE_MOCK=true npm run build                         # build static, fără backend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build  # exact ce face pages.yml
node --test src/engine/*.test.mjs                        # logica motorului (Node, fără browser)
npm run test:e2e                                         # Playwright, 5 teste
```

Testele rulează în Node, fără browser, pe tot ce ține de logică (`src/engine`,
`src/utils`, `src/constants`). Producția nu are teste Python.

Modele și media (binare, regenerate, nu inventate):

```bash
python3 frontend/scripts/prepare-models.py --yolo <export.onnx> --yunet <yunet.onnx>
                                             # rescrie yolo26n.onnx + yunet.onnx (sursele: istoric git)
bash scripts/prepare-demo-media.sh --check   # doar listează ce s-ar encodea
bash scripts/prepare-demo-media.sh           # scrie în frontend/public/media/
```

Înainte de a încheia: rulează verificarea modulului atins (`npm run build` și
`node --test ...` în `frontend`). Dacă nu poți, spune exact ce comandă a eșuat și de ce.

## Ce citești înainte de lucrul pe motor

1. `docs/browser-engine.md` — ce se portează, modul cu modul, și ce rămâne afară.
2. `docs/media.md` — cum ajung clipurile în build fără să intre în git.
3. `docs/performance.md` — cifrele măsurate pe vechea referință CPU (istoric); nu optimiza
   după intuiție, iar pentru tab folosește cifrele din `docs/browser-engine.md`.
4. `docs/contract.md` — plicul evenimentului (`event_id`, `confidence`, severitate).
   Abaterea acceptată în browser: `snapshot_url` devine `blob:`.

## Cod moștenit din SafeSight

- Fișierele scrise înainte de fork se înlocuiesc **oportunist**, doar când un change atinge
  deja fișierul pentru un motiv de produs. Nu porni o rescriere în val.
- Dacă înlocuirea depășește ~150 de linii, o faci pe branch separat, nu îngropată într-un fix.
- Inventarul, proveniența și ce s-a amânat stau în `docs/rewrite-backlog.md`; adaugă acolo
  orice amâni, cu o linie de motiv.
- Procentele se măsoară cu `python3 scripts/provenance.py`; înainte să declari un fișier
  înlocuit, rulează `--audit <fișier>` și verifică să nu rămână logică a colegilor. Liniile
  identice (importuri, clase, matematică) rămân atribuite lor — asta e corect.
- `data/` e referință, nu produs: nu îl rescrii și nu îl cureți.
- Comentariile din `frontend/src` care citează `ml/` sau `backend/` sunt **proveniență**:
  arată din ce fișier s-a portat logica. Acele fișiere nu mai există în fork; nu le urma
  ca pe niște căi de rulat, ci caută-le în istoricul git dacă ai nevoie de ele.

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

## Accesibilitate — reguli pe care UI-ul le respectă azi

- **Inelul de focus e global**, în `frontend/src/styles/base.css`: două tonuri (miez închis
  `#0F172A` pe tema luminoasă, galben `#FFEB33` pe cea întunecată, fiecare cu halo). Nu
  adăuga local `focus:ring-[#FFEB33]`: galbenul pe alb are 1,22:1 și nu se vede.
- **Orice modal trece prin portal în `<body>`** și respectă contractul din
  `FalsePositiveDialog.jsx`: `role=dialog` + `aria-modal` + `aria-labelledby`, focus în
  primul control, Tab/Shift+Tab prinse în dialog, Escape închide, focusul se întoarce la
  declanșator, iar restul documentului devine `inert`.
- **Metadata pe suprafață albă folosește `text-slate-500`** (4,76:1) cu `dark:text-slate-400`
  (5,75:1). `text-slate-400` pe alb are 2,56:1 și nu trece AA; `text-amber-700` înlocuiește
  `amber-500` pentru valori (5,02:1).
- **Mișcarea infinită se oprește** sub `prefers-reduced-motion` (blocul global din
  `base.css`), iar accentul de escaladare e un inel static — nu o pulsație de opacitate,
  care coboară textul sub AA pentru jumătate din ciclu.
- **Pe ecranele Live, eticheta sursei spune adevărul**: `LIVE REC` există doar pentru
  camera locală; un clip demo scrie `CLIP DEMO · LOOP`. Starea de eroare a camerei nu păstrează
  cadrul vechi, HUD-ul sau footerul.

## Când ești blocat

Citește documentul relevant și fișierele atinse; propune un plan de 3 linii; pune o singură
întrebare de clarificare; nu ghici. Dacă găsești o inconsecvență (de exemplu între
`docs/browser-engine.md` și cod), oprește-te și raportează în loc să o ocolești.

## Descoperire progresivă

`docs/browser-engine.md` · `docs/media.md` · `docs/performance.md` · `docs/contract.md` ·
`docs/qa/` · `docs/rewrite-backlog.md` · `frontend/README.md` ·
`frontend/public/models/README.md` · `demo/run_sheet_browser.md` · `demo/run_sheet.md` (istoric)
