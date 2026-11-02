# Release & operations audit — LocalSight static demo

**Date:** 2026-11-02 · **Branch:** `prep/release-audit` · **Audited commit:** `ad05128` (main) ·
**Live URL:** <https://andreisugu.github.io/LocalSight/> · **Repo:** `andreisugu/LocalSight` (public)
**Author:** release-audit subagent. Read-only: this file is the only change; no app, workflow or
script was modified, no dependency added.

**Method.** Read `README.md`, `RUNNING.md`, `AGENTS.md`, `CONTRIBUTING.md`, `THIRD_PARTY.md`,
both workflows, `frontend/{package.json,vite.config.js,playwright.config.js}`,
`frontend/scripts/check-base.mjs`, `frontend/src/main.jsx`, `frontend/public/coi-serviceworker.js`,
the e2e suite and `docs/media.md` / `docs/browser-engine.md` / `docs/qa/*`. Then probed production
with `curl`, the GitHub API (`gh run`, `gh api`), and the deployed Pages artifact itself.

---

## 1. Verdict

**Conditional GO for the static mock showcase.** The demo path works today: `/` boots, models are
served, `/404.html` is the app shell, deep links render, the COOP/COEP worker is published with the
right MIME type, and CI is green in ~1m45s on the audited commit.

**No-go for anything described as a production, privacy-clean or licence-clean release.** Four
things block that claim: deploys are not gated on CI, a deploy blanks the app for visitors holding a
cached shell (≤10 min), the shipped YOLO weights are AGPL with no notice file in the artifact, and
the browser engine / service worker / subpath are never executed by CI.

Top 5 risks, in order:

1. **`main` deploys even when CI is red.** `ci.yml` and `pages.yml` are independent workflows on the
   same `push: main`, there is no `needs`/`workflow_run` gate and no branch protection.
2. **Post-deploy white screen for up to 10 minutes.** `index.html` is served `cache-control:
   max-age=600`; each deploy replaces the Pages artifact and deletes the previous hashed bundles, so
   a cached shell points at files that now 404 (`text/html`), and the module never executes.
3. **No build stamp, no rollback runbook, live site can silently lag `main`.** During the audit the
   live build was two commits behind `main`; a deploy run was also observed cancelled.
4. **Licence/attribution exposure.** AGPL-3.0 YOLO weights ship to every visitor, no `NOTICE` or
   attribution page is in `dist/`, and three committed stills used by the zone editor are missing
   from `THIRD_PARTY.md`.
5. **The product's core is untested as deployed.** CI builds the mock app at base `/`, never under
   `/LocalSight/`, and never starts the engine, loads a model, or asserts
   `crossOriginIsolated === true`; Playwright runs Chromium only.

---

## 2. Findings

Severity: **Blocker** = stop the release · **High** = fix before a public demo · **Medium** = fix
before calling it a product · **Low** = hygiene · **Info** = verified good.

### 2.1 CI

