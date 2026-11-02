# Cum contribui la LocalSight

LocalSight pornește de la SafeSight și mută pipeline-ul în browser: detecție, zone,
blur pe fețe și incidente rulează în tab, fără server și fără upload.
**Artefactul produsului e build-ul static din `frontend/`.** Stack-ul Python de referință
(`backend/`, `ml/`, `automation/`) a fost șters din acest fork; nu mai există comenzi de
rulat pentru el. Codul vechi rămâne în istoricul git și în repo-ul upstream SafeSight.

**Comenzile de rulare, testare și deploy sunt într-un singur loc:**
[`RUNNING.md`](RUNNING.md). Nu le copia în alte fișiere; dacă se schimbă ceva, se schimbă
acolo.

## 1. Înainte să începi

Cerințele și verificarea lor sunt în [`RUNNING.md`](RUNNING.md#cerințe). Dacă o comandă de
acolo nu răspunde, oprește-te: restul pașilor depind de ea.

## 2. Pornire și build

Dezvoltarea, build-ul static și varianta de Pages sunt în
[`RUNNING.md`](RUNNING.md#pornire-rapidă). Pentru demo folosește mereu build-ul mock:
`VITE_USE_MOCK=true` înlocuiește apelurile către API cu datele din fixtures, ca pagina să
meargă fără niciun backend.

## 3. Teste

Suita unitară, smoke-ul Playwright și suita pe forma de deploy sunt în
[`RUNNING.md`](RUNNING.md#teste). Orice schimbare de logică vine cu un test; nu slăbi și nu
șterge un test ca să treacă ceva.

## 4. Unde se lucrează

Nu există un stack Python de pornit. Tot ce ține de produs e în `frontend/src/engine/`:
YOLO26n + YuNet + tracker + zone + reguli + blur + vestă hi-vis, în Web Worker prin ONNX
Runtime Web. Logica pură se testează în Node.

Design-ul și deciziile sunt în [`docs/browser-engine.md`](docs/browser-engine.md).
Comentariile din `frontend/src` care citează `ml/` sau `backend/` sunt proveniență (din ce
fișier s-a portat logica), nu căi de rulat: fișierele acelea sunt doar în istoricul git.

## 5. Modele și media

Regenerarea modelelor și encode-ul clipurilor sunt în
[`RUNNING.md`](RUNNING.md#modele-și-media). Reguli:

- `prepare-models.py` pornește de la exporturile YOLO26n și YuNet folosite de fosta
  referință Python (acum doar în istoricul git / upstream) și rescrie inputul YuNet la
  `[1, 3, "height", "width"]`. Are nevoie de `pip install onnx`.
- `prepare-demo-media.sh` citește `*.mp4` din directorul sursă și scrie versiunea web în
  `frontend/public/media/`. Implicitul e o cale absolută de pe mașina autorului: dă-ți
  directorul ca prim argument.
- Binarele generate **nu intră în git**: clipurile din `frontend/public/media/`, `dist/`,
  bazele locale. Singura excepție sunt cele două ONNX din `frontend/public/models/`, ținute
  intenționat în repo pentru că Pages nu le poate regenera la build. Nu mai adăuga altele.

## 6. Deploy

Garda de CI, build-ul de Pages, verificarea artefactului și rollback-ul sunt în
[`RUNNING.md`](RUNNING.md#deploy). Pull request-urile rulează `.github/workflows/ci.yml`
(unit, build, e2e, Pages e2e, pages-base) fără să publice nimic.

## 7. Reguli de contribuție

- **Un singur concern per commit.** Diff mic, mesaj care spune ce se schimbă.
- **Fără dependențe noi fără să întrebi.** Fiecare pachet în plus ajunge în build-ul
  static pe care îl descarcă utilizatorul.
- **Nu comite modele, clipuri, `.env` sau baze de date locale** (secțiunea 5).
- **Niciodată fețe neblurate în assets, teste sau capturi.** Blur-ul rulează înainte
  de orice scriere ori afișare; fără nume, emoții sau identificare de persoane.
- **Licența:** codul e **BSL 1.1** (`LICENSE`) — copiere și modificare libere,
  producție și serviciu găzduit doar cu licență comercială, conversie la Apache 2.0
  pe 2 noiembrie 2030. **YOLO/Ultralytics e AGPL-3.0**: build-ul servește greutățile,
  deci AGPL se aplică ansamblului distribuit; BSL-ul nu acoperă asta — pentru orice
  uz comercial, întreabă întâi. Detalii: [`THIRD_PARTY.md`](THIRD_PARTY.md).

## 8. Depanare

Simptomele cunoscute și cauzele lor sunt în
[`RUNNING.md`](RUNNING.md#dacă-ceva-nu-merge).
