# demo/ — scenariu și înregistrare de rezervă

**Demo-ul curent:** [`run_sheet_browser.md`](run_sheet_browser.md) — 90 de secunde pe
build-ul static, tot pipeline-ul în tab. Pornirea și preflight-ul sunt în
[`RUNNING.md`](../RUNNING.md#pornire-rapidă).

> **Material istoric — nu se mai rulează.** [`run_sheet.md`](run_sheet.md) și
> [`scenario.md`](scenario.md) descriu demo-ul de hackathon SafeSight (trei camere, Slack,
> ack, raport de tură) pe `ml/` + `backend/`. Comenzile lor (`./run.sh`, `scripts/dev.py`)
> au fost șterse din acest fork; fișierele rămân ca record al ce s-a construit, nu ca demo
> al produsului. Pentru direcția actuală: [`docs/browser-engine.md`](../docs/browser-engine.md).

Responsabile: **Ariana** (scenariul și înregistrarea OBS) și **Dalina** (video-urile de test și recuzita).

- Scenariul demo-ului de hackathon: 10 pași, 3 minute; versiunea scurtă sare la pașii 2, 3, 4 și 9.
- Cazuri în demo: persoană în zona motorului și PPE lipsă. Fumul rămâne stretch; FOD nu mai e în scope.
- Pentru fiecare cameră, pregătiți un cadru de referință din același unghi; editorul de zone desenează pe el.
- Sursele `.mp4` (4K) rămân în [folderul comun din Drive](https://drive.google.com/drive/folders/1OTXiPjvX7PCAGDeXVKPa702PyQQZgzhA?usp=sharing) și nu intră în git. Versiunile web din `frontend/public/media/` intră, prin excepția din `.gitignore`; se fac cu `scripts/prepare-demo-media.sh`, descris în [`docs/media.md`](../docs/media.md).
- Fiecare clip are sursă, licență și cine a filmat, în `data/videos/README.md`. Fără acord scris, nu apare în materialul publicat.

Clipurile de test: om cu vestă, om fără vestă, om în zona motorului, cadru de referință curat.