| # | Sev | Finding | Evidence (command → result) | Fix |
|---|---|---|---|---|
| C1 | Blocker | Deploy is not gated on CI. Both workflows trigger on `push: main`, in parallel; `pages.yml` has no `needs`, no `workflow_run` on CI, and `main` is unprotected, so a red build publishes. | `gh api repos/andreisugu/LocalSight/branches/main/protection` → `404 Branch not protected`; `gh run list` shows `CI` and `Deploy …` created at the same second (`17:17:46Z`) for `ad05128`. | Require the four CI jobs as status checks on `main`, or switch Pages to `on: workflow_run: workflows: [CI] types: [completed]` + `if: conclusion == 'success'`. |
| C2 | High | CI never runs the product: e2e builds with `VITE_USE_MOCK` only, so base is `/`, not `/LocalSight/`; `pages-base` checks HTML strings, not behaviour. Engine, models, service worker, `crossOriginIsolated`, deep link on the 404 fallback are only exercised by hand. | `playwright.config.js:30-40` (`env: { VITE_USE_MOCK: 'true' }`, no `VITE_BASE`); `check-base.mjs` reads `dist/index.html` with regexes; `grep -c "^test(" frontend/e2e/smoke.spec.js` → `5`, none starts the engine. | Run e2e twice or once with `VITE_BASE=/LocalSight/` and a preview path prefix; add one test that starts the engine, asserts `navigator.serviceWorker` registration + `crossOriginIsolated`, and fetches both ONNX files. |
| C3 | Medium | Only Chromium is installed and tested, while the docs make Firefox behaviour (WASM-only by choice) and Safari 26+ part of the product story. | `ci.yml:91` `npx playwright install --with-deps chromium`; `playwright.config.js:24-29` single `chromium` project; `docs/ort-web-notes.md:242` admits "merge în Firefox/Safari" is unverified. | Add a `firefox` project for the smoke suite (cheap, no engine start); keep Safari as a documented manual check. |
| C4 | Medium | Node 20 is EOL. It was the only version in both workflows; `package.json` has no `engines`, no `.nvmrc`, and local dev is already on Node 26. | `gh run view 41489798999` → jobs ran with `node-version: 20`; `grep engines frontend/package.json` → none; `node --version` → `v26.7.0`. Node 20 EOL 2026-04-30. | Move workflows to Node 22 LTS or 24, add `"engines": { "node": ">=22" }` and `.nvmrc`. |
| C5 | Medium | No lint, no typecheck, no format check anywhere. There is no ESLint/Prettier/tsconfig in the tree, so style and dead-import regressions land on review only. | `ls -a frontend \| grep -iE 'eslint\|prettier\|tsconfig\|editorconfig'` → none; `package.json:7-14` has only `dev/build/preview/test:*`. | Add `eslint` (flat config, `no-unused-vars`, `react-hooks`) as a CI job; JS-only repo, so a full `tsc --checkJs` is a separate decision. |
| C6 | Medium | No `timeout-minutes` on any job or step. A hung Playwright build keeps a runner for the 360-minute default. | `grep -n timeout-minutes .github/workflows/*.yml` → no match. | `timeout-minutes: 15` per job (build/deploy 20). |
| C7 | Low | No CI `concurrency`, and four jobs each run `npm ci` with no shared artifact, so every push to `main` installs four times and builds the app three times in CI (`build`, `e2e`, `pages-base`) on top of `pages.yml`'s own build. | `ci.yml` has no `concurrency:` block; jobs are independent by design (comment in `ci.yml:3-5`). | Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`; cache `~/.cache/ms-playwright` with `actions/cache`. |
| C8 | Low | No dependency or vulnerability automation: no `dependabot.yml`, no `npm audit` in CI. | `npm audit --package-lock-only` → `2 vulnerabilities (1 moderate, 1 high)`, both `esbuild`/`vite` (dev server only, not shipped); `ls .github/dependabot.yml` → missing. | Add Dependabot for `npm` + `github-actions`; add `npm audit --omit=dev` as a non-blocking job. |
| C9 | Low | No link check and no licence check. Docs-only commits still run the full pipeline (evidence: `a887464` "docs: record the final provenance sweep" ran CI **and** a deploy). | `gh run list` for `a887464` → both workflows `success`; no `paths-ignore` in either workflow. | Add `paths-ignore: ['**/*.md', 'docs/**']` to `ci.yml`, a markdown link check job, and a licence allow-list check on the lockfile. |
| C10 | Low | Actions are pinned to moving major tags (`checkout@v4`, `setup-node@v4`, `upload-pages-artifact@v3`, `deploy-pages@v4`), not commit SHAs. | `.github/workflows/*.yml`. | Pin to SHAs (Dependabot can keep them updated). |
| C11 | Info | Triggers are sane: CI on `push: main` + every PR; Pages on `push: main` + `workflow_dispatch`; `permissions` least-privilege (`contents: read`; `pages: write` + `id-token: write` only for deploy); npm cache keyed on `frontend/package-lock.json`. CI on `ad05128` finished in 1m44s. | `gh run view 41489798999` → all four jobs success, `17:17:49Z`→`17:19:30Z`. | — |

