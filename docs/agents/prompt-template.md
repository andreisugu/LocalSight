# Agent task prompt — reusable template

Copy everything below into the next agent's task, fill the `<...>` slots, and delete the
bracketed hints. The companion SOP is [`../ops/agent-workflow.md`](../ops/agent-workflow.md);
run/test commands are canonical in [`../../RUNNING.md`](../../RUNNING.md).

---

## Context

Repository: LocalSight (browser-only apron safety pipeline; React/Vite static build, no
backend). The product is `frontend/`; the engine runs in the tab.

Read first, in this order:
1. `AGENTS.md` (rules, boundaries, license/privacy constraints)
2. `RUNNING.md` (start/build/test/deploy commands)
3. `docs/contract.md` (event envelope; historical backend endpoints do not exist)
4. The README or doc of the folder you touch

Starting state: `origin/main@<sha>` (checked at `<date/time>`). Do not work in the main
checkout.

## Ownership

Create exactly one worktree and one branch:

```bash
bash scripts/agent-worktree.sh <slug>
cd ../LocalSight-prep/<slug>
source .agent/env
bash scripts/agent-preflight.sh
```

Branch: `prep/<slug>`. Files you own (edit only these):

- `<path/one>`
- `<path/two>`
- `<new file, if any>`

Files you may read but not edit: `<...>`. Anything outside this list is another agent's
work: stop and report instead of editing it.

## Frozen interfaces

Do not change, unless this task explicitly says so:

- `docs/contract.md`: event/zone fields, `severity`, `confidence`, `snapshot_url` shape.
- Routes and their URLs (`/`, `/incidents`, `/incidents/:id`, `/zones`, `/reports`,
  `/settings`, `/lab`, `/bench`) and the sidebar labels they expose.
- Component props/behaviour that tests locate by role or `data-testid`.
- `frontend/package.json`, `frontend/package-lock.json`, `.github/workflows/**`.
- The mock/live boundary (`VITE_USE_MOCK`), demo-fixture visibility (`showDemoData`), and
  the "nothing leaves the tab" privacy guarantee.
- Other worktrees; do not modify them or their branches.

## Task

<One paragraph: the user-visible problem and the outcome. Then a short numbered list of
acceptance criteria, each testable.>

Out of scope: `<explicit non-goals>`.

Constraints: `<perf budget, browser target, no new dependency, no contract change, etc.>`

## Verification

Run from `frontend/`, with the ports from `.agent/env`:

```bash
cd frontend
npm run verify:fast                 # unit + build (~12 s) - after the first edit
npm run verify                      # final gate: 2 builds + smoke + Pages (~21 s)
# only if this change touches storage/IndexedDB/reload:
npm run verify -- --with-persistence
# targeted e2e without rebuilding:
npm run e2e:serve                   # prints http://127.0.0.1:<port>/LocalSight/
PW_BASE_URL=http://127.0.0.1:<port>/LocalSight/ npm run e2e:pages
PW_BASE_URL=http://127.0.0.1:<port>/ npm run e2e:smoke
```

Also required for this task: `<UI screenshot at 1400/1024/375, engine fps from /bench,
a11y check, docs link check, ...>`. Report the exact command and result; if a gate cannot
run on this machine, name it and why. Do not substitute a weaker command silently.

## Rules

- Read every file before editing it. Small diff, one subject.
- No new dependency; no lockfile change; no test hook added only to make a test pass; no
  weakening/removal of a test, timeout or assertion.
- No contract change; no app/test/CI change outside your ownership.
- No force push, no `reset --hard`, no history rewrite, no merge.
- No secrets, models (`.onnx`/`.pt`), videos (`.mp4`), local DBs or `.env` in git. `.agent/`
  is ignored and stays untracked.
- Unblurred faces, names or emotion recognition are never acceptable in code or assets.
- If you find an inconsistency, stop and report it instead of working around it.
- If blocked: read the contract and the affected files, propose a 3-line plan, ask one
  clarifying question, do not guess.

## Delivery

- Commit on `prep/<slug>` with an English message; push the branch when asked. **Do not
  merge.**
- Leave the worktree clean (`git status --porcelain` empty apart from ignored files).
- End with this report:

```text
Branch:      prep/<slug>
Commit:      <sha> (<subject>)
Changed:     <files/areas>
Verification: <command> -> <pass/fail + key numbers>
Numbers:     <before -> after, measured only>
Not done:    <skipped gates, risks, follow-ups>
Worktree:    <path> (clean)
```

The orchestrator merges in the order from `bash scripts/agent-status.sh`; a rebase onto the
current `origin/main` plus a re-run of the named gate may be requested before merge.

---

## Example (filled, short)

```text
## Context
origin/main@df8bd6c. Fix the incident list so a card is keyboard-reachable.

## Ownership
- frontend/src/components/incidents/IncidentCard.jsx
- frontend/src/components/incidents/IncidentCard.test.jsx (new)

## Frozen interfaces
Route /incidents, card text/`data-testid="incident-card"`, severity values.

## Task
1. Card is a real button/link with visible focus.
2. Enter opens the detail route; Space does not scroll unexpectedly.
3. Unit test covers the handler; existing a11y ring styles are reused.

## Verification
npm run verify:fast; npm run verify; keyboard check at 1400 and 375.

## Rules
No dependency, no contract change, no test weakening.

## Delivery
Branch prep/incident-keyboard; report the block above; do not merge.
```
