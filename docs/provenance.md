# Proveniență — cine a scris codul rămas

Generat cu `python3 scripts/provenance.py --write` la commit `d205b04`.
Măsoară **ultima atingere a fiecărei linii** (`git blame -w`), nu commit-urile.
Un rând rescris de tine apare ca al tău chiar dacă ideea era a altcuiva; un rând
copiat dintr-un fișier al colegilor rămâne al lor până îl atingi. `-w` ignoră
schimbările doar de whitespace. Fișierele binare, lockfile-urile și asset-urile sunt
excluse. Codul scris de agenți în această sesiune e comis sub identitatea ta, deci
intră la „tu”.

**Total: 18637 linii** — tu 16344, colegi 2293, necunoscut 0.

| Fișier | Linii | Tu | Colegi | ? | Colegi % |
|---|---:|---:|---:|---:|---:|
| `frontend/src/index.css` | 67 | 0 | 67 | 0 | 100.0% |
| `frontend/tailwind.config.js` | 49 | 0 | 49 | 0 | 100.0% |
| `frontend/src/utils/print.js` | 12 | 0 | 12 | 0 | 100.0% |
| `frontend/src/constants/theme.js` | 126 | 1 | 125 | 0 | 99.2% |
| `frontend/index.html` | 13 | 2 | 11 | 0 | 84.6% |
| `frontend/src/constants/eventActions.js` | 12 | 3 | 9 | 0 | 75.0% |
| `frontend/src/context/ThemeContext.jsx` | 39 | 15 | 24 | 0 | 61.5% |
| `frontend/src/App.jsx` | 80 | 37 | 43 | 0 | 53.8% |
| `frontend/vite.config.js` | 21 | 10 | 11 | 0 | 52.4% |
| `frontend/src/context/SecurityContext.jsx` | 855 | 428 | 427 | 0 | 49.9% |
| `frontend/src/components/layout/Header.jsx` | 375 | 202 | 173 | 0 | 46.1% |
| `frontend/src/components/layout/Sidebar.jsx` | 359 | 197 | 162 | 0 | 45.1% |
| `frontend/src/components/views/ReportsView.jsx` | 404 | 229 | 175 | 0 | 43.3% |
| `frontend/src/utils/polygon.js` | 108 | 63 | 45 | 0 | 41.7% |
| `frontend/src/components/views/LiveView.jsx` | 1298 | 813 | 485 | 0 | 37.4% |
| `frontend/src/components/common/ConfidenceBadge.jsx` | 32 | 21 | 11 | 0 | 34.4% |
| `frontend/src/components/views/IncidentDetailView.jsx` | 80 | 55 | 25 | 0 | 31.2% |
| `frontend/src/services/api.js` | 480 | 334 | 146 | 0 | 30.4% |
| `frontend/src/components/views/IncidentsListView.jsx` | 223 | 157 | 66 | 0 | 29.6% |
| `frontend/src/components/common/Toast.jsx` | 38 | 27 | 11 | 0 | 28.9% |
| `frontend/src/components/views/ZoneEditorView.jsx` | 341 | 267 | 74 | 0 | 21.7% |
| `frontend/src/main.jsx` | 48 | 38 | 10 | 0 | 20.8% |
| `frontend/src/components/views/SettingsView.jsx` | 320 | 254 | 66 | 0 | 20.6% |
| `frontend/src/utils/sound.js` | 46 | 41 | 5 | 0 | 10.9% |
| `frontend/src/constants/mockData.js` | 680 | 619 | 61 | 0 | 9.0% |
| `frontend/src/engine/worker.js` | 836 | 836 | 0 | 0 | 0.0% |
| `frontend/src/components/views/BenchView.jsx` | 764 | 764 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.test.mjs` | 570 | 570 | 0 | 0 | 0.0% |
| `frontend/src/components/views/LabView.jsx` | 554 | 554 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.js` | 460 | 460 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.test.mjs` | 445 | 445 | 0 | 0 | 0.0% |
| `frontend/src/engine/useEngine.js` | 405 | 405 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.js` | 383 | 383 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.js` | 380 | 380 | 0 | 0 | 0.0% |
| `frontend/src/engine/events.js` | 334 | 334 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.test.mjs` | 328 | 328 | 0 | 0 | 0.0% |
| `frontend/src/components/live/LiveEngineCard.jsx` | 308 | 308 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneCanvas.jsx` | 304 | 304 | 0 | 0 | 0.0% |
| `frontend/src/engine/tracker.js` | 296 | 296 | 0 | 0 | 0.0% |
| `scripts/provenance.py` | 267 | 267 | 0 | 0 | 0.0% |
| `scripts/prepare-demo-media.sh` | 266 | 266 | 0 | 0 | 0.0% |
| `frontend/src/engine/pipeline.js` | 265 | 265 | 0 | 0 | 0.0% |
| `frontend/src/engine/detectors.js` | 254 | 254 | 0 | 0 | 0.0% |
| `frontend/src/constants/shiftReport.js` | 246 | 246 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentDetail.test.mjs` | 243 | 243 | 0 | 0 | 0.0% |
| `frontend/src/constants/shiftReport.test.mjs` | 236 | 236 | 0 | 0 | 0.0% |
| `frontend/src/utils/systemView.test.mjs` | 227 | 227 | 0 | 0 | 0.0% |
| `frontend/src/engine/events.test.mjs` | 226 | 226 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentDetail.js` | 226 | 226 | 0 | 0 | 0.0% |
| `frontend/src/engine/tracker.test.mjs` | 220 | 220 | 0 | 0 | 0.0% |
| `frontend/src/engine/pipeline.test.mjs` | 210 | 210 | 0 | 0 | 0.0% |
| `frontend/src/utils/systemView.js` | 201 | 201 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneToolbar.jsx` | 178 | 178 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneParameters.jsx` | 177 | 177 | 0 | 0 | 0.0% |
| `frontend/src/engine/decode.js` | 163 | 163 | 0 | 0 | 0.0% |
| `frontend/src/engine/blur.test.mjs` | 161 | 161 | 0 | 0 | 0.0% |
| `frontend/scripts/prepare-models.py` | 157 | 157 | 0 | 0 | 0.0% |
| `frontend/scripts/check-base.mjs` | 146 | 146 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneReferencePanel.jsx` | 145 | 145 | 0 | 0 | 0.0% |
| `frontend/src/components/common/ErrorBoundary.jsx` | 135 | 135 | 0 | 0 | 0.0% |
| `.github/workflows/ci.yml` | 131 | 131 | 0 | 0 | 0.0% |
| `frontend/e2e/smoke.spec.js` | 130 | 130 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/ReportPanel.jsx` | 111 | 111 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentHeader.jsx` | 107 | 107 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/DecisionPanel.jsx` | 97 | 97 | 0 | 0 | 0.0% |
| `frontend/src/utils/polygon.test.mjs` | 83 | 83 | 0 | 0 | 0.0% |
| `frontend/src/utils/sound.test.mjs` | 79 | 79 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentList.js` | 77 | 77 | 0 | 0 | 0.0% |
| `frontend/public/coi-serviceworker.js` | 75 | 75 | 0 | 0 | 0.0% |
| `frontend/src/engine/blur.js` | 71 | 71 | 0 | 0 | 0.0% |
| `frontend/src/engine/report.js` | 71 | 71 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentList.test.mjs` | 70 | 70 | 0 | 0 | 0.0% |
| `.github/workflows/pages.yml` | 65 | 65 | 0 | 0 | 0.0% |
| `frontend/src/engine/report.test.mjs` | 61 | 61 | 0 | 0 | 0.0% |
| `frontend/src/utils/themePreference.test.mjs` | 59 | 59 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/EvidencePanel.jsx` | 58 | 58 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/EventTimeline.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/FalsePositiveDialog.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.js` | 54 | 54 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.test.mjs` | 46 | 46 | 0 | 0 | 0.0% |
| `frontend/src/components/common/SafeImage.jsx` | 45 | 45 | 0 | 0 | 0.0% |
| `frontend/src/utils/themePreference.js` | 43 | 43 | 0 | 0 | 0.0% |
| `frontend/playwright.config.js` | 41 | 41 | 0 | 0 | 0.0% |
| `frontend/src/constants/eventActions.test.mjs` | 38 | 38 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.default.js` | 34 | 34 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentEmptyState.jsx` | 30 | 30 | 0 | 0 | 0.0% |
| `frontend/src/engine/webgpu.js` | 29 | 29 | 0 | 0 | 0.0% |

## Candidați de rescriere

Doar cod de produs din `frontend/`: ≥60% linii de la colegi și ≥30 de linii, în
ordinea proporției. `data/` e referință și nu intră în listă; `backend/` și `ml/`
au fost șterse din acest fork. Tokenurile de design (`theme.js`, `index.css`,
`tailwind.config.js`) apar aici din cauza liniei, nu pentru că ar conține logică de rescris.

- `frontend/src/index.css` — 100.0% din 67 linii
- `frontend/tailwind.config.js` — 100.0% din 49 linii
- `frontend/src/constants/theme.js` — 99.2% din 126 linii
- `frontend/src/context/ThemeContext.jsx` — 61.5% din 39 linii

Inventarul deciziilor (ce rescriem oportunist) rămâne în `docs/rewrite-backlog.md`.
