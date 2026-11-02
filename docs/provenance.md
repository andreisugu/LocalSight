# Proveniență — cine a scris codul rămas

Generat cu `python3 scripts/provenance.py --write` la commit `d8d4a85`.
Măsoară **ultima atingere a fiecărei linii** (`git blame -w`), nu commit-urile.
Un rând rescris de tine apare ca al tău chiar dacă ideea era a altcuiva; un rând
copiat dintr-un fișier al colegilor rămâne al lor până îl atingi. `-w` ignoră
schimbările doar de whitespace. Fișierele binare, lockfile-urile și asset-urile sunt
excluse. Codul scris de agenți în această sesiune e comis sub identitatea ta, deci
intră la „tu”.

**Total: 23093 linii** — tu 22422, colegi 671, necunoscut 0.

| Fișier | Linii | Tu | Colegi | ? | Colegi % |
|---|---:|---:|---:|---:|---:|
| `frontend/vite.config.js` | 21 | 10 | 11 | 0 | 52.4% |
| `frontend/tailwind.config.js` | 51 | 26 | 25 | 0 | 49.0% |
| `frontend/src/App.jsx` | 77 | 42 | 35 | 0 | 45.5% |
| `frontend/src/utils/polygon.js` | 108 | 63 | 45 | 0 | 41.7% |
| `frontend/index.html` | 24 | 14 | 10 | 0 | 41.7% |
| `frontend/src/context/ThemeContext.jsx` | 47 | 32 | 15 | 0 | 31.9% |
| `frontend/src/components/views/IncidentDetailView.jsx` | 80 | 55 | 25 | 0 | 31.2% |
| `frontend/src/components/views/IncidentsListView.jsx` | 223 | 157 | 66 | 0 | 29.6% |
| `frontend/src/components/common/Toast.jsx` | 38 | 27 | 11 | 0 | 28.9% |
| `frontend/src/components/common/ConfidenceBadge.jsx` | 33 | 24 | 9 | 0 | 27.3% |
| `frontend/src/components/layout/Header.jsx` | 449 | 334 | 115 | 0 | 25.6% |
| `frontend/src/index.css` | 12 | 9 | 3 | 0 | 25.0% |
| `frontend/src/main.jsx` | 48 | 38 | 10 | 0 | 20.8% |
| `frontend/src/components/views/SettingsView.jsx` | 320 | 254 | 66 | 0 | 20.6% |
| `frontend/src/components/layout/Sidebar.jsx` | 370 | 301 | 69 | 0 | 18.6% |
| `frontend/src/utils/print.js` | 23 | 19 | 4 | 0 | 17.4% |
| `frontend/src/components/views/LiveView.jsx` | 234 | 196 | 38 | 0 | 16.2% |
| `frontend/src/constants/eventActions.js` | 19 | 16 | 3 | 0 | 15.8% |
| `frontend/src/components/views/ReportsView.jsx` | 496 | 439 | 57 | 0 | 11.5% |
| `frontend/src/utils/sound.js` | 46 | 41 | 5 | 0 | 10.9% |
| `frontend/src/components/views/ZoneEditorView.jsx` | 379 | 343 | 36 | 0 | 9.5% |
| `frontend/src/context/SecurityContext.jsx` | 164 | 154 | 10 | 0 | 6.1% |
| `frontend/src/services/api.js` | 51 | 48 | 3 | 0 | 5.9% |
| `frontend/src/engine/worker.js` | 836 | 836 | 0 | 0 | 0.0% |
| `frontend/src/components/views/BenchView.jsx` | 764 | 764 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.test.mjs` | 570 | 570 | 0 | 0 | 0.0% |
| `frontend/src/components/views/LabView.jsx` | 554 | 554 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.js` | 460 | 460 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.test.mjs` | 445 | 445 | 0 | 0 | 0.0% |
| `frontend/src/engine/useEngine.js` | 405 | 405 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.js` | 383 | 383 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.js` | 380 | 380 | 0 | 0 | 0.0% |
| `frontend/src/components/live/liveMedia.js` | 341 | 341 | 0 | 0 | 0.0% |
| `frontend/src/engine/events.js` | 334 | 334 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.test.mjs` | 328 | 328 | 0 | 0 | 0.0% |
| `frontend/src/components/live/liveMedia.test.mjs` | 317 | 317 | 0 | 0 | 0.0% |
| `frontend/src/components/live/LiveEngineCard.jsx` | 308 | 308 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneCanvas.jsx` | 304 | 304 | 0 | 0 | 0.0% |
| `frontend/src/engine/tracker.js` | 296 | 296 | 0 | 0 | 0.0% |
| `frontend/src/data/incidents.js` | 271 | 271 | 0 | 0 | 0.0% |
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
| `frontend/src/components/live/useLiveMedia.js` | 207 | 207 | 0 | 0 | 0.0% |
| `frontend/src/utils/systemView.js` | 201 | 201 | 0 | 0 | 0.0% |
| `frontend/src/context/useIncidentStore.js` | 192 | 192 | 0 | 0 | 0.0% |
| `frontend/src/services/backendMappers.test.mjs` | 189 | 189 | 0 | 0 | 0.0% |
| `frontend/src/services/backendApi.js` | 186 | 186 | 0 | 0 | 0.0% |
| `frontend/src/services/backendMappers.js` | 186 | 186 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneToolbar.jsx` | 178 | 178 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneParameters.jsx` | 177 | 177 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentState.test.mjs` | 176 | 176 | 0 | 0 | 0.0% |
| `frontend/src/data/report.js` | 173 | 173 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentState.js` | 167 | 167 | 0 | 0 | 0.0% |
| `frontend/src/engine/decode.js` | 163 | 163 | 0 | 0 | 0.0% |
| `frontend/src/utils/reportExport.test.mjs` | 162 | 162 | 0 | 0 | 0.0% |
| `frontend/src/engine/blur.test.mjs` | 161 | 161 | 0 | 0 | 0.0% |
| `frontend/scripts/prepare-models.py` | 157 | 157 | 0 | 0 | 0.0% |
| `frontend/src/components/live/CameraToolbar.jsx` | 157 | 157 | 0 | 0 | 0.0% |
| `frontend/src/data/report.test.mjs` | 156 | 156 | 0 | 0 | 0.0% |
| `frontend/src/utils/reportExport.js` | 154 | 154 | 0 | 0 | 0.0% |
| `frontend/src/components/live/IncidentFeed.jsx` | 151 | 151 | 0 | 0 | 0.0% |
| `frontend/src/data/fixtures.test.mjs` | 150 | 150 | 0 | 0 | 0.0% |
| `frontend/src/services/mockApi.test.mjs` | 147 | 147 | 0 | 0 | 0.0% |
| `frontend/scripts/check-base.mjs` | 146 | 146 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneReferencePanel.jsx` | 145 | 145 | 0 | 0 | 0.0% |
| `frontend/src/components/common/ErrorBoundary.jsx` | 135 | 135 | 0 | 0 | 0.0% |
| `.github/workflows/ci.yml` | 131 | 131 | 0 | 0 | 0.0% |
| `frontend/e2e/smoke.spec.js` | 130 | 130 | 0 | 0 | 0.0% |
| `frontend/src/services/mockApi.js` | 129 | 129 | 0 | 0 | 0.0% |
| `frontend/src/components/live/MediaStage.jsx` | 127 | 127 | 0 | 0 | 0.0% |
| `frontend/src/data/cameras.js` | 120 | 120 | 0 | 0 | 0.0% |
| `frontend/src/context/useConnectionHealth.js` | 116 | 116 | 0 | 0 | 0.0% |
| `frontend/src/data/clock.js` | 114 | 114 | 0 | 0 | 0.0% |
| `frontend/src/components/live/FullscreenStage.jsx` | 113 | 113 | 0 | 0 | 0.0% |
| `frontend/src/data/zones.js` | 113 | 113 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/ReportPanel.jsx` | 111 | 111 | 0 | 0 | 0.0% |
| `frontend/src/components/live/IncidentFeedCard.jsx` | 111 | 111 | 0 | 0 | 0.0% |
| `frontend/src/context/useZoneStore.js` | 110 | 110 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentHeader.jsx` | 107 | 107 | 0 | 0 | 0.0% |
| `frontend/src/utils/engineEventFeed.test.mjs` | 104 | 104 | 0 | 0 | 0.0% |
| `frontend/src/components/live/StageOverlays.jsx` | 100 | 100 | 0 | 0 | 0.0% |
| `frontend/src/utils/operatorName.test.mjs` | 99 | 99 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/DecisionPanel.jsx` | 97 | 97 | 0 | 0 | 0.0% |
| `frontend/src/components/live/EngineOverlayBadges.jsx` | 92 | 92 | 0 | 0 | 0.0% |
| `frontend/src/services/mockEvents.test.mjs` | 90 | 90 | 0 | 0 | 0.0% |
| `frontend/src/components/live/LiveEmptyStates.jsx` | 84 | 84 | 0 | 0 | 0.0% |
| `frontend/src/data/selectors.test.mjs` | 84 | 84 | 0 | 0 | 0.0% |
| `frontend/src/theme/status.js` | 84 | 84 | 0 | 0 | 0.0% |
| `frontend/src/components/live/KpiStrip.jsx` | 83 | 83 | 0 | 0 | 0.0% |
| `frontend/src/utils/eventFeed.test.mjs` | 83 | 83 | 0 | 0 | 0.0% |
| `frontend/src/utils/polygon.test.mjs` | 83 | 83 | 0 | 0 | 0.0% |
| `frontend/src/utils/appRoute.js` | 80 | 80 | 0 | 0 | 0.0% |
| `frontend/src/data/kpis.test.mjs` | 79 | 79 | 0 | 0 | 0.0% |
| `frontend/src/utils/sound.test.mjs` | 79 | 79 | 0 | 0 | 0.0% |
| `frontend/src/context/useBackendBootstrap.js` | 77 | 77 | 0 | 0 | 0.0% |
| `frontend/src/context/useShiftReport.js` | 77 | 77 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentList.js` | 77 | 77 | 0 | 0 | 0.0% |
| `frontend/public/coi-serviceworker.js` | 75 | 75 | 0 | 0 | 0.0% |
| `frontend/src/data/clock.test.mjs` | 72 | 72 | 0 | 0 | 0.0% |
| `frontend/src/engine/blur.js` | 71 | 71 | 0 | 0 | 0.0% |
| `frontend/src/engine/report.js` | 71 | 71 | 0 | 0 | 0.0% |
| `frontend/src/services/mockEvents.js` | 71 | 71 | 0 | 0 | 0.0% |
| `frontend/src/utils/appRoute.test.mjs` | 70 | 70 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentList.test.mjs` | 70 | 70 | 0 | 0 | 0.0% |
| `frontend/src/utils/kpi.test.mjs` | 69 | 69 | 0 | 0 | 0.0% |
| `.github/workflows/pages.yml` | 65 | 65 | 0 | 0 | 0.0% |
| `frontend/src/engine/report.test.mjs` | 61 | 61 | 0 | 0 | 0.0% |
| `frontend/src/utils/operatorName.js` | 60 | 60 | 0 | 0 | 0.0% |
| `frontend/src/data/operators.js` | 59 | 59 | 0 | 0 | 0.0% |
| `frontend/src/utils/themePreference.test.mjs` | 59 | 59 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/EvidencePanel.jsx` | 58 | 58 | 0 | 0 | 0.0% |
| `frontend/src/services/http.js` | 58 | 58 | 0 | 0 | 0.0% |
| `frontend/src/context/useRouting.js` | 56 | 56 | 0 | 0 | 0.0% |
| `frontend/src/services/api.test.mjs` | 56 | 56 | 0 | 0 | 0.0% |
| `frontend/src/utils/engineEventFeed.js` | 56 | 56 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/EventTimeline.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/FalsePositiveDialog.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/context/useSimulation.js` | 54 | 54 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.js` | 54 | 54 | 0 | 0 | 0.0% |
| `frontend/src/context/useOperator.js` | 53 | 53 | 0 | 0 | 0.0% |
| `frontend/src/data/kpis.js` | 50 | 50 | 0 | 0 | 0.0% |
| `frontend/src/context/useCameraStore.js` | 47 | 47 | 0 | 0 | 0.0% |
| `frontend/src/data/selectors.js` | 47 | 47 | 0 | 0 | 0.0% |
| `frontend/src/utils/eventFeed.js` | 47 | 47 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.test.mjs` | 46 | 46 | 0 | 0 | 0.0% |
| `frontend/src/components/common/SafeImage.jsx` | 45 | 45 | 0 | 0 | 0.0% |
| `frontend/src/theme/themes.js` | 43 | 43 | 0 | 0 | 0.0% |
| `frontend/src/utils/themePreference.js` | 43 | 43 | 0 | 0 | 0.0% |
| `frontend/src/theme/palette.js` | 42 | 42 | 0 | 0 | 0.0% |
| `frontend/src/utils/kpi.js` | 42 | 42 | 0 | 0 | 0.0% |
| `frontend/playwright.config.js` | 41 | 41 | 0 | 0 | 0.0% |
| `frontend/src/data/shift.js` | 41 | 41 | 0 | 0 | 0.0% |
| `frontend/src/components/live/ZoneOutline.jsx` | 40 | 40 | 0 | 0 | 0.0% |
| `frontend/src/constants/eventActions.test.mjs` | 38 | 38 | 0 | 0 | 0.0% |
| `frontend/src/services/config.js` | 35 | 35 | 0 | 0 | 0.0% |
| `frontend/src/data/eventIds.test.mjs` | 34 | 34 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.default.js` | 34 | 34 | 0 | 0 | 0.0% |
| `frontend/src/services/shift.test.mjs` | 34 | 34 | 0 | 0 | 0.0% |
| `frontend/src/styles/print.css` | 33 | 33 | 0 | 0 | 0.0% |
| `frontend/src/context/useToast.js` | 32 | 32 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentEmptyState.jsx` | 30 | 30 | 0 | 0 | 0.0% |
| `frontend/src/engine/webgpu.js` | 29 | 29 | 0 | 0 | 0.0% |
| `frontend/src/data/media.js` | 28 | 28 | 0 | 0 | 0.0% |
| `frontend/src/services/shift.js` | 28 | 28 | 0 | 0 | 0.0% |
| `frontend/src/data/eventIds.js` | 24 | 24 | 0 | 0 | 0.0% |
| `frontend/src/context/useKpis.js` | 23 | 23 | 0 | 0 | 0.0% |
| `frontend/src/styles/effects.css` | 21 | 21 | 0 | 0 | 0.0% |
| `frontend/src/components/live/DemoDataChip.jsx` | 17 | 17 | 0 | 0 | 0.0% |
| `frontend/src/styles/scrollbar.css` | 15 | 15 | 0 | 0 | 0.0% |
| `frontend/src/constants/mockData.js` | 14 | 14 | 0 | 0 | 0.0% |
| `frontend/src/theme/signals.js` | 14 | 14 | 0 | 0 | 0.0% |
| `frontend/src/data/labels.js` | 13 | 13 | 0 | 0 | 0.0% |

## Candidați de rescriere

Doar cod de produs din `frontend/`: ≥60% linii de la colegi și ≥30 de linii, în
ordinea proporției. `data/` e referință și nu intră în listă; `backend/` și `ml/`
au fost șterse din acest fork. Tokenurile de design (`theme.js`, `index.css`,
`tailwind.config.js`) apar aici din cauza liniei, nu pentru că ar conține logică de rescris.

Niciunul peste prag.

Inventarul deciziilor (ce rescriem oportunist) rămâne în `docs/rewrite-backlog.md`.
