# CI speed — what runs, what it costs, what changed

**Date:** 2026-11-02 · **Branch:** `prep/ci-speed` · **Owner:** ci-speed subagent ·
**Scope:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, this file.
No app code, test, Playwright config, dependency or `RUNNING.md` change.

---

## 1. How this was measured

`act` is not installed on this machine and was not installed, so nothing here comes from a local
workflow execution. The "before" numbers are the real GitHub-hosted runs of `ci.yml` on `main`:

```bash
gh run list --workflow=CI --limit 20 --json databaseId
gh run view <id> --json jobs        # startedAt / completedAt per job and per step
```

Twenty consecutive successful runs on 2026-11-02 (18:02–18:21Z) were reduced to per-job and
per-step medians. "Wall clock" is `updatedAt - createdAt` of the whole run; "job time" is the
sum of the five job durations, which is what the free-tier minutes are billed on.

## 2. Before

| Job | Median job time | Dominated by (step medians) |
|---|---|---|
| `frontend / Pages e2e` | **54 s** | Playwright install **19 s**, Pages suite 12 s, Node setup 6 s, `npm ci` 3 s |
| `frontend / e2e smoke` | **44 s** | Playwright install **18 s**, smoke suite 10 s, Node setup 5 s, `npm ci` 2 s |
| `frontend / Pages base` | **24 s** | Node setup 4 s, `npm ci` 3 s, deploy-base build 4 s, `check-base.mjs` <1 s |
| `frontend / build` | **24 s** | Node setup 5 s, `npm ci` 3 s, `vite build` 4 s |
| `frontend / unit` | **20 s** | Node setup 5 s, `npm ci` 3 s, `node --test` 2 s |
| **Whole run** | **67.5 s** (min 50 s, max 574 s) | five jobs in parallel; Pages e2e is the critical path |
| **Sum of job time** | **≈166 s ≈ 2.8 min** | per push to `main`, and per PR update |

Two things dominated and both were pure setup cost:

1. **`npx playwright install --with-deps chromium` on every run, twice** (18–19 s median, 36 s
   worst case) — about 40 s of the 166 s, re-downloading the same Chromium on every push.
2. **Five independent `npm ci` + Node set-ups** — 5 × (5 s + 3 s + checkout/setup) even though all
   five jobs read the same lockfile and only two of them execute anything in a browser.

And the runs themselves were often avoidable: **15 of the last 60 commits on `main` touch only
`docs/**`, `demo/**` or a root Markdown file**, i.e. ~25 % of pushes paid for a full five-job run
that could not possibly change `dist/`.

## 3. What changed

### 3.1 Playwright browser cache (`e2e`, `pages-e2e`)

`actions/cache@v4` stores `~/.cache/ms-playwright` under
`playwright-${runner.os}-chromium-${<resolved @playwright/test version>}`. The version comes from
`node -p "require('@playwright/test/package.json').version"` after `npm ci`, so a dependency bump
that ships a different Chromium revision misses the cache instead of launching a browser the lock
did not ask for. No `restore-keys`: restoring a different version's directory is the one way a
browser cache can mislead.

On a **miss** the step is unchanged: `npx playwright install --with-deps chromium` (browser plus
the apt libraries the runner image may not ship). On a **hit** the browser is already on disk, so a
launch probe — `node -e "chromium.launch().then(b => b.close())"` — decides whether the OS side
still works. If Chromium does not start, the step falls back to the full `install --with-deps`.
This is the cheap version of "keep OS deps working": we do not pay for `apt` on every run, and a
runner-image change can never turn into a mystery red suite — it just re-installs.

Both browser jobs use the same key, so one cache entry serves both. When a run with a cold cache
starts both jobs in parallel, both may try to save the same key; `actions/cache` keeps the first
and logs a warning for the second. That warning is expected and is not a failure.

### 3.2 npm cache and install flags

`actions/setup-node`'s `cache: npm` was already there and stays. Every install is now
`npm ci --prefer-offline --no-audit --no-fund`: the lockfile is still validated and installed
exactly, but `npm` answers from the restored cache and drops the audit/funding round-trips this
repo never reads. No dependency, lockfile or `package.json` change.

