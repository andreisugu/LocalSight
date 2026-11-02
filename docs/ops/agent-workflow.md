# Agent workflow — one worktree, one base, one fast loop

**Date:** 2026-11-02 · **Branch:** `prep/agent-workflow` · **Base:** `origin/main@df8bd6c`
**Scope:** how parallel agents start, verify, hand off and clean up in this repository.
Tooling: `scripts/agent-preflight.sh`, `agent-worktree.sh`, `agent-status.sh`,
`agent-cleanup.sh`. Reusable task prompt: [`../agents/prompt-template.md`](../agents/prompt-template.md).
Run/test commands stay canonical in [`../../RUNNING.md`](../../RUNNING.md); this document does
not replace them.

---

## 1. What was measured, and how

Everything below came from read-only commands on the machine that hosts the worktrees, on
2026-11-02, with `origin/main` at `df8bd6c`. Counts of "dirty" and "active" worktrees are
transient by nature; re-run the audit commands instead of trusting the snapshot.

```bash
git worktree list                                  # 76 entries = main + 75 prep worktrees
git branch -r | grep -c 'origin/prep/'             # 104 remote prep branches
du -sh . && du -sch */frontend/node_modules        # 19 GB total, 14 GB node_modules
for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do ...; done
ss -H -ltn                                          # preview ports
time (cd frontend && npm ci --prefer-offline --no-audit --no-fund)
time (cd frontend && npm run verify:fast)
time (cd frontend && npm run verify)
bash scripts/agent-cleanup.sh                       # dry-run over the same state
```

| Measurement | Value |
|---|---|
| Worktrees | **76** (1 main + 75 `prep/*`), **19 GB** on disk |
| `frontend/node_modules` copies | **53 real directories** × 258–264 MB = **~14 GB**; 10 symlinks; 12 missing |
| Prep branches | 75 local, **104 remote**; **75/75 merged** into `origin/main` |
| Unmerged prep branches | **0**; all 75 are strict ancestors of `main` (0 commits ahead) |
| Branch drift | **75/75 behind** `origin/main`: median **90** commits, max **224**, mean 115 |
| Dirty worktrees | **2** (`metrics-ui` 9 paths, `triage-ui` 8 paths) at audit time |
| Active preview servers | **7** listeners on 4173/43xx: 4340, 4343, 4348, 4350, 4365, 4366, 4399 (4 worktrees held a live server) |
| Merge conflicts vs `origin/main` | **0** — the cost is re-validation of stale bases, not repeated conflict resolution |
| `npm ci` (warm cache) | **2.6 s**, 258 MB per worktree |
| Symlinked `node_modules` | **~0.03 s**, 0 bytes |
| `npm run verify:fast` | **12.4 s** (cold Vite transform; build 8.2 s) |
| `npm run verify` (warm) | **21.0 s**: unit 1.4 s, build `/` 3.6 s, smoke 3.4 s, build `/LocalSight/` 4.5 s, Pages 8.1 s |
| Cleanup dry-run over 76 worktrees | **4.8 s**; **68 removable**, **17.1 GB** reclaimable, 8 kept (main, current, 2 dirty, 4 active) |
| CI baseline | 67.5 s wall / ≈166 s job-time per push; ~25 % of recent pushes are docs-only (see [`ci-speed.md`](ci-speed.md)) |

### Top five time sinks

1. **Worktree sprawl and duplicated installs.** 76 worktrees, 53 real `node_modules`
   (14 GB), 19 GB total. Every fetch/status/cleanup walks the whole set, and 68 of the 75
   prep worktrees contain no unmerged work at all. `agent-worktree.sh` + `agent-cleanup.sh`
   turn this into a symlink and a 17.1 GB reclamation.
2. **A rebuild per suite (and per iteration).** Each Playwright config runs
   `npm run build` inside its `webServer` when `PW_BASE_URL` is unset. A 2-second spec edit
   therefore pays a 4–8 s build plus a server start; `npm run verify` pays two builds by
   design (base `/` and `/LocalSight/`, because `VITE_BASE` is compiled in). `e2e:serve` +
   `PW_BASE_URL` removes the rebuild from every rerun.
