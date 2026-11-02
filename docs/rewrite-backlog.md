# Rewrite backlog — cod moștenit din SafeSight

Regula proiectului: codul scris înainte de fork se înlocuiește **oportunist**, nu în valuri.
Nu rescriem un modul doar pentru că e vechi; îl rescriem când avem un motiv de produs și
atingem oricum fișierul. Restul se notează aici, ca să nu se piardă.

## Ce înseamnă „înlocuit" (standard strict)

Un fișier se declară înlocuit doar dacă toate trei sunt adevărate:

1. **Diff-ul arată înlocuire**, nu doar atingere: implementarea veche ștearsă, una nouă
   scrisă. Commit-ul și `git show --numstat` sunt dovada, nu procentul.
2. **Auditul nu mai găsește logică a colegilor.** `python3 scripts/provenance.py --audit
   <fișier>` listează fiecare linie rămasă. Poate rămâne import, cheie de context, etichetă,
   clasă CSS sau matematică identică; **nicio funcție/ramură de logică**.
3. **Logica nouă are teste**, când e testabilă.

Altfel fișierul e „parțial", oricât de mare ar fi diff-ul. Procentul singur nu dovedește
nimic: `git blame -w` păstrează autorul vechi pentru liniile identice, iar o rescriere care
re-produce aceleași importuri și clase nu le transferă.

## Politica

1. **Oportunist, nu big-bang.** Când un fix sau o funcție atinge un fișier moștenit, poți
   înlocui unitatea atinsă (componenta, funcția, blocul) în același change — dacă diff-ul
   rămâne reviewable.
2. **Prag de mărime.** Dacă rescrierea depășește ~150 de linii schimbate, o faci pe branch
   separat, nu îngropată într-un fix.
3. **Dovada rămâne verde.** Demo path-ul, `node --test src/engine/*.test.mjs` și
   `npm run test:e2e` trebuie să treacă după fiecare înlocuire. Logica pură primește test
   înainte de a înlocui implementarea.
4. **Fără schimbări de contract.** O rescriere nu modifică `docs/contract.md`; dacă are
   nevoie, e alt PR.
5. **Referința nu e produs.** `backend/`, `ml/` și `data/` rămân implementarea de referință
   SafeSight. Nu le rescriem și nu le „curățăm"; nu rulează în build-ul static.
6. **Ce amâni, notezi.** Fiecare fișier atins dar nelocuit primește un rând aici, cu motivul.

Proveniența de mai jos e o **heuristcă** din `git log` (autorul cu cele mai multe commit-uri
non-merge pe fișier, plus fișierele adăugate înainte de fork). Nu e vină pe nimeni: arată
doar ce cod a fost scris înainte de direcția LocalSight și cât de mult l-am atins deja.

## Inventar

| Fișier | Proveniență | Stare | Decizie |
|---|---|---|---|
| `components/layout/Header.jsx` | VojuAriana (6/16) | **parțial**: structura, meniurile și focusul sunt rescrise (185+/122−), dar 173 de linii rămân (importuri, chei de context, JSX, clase) | nu se declară înlocuit până nu scade logică; restul e prezentare |
| `components/views/IncidentDetailView.jsx` | muxxq (4/9) | parțial rescris: copiază link, descarcă dovada, etichete demo/local; layout-ul de bază e încă moștenit | restul layout-ului, într-un pass separat |
| `components/views/IncidentsListView.jsx` | VojuAriana (1/3) | **logică înlocuită**: filtrare/formatare în `utils/incidentList.js` (8 teste), markup nou (181+/143−); 66 de linii rămase = `TokenBadge`, importuri, câteva clase | parțial textual, complet pe logică |
| `components/views/SettingsView.jsx` | VojuAriana (3/7) | parțial rescris (onestitate) | rescrie ca „Sistem" de la zero la următorul pass de UI |
| `components/layout/Sidebar.jsx` | andreisugu (8/17) | parțial rescris (responsive, footer) | refăcut la un design pass, nu înainte |
| `components/common/Toast.jsx` | VojuAriana (2/4) | moștenit | mic; înlocuiește-l când umbli la notificări |
| `components/common/ConfidenceBadge.jsx` | VojuAriana (1/1) | **logică nouă**: `utils/confidence.js` + 6 teste; 11 linii rămase sunt importuri/semnătură | parțial (markup-ul e încă aproape identic) |
| `constants/theme.js` + `context/ThemeContext.jsx` | VojuAriana | moștenit (tokens) | nu atinge până la un design pass; e folosit peste tot |
| `utils/polygon.js` | muxxq (1/1) | **rescris ca implementare** (63+/20−) + 14 teste; 45 de linii rămase sunt matematica identică și comentarii | înlocuit ca logică, nu ca text; nu pretindem altfel |
| `utils/print.js` | muxxq (1/1) | moștenit, folosit de 7 fișiere | înlocuiește-l cu un export CSV/PDF real, nu `window.print` |
| `utils/sound.js` | VojuAriana (1/1) | **înlocuit** (41+/32−) + 4 teste; 5 linii rămase sunt acolade/goale | gata |
| `constants/eventActions.js` | muxxq (1/1) | moștenit (matricea de acțiuni) | înlocuiește-l cu tabelul din contract la următoarea modificare de statusuri |
| `App.jsx` | VojuAriana (5/10) | **rescris structural**: hartă de rute, reset scroll/focus la schimbarea ecranului; 43 de linii rămase = importuri/layout | parțial textual, logica de navigare e a noastră |
| `main.jsx` | VojuAriana (1/2) | aproape tot al nostru (ErrorBoundary) | nu merită un pass separat |
| `components/video/BoundingBox.jsx` | VojuAriana (2/2) | **mort** — 0 importuri | candidat la ștergere; cere confirmare înainte |
| `components/views/LiveView.jsx` | andreisugu (15/24) | parțial rescris (motor, webcam, card) | shell-ul mai e moștenit; îl refacem la următorul pass mare de Live |
| `context/SecurityContext.jsx` | andreisugu (17/29) | parțial rescris (routing, engine events, ack) | taie-l în contexte mai mici doar când îl atinge un feature mare |
| `constants/mockData.js` | andreisugu (9/16) | parțial rescris (stills, id-uri stabile) | separă fixture-urile de logică la următorul pass de date |
| `services/api.js` | andreisugu (10/22) | parțial rescris (mock/API) | de înlocuit cu un client subțire când apare un backend real |

