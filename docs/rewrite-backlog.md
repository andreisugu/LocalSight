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
5. **Referința nu e produs.** `backend/`, `ml/` și `automation/` au fost **șterse din acest
   fork** odată cu decizia de a livra doar aplicația statică; codul lor rămâne în istoricul
   git și în upstream. `data/` rămâne material de referință. Nu se rescrie nimic din ele.
6. **Ce amâni, notezi.** Fiecare fișier atins dar nelocuit primește un rând aici, cu motivul.

Proveniența de mai jos e o **heuristcă** din `git log` (autorul cu cele mai multe commit-uri
non-merge pe fișier, plus fișierele adăugate înainte de fork). Nu e vină pe nimeni: arată
doar ce cod a fost scris înainte de direcția LocalSight și cât de mult l-am atins deja.

## Inventar

| Fișier | Proveniență | Stare | Decizie |
|---|---|---|---|
| `components/layout/Header.jsx` | VojuAriana (6/16) | **înlocuit** (`f705119`): 173→115 linii, logică în hook-uri; rămâne schelet JSX/importuri | gata |
| `components/views/IncidentDetailView.jsx` | muxxq (4/9) | **înlocuit** (`e303dbc`): 432→78 linii, 7 componente, helper cu 18 teste; audit 342→25 linii (0 logică) | gata |
| `components/views/IncidentsListView.jsx` | VojuAriana (1/3) | **logică înlocuită**: filtrare/formatare în `utils/incidentList.js` (8 teste), markup nou (181+/143−); 66 de linii rămase = `TokenBadge`, importuri, câteva clase | parțial textual, complet pe logică |
| `components/views/SettingsView.jsx` | VojuAriana (3/7) | **înlocuit** (347→66 linii; +269/−296), logică în `utils/systemView.js` + 13 teste; audit: 0 linii de logică | gata |
| `components/views/ReportsView.jsx` | VojuAriana | **înlocuit** (496 linii; +444/−352), pagina rescrisă, valorile în `utils/reportExport.js` + 12 teste; light mode lizibil; audit: 57 de linii (importuri, etichete, stiluri, JSX) | gata |
| `components/views/ZoneEditorView.jsx` | VojuAriana | **înlocuit**: logica la `990028f`, shell-ul refăcut la `8095b9e` (+159/−121); audit: 36 de linii (importuri, chei de context, JSX) | gata |
| `components/layout/Sidebar.jsx` | andreisugu (8/17) | **înlocuit** (`f705119`): 162→69 linii; nav din tabel, același comportament responsive | gata |
| `components/common/Toast.jsx` | VojuAriana (2/4) | **înlocuit** (20→11; +27/−9), `role=status`/`aria-live`, audit: 0 logică | gata |
| `components/common/ConfidenceBadge.jsx` | VojuAriana (1/1) | **înlocuit** (`f705119`): 11→9 linii, markup nou peste `utils/confidence.js` + 6 teste | gata |
| `context/ThemeContext.jsx` | VojuAriana (1/1) | **înlocuit** (`2b556cb`): 24→15 linii de schelet React, persistență în `utils/themePreference.js` + 6 teste | gata |
| `constants/theme.js` | VojuAriana | **înlocuit** (`2b556cb`): barrel de 5 linii peste `src/theme/*`; audit 125→0 | gata |
| `utils/polygon.js` | muxxq (1/1) | **rescris ca implementare** (63+/20−) + 14 teste; 45 de linii rămase sunt matematica identică și comentarii | înlocuit ca logică, nu ca text; nu pretindem altfel |
| `utils/print.js` | muxxq (1/1) | **înlocuit** (`f705119`): 12→4 linii, același contract `afterprint` | gata |
| `utils/sound.js` | VojuAriana (1/1) | **înlocuit** (41+/32−) + 4 teste; 5 linii rămase sunt acolade/goale | gata |
| `constants/eventActions.js` | muxxq (1/1) | **înlocuit** (`f705119`): matrice înghețată + `Object.hasOwn`; 11→3 linii | gata |
| `App.jsx` | VojuAriana (5/10) | **înlocuit** (`f705119`): hartă de rute, scroll/focus; 43→35 linii de schelet | gata |
| `main.jsx` | VojuAriana (1/2) | aproape tot al nostru (ErrorBoundary) | nu merită un pass separat |
| `components/video/BoundingBox.jsx` | VojuAriana (2/2) | **șters 2026-11-02** — 0 importuri, cod mort | gata |
| `components/views/LiveView.jsx` | andreisugu (15/24) | **înlocuit** (1298→234; +2102/−1220, 15 fișiere) | logică în `liveMedia.js` (19 teste) + `useLiveMedia.js`; ecranul e compus din 11 componente sub `components/live/`. Audit: 0 logică, 38 de linii = importuri, destructurare și schelet JSX |
| `context/SecurityContext.jsx` | andreisugu (17/29) | **înlocuit** (`ad4a246`): 855→164 linii, 10 hook-uri + 6 helperi cu 61 teste; audit 427→10 linii (acolade/goale) | gata |
| `constants/mockData.js` | andreisugu (9/16) | **înlocuit** (`6e37286`): barrel de 14 linii peste `src/data/*`; audit 61→0 | gata |
| `services/api.js` | andreisugu (10/22) | **înlocuit** (`6e37286`): 480→51 linii, `mockApi`/`http`/`backendApi` separate; audit 147→3 | gata |