3. **Port collisions.** Seven listeners already occupy 43xx. The defaults are 4173
   (smoke), 4317 (Pages), 4352 (persistence); `strictPort` means a second agent fails
   instead of stealing the port, and a reused stale server can pass a test against a `dist/`
   that no longer exists. Unique `PW_PORT`/`PW_PAGES_PORT` in `.agent/env` or a printed
   `PW_BASE_URL` makes the collision impossible.
4. **Rebasing late.** All 75 branches are behind `main` (median 90 commits, max 224), and
   none had unmerged work. A branch that starts from a 90-commit-old base has to be
   re-verified against today's UI, engine and tests even when the diff is small; the
   conflict count is 0 today, which is luck plus non-overlapping work, not a property to
   rely on. Start from a fresh `origin/main`, and rebase before the final verify.
5. **Unobservable state / merge queue.** 104 remote prep branches against 75 local, 76
   worktree entries, 2 dirty trees and 4 live servers were only discoverable by scripting
   `git worktree` by hand. Without a status table the orchestrator cannot order merges, and
   a cleanup run can destroy work or a running demo. `agent-status.sh` (read-only) and the
   dry-run cleanup make the state explicit; copy-coupled tests are already gone —
   Playwright locates by role/`data-testid`, so test edits are not forced by DOM text
   changes.

**Expected savings.** Bootstrap: 2.6 s and 258 MB per agent → ~0.03 s and 0 bytes
(symlink). Cleanup: 68 worktrees / 17.1 GB, and a smaller set to scan on every fetch and
status (dry-run 4.8 s → under a second after pruning). Iteration: 4–8 s per e2e rerun when
the server is reused; `verify` stays 21 s because it is the deliberate two-build gate.
CI: docs-only pushes already cost 0 runs and code pushes ~30 % fewer job-minutes
(`ci-speed.md`).

---

## 2. The workflow

### 2.1 One worktree per agent, from fresh `origin/main`

Never work in the main checkout and never share a worktree between agents.

```bash
cd /home/restlessstone/Coding/LocalSight            # any checkout of this repo
bash scripts/agent-worktree.sh my-change            # fetch + create ../LocalSight-prep/my-change
cd ../LocalSight-prep/my-change
source .agent/env                                   # PW_PORT, PW_PAGES_PORT, PW_BASE_URL=
bash scripts/agent-preflight.sh
```

`agent-worktree.sh` fetches first, creates the branch `prep/my-change` from
`origin/main`, refuses to reuse an existing branch or directory, links
`frontend/node_modules` through `frontend/scripts/link-node-modules.sh`, and writes
`.agent/env` (ignored via `.git/info/exclude`). It does not commit, push or install.

Rules:

- The base is always the **fetched** `origin/main`, not a local `main` that may be stale.
- Before starting, and again immediately before the final verify, rebase:
  `git fetch origin && git rebase origin/main`. Resolve on your branch; never rewrite
  `main`.
- If the tree is dirty, commit or stash before rebasing. Preflight warns; it never pulls.
- Do not create work in the main checkout. Do not leave a detached HEAD.
- If a task spans more than ~150 lines of replacement or two unrelated concerns, split it
  into two worktrees/branches rather than one mixed diff.

### 2.2 Ownership and frozen interfaces

Each task prompt names the files the agent owns. Outside that list:

- **Frozen:** `docs/contract.md` (event/zone envelope), the public routes and the
  component contracts they expose, `frontend/package.json`/`package-lock.json`,
  `.github/workflows/**`, the Playwright configs' semantics, and other agents' worktrees.
- **No new dependency**, no test hook, no build-time flag, no change to the mock/live
  boundary without explicit approval in the task.
- Shared files (`RUNNING.md`, `AGENTS.md`, `README.md`) are edited only in the section the
  task names, and only when the change is durable documentation of that change.