### 2.2 Pages build, deploy and caching

| # | Sev | Finding | Evidence (command → result) | Fix |
|---|---|---|---|---|
| P1 | High | **Stale shell, deleted bundles.** `index.html` ships `cache-control: max-age=600`; a deploy replaces the artifact and removes the old `assets/index-<hash>.js`, so a browser that cached the shell for up to 10 min requests a file that no longer exists and gets `404 text/html`, which the module loader refuses. The page is blank until the cache expires or the user hard-refreshes. | `curl -sI .../` → `cache-control: max-age=600`; deployed JS hash changed `index-YTqGklB9.js` → `index-ClyDEdlU.js` after the `ad05128` deploy, and `curl -o /dev/null -w '%{http_code} %{content_type}' .../assets/index-YTqGklB9.js` → `404 text/html; charset=utf-8`. Same for the bundle from the `92c85f9` artifact (`index-CU8DByJa.js` → 404). | Shorten the HTML TTL or add a deploy marker. On Pages the cheapest mitigation: in `pages.yml`, write `dist/deploy.json` with `{ sha, builtAt }` and announce "hard refresh after a deploy" in the run sheet; the real fix is a host with `immutable` assets + `no-cache` HTML. |
| P2 | High | **Deploy lag without a build stamp.** The live build is only identifiable by hashing its bundle names; nothing in the page reports the commit. During the audit the site served `a887464` while `main` was `ad05128`, and deploys took 3m46s. One deploy run was cancelled (`41485895797`), so "workflow success on commit X" does not by itself prove X is live. | `gh api repos/.../deployments?environment=github-pages` → latest successful `a887464` at `16:59:02Z` while `git rev-parse origin/main` → `ad05128`; `gh run list` → `41485895797` `cancelled`; deploy `ad05128` created `17:17:46Z`, environment updated `17:21:32Z`. | Emit `dist/version.json` (`{commit, builtAt}`) in `pages.yml` and read it in `/settings`; checklist step "live commit == main" via `gh api .../deployments`. |
| P3 | Medium | **Deep links return HTTP 404**, not 200. The body is the correct app shell (`404.html` is byte-identical to `index.html`), so the browser demo works, but link unfurls, uptime checks and crawlers see a 404. | `curl -o /dev/null -w '%{http_code}' .../incidents` → `404 text/html`; `cmp <(curl .../404.html) <(curl .../)` → identical. | Accept and document it, or move to a host with rewrites (Cloudflare Pages/Netlify) if unfurls matter. Do **not** treat a 404 on `/incidents` as an outage in monitoring. |
| P4 | Medium | No rollback story. No release tags (only `archive/*` branches), no runbook, no previous-artifact pointer. Rollback today means revert + redeploy (~4 min) or re-running an older Pages workflow, which rebuilds that commit. | `git tag` → only `archive/auto-docs-mini-readme`, `archive/auto-zones`; `grep -rn rollback docs README.md` → nothing. | Write three lines in `RUNNING.md`: re-run the last green Pages workflow for the good SHA, or `git revert` + push; both ≈4 min. Tag demo builds. |
| P5 | Low | No `immutable` caching and no long TTL on hashed assets: every asset is `max-age=600`, so the 51 MB artifact's big files (28.7 MB ORT wasm, 10 MB models, 11 MB clips) are revalidated every 10 min in a long session. | `curl -sI .../assets/index-ClyDEdlU.js` → `cache-control: max-age=600` (no `immutable`); `du -b` of the unpacked `ad05128`/`92c85f9` artifact tar → `51,376,583` bytes. | Nothing to fix on Pages (headers are fixed); note it in the run sheet (pre-warm the engine before the demo, don't reload mid-session). |
| P6 | Low | The artifact ships documentation and a placeholder inside `dist/`: `models/README.md`, `media/.gitkeep`. Harmless, but it is product surface and an unversioned doc. | `tar -tf` of the Pages artifact → `./models/README.md`, `./media/.gitkeep`. | Move the model note into `docs/` or add a `public/models/README.md` exclusion step. |
| P7 | Info | Build/deploy chain is correct and minimal: `npm ci` → `npm run build` with `VITE_USE_MOCK=true`/`VITE_BASE=/LocalSight/` → `cp dist/index.html dist/404.html` → `configure-pages` → `upload-pages-artifact` (`frontend/dist`) → `deploy-pages`. Concurrency group `pages`, `cancel-in-progress: false`. HTTPS enforced. | `gh api repos/.../pages` → `build_type: workflow`, `https_enforced: true`; deploy job success on `ad05128`. | — |
| P8 | Info | Base path, SPA fallback and model publication are verified before upload **by CI**, not by the deploy workflow: `pages-base` builds under `/LocalSight/`, mirrors the 404 copy, and fails on any internal `src`/`href` without the prefix, on a drifting fallback, on a missing COOP/COEP worker, or on a missing model. | `frontend/scripts/check-base.mjs` steps 2–5; `CI / frontend / Pages base` success on `ad05128`. | Also run `node scripts/check-base.mjs` inside `pages.yml` before `upload-pages-artifact`. |