**Al nostru, nu se rescrie:** tot `frontend/src/engine/` (worker, pipeline, zones, events,
tracker, vest, blur, report, webgpu, decode), `LiveEngineCard`, `SafeImage`, `ErrorBoundary`,
`BenchView`, `LabView`, `pages.yml`, `ci.yml`, `check-base.mjs`.

**Referință, nu produs:** `data/`. Stack-ul Python (`backend/`, `ml/`, `automation/`,
`docker-compose.yml`) a fost șters din fork; nu se rescrie și nu se restaurează aici.

## Dovada rescrierilor

| Commit | Fișier | +/− | Ce s-a schimbat | Linii rămase (audit) |
|---|---|---|---|---|
| `ca4d137` | `Header.jsx` | +185 / −122 | meniuri cu Escape/click-outside, focus, căutare cu `/` | 173 — importuri, chei, JSX, clase |
| `8788265` | `utils/polygon.js` | +63 / −20 | implementare nouă + 14 teste | 45 — matematică identică |
| `1e15a73` | `utils/sound.js` | +41 / −32 | un singur AudioContext + 4 teste | 5 — acolade/goale |
| `009fdaf` | `ConfidenceBadge.jsx` + `utils/confidence.js` | +21/−11, +54 nou | formatter testat, fără valori inventate | 11 — importuri/semnătură |
| `ab3bac5` | `IncidentDetailView.jsx` | +42 / −3 | copiază link, descarcă dovada | 342 — layout moștenit |
| `e303dbc` | `IncidentDetailView.jsx` + 7 componente + `utils/incidentDetail.js` | +460/−406, +469 nou | ecran rescris, helper cu 18 teste, light mode reparat | 25 — importuri/JSX (0 logică) |
| `990028f` | `ZoneEditorView.jsx` + 3 componente + `utils/zoneDraft.js` | +2048/−944 | editor rescris, state machine cu 39 teste | 74 — importuri/JSX (0 logică) |
| `d205b04` | `backend/`, `ml/`, `automation/`, scripturi | −17 942 | stack-ul de referință scos din fork | eliminat |
| `ad4a246` | `SecurityContext.jsx` + 10 hook-uri + 6 helperi | 855→164 | context împărțit, 61 teste | 10 — acolade/goale |
| `6e37286` | `services/api.js` + `constants/mockData.js` + `data/` + `services/` | 480→51, 680→14 | date și API rebuild | 3 / 0 |
| `f705119` | `Header`, `Sidebar`, `App`, `print`, `eventActions`, `ConfidenceBadge` | +561/−460 | chrome rebuilt, 0 logică | 115/69/35/4/3/9 |
| `2b556cb` | `theme.js`, `index.css`, `tailwind.config.js`, `ThemeContext` | +329/−234 | tokenuri + CSS split, valori identice | 0/3/25/15 |
| `8095b9e` | `ReportsView`, `ZoneEditorView`, `reportExport` | +444/−352 | shell-uri rescrise, CSV testat | 57/36 (0 logică) |
| `48804bb` | `LiveView` + 11 componente + `liveMedia` | +2102/−1220 | ecran compus, 19 teste | 38 (0 logică) |
| `5b05796` | `IncidentsListView.jsx` + `utils/incidentList.js` | +181/−143, +77 nou | listă rescrisă, filtre testate | 66 — TokenBadge/importuri |
| `1381d99` | `App.jsx` | +35 / −30 | hartă de rute, scroll/focus | 43 — importuri/layout |
| `f0b0eae` | `worker.js` / `useEngine.js` | +12/−12, +12/−1 | snapshot-ul e deținut de pagină | nu se aplică (engine al nostru) |
| `3990c27` | `SettingsView.jsx` + `Toast.jsx` + `utils/systemView.js` | +269/−296, +27/−9, +201 nou | pagină „Sistem & Audit" și toast accesibil, logică testată | 0 logică; doar importuri/JSX/clase |
| `8095b9e` | `ReportsView.jsx` + `ZoneEditorView.jsx` + `utils/reportExport.js` | +444/−352, +159/−121, +316 nou | pagini rescrise, CSV compus și testat (12 teste), light mode reparat | 57 / 36 — importuri, etichete, stiluri, JSX (0 logică) |
| `48804bb` | `LiveView.jsx` + 11 componente + `liveMedia.js` / `useLiveMedia.js` | +2102 / −1220 | ecran rescris: surse, webcam, etichete și guardul de ack mutate în module testate; invarianții de privacy neschimbați | 38 — importuri, destructurare, `if`-ul de fullscreen și scheletul JSX (0 logică) |

