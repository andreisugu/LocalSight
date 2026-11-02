# docs/ — index

LocalSight rulează tot pipeline-ul în tab. Documentele de aici vin din două epoci: unele
descriu motorul din browser (actual), altele implementarea SafeSight cu backend Python
(istoric). Nu rescriem istoricul; îl marcăm ca să nu-l confundăm cu direcția curentă.

Fișierul de față (`README.md`) este indexul; toate celelalte fișiere din `docs/` apar exact
o dată în tabelul de mai jos.

| Fișier | Stare | Ce conține | Ce faci cu el |
|---|---|---|---|
| [browser-engine.md](browser-engine.md) | actual | Nota de proiect a motorului din browser: module JS, active de model, runtime, buget de performanță, riscuri | Punctul de plecare; se actualizează când se schimbă arhitectura |
| [media.md](media.md) | actual | Re-encodarea clipurilor demo (H.264, 1920 px, fără audio) și publicarea lor pe GitHub Pages | Îl urmezi cu `scripts/prepare-demo-media.sh` înainte de build |
| [performance.md](performance.md) | referință | Cifre măsurate pe edge (torch vs ncnn, blur de fețe) și experimente respinse cu motiv | Nu se aplică 1:1 în tab; îl folosești pentru buget și așteptări realiste |
| [contract.md](contract.md) | istoric | Contractul eveniment/zonă v2.2 și endpointurile backendului (A→B) | Citești doar forma plicului de eveniment; endpointurile nu se mai aplică |
| [plan_alert_guarantees.md](plan_alert_guarantees.md) | istoric | Planul livrat pentru outbox/retry, watchdog de cameră și raport de tură | Nu se portează; spune ce însemna „alertă garantată” înainte |
| [agentic-annotation-workflow.md](agentic-annotation-workflow.md) | istoric | Cum s-au produs cele 2 etichete YOLO PPE, cu verificare vizuală | Nu se portează; etichetele trăiesc în `data/annotations/` |
| [assets/demo-apron.webp](assets/demo-apron.webp) | istoric | Captură SafeSight veche: platforma reală (avion la poartă, zonă restricționată) | Nu mai e în README-ul rădăcină, care linkuiește `assets/localsight-*.png`; rămâne doar numită în `THIRD_PARTY.md` |
| [assets/demo-app.webp](assets/demo-app.webp) | istoric | Captură SafeSight veche cu aplicația din demo (veste, incidente) | Idem; nu o pune în README |

Legendă: **actual** = descrie direcția LocalSight; **referință** = încă adevărat și util la
port; **istoric** = descrie implementarea SafeSight (backend/edge) și nu mai decide nimic.
Documentele istorice au un banner în capul fișierului, nu conținut rescris.

## Candidate la ștergere

Nu ștergem nimic acum; verificăm întâi că nu e citat de altcineva. Sunt aceleași
fișiere ca în tabelul de sus.

| Fișier | De ce ar fi candidat |
|---|---|
| `plan_alert_guarantees` | Planul e livrat, iar deltele lui de contract au intrat în contract.md v2.2 și regulile de livrare în `AGENTS.md`; rămâne dublură istorică |
| `agentic-annotation-workflow` | Ordinea claselor și setul final sunt deja în `data/annotations/README.md`, care e sursa întreținută |