### 2.3 Service worker (COOP/COEP) — production behaviour

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| S1 | Info | Registration on the subpath is correct. The worker is served at `/LocalSight/coi-serviceworker.js` with `application/javascript`, and `scope: '/LocalSight/'` is inside the script's own directory, so no `Service-Worker-Allowed` header is needed. | `curl -sI .../coi-serviceworker.js` → `200 application/javascript; charset=utf-8`, 3449 B; `frontend/src/main.jsx:33`. | If the worker ever moves to `/coi-serviceworker.js` with scope `/`, add `Service-Worker-Allowed: /` — Pages cannot, so keep it under the base. |
| S2 | Info | No stale-deploy via service worker: the worker caches nothing (`caches.open`/`cache.put` absent) and every request goes to the network. Staleness comes only from the HTTP cache (P1). | `frontend/public/coi-serviceworker.js:57-75`; `grep -c "caches\."` → 0. | — |
| S3 | Info | Origin sends no COOP/COEP (expected — Pages cannot); isolation appears only after the worker controls the document, with **one** reload per tab guarded by `sessionStorage`; if storage throws, no reload and the engine silently stays single-threaded. | `curl -sI .../` → no `cross-origin-*` headers; `main.jsx:11-38`; `docs/browser-engine.md:181`. | Keep the guard; add the "one reload on first visit" line to the run sheet so it does not read as a glitch on stage. |
| S4 | Medium | The fetch handler only rewrites `navigate` and worker destinations. Isolation therefore depends on an undocumented invariant: the engine worker must stay a same-origin worker script, and no cross-origin subresource may be added (COEP `require-corp` would block it with no CORP header). Nothing in CI asserts the invariant. | `coi-serviceworker.js:57-75` (`isDocument`, `WORKER_DESTINATIONS`); no test references `crossOriginIsolated`. | Add the invariant as a comment in `main.jsx` **and** an e2e assertion (C2) so a refactor fails CI instead of silently dropping to one thread or blocking an asset. |
| S5 | Low | Cross-browser reality is unverified for the isolation path. Safari and Firefox support module workers and COOP/COEP, but this exact "rebuild the response with headers" trick is only measured in Chromium/Firefox on desktop, and no automated test covers any of it. | `playwright.config.js` chromium only; `docs/ort-web-notes.md:59-63` (Safari 26 "partial", WebGPU limited). | Demo on Chrome/Edge; label Safari/Firefox as "unconfirmed" in the talk track (the repo docs already do). |
| S6 | Low | The rebuilt responses copy the upstream headers verbatim, including any encoding-related ones, and the worker re-fetches the document on every navigation — no offline behaviour and no protection if Pages is slow. | `coi-serviceworker.js:39-45`. | Accept (no cache is a deliberate trade-off); if it ever breaks on a CDN, strip `content-encoding`/`content-length` when rebuilding. |

