# LocalSight — stare și handoff

**Data:** 3 noiembrie 2026. **Cod:** `main` după valul de features (vezi `git log`); build-ul
public se identifică în footer (`build <sha>`). **Teste:** 871 Node, 5 smoke, 6 Pages, 8
persistență, 1 Firefox mobil. **Licențe:** `npm run check:licenses` verde.

Documentul e scris pentru pauză: ce funcționează, ce e demo, ce e deschis și de unde se
reia. Nu înlocuiește `README.md`, `THIRD_PARTY.md` sau `docs/legal/model-provenance.md`.

## Ce funcționează

- **Motor în browser**: EfficientDet-Lite0 (implicit) / Lite2 (Setări), ONNX Runtime Web pe
  WASM 4 fire, YuNet blur, tracker, zone, PPE, incidente, snapshot-uri. Fără backend.
- **HUD pe regulă**: cutiile persoanelor sunt roșii la `CRITICAL` și ambre la `WARNING` când
  picioarele sunt în zona activă (`engine/hud.js`); snapshot-ul păstrează culoarea.
- **Coada de triaj**: `Coadă` implicită când există incidente deschise; deadline, episoade,
  hold doar pe WARNING, taste A/F/H/Enter.
- **Calibrare sol + viteză** per cameră, **acoperire cameră** din eșantioanele sesiunii.
- **Arhivă & Backup** (`/archive`): export/import JSON local al incidentelor, snapshot-urilor
  și ack-urilor; validare strictă, replace explicit, reload după import.
- **Șabloane de zone** (`/zones`): export/import JSON, template per cameră/global, confirmare
  la replace; ID-urile se re-emit dacă sunt deja folosite de altă cameră.
- **Webhook opțional** (`/settings`): Slack/Discord/Telegram/ntfy prin relay self-hosted;
  text-only, OFF implicit, retry cât timp tab-ul e deschis.
- **Cameră de rețea opțională**: RTSP → MediaMTX → WHEP, `?whep=`/localStorage; player fără
  dependențe; gateway-ul e separat, nu e în build.
- **Firefox mobil**: autoplay-ul clipului e numit în card, iar un tap pornește motorul; test
  `npm run e2e:firefox`.
- **License guard**: `npm run check:licenses` pică pe GPL/AGPL/LGPL, licențe necunoscute,
  notice-uri lipsă sau modele YOLO; rulează în CI și `verify`.

## Ce e demo / ce nu e production-grade

- Clipurile demo sunt **generate** din still-uri Unsplash/CC0; nu sunt camere reale.
- Incidentele din fixtures sunt ascunse implicit; se activează explicit din Setări.
- Acuratețea nu e validată pe apron real: benchmark-ul arată Lite0 rapid, dar CAM-01/02 nu au
  muncitori detectabili; doar CAM-03 declanșează incidentul. Fără dataset etichetat/fine-tuning.
- Nu există backend, multi-user, audit central sau alertare 24/7. Incidentele și ack-urile sunt
  în IndexedDB, per browser; arhiva JSON e backup local, nu sincronizare.
- Webhook-ul e best-effort; relay-ul e self-hosted; fără TLS/auth/rate-limit în demo.
- Gateway-ul WHEP e local, fără TLS/auth; RTSP nu merge direct în browser.
- Firefox mobil: fixul de autoplay e verificat în Firefox emulat cu politica Android; nu e un
  test pe device fizic.
- ORT WASM/Eigen/MPL2: notice-ul oficial e livrat, dar manifestul exact trebuie confirmat de
  avocat. Unsplash apron poate conține trademark de companie/aeroport.

## Legal — ce e rezolvat și ce nu

Rezolvat în arborele curent: modele Apache-2.0/CC BY 3.0, YuNet MIT, runtime notices, fără
AGPL, cod 100% al nostru (0 linii de la colegi), clipuri generate din surse permissive.

Deschis:

1. **Istoricul git public** încă are `yolo26n.onnx` (AGPL), clipurile vechi și liniile vechi.
   Un repo nou din arborele curent (sau istoric filtrat) le elimină; vechiul fork se arhivează.
2. **Docs/design** rămân creditate echipei; lipsește cesiunea/acordul scris. Template:
   `docs/legal/contributor-assignment-template.md`.
3. **ORT WASM** (Eigen/MPL2, notice Intel MKL generic) — aviz juridic.
4. **Trademark** în fotografia Unsplash de apron; de curățat/înlocuit pentru comercial.
5. **Aviz juridic** general; documentele nu sunt consultanță juridică.

## Ce urmează, în ordine

1. **Repo nou / istoric curat**: păstrează arborele curent, arhivează fork-ul, mută Pages.
2. **CLA/cesiune** de la contribuitori pentru docs/design sau rescrierea lor.
3. **Fine-tuning / dataset**: filmări reale cu drepturi, adnotări, benchmark pe apron; modelul
   actual e COCO, nu specific.
4. **Backend minimal** dacă produsul iese din demo: incidente comune, ack, audit, outbox
   pentru webhook, cont/roluri. Arhiva JSON nu ține loc de server.
5. **Gateway de producție**: TLS, auth, CORS restrâns, segmentare, STUN/TURN; H.264 baseline
   fără B-frames (gateway-ul transcodes).
6. **Relay de producție**: HTTPS, `ALLOW_ORIGIN` restrâns, token, rate limit, monitorizare.
7. **Verificare pe device real** (Firefox Android/iOS) și pe hardware-ul țintă.

## Cum se reia

```bash
cd frontend
npm ci
npm run verify -- --with-persistence   # 871 unit + build + smoke + Pages + persistence + licențe
npm run e2e:firefox                    # necesită npx playwright install firefox
npm run build                          # mock, base /
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
```

Webhook: `node scripts/webhook-relay.mjs` cu env-urile providerului; vezi
`docs/ops/webhook-relay.md`. Cameră: `gateway/README.md`. Benchmark:
`docs/qa/detector-benchmark.md`.