**Al nostru, nu se rescrie:** tot `frontend/src/engine/` (worker, pipeline, zones, events,
tracker, vest, blur, report, webgpu, decode), `LiveEngineCard`, `SafeImage`, `ErrorBoundary`,
`BenchView`, `LabView`, `pages.yml`, `ci.yml`, `check-base.mjs`.

**Referință, nu produs:** `backend/`, `ml/`, `data/`, `docker-compose.yml`. Nu le rescriem.

## Dovada rescrierilor

| Commit | Fișier | +/− | Ce s-a schimbat | Linii rămase (audit) |
|---|---|---|---|---|
| `ca4d137` | `Header.jsx` | +185 / −122 | meniuri cu Escape/click-outside, focus, căutare cu `/` | 173 — importuri, chei, JSX, clase |
| `8788265` | `utils/polygon.js` | +63 / −20 | implementare nouă + 14 teste | 45 — matematică identică |
| `1e15a73` | `utils/sound.js` | +41 / −32 | un singur AudioContext + 4 teste | 5 — acolade/goale |
| `009fdaf` | `ConfidenceBadge.jsx` + `utils/confidence.js` | +21/−11, +54 nou | formatter testat, fără valori inventate | 11 — importuri/semnătură |
| `ab3bac5` | `IncidentDetailView.jsx` | +42 / −3 | copiază link, descarcă dovada | 342 — layout moștenit |
| `5b05796` | `IncidentsListView.jsx` + `utils/incidentList.js` | +181/−143, +77 nou | listă rescrisă, filtre testate | 66 — TokenBadge/importuri |
| `1381d99` | `App.jsx` | +35 / −30 | hartă de rute, scroll/focus | 43 — importuri/layout |
| `f0b0eae` | `worker.js` / `useEngine.js` | +12/−12, +12/−1 | snapshot-ul e deținut de pagină | nu se aplică (engine al nostru) |

## Ce am amânat

| Data | Fișier | Motiv |
|---|---|---|
| 2026-11-02 | `IncidentDetailView.jsx` | am adăugat doar eticheta „date demo" și copy-ul onest; layout-ul rămâne moștenit |
| 2026-11-02 | `Header.jsx`, `IncidentsListView.jsx`, `Toast.jsx` | fix-uri punctuale de responsive/onestitate; rescrierea nu era în scope |
| 2026-11-02 | `IncidentDetailView.jsx` (layout) | 342 de linii rămase; doar acțiunile noi sunt ale noastre. Rescrierea completă e următorul pass. |
| 2026-11-02 | `Toast.jsx`, `eventActions.js`, `print.js` | mici și funcționale; le înlocuim când le atinge un feature |
| 2026-11-02 | `BoundingBox.jsx` | cod mort (0 importuri); așteaptă confirmarea pentru ștergere |