### 2.4 Repo hygiene, documents, licensing

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| H1 | High | `THIRD_PARTY.md` omits three committed, shipped stills used by the zone editor: `zone-stand12.jpg`, `zone-taxiway-b.jpg`, `zone-baggage-area.jpg`. They are re-encoded frames of the demo clips (1280×720, `Lavc` encoder), so they inherit the unresolved clip provenance — but the audit table lists only three other stills. | `git show --stat 74493cb` → the three `.jpg` added; `frontend/src/data/media.js:26-30`; `THIRD_PARTY.md:63-69` lists only `apron-stand`, `taxiway-heathrow`, `baggage-hall`. | Add the three files to `THIRD_PARTY.md` under the clips' open provenance item (or replace them with frames from footage you own). |
| H2 | Medium | No notice file reaches the visitor. `THIRD_PARTY.md` itself says "ship a third-party notices file with any distribution", but the artifact contains no `NOTICE`, no credits route and no AGPL source offer. YuNet is MIT ("keep the MIT notice"), YOLO is AGPL-3.0. | `tar -tf` of the Pages artifact → no `NOTICE*`; `ls NOTICE*` → none; `THIRD_PARTY.md:190-193`; `frontend/public/models/README.md:63-73`. | Add `frontend/public/NOTICE.txt` (MIT/BSD/Apache texts + YuNet MIT + AGPL-3.0 text + CC BY-SA credit) and a `/credits` link in the settings screen; it is copied into `dist/` automatically. |
| H3 | Medium | Public demo = distribution of AGPL-3.0 weights, and the repo licence is BSL-1.1. Documented, but unresolved; anyone treating the demo as a commercial showcase inherits the obligation. | `THIRD_PARTY.md:93-132`; `README.md:158-168`; weights served at `/models/yolo26n.onnx` (200, 9,930,308 B). | Decide before any commercial framing: Ultralytics Enterprise licence, or replace the detector with an Apache-2.0 family. Keep the repo public so the AGPL source offer holds for the demo. |
| H4 | Medium | The committed demo media shows **unblurred faces**. The blur runs only inside the browser pipeline; the `.mp4` cuts and the six stills are raw frames. `AGENTS.md:112-115` states the rule literally ("nicio față neblurată în niciun asset commitat"). Faces are small (workers ~60 px tall in 720p), so identification is unlikely, but the invariant as written does not hold. | Frame extracted from `frontend/public/media/stand12.mp4` (`ffmpeg -frames:v 1`) and `zone-stand12.jpg` show three workers with visible faces; `blur` is only applied in `src/engine/worker.js`. | Either blur the exports once, or narrow the rule to "no identifiable face" and record the exception in `THIRD_PARTY.md`. |
| H5 | Low | `THIRD_PARTY.md` metadata drift: header still says branch `prep/reference-removal`; it claims "README badges say React 19" although the README has no badges (the real drift is `AGENTS.md:23` and `docs/browser-engine.md:41`, both React 19 vs lockfile 18.3.1); it lists `data/videos/*.mp4` and `data/reference_frames/*.jpeg` under "what this fork ships today" although they are not in git (and the `.jpeg` files do not exist in the tree at all). | `THIRD_PARTY.md:7, 63-64, 199`; `grep -rn "React 19"` → `AGENTS.md:23`, `docs/browser-engine.md:41`; `git ls-files data/reference_frames` → only `README.md`. | One docs commit: fix the branch line, the React claim and move the non-shipped media to a "not in git" subsection. |
| H6 | Low | `docs/media.md` has two consecutive "Reguli" blocks with contradictory caps (15 MB vs 10 MB) and a stale line reference (`.gitignore (liniile 48–53)`, actually 50–55). | `docs/media.md:129, 174-184`. | Delete the duplicate block, fix the line range (or drop it). |
| H7 | Low | The QA documents are labelled **actual** but are snapshots with no "resolved" markers, and their headline findings no longer match the code. `privacy-findings.md` calls the blur guard "fail-open" (the worker now returns a `PRIVACY: modelul de blur nu este disponibil` placeholder) and says no snapshot is ever created (`useEngine.js:178` creates a `blob:` one). `ui-findings.md` still opens with F1 (double ack) and F2 (deep links die on reload) as the two *Ridicată* items, while the code now captures the acked id on `pointerDown` and builds ids from a fixed anchor (`fixtureEventId`), and F3's phone sidebar now auto-collapses via `matchMedia`. `docs/README.md` sends readers to `privacy-findings.md` before public privacy claims. | `frontend/src/engine/worker.js:311-366`; `frontend/src/engine/useEngine.js:178`; `frontend/src/components/live/IncidentFeedCard.jsx:100-101`; `frontend/src/data/eventIds.js:9-24`; `frontend/src/components/layout/Sidebar.jsx:200-220`; `docs/README.md` rows for `qa/*`. | Add a dated banner per finding ("fixed in `<sha>`" / "still open") instead of rewriting the history. |
| H8 | Low | A stale comment in the e2e suite justifies freezing the clock with a claim that is no longer true, which makes the deep-link test look weaker than it is and would mislead the next person who touches it. | `frontend/e2e/smoke.spec.js:104-110` says "Mock event ids embed the load time (mockData builds them from Date.now())"; `frontend/src/data/eventIds.js:9-24` pins them to `EVENT_ID_ANCHOR_MS`. | Update the comment (the `page.clock` freeze is still fine, just no longer required for id stability). |
| H9 | Low | README test count is off: "399 Node (`node --test`)" while the tree has 403 `test(` registrations in 36 files (0 skips). | `grep -rhoE "^[[:space:]]*test\(" frontend/src --include=*.test.mjs \| wc -l` → `403`. | Recount and update, or drop the exact number. |
| H10 | Low | `.github/CODEOWNERS` is entirely commented out with `<github-...>` placeholders, so nobody is a required reviewer; every file has the same implicit owner. | `cat .github/CODEOWNERS`. | Fill real handles or delete the file; pair with branch protection (C1). |
| H11 | Low | Clip provenance is still open: all six rows in `data/videos/README.md` read `de completat` for source, licence and camera operator, and the PPE clip promised by the READMEs does not exist. Acknowledged in `THIRD_PARTY.md` as an open item, not fixed. | `data/videos/README.md` table; `THIRD_PARTY.md:23-24`. | Fill the table before any public screening, or replace the clips. |
| H12 | Info | Hygiene checks pass: 32 markdown files, **0 broken relative links**; no secrets or tokens in tracked files; only `frontend/.env.example` is tracked (`VITE_USE_MOCK`, `VITE_API_URL`), `.env` is ignored; no ignored files linger in the worktree; `.gitignore` exceptions are correct — `git check-ignore` says the two ONNX and the three MP4s are **not** ignored while `data/videos/x.mp4` is; 17 tracked binaries, 22.9 MB working tree, repo `.git` 34 MB, largest file 9.7 MB — all far under GitHub's 100 MB/1 GB limits. | `git check-ignore -v`; a link-check script over `git ls-files "*.md"` → `broken=0 files=32`; `git grep -nIE '(ghp_\|sk-\|AKIA\|xox[baprs]-\|hooks\.slack\.com)'` → no match; `git ls-files -z \| xargs -0 du -b` → 22.9 MB. | — |
| H13 | Info | Old Python instructions are contained: `RUNNING.md`, `demo/README.md`, `demo/run_sheet.md` and `docs/plan_alert_guarantees.md` carry explicit "istoric / do not run" banners; the only stale commands left are inside those banners. All commands in `README.md`, `RUNNING.md`, `AGENTS.md`, `CONTRIBUTING.md` and `frontend/README.md` exist (`npm ci`, `npm run dev/build/preview`, `node --test`, `npm run test:e2e`, `check-base.mjs`, `prepare-models.py`, `prepare-demo-media.sh`). | Manual pass over each command; `docs/README.md` index marks every historical file. | — |
| H14 | Info | `docs/README.md` promises every file in `docs/` appears exactly once in its table. This new file (`docs/ops/release-audit.md`) does not — adding the row is the one follow-up this audit could not do under its own read-only rule. | `docs/README.md` preamble. | Add a row when merging the branch. |