- If a needed edit falls outside ownership, stop and report it; do not "just fix" another
  agent's file.

### 2.3 Ports and servers

- `.agent/env` gives every worktree a unique `PW_PORT` and `PW_PAGES_PORT`.
  `agent-preflight.sh` shows what is already listening on 4173/43xx.
- `PW_BASE_URL` is the fast path: when set, the Playwright configs start **nothing** (no
  build, no server). The caller owns the build and the port.
- Never reuse a port you did not start. A leftover server serves an old `dist/`; the suite
  can pass against code that no longer exists.
- `npm run e2e:serve` prints a free-port URL; `npm run serve:test` does the same at base
  `/`. Both support `--coi` for UI-only runs.
- One server can serve many runs: build once, start once, rerun the suite with
  `PW_BASE_URL` as often as needed.

### 2.4 Test matrix by change type

| Change type | Minimum gate | Fast loop | Notes |
|---|---|---|---|
| Docs only (`docs/**`, root `.md`) | `git diff --check`; links resolve; no code command | — | CI skips via `paths-ignore`; do not claim a build you did not run |
| UI (`frontend/src/components`, `styles`, `pages`) | `npm run verify` (both bases) | `verify:fast`, then `e2e:serve` + `PW_BASE_URL` | Add a `data-testid` only if a new stable hook is genuinely needed; locate by role first |
| Engine (`frontend/src/engine`, workers, models) | `npm run verify`; `/bench` for fps claims | unit tests + Pages suite against one server | Engine test needs models and the service-worker/COI path; do not weaken timeouts |
| Data/context (`src/data`, `src/context`, fixtures) | `verify:fast` + smoke; `verify -- --with-persistence` if storage changed | unit + smoke | Demo fixtures stay hidden behind `showDemoData`; no parallel list |
| CI / scripts / config | affected command + `bash -n` / YAML parse; simulate path filters | targeted runs | No app code change; state what could not run here |
| Mixed | `npm run verify` | as above | A mixed push always runs full CI |

`npm run verify` is the definition of "done" for anything that can change `dist/`. For
docs-only or script-only changes, run what the change actually affects and say so.

### 2.5 The fast loop

```bash
cd frontend
npm run verify:fast                    # unit + build, ~12 s
                                        # edit / iterate
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
cp dist/index.html dist/404.html
npm run e2e:serve                      # prints http://127.0.0.1:<free>/LocalSight/
PW_BASE_URL=http://127.0.0.1:<free>/LocalSight/ npm run e2e:pages
PW_BASE_URL=http://127.0.0.1:<free>/ npm run e2e:smoke      # server at base /
npm run verify                         # final gate, ~21 s, 2 builds
npm run verify -- --with-persistence   # when IndexedDB/reload behaviour changed (minutes)
```

Do not run `npm ci` in a linked worktree: it writes through the symlink into the main
checkout. If the lockfile differs, `link-node-modules.sh` refuses; install locally once and
say why.

### 2.6 Commit, push, do not merge

- One subject per commit; English commit message; small diff.
- Commit on `prep/<slug>` and `git push -u origin prep/<slug>` when the human asked for a
  push. Pushing the branch is delivery; merging is not.
- **Do not merge your own branch** and do not force-push, `reset --hard`, or rewrite shared
  history. The orchestrator merges.
- Leave the worktree clean: no `.env`, models, videos, local DBs, `dist/`, `test-results/`
  or `node_modules` in git. `.agent/` is ignored.

### 2.7 Report format

Every agent ends with the same block, so the orchestrator can merge without re-reading the
diff:

```text
Branch:      prep/<slug>
Commit:      <sha> (<subject>)
Changed:     <files/areas, one line each>
Verification: <command> -> <pass/fail, key numbers>
Numbers:     <before -> after, only measured ones>
Not done:    <what was skipped and why, risks, follow-ups>
Worktree:    <path> (clean | dirty: why)
```

Include the exact commands. If a gate could not run, name it and the reason; do not
substitute a weaker command silently.