## Rezultat final (2026-11-02)

```text
frontend 22 364 linii de cod
  tu       21 693 (97,0%)
  colegi      671 (3,0%)
  logică moștenită: 0
```

Restul de 3% este schelet JSX, importuri, chei de context, etichete vizibile și valorile
de design pe care API-ul trebuie să le păstreze; nu conține funcții, ramuri sau calcule.
Stack-ul Python (`backend/`, `ml/`, `automation/`) a fost șters din fork (`d205b04`) și
rămâne în istoric/upstream. `polygon.js` păstrează matematica identică (rescrisă cu teste),
iar `tailwind.config.js` păstrează valorile de configurare.

## Ce am amânat

| Data | Fișier | Motiv |
|---|---|---|
| 2026-11-02 | `IncidentDetailView.jsx` | am adăugat doar eticheta „date demo" și copy-ul onest; layout-ul rămâne moștenit |
| 2026-11-02 | `Header.jsx`, `IncidentsListView.jsx`, `Toast.jsx` | fix-uri punctuale de responsive/onestitate; rescrierea nu era în scope |
| 2026-11-02 | `IncidentDetailView.jsx` (layout) | 342 de linii rămase; doar acțiunile noi sunt ale noastre. Rescrierea completă e următorul pass. |
| 2026-11-02 | `Toast.jsx`, `eventActions.js`, `print.js` | mici și funcționale; le înlocuim când le atinge un feature |
| 2026-11-02 | `theme.js`, `ThemeContext.jsx`, `index.css`, `tailwind.config.js` | tokenuri de design partajate; o rescriere fără un redesign real ar fi cosmetică |
| 2026-11-02 | `ReportsView.jsx`, `IncidentDetailView.jsx`, `IncidentsListView.jsx`, `ZoneEditorView.jsx`, `components/zones/*` | valul 1 de fix-uri a11y/design nu atinge ecranele care sunt consolidate de alt branch; rămân pe valul 2 (vezi raportul `prep/ui-fix`) |
| 2026-11-02 | `ReportsView.jsx` | contrast pe temă luminoasă: KPI `text-amber-600` (3,19:1), `#D73833` la `opacity-80` (3,53:1), `<th>` „Critice"/„Warning" (3,77/2,51:1); h3 „Rezumat Executiv Tură" pe temă întunecată (3,16:1) |
| 2026-11-02 | `ZoneEditorView.jsx` | hint-uri `opacity-60` (4,38:1) și butonul „Șterge" `text-red-500` (3,76:1) în tema luminoasă; numerotarea punctelor stă peste cadru (contrast nedeterminabil automat) |
| 2026-11-02 | `IncidentDetailView.jsx` | titlul `<h2>` e încă id-ul sintetic (design H4); eticheta raportului „AI · demo" vs „șablon" (H5) aparține ecranului de raport |
| 2026-11-02 | `IncidentFeedCard` / `IncidentsListView` | cardul de feed nu mai e `role=button` cu buton înăuntru (A5 rezolvat); lista rămâne cu `role=button` imbricat până la consolidare |
| 2026-11-02 | controlele din tema întunecată | granițele au 1,37–1,92:1 (sub 3:1, A9); tema luminoasă are acum `#64748B` = 4,76:1. Închiderea pe dark cere un pas de token, nu o clasă locală |