### 3.3 `unit` + `build` merged into one job

Job `frontend / unit + build` installs once and runs both steps. The step **names** are unchanged
(`Unit tests`, `Build`) and `Build` carries `if: ${{ !cancelled() }}`, so a failing unit test still
lets the build run and report on its own line — one red job, two visible results, no hidden
failure. This removes a whole checkout + Node setup + `npm ci` from every push.

### 3.4 `e2e` and `pages-e2e` stay separate

They share the install path through the browser cache but not a job. Merging them would serialise
the two browser suites on the critical path (smoke ≈14 s of build+test, then the Pages suite
≈16 s) and would leave one job name covering two very different failures. Keeping them parallel
costs one extra `npm ci` (≈3 s + 5 s Node setup) and keeps the wall clock at a single pass.

`pages-base` also stays its own job: it is the only check that builds under `/LocalSight/` and
inspects the deploy artifact, and it is the cheapest way to keep that signal independent of
anything that needs a browser.

### 3.5 `paths-ignore`: docs-only pushes do not run CI

`docs/**`, `demo/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `RUNNING.md`,
`THIRD_PARTY.md`, `LICENSE`, `.gitignore` — on both `push` and `pull_request`.

`paths-ignore` only skips when **every** changed path matches, so a mixed push still runs the full
matrix. Patterns are matched against the path from the repository root and `*` does not cross `/`,
so this list ignores the root documents only: `frontend/README.md` or any other per-module
Markdown still triggers CI. `frontend/public/**` is not ignored, because it is bundled into
`dist/`.

The filter is on `pull_request` too, which is safe here: this repository has **no branch
protection and no ruleset** (`gh api repos/andreisugu/LocalSight/branches/main/protection` → 404,
`/rulesets` → `[]`), so a docs-only PR is not left waiting for a required check that will never
start. If required checks are ever added, drop the `pull_request` filter (or add an always-on
no-op job) in the same change that adds the protection.

### 3.6 Concurrency and the Pages deploy

`ci.yml` now has:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

A push to the same ref cancels the run it supersedes — on the demo branch as much as on `main`,
which is where most of the wasted runs came from (the run list above shows many 50–60 s runs for
commits that were superseded within a minute).

Interaction with Pages, which is the part worth being careful about:

- `pages.yml` is triggered by **`workflow_run: [completed]`** and its build job requires
  `workflow_run.event == 'push'`, `head_branch == 'main'` and `conclusion == 'success'`.
- A cancelled CI run reports `cancelled`, never `success`, so a superseded commit can never
  publish. Only the run that actually finished green deploys, and after a burst of pushes that is
  the tip.
- A docs-only push produces **no** CI run at all, so there is no deploy either. That is
  deliberate: the app bundle is unchanged, the previous deployment stays live, and there is no
  "stale deploy requirement" to satisfy.
- Every cancelled CI run still produces a `pages.yml` entry in the Actions list, and it shows as
  **skipped**, not failed — the conclusion filter cannot be expressed in the `on:` block, only in
  the job `if:`. Skipped entries are noise, not a gate.
- `pages.yml` keeps `concurrency: { group: pages, cancel-in-progress: false }`, so a deploy that
  has started is never interrupted; a queued deploy waits for it. Deploy order follows CI
  completion order, and with `cancel-in-progress` on the CI side there is normally only one
  surviving run per burst, so the last deploy is the tip. The residual case — an older run that
  happens to finish *after* a newer one, both green, both deploying — would leave the older commit
  live; re-run `pages.yml` manually (`workflow_dispatch`) if that ever shows up. No code was added
  for it, because a tip check would also have to tolerate docs-only commits and that is more
  moving parts than the race is worth.

## 4. After (expected)

Estimated from the measured step medians; the "after" column is what the same `gh run view` should
report once this lands. Re-measure after ~10 runs and correct this table rather than trusting it.

| Job | Before | After (expected) | Why |
|---|---|---|---|
| `frontend / unit + build` | 20 s + 24 s (two jobs, 44 s) | **≈ 20 s** | one checkout/Node/`npm ci` instead of two |
| `frontend / e2e smoke` | 44 s | **≈ 31 s** | Playwright 18 s → ~5 s (cache restore + launch probe) |
| `frontend / Pages e2e` | 54 s | **≈ 41 s** | same, on the critical path |
| `frontend / Pages base` | 24 s | **≈ 23 s** | `--prefer-offline --no-audit --no-fund` only |
| Whole run, code push | 67.5 s | **≈ 50 s** | critical path = Pages e2e |
| Sum of job time, code push | ≈166 s | **≈115 s** (–30 %) | caching + one fewer install |
| Docs-only push | 166 s, 5 jobs | **0 s, 0 runs** | `paths-ignore` |
| Superseded push | full run to completion | **cancelled in seconds** | `concurrency` |

Combined effect, using the 15/60 docs-only share of recent commits: roughly **a quarter of all
runs disappear entirely** and the remaining ones bill about **30 % fewer job-minutes**, with a
**~15–20 s** shorter wall clock. The gates are unchanged: the same four jobs must all pass before
Pages may deploy, `check-base.mjs` still runs on every app change, and no suite was removed,
relaxed or given retries.

## 5. What was verified, and what could not be

Verified offline (GitHub Actions cannot run here, `act` is absent and was not added):

- Both workflows parse as YAML, with a loader that keeps the bare key `on` a string.
- The job graph is three original gates plus the merged one; `pages.yml` still requires
  `conclusion == 'success'` for a `push` to `main`, so every CI job above still gates the deploy.
- Action references are pinned tags, no `uses:` was bumped, no `secrets.*` is referenced, and the
  permission blocks are byte-for-byte the previous ones (`contents: read` in CI; `contents: read`,
  `pages: write`, `id-token: write` in the deploy workflow).
- The `paths-ignore` patterns were simulated against representative paths: `docs/ops/ci-speed.md`,
  `docs/README.md`, `demo/run_sheet.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
  `RUNNING.md`, `THIRD_PARTY.md`, `LICENSE`, `.gitignore` → CI skipped; `frontend/src/App.jsx`,
  `frontend/public/coi-serviceworker.js`, `frontend/package-lock.json`, `scripts/*.sh`,
  `frontend/README.md` and any mixed docs+code change → CI runs.
- Every `${{ }}` expression is balanced; `if: ${{ !cancelled() }}` is a string under YAML, so it is
  not read as a YAML tag.

Not verified, because it needs a real runner: the cache actually hits, the launch probe returns 0
on a warm hit, and the measured "after" numbers. Watch the first runs of this branch on `main` and
check the `Post Restore the Playwright browser cache` step output (`Cache restored from key: …`).

## 6. Rollback

Everything is in two files, so rollback is a revert:

```bash
git revert <this commit>   # restores the previous ci.yml and pages.yml
```

- Reverting `ci.yml` also removes the `paths-ignore` filter, the merged job, the browser cache and
  the concurrency block together — there is no separate state to clean up.
- Caches are harmless if they outlive the revert: they expire after 7 days without a hit, and a
  stale or truncated entry can only cost a re-install, never a wrong browser — a missed probe
  falls back to `install --with-deps`, and a hit always launches the exact revision the lockfile
  pins. To drop them immediately:
  `gh api -X DELETE "repos/andreisugu/LocalSight/actions/caches?key=playwright-Linux-chromium-<version>"`.
- If only the browser cache misbehaves, the surgical fix is to bump the key
  (`playwright-…-chromium-<version>-2`); deleting the job is not necessary.
- `pages.yml` changed only in comments, so reverting it is behaviour-neutral.

## 7. Index

This document is linked from the change report, not from `docs/README.md`: that index is owned by
the docs tidy-up pass, and a file added to it here would collide with that work. Whoever owns the
index should add the row:

`| [ops/ci-speed.md](ops/ci-speed.md) | actual | Timpi CI măsurați, cache Playwright, paths-ignore, concurrency și rollback | Îl citești înainte să atingi workflow-urile |`
