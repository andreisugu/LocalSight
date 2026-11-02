# Proveniență — cine a scris codul rămas

Generat cu `python3 scripts/provenance.py --write` la commit `5afbb89`.
Măsoară **ultima atingere a fiecărei linii** (`git blame -w`), nu commit-urile.
Un rând rescris de tine apare ca al tău chiar dacă ideea era a altcuiva; un rând
copiat dintr-un fișier al colegilor rămâne al lor până îl atingi. `-w` ignoră
schimbările doar de whitespace. Fișierele binare, lockfile-urile și asset-urile sunt
excluse. Codul scris de agenți în această sesiune e comis sub identitatea ta, deci
intră la „tu”.

**Total: 30788 linii** — tu 22397, colegi 8389, necunoscut 2.

| Fișier | Linii | Tu | Colegi | ? | Colegi % |
|---|---:|---:|---:|---:|---:|
| `ml/tests/test_align.py` | 160 | 0 | 160 | 0 | 100.0% |
| `backend/tests/test_actions.py` | 158 | 0 | 158 | 0 | 100.0% |
| `backend/tests/test_snapshots.py` | 157 | 0 | 157 | 0 | 100.0% |
| `ml/safesight_ml/align.py` | 125 | 0 | 125 | 0 | 100.0% |
| `backend/tests/test_escalation.py` | 120 | 0 | 120 | 0 | 100.0% |
| `ml/safesight_ml/overlay.py` | 119 | 0 | 119 | 0 | 100.0% |
| `ml/safesight_ml/calibrate.py` | 115 | 0 | 115 | 0 | 100.0% |
| `backend/app/routers/events.py` | 93 | 0 | 93 | 0 | 100.0% |
| `backend/tests/test_full_system_integration.py` | 91 | 0 | 91 | 0 | 100.0% |
| `ml/tests/test_capture.py` | 91 | 0 | 91 | 0 | 100.0% |
| `ml/safesight_ml/capture.py` | 88 | 0 | 88 | 0 | 100.0% |
| `backend/tests/conftest.py` | 86 | 0 | 86 | 0 | 100.0% |
| `ml/tests/test_ppe.py` | 84 | 0 | 84 | 0 | 100.0% |
| `backend/app/mock.py` | 76 | 0 | 76 | 0 | 100.0% |
| `frontend/src/index.css` | 67 | 0 | 67 | 0 | 100.0% |
| `backend/app/db.py` | 59 | 0 | 59 | 0 | 100.0% |
| `backend/app/geometry.py` | 58 | 0 | 58 | 0 | 100.0% |
| `frontend/tailwind.config.js` | 49 | 0 | 49 | 0 | 100.0% |
| `backend/tests/test_ws.py` | 42 | 0 | 42 | 0 | 100.0% |
| `backend/app/ws.py` | 36 | 0 | 36 | 0 | 100.0% |
| `backend/app/timeutil.py` | 31 | 0 | 31 | 0 | 100.0% |
| `backend/tests/test_geometry.py` | 26 | 0 | 26 | 0 | 100.0% |
| `backend/app/__init__.py` | 24 | 0 | 24 | 0 | 100.0% |
| `backend/tests/test_health.py` | 20 | 0 | 20 | 0 | 100.0% |
| `frontend/src/constants/theme.js` | 126 | 1 | 125 | 0 | 99.2% |
| `backend/tests/test_report.py` | 109 | 2 | 107 | 0 | 98.2% |
| `backend/app/services/report.py` | 92 | 2 | 90 | 0 | 97.8% |
| `backend/scripts/demo_event.py` | 111 | 3 | 108 | 0 | 97.3% |
| `ml/safesight_ml/ppe.py` | 135 | 4 | 131 | 0 | 97.0% |
| `docker-compose.yml` | 30 | 1 | 29 | 0 | 96.7% |
| `backend/tests/test_stream.py` | 65 | 3 | 62 | 0 | 95.4% |
| `backend/tests/test_ingest.py` | 163 | 8 | 155 | 0 | 95.1% |
| `backend/app/services/escalation.py` | 101 | 5 | 96 | 0 | 95.0% |
| `backend/app/seed.py` | 197 | 10 | 187 | 0 | 94.9% |
| `backend/app/routers/reports.py` | 35 | 2 | 33 | 0 | 94.3% |
| `backend/app/routers/stream.py` | 83 | 5 | 78 | 0 | 94.0% |
| `backend/tests/test_notify.py` | 129 | 8 | 121 | 0 | 93.8% |
| `backend/app/services/events.py` | 229 | 23 | 206 | 0 | 90.0% |
| `backend/app/main.py` | 92 | 10 | 82 | 0 | 89.1% |
| `backend/tests/test_schemas.py` | 107 | 13 | 94 | 0 | 87.9% |
| `backend/app/routers/health.py` | 70 | 9 | 61 | 0 | 87.1% |
| `backend/app/schemas.py` | 227 | 35 | 192 | 0 | 84.6% |
| `backend/app/routers/edge.py` | 139 | 23 | 116 | 0 | 83.5% |
| `ml/safesight_ml/live.py` | 255 | 49 | 206 | 0 | 80.8% |
| `backend/scripts/export_fixtures.py` | 191 | 45 | 146 | 0 | 76.4% |
| `backend/tests/test_demo_event.py` | 58 | 14 | 44 | 0 | 75.9% |
| `backend/app/services/notify.py` | 101 | 27 | 74 | 0 | 73.3% |
| `backend/app/config.py` | 37 | 13 | 24 | 0 | 64.9% |
| `ml/tests/test_live.py` | 271 | 99 | 172 | 0 | 63.5% |
| `frontend/src/context/ThemeContext.jsx` | 39 | 15 | 24 | 0 | 61.5% |
| `backend/app/models.py` | 147 | 58 | 89 | 0 | 60.5% |
| `backend/tests/test_kpi.py` | 285 | 119 | 166 | 0 | 58.2% |
| `backend/tests/test_cameras_zones.py` | 300 | 131 | 169 | 0 | 56.3% |
| `backend/app/routers/cameras.py` | 84 | 38 | 46 | 0 | 54.8% |
| `frontend/src/App.jsx` | 80 | 37 | 43 | 0 | 53.8% |
| `frontend/vite.config.js` | 21 | 10 | 11 | 0 | 52.4% |
| `frontend/src/context/SecurityContext.jsx` | 855 | 428 | 427 | 0 | 49.9% |
| `automation/smoke.py` | 49 | 25 | 24 | 0 | 49.0% |
| `frontend/src/components/layout/Header.jsx` | 375 | 202 | 173 | 0 | 46.1% |
| `backend/app/routers/zones.py` | 239 | 131 | 108 | 0 | 45.2% |
| `frontend/src/components/layout/Sidebar.jsx` | 359 | 197 | 162 | 0 | 45.1% |
| `frontend/src/components/views/ReportsView.jsx` | 404 | 229 | 175 | 0 | 43.3% |
| `ml/safesight_ml/pipeline.py` | 294 | 170 | 124 | 0 | 42.2% |
| `frontend/src/utils/polygon.js` | 108 | 63 | 45 | 0 | 41.7% |
| `backend/tests/test_seed_zone_sync.py` | 128 | 75 | 53 | 0 | 41.4% |
| `automation/report.py` | 273 | 161 | 112 | 0 | 41.0% |
| `ml/tests/test_zones.py` | 172 | 102 | 70 | 0 | 40.7% |
| `frontend/src/components/views/LiveView.jsx` | 1294 | 808 | 486 | 0 | 37.6% |
| `backend/app/services/kpi.py` | 293 | 190 | 103 | 0 | 35.2% |
| `frontend/src/components/common/ConfidenceBadge.jsx` | 32 | 21 | 11 | 0 | 34.4% |
| `ml/safesight_ml/run.py` | 535 | 358 | 177 | 0 | 33.1% |
| `frontend/src/components/views/IncidentDetailView.jsx` | 80 | 55 | 25 | 0 | 31.2% |
| `frontend/src/services/api.js` | 480 | 333 | 147 | 0 | 30.6% |
| `frontend/src/components/views/IncidentsListView.jsx` | 223 | 157 | 66 | 0 | 29.6% |
| `frontend/src/components/common/Toast.jsx` | 38 | 27 | 11 | 0 | 28.9% |
| `ml/safesight_ml/zones.py` | 224 | 165 | 59 | 0 | 26.3% |
| `ml/tests/test_http_sink.py` | 68 | 51 | 17 | 0 | 25.0% |
| `scripts/dev.py` | 805 | 607 | 198 | 0 | 24.6% |
| `frontend/src/components/views/ZoneEditorView.jsx` | 341 | 267 | 74 | 0 | 21.7% |
| `frontend/src/main.jsx` | 48 | 38 | 10 | 0 | 20.8% |
| `frontend/src/components/views/SettingsView.jsx` | 320 | 254 | 66 | 0 | 20.6% |
| `ml/safesight_ml/privacy.py` | 292 | 240 | 52 | 0 | 17.8% |
| `ml/tests/test_privacy.py` | 103 | 87 | 16 | 0 | 15.5% |
| `ml/safesight_ml/sink.py` | 102 | 88 | 14 | 0 | 13.7% |
| `frontend/src/utils/sound.js` | 46 | 41 | 5 | 0 | 10.9% |
| `backend/app/services/live_rate.py` | 65 | 59 | 6 | 0 | 9.2% |
| `frontend/src/constants/mockData.js` | 680 | 619 | 61 | 0 | 9.0% |
| `ml/safesight_ml/detector.py` | 128 | 117 | 11 | 0 | 8.6% |
| `ml/tests/test_pipeline.py` | 455 | 417 | 38 | 0 | 8.4% |
| `backend/tests/test_automation_contract.py` | 76 | 75 | 1 | 0 | 1.3% |
| `frontend/src/engine/worker.js` | 832 | 832 | 0 | 0 | 0.0% |
| `frontend/src/components/views/BenchView.jsx` | 763 | 763 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.test.mjs` | 570 | 570 | 0 | 0 | 0.0% |
| `frontend/src/components/views/LabView.jsx` | 554 | 554 | 0 | 0 | 0.0% |
| `frontend/src/utils/zoneDraft.js` | 460 | 460 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.test.mjs` | 445 | 445 | 0 | 0 | 0.0% |
| `frontend/src/engine/useEngine.js` | 405 | 405 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.js` | 383 | 383 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.js` | 380 | 380 | 0 | 0 | 0.0% |
| `frontend/src/engine/events.js` | 333 | 333 | 0 | 0 | 0.0% |
| `frontend/src/engine/vest.test.mjs` | 328 | 328 | 0 | 0 | 0.0% |
| `frontend/src/components/live/LiveEngineCard.jsx` | 308 | 308 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneCanvas.jsx` | 304 | 304 | 0 | 0 | 0.0% |
| `frontend/src/engine/tracker.js` | 296 | 296 | 0 | 0 | 0.0% |
| `backend/app/services/outbox.py` | 273 | 273 | 0 | 0 | 0.0% |
| `scripts/provenance.py` | 267 | 265 | 0 | 2 | 0.0% |
| `scripts/prepare-demo-media.sh` | 266 | 266 | 0 | 0 | 0.0% |
| `frontend/src/engine/pipeline.js` | 265 | 265 | 0 | 0 | 0.0% |
| `frontend/src/engine/detectors.js` | 254 | 254 | 0 | 0 | 0.0% |
| `frontend/src/constants/shiftReport.js` | 246 | 246 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentDetail.test.mjs` | 243 | 243 | 0 | 0 | 0.0% |
| `frontend/src/constants/shiftReport.test.mjs` | 236 | 236 | 0 | 0 | 0.0% |
| `frontend/src/utils/systemView.test.mjs` | 227 | 227 | 0 | 0 | 0.0% |
| `frontend/src/utils/incidentDetail.js` | 226 | 226 | 0 | 0 | 0.0% |
| `backend/tests/test_outbox.py` | 225 | 225 | 0 | 0 | 0.0% |
| `frontend/src/engine/events.test.mjs` | 225 | 225 | 0 | 0 | 0.0% |
| `frontend/src/engine/tracker.test.mjs` | 220 | 220 | 0 | 0 | 0.0% |
| `frontend/src/engine/pipeline.test.mjs` | 210 | 210 | 0 | 0 | 0.0% |
| `ml/safesight_ml/ncnn_detector.py` | 206 | 206 | 0 | 0 | 0.0% |
| `backend/app/services/watchdog.py` | 204 | 204 | 0 | 0 | 0.0% |
| `frontend/src/utils/systemView.js` | 201 | 201 | 0 | 0 | 0.0% |
| `.github/workflows/ci.yml` | 181 | 181 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneToolbar.jsx` | 178 | 178 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneParameters.jsx` | 177 | 177 | 0 | 0 | 0.0% |
| `frontend/src/engine/decode.js` | 163 | 163 | 0 | 0 | 0.0% |
| `frontend/src/engine/blur.test.mjs` | 161 | 161 | 0 | 0 | 0.0% |
| `frontend/scripts/prepare-models.py` | 157 | 157 | 0 | 0 | 0.0% |
| `backend/tests/test_watchdog.py` | 153 | 153 | 0 | 0 | 0.0% |
| `frontend/scripts/check-base.mjs` | 146 | 146 | 0 | 0 | 0.0% |
| `ml/experiments/face_roi.py` | 146 | 146 | 0 | 0 | 0.0% |
| `frontend/src/components/zones/ZoneReferencePanel.jsx` | 145 | 145 | 0 | 0 | 0.0% |
| `scripts/bench.sh` | 140 | 140 | 0 | 0 | 0.0% |
| `frontend/src/components/common/ErrorBoundary.jsx` | 135 | 135 | 0 | 0 | 0.0% |
| `frontend/e2e/smoke.spec.js` | 130 | 130 | 0 | 0 | 0.0% |
| `ml/safesight_ml/privacy_audit.py` | 117 | 117 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/ReportPanel.jsx` | 111 | 111 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentHeader.jsx` | 107 | 107 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/DecisionPanel.jsx` | 97 | 97 | 0 | 0 | 0.0% |
| `ml/safesight_ml/events.py` | 95 | 95 | 0 | 0 | 0.0% |
| `ml/tests/test_ncnn_detector.py` | 92 | 92 | 0 | 0 | 0.0% |
| `ml/tests/test_events.py` | 84 | 84 | 0 | 0 | 0.0% |
| `frontend/src/utils/polygon.test.mjs` | 83 | 83 | 0 | 0 | 0.0% |
| `ml/tests/test_privacy_audit.py` | 82 | 82 | 0 | 0 | 0.0% |
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
| `ml/safesight_ml/threads.py` | 57 | 57 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/EventTimeline.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/FalsePositiveDialog.jsx` | 55 | 55 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.js` | 54 | 54 | 0 | 0 | 0.0% |
| `backend/tests/test_live_rate.py` | 53 | 53 | 0 | 0 | 0.0% |
| `scripts/agent-preflight.sh` | 47 | 47 | 0 | 0 | 0.0% |
| `frontend/src/utils/confidence.test.mjs` | 46 | 46 | 0 | 0 | 0.0% |
| `ml/tests/test_threads.py` | 46 | 46 | 0 | 0 | 0.0% |
| `frontend/src/components/common/SafeImage.jsx` | 45 | 45 | 0 | 0 | 0.0% |
| `frontend/src/utils/themePreference.js` | 43 | 43 | 0 | 0 | 0.0% |
| `ml/tests/test_remote.py` | 43 | 43 | 0 | 0 | 0.0% |
| `frontend/playwright.config.js` | 41 | 41 | 0 | 0 | 0.0% |
| `frontend/src/constants/eventActions.test.mjs` | 37 | 37 | 0 | 0 | 0.0% |
| `frontend/src/engine/zones.default.js` | 34 | 34 | 0 | 0 | 0.0% |
| `ml/scripts/rtsp-loop.sh` | 33 | 33 | 0 | 0 | 0.0% |
| `frontend/src/components/incidents/IncidentEmptyState.jsx` | 30 | 30 | 0 | 0 | 0.0% |
| `ml/safesight_ml/remote.py` | 30 | 30 | 0 | 0 | 0.0% |
| `frontend/src/engine/webgpu.js` | 29 | 29 | 0 | 0 | 0.0% |
| `ml/tests/test_pacing.py` | 21 | 21 | 0 | 0 | 0.0% |

## Candidați de rescriere

Doar cod de produs din `frontend/`: ≥60% linii de la colegi și ≥30 de linii, în
ordinea proporției. `backend/`, `ml/` și `data/` sunt referință intenționată și nu
intră în listă. Tokenurile de design (`theme.js`, `index.css`, `tailwind.config.js`)
apar aici din cauza liniei, nu pentru că ar conține logică de rescris.

- `frontend/src/index.css` — 100.0% din 67 linii
- `frontend/tailwind.config.js` — 100.0% din 49 linii
- `frontend/src/constants/theme.js` — 99.2% din 126 linii
- `frontend/src/context/ThemeContext.jsx` — 61.5% din 39 linii

Inventarul deciziilor (ce rescriem oportunist) rămâne în `docs/rewrite-backlog.md`.