### 2.8 Merge order (orchestrator)

Use `bash scripts/agent-status.sh`; it is read-only.

1. **Merged + clean** first, oldest last-commit first. These are bookkeeping merges; still
   run `verify:fast` after each batch.
2. **Unmerged + clean** next, ordered by dependency (infrastructure before UI that consumes
   it), then by last commit. Rebase the branch on the current `origin/main` immediately
   before merging; rerun `npm run verify` after the rebase, not before.
3. **Dirty or active** last, after the agent reports and the tree is clean/idle. Never merge
   a dirty tree, a detached HEAD, or a branch whose worktree is serving a demo.
4. After each merge: `npm run verify:fast` on `main`; after a batch touching UI/engine,
   `npm run verify` once. A docs-only merge needs no build.
5. Remove the merged worktree only after the merge is on `origin/main`
   (`agent-cleanup.sh --apply`); keep the branch until the merge is confirmed.

### 2.9 Cleanup

```bash
bash scripts/agent-cleanup.sh              # dry-run: print what would go and why
bash scripts/agent-cleanup.sh --json       # machine-readable, same decision
bash scripts/agent-cleanup.sh --apply      # remove only merged + clean + idle
```

A worktree is removable only when it is not the main checkout, not the current worktree,
has a named branch, has an empty `git status --porcelain`, its tip is an ancestor of
`origin/main`, and no live process has its cwd inside it. Everything else is skipped with
the reason (dirty, unmerged, detached, active pid). `--apply` uses `git worktree remove`
without `--force`, then deletes the now-unused merged local branch and runs
`git worktree prune`. It never fetches: run preflight first, otherwise a branch merged on
the remote but not in your refs counts as unmerged and stays (safe direction).

Remote `prep/*` branches (104 at audit time) are not deleted by the script. Delete them
deliberately after merge, e.g. `git push origin --delete prep/<slug>`; batch them only when
the merge queue is empty.

---

## 3. Measuring a change (do not guess)

1. Record the commit (`git rev-parse --short HEAD`), date, and the before state.
2. Prefer the tool's own numbers: `npm run verify` prints a per-step timing table; use it
   instead of stopwatch arithmetic.
3. Disk: `du -sh <path>` and `du -sch */frontend/node_modules`; count worktrees with
   `git worktree list`.
4. Engine/UI performance: `/bench` in the app or the relevant `docs/qa/perf-*` method; state
   the provider (WebGPU/WASM), input size and hardware.
5. CI: `gh run view <id> --json jobs` and medians over ≥10 runs, as in `ci-speed.md`.
6. Report before → after and the command that produced both. If a number is estimated, say
   "expected"; if it could not be measured here, say why.

---

## 4. Script reference

| Command | Mutates | Use |
|---|---|---|
| `bash scripts/agent-preflight.sh` | fetch only (no pull/checkout) | Start of every session: main sha, branch, dirty/behind, node_modules, ports, fast commands |
| `bash scripts/agent-worktree.sh <slug>` | creates worktree/branch, symlink, `.agent/env` | One isolated workspace from fresh `origin/main` |
| `bash scripts/agent-status.sh` | nothing | Merge-order table: ahead/behind, dirty, merged, node_modules, last subject |
| `bash scripts/agent-cleanup.sh [--apply] [--json]` | dry-run by default; `--apply` removes merged+clean+idle worktrees and prunes merged local branches | Housekeeping between waves |

Exit codes: preflight is non-zero only for a failed fetch (or not being in a repo);
worktree creation is non-zero on an existing branch/directory or fetch failure; cleanup is
non-zero only on bad arguments or running outside a repo. A skipped worktree is a normal,
successful outcome.

### What the tooling deliberately does not do

- No automatic pull, rebase, merge, commit or push.
- No `npm install`, no dependency change, no lockfile rewrite.
- No deletion without `--apply`, and no `--force` worktree removal.
- No remote branch deletion.
- No app, test or CI changes: these scripts are development plumbing only.