---

## 3. Production probes (raw)

Commands run 2026-11-02, 17:18–17:25 UTC. Before the `ad05128` deploy finished the live build was
`a887464`; the values below are post-deploy unless noted.

| Probe | Command | Result |
|---|---|---|
| `/` | `curl -sI https://andreisugu.github.io/LocalSight/` | `200`, `text/html; charset=utf-8`, 1042 B, `cache-control: max-age=600`, `etag: "6ae8c69c-412"` |
| `/coi-serviceworker.js` | `curl -sI .../coi-serviceworker.js` | `200`, `application/javascript; charset=utf-8`, 3449 B |
| `/404.html` | `curl -sI .../404.html` | `200`, `text/html`, 1042 B; `cmp` against `/` → **identical** |
| `/models/yolo26n.onnx` | `curl -sI` | `200`, `application/octet-stream`, `9,930,308` B |
| `/models/yunet.onnx` | `curl -sI` | `200`, `application/octet-stream`, `232,598` B |
| deep link `/incidents` | `curl -o /dev/null -w '%{http_code}'` | **`404`**, `text/html`, body = app shell |
| deep link `/zones` | same | **`404`**, `text/html` |
| unknown path `/nope-does-not-exist` | same | `404`, `text/html` (app shell) |
| bundle | `curl .../assets/index-ClyDEdlU.js` | `200`, `application/javascript`, 408,559 B |
| previous deploy's bundle | `curl .../assets/index-YTqGklB9.js` | **`404`**, `text/html` |
| stills / media | `curl -sI .../media/stand12.mp4`, `.../media/stills/zone-stand12.jpg` | `200`, `video/mp4` (3,548,603 B, `accept-ranges: bytes`), `200 image/jpeg` |
| `.nojekyll` | `curl -sI .../.nojekyll` | `200`, 0 B |
| COOP/COEP at origin | headers above | **absent** (expected; the worker adds them) |
| `Service-Worker-Allowed` | headers above | absent, **not required** (`scope` is inside `/LocalSight/`) |
| models checksums | `sha256sum frontend/public/models/*.onnx` | match `frontend/public/models/README.md` (`a456b588…`, `d1cd2585…`) |
| live commit | `gh api repos/.../deployments?environment=github-pages` | `a887464` at probe start; `ad05128` after `17:21:32Z` |
| deploy latency | `gh run view 41489798942` | created `17:17:46Z`, build done `17:21:24Z`, live `17:21:32Z` (≈3m46s) |
| CI latency | `gh run view 41489798999` | four jobs, `17:17:49Z`→`17:19:30Z` (1m44s) |
| repo metadata | `gh repo view ... --json` | public; description + homepage set; 8 topics; `licenseInfo: Other` (BSL-1.1 not recognised by GitHub's licence list); 0 stars |
| Pages settings | `gh api repos/.../pages` | `build_type: workflow`, `https_enforced: true`, `cname: null` |
| artifact contents | `gh run download 41486124881` + `tar -tf` | 51,376,583 B unpacked: `index.html`, `404.html`, `coi-serviceworker.js`, `favicon.svg`, `logo.svg`, `.nojekyll`, `assets/*` (incl. 28.7 MB ORT wasm), `models/*.onnx` + `models/README.md`, `media/*.mp4` + `media/stills/*.jpg` + `media/.gitkeep` |

---

## 4. Go / no-go checklist for a public demo

**Must be true before the link is shown** (each line is checkable in <1 min):

- [ ] `gh run list --limit 2` shows **both** CI and Pages `success` for the SHA that is live.
- [ ] Live commit == `main`: `gh api repos/andreisugu/LocalSight/deployments?environment=github-pages --jq '.[0].sha[0:7]'` equals `git rev-parse --short origin/main`.
- [ ] `/`, `/coi-serviceworker.js`, `/404.html`, both `/models/*.onnx` return `200` (`curl -o /dev/null -w '%{http_code}'`).
- [ ] A deep link (e.g. `/incidents/<id>`) loads the app shell. **Expect HTTP 404 and do not read it as an outage.**
- [ ] **No deploy in the 15 minutes before the demo.** The shell is cached for 600 s and old bundles are deleted; a deploy in that window can blank a visitor's tab.
- [ ] Demo laptop opened the URL **after** the last deploy, with a hard refresh (`Ctrl/Cmd+Shift+R`) — confirms the current bundle, not a cached one.
- [ ] The engine has been started once on the demo laptop (pre-warms the 28.7 MB ORT wasm and the 10 MB models; venue Wi-Fi is the slowest part of the demo).
- [ ] `crossOriginIsolated === true` in the console after one automatic reload (otherwise the engine runs at ~1.5 fps instead of ~5–6).
- [ ] Demo browser is Chrome/Edge. Firefox is WASM-only by design; Safari is unconfirmed — say so rather than discovering it on stage.
- [ ] Talk track matches reality: static mock showcase, engine opt-in, report is a template, snapshots for engine events are local `blob:` URLs, nothing is uploaded.
- [ ] YOLO/AGPL is disclosed on the slide or in the repo description; the repo stays public (that is the demo's AGPL source offer).
- [ ] The three zone stills are attributed in `THIRD_PARTY.md` (or the finding is accepted in writing).

**Rollback, if the demo build is broken:** `gh run rerun <id>` on the last green Pages run (it rebuilds
that commit's artifact), ≈4 minutes; or `git revert <sha> && git push`, then wait ~4 minutes. Then
hard-refresh the demo laptop. There is no tag pointing at the demo build — creating one is the first
follow-up.

**Do not claim** (not true today): "CI tests the product as deployed" (C2), "deploys are gated"
(C1), "rollback is one click" (P4), "every asset is licensed and attributed" (H1/H2), "no faces in
committed media" (H4), "works in every browser" (C3/S5).

---

## 5. Follow-ups, smallest first

1. `docs/README.md`: add this file to the index (H14).
2. `THIRD_PARTY.md`: add the three zone stills, drop the "README badges" claim, fix the branch line (H1, H5).
3. `docs/media.md`: delete the duplicate "Reguli" block (H6).
4. `.github/workflows/*.yml`: `timeout-minutes`, Node 22, `paths-ignore` for docs, run `check-base.mjs` before upload (C4, C6, C9, P8).
5. `pages.yml`: emit `dist/version.json` with `{commit, builtAt}` and show it in `/settings` (P2).
6. e2e: build under `VITE_BASE=/LocalSight/`, assert `crossOriginIsolated`, fetch both models, one engine frame (C2, S4).
7. Branch protection requiring the four CI jobs; Pages gated on CI (C1).
8. `frontend/public/NOTICE.txt` + `/credits` (H2).
9. Rollback paragraph in `RUNNING.md` + a tag for demo builds (P4).
10. Dependabot, licence check, link-check job (C8, C9); blur or re-encode the committed media (H4); resolve the clip provenance table (H11).
