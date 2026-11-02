# Rewrite backlog — cod moștenit din SafeSight

Regula proiectului: codul scris înainte de fork se înlocuiește **oportunist**, nu în valuri.
Nu rescriem un modul doar pentru că e vechi; îl rescriem când avem un motiv de produs și
atingem oricum fișierul. Restul se notează aici, ca să nu se piardă.

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
| `components/layout/Header.jsx` | VojuAriana (6/16) | moștenit, cu fix-uri de responsive | înlocuiește-l când îl atingi iar; e mic |
| `components/views/IncidentDetailView.jsx` | muxxq (4/9) | moștenit, layout + raport/print | rescriere de layout într-un pass separat; păstrează legarea la date |
| `components/views/IncidentsListView.jsx` | VojuAriana (1/3) | moștenit | înlocuiește-l când îl atingi; e listă simplă |
| `components/views/SettingsView.jsx` | VojuAriana (3/7) | parțial rescris (onestitate) | rescrie ca „Sistem" de la zero la următorul pass de UI |
| `components/layout/Sidebar.jsx` | andreisugu (8/17) | parțial rescris (responsive, footer) | refăcut la un design pass, nu înainte |
| `components/common/Toast.jsx` | VojuAriana (2/4) | moștenit | mic; înlocuiește-l când umbli la notificări |
| `components/common/ConfidenceBadge.jsx` | VojuAriana (1/1) | moștenit | 20 de linii; înlocuiește-l când îl atingi |
| `constants/theme.js` + `context/ThemeContext.jsx` | VojuAriana | moștenit (tokens) | nu atinge până la un design pass; e folosit peste tot |
| `utils/polygon.js` | muxxq (1/1) | moștenit, folosit de editorul de zone | înlocuiește-l cu funcții testate când schimbi geometria editorului |
| `utils/print.js` | muxxq (1/1) | moștenit, folosit de 7 fișiere | înlocuiește-l cu un export CSV/PDF real, nu `window.print` |
| `utils/sound.js` | VojuAriana (1/1) | moștenit, 1 consumator | rescrie în ~10 linii când atingi alerta critică |
| `constants/eventActions.js` | muxxq (1/1) | moștenit (matricea de acțiuni) | înlocuiește-l cu tabelul din contract la următoarea modificare de statusuri |
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

## Ce am amânat

| Data | Fișier | Motiv |
|---|---|---|
| 2026-11-02 | `IncidentDetailView.jsx` | am adăugat doar eticheta „date demo" și copy-ul onest; layout-ul rămâne moștenit |
| 2026-11-02 | `Header.jsx`, `IncidentsListView.jsx`, `Toast.jsx` | fix-uri punctuale de responsive/onestitate; rescrierea nu era în scope |
| 2026-11-02 | `utils/polygon.js` | geometria editorului merge; o rescriere cere teste înainte |
