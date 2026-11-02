# docs/ — index

LocalSight rulează tot pipeline-ul în tab. Documentele de aici vin din două epoci: unele
descriu motorul din browser (actual), altele implementarea SafeSight cu backend Python
(istoric). Nu rescriem istoricul; îl marcăm ca să nu-l confundăm cu direcția curentă.

Stack-ul Python de referință (`backend/`, `ml/`, `automation/`) **a fost șters din acest
fork**: documentele de mai jos care îl citează sunt păstrate ca record, iar căile și
comenzile din ele nu mai există în arbore. Codul se află în istoricul git și în repo-ul
upstream SafeSight. Pentru produs, sursa de adevăr rămâne `docs/browser-engine.md` și
`docs/contract.md` (plicul evenimentului).

Fișierul de față (`README.md`) este indexul; toate celelalte fișiere din `docs/` apar exact
o dată în tabelul de mai jos. Comenzile de rulare, testare și deploy sunt doar în
[`../RUNNING.md`](../RUNNING.md).

| Fișier | Stare | Ce conține | Ce faci cu el |
|---|---|---|---|
| [browser-engine.md](browser-engine.md) | actual | Nota de proiect a motorului din browser: module JS, active de model, runtime, buget de performanță, riscuri | Punctul de plecare; se actualizează când se schimbă arhitectura |
| [media.md](media.md) | actual | Re-encodarea clipurilor demo (H.264, 1920 px, fără audio) și publicarea lor pe GitHub Pages | Îl urmezi cu `scripts/prepare-demo-media.sh` înainte de build |
| [architecture/review.md](architecture/review.md) | actual | Audit de arhitectură și cod: verdict, constatări prioritizate P0–P2, dovezi și anexe pe `frontend/`, `docs/` și CI | Îl folosești ca listă de priorități; cifrele lui sunt snapshot-ul commitului `ad05128`, nu starea de azi |
| [ops/release-audit.md](ops/release-audit.md) | actual | Audit de release și operațiuni: stare live, gate de CI, artefact, riscuri și goluri de runbook | Citește-l înainte de un demo public; spune ce e verificat și ce rămâne deschis |
| [ops/ci-speed.md](ops/ci-speed.md) | actual | CI înainte/după: cache Playwright, job unit+build, paths-ignore, concurrency | Verifică cifrele după ~10 rulări; rollback prin revert |
| [product/feature-gaps.md](product/feature-gaps.md) | actual | Analiză de produs: ce lipsește între demo și un pilot de apron, efort, riscuri și non-scop | Îl folosești pentru prioritizare de produs; nu adaugă backend sau upload |
| [product/innovation-operator.md](product/innovation-operator.md) | actual | Propuneri pentru operator: coada de triaj cu deadline, episode grouping, coverage receipt | Shortlist de produs; propunerile nu sunt implementate |
| [product/innovation-engine.md](product/innovation-engine.md) | actual | Propuneri pentru motor: metric ground plane, obiecte staționare, a doua opinie pe cadrele de eveniment | Shortlist tehnică, cu fezabilitate și limite; nimic nu e implementat |
| [design/ui-audit.md](design/ui-audit.md) | actual | Audit vizual pe toate ecranele, dark/light, 1400/1024/375: 29 de constatări, 8 mari | Fix-ul pornește de la ID-urile din raport; nu redesena |
| [qa/a11y-findings.md](qa/a11y-findings.md) | actual | Audit de accesibilitate pe build-ul livrat: constatări cu dovezi, severitate și reparații propuse | Pornește fiecare fix de accesibilitate de la o constatare de aici |
| [qa/functional-round2.md](qa/functional-round2.md) | actual | QA funcțional pe zone/thread-uri/safety blur; toate F1–F6 reparate pe main | Evidența stării de la build-ul testat; verifică commit-urile din header |
| [qa/ui-findings.md](qa/ui-findings.md) | actual | QA adversarial pe interfață: constatări cu pași de reproducere, severitate și dovezi | Nu se rezolvă „după impresii”; fiecare fix pornește de la un pas de aici |
| [qa/privacy-findings.md](qa/privacy-findings.md) | actual | Ce se vede pe ecran și ce pleacă în rețea cu motorul pornit; scurgerile găsite înainte de fix | Se recitește înainte de orice afirmație publică despre blur; regression-ul de mai jos e dovada stării curente |
| [qa/privacy-regression.md](qa/privacy-regression.md) | actual | Regresie pe build-ul curent: cadrele rămân în tab, blur fail-closed, fără upload sau cereri terțe | Dovada de privacy pentru build-ul livrat; o rulezi din nou după orice atingere a motorului |
| [qa/ppe-end-to-end.md](qa/ppe-end-to-end.md) | actual | Dovada că `NO_PPE` chiar se declanșează, cu clip de control și poarta de 150 px | Arată de ce un om mic în cadru nu produce `no_vest`; nu coborî pragul |
| [qa/perf-findings.md](qa/perf-findings.md) | actual | Sesiune de 13 minute: fps, memorie, workeri, plus leak-ul nativ la comutarea motorului | Cifrele de referință pentru orice optimizare; leak-ul e urmărit separat |
| [qa/perf-face-cap.md](qa/perf-face-cap.md) | actual | Profilul cadrului la 1280 și capul pe inputul YuNet: A/B, recall și dovezile de privacy | Cifrele „după” pentru motor; capul e condiționat de banda de cap, nu se scoate din context |
| [rewrite-backlog.md](rewrite-backlog.md) | actual | Inventarul codului moștenit din SafeSight și regula de înlocuire oportunistă | Adaugi aici ce amâni; nu porni rescrieri în val |
| [performance.md](performance.md) | istoric | Cifre măsurate pe edge-ul Python (torch vs ncnn, blur de fețe) și experimente respinse cu motiv | Nu se aplică 1:1 în tab și **nu se mai poate re-rula** (stack-ul Python a fost șters); îl folosești pentru buget și așteptări realiste |
| [contract.md](contract.md) | istoric | Contractul eveniment/zonă v2.2 și endpointurile backendului (A→B) | Citești doar forma plicului de eveniment; endpointurile descriu un backend care nu mai există în fork |
| [plan_alert_guarantees.md](plan_alert_guarantees.md) | istoric | Planul livrat pentru outbox/retry, watchdog de cameră și raport de tură | Nu se portează; spune ce însemna „alertă garantată” înainte, pe backend-ul șters |
| [agentic-annotation-workflow.md](agentic-annotation-workflow.md) | istoric | Cum s-au produs cele 2 etichete YOLO PPE, cu verificare vizuală | Nu se portează; etichetele trăiesc în `data/annotations/` |
| [ort-web-notes.md](ort-web-notes.md) | istoric | Notă de cercetare despre ONNX Runtime Web, WebGPU și WASM, scrisă înainte de port; cifrele din browser sunt ipoteze | Nu o folosi ca stare curentă; multi-threading-ul pe Pages a fost rezolvat prin service worker, vezi `browser-engine.md` |
| [qa/engine-parity.md](qa/engine-parity.md) | istoric | Motorul JS vs referința Python: geometrie, reguli, recall YOLO/YuNet pe cadre reale | Dovada că portul a fost echivalent; nu se mai poate re-rula, stack-ul Python a fost șters |
| [provenance.md](provenance.md) | generat | Tabel pe fișiere: câte linii sunt ale tale, ale colegilor, necunoscute | Îl regenerezi cu `python3 scripts/provenance.py --write`; nu îl edita manual |
| [assets/localsight-live.png](assets/localsight-live.png) | actual | Captură LocalSight: feed-ul camerei CAM-01 cu zona motorului și incidentele detectate | Imaginea din README-ul rădăcină; o înlocuiești când se schimbă UI-ul |
| [assets/localsight-incidents.png](assets/localsight-incidents.png) | actual | Captură LocalSight: lista de incidente cu severitate, status și dovadă foto | Idem |
| [assets/localsight-zones.png](assets/localsight-zones.png) | actual | Captură LocalSight: configurarea zonei pe canvas și parametrii regulii | Idem |

Legendă: **actual** = descrie direcția LocalSight sau e un raport despre ea; **istoric** =
descrie implementarea SafeSight (backend/edge) și nu mai decide nimic; **generat** = produs
de un script. Documentele istorice au în cap bannerul
**`Material istoric — nu se mai rulează`**, nu conținut rescris. Eticheta „referință” a
dispărut: nu mai există cod Python în arbore față de care să se refere.

## Candidate la ștergere

Nu ștergem nimic acum; verificăm întâi că nu e citat de altcineva. Sunt aceleași
fișiere ca în tabelul de sus.

| Fișier | De ce ar fi candidat |
|---|---|
| `plan_alert_guarantees` | Planul e livrat, iar deltele lui de contract au intrat în contract.md v2.2 și regulile de livrare în `AGENTS.md`; rămâne dublură istorică |
| `agentic-annotation-workflow` | Ordinea claselor și setul final sunt deja în `data/annotations/README.md`, care e sursa întreținută |

Rapoartele din `architecture/`, `ops/`, `product/` și `qa/` sunt **dovezi**, nu candidate:
rămân chiar dacă recomandările lor au fost sau nu implementate.
