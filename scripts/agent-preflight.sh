#!/usr/bin/env bash
# Read-only preflight for an agent session.
#
#   bash scripts/agent-preflight.sh
#
# Answers, in one screen: what origin/main is, which worktree and branch you are in,
# whether the tree is dirty or behind, whether frontend/node_modules is a shared
# symlink, which preview ports are already taken, and the canonical fast commands.
#
# It fetches (that is the point: a stale origin/main is how agents rebase late) but
# never pulls, checks out, rebases or writes to the worktree. A dirty or behind tree
# is a warning, not an error: the only non-zero exit is a failed fetch (or running
# outside a git repository).
set -uo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[preflight] not inside a git worktree" >&2
  exit 2
fi

WORKTREE="$(git rev-parse --show-toplevel)"
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$COMMON_DIR")"
BRANCH="$(git -C "$WORKTREE" branch --show-current 2>/dev/null || true)"
[ -n "$BRANCH" ] || BRANCH="DETACHED"

echo "== fetch =="
if ! git -C "$WORKTREE" fetch --quiet origin; then
  echo "[preflight] git fetch origin failed; fix the remote before starting" >&2
  exit 1
fi
echo "origin/main  $(git -C "$WORKTREE" rev-parse --short origin/main)  $(git -C "$WORKTREE" log -1 --format=%s origin/main)"

echo
echo "== worktree =="
echo "path         $WORKTREE"
echo "main         $MAIN"
echo "branch       $BRANCH"

DIRTY="$(git -C "$WORKTREE" status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" -gt 0 ]; then
  echo "status       DIRTY ($DIRTY path(s)) - commit, stash or revert before rebasing"
  git -C "$WORKTREE" status --short | head -5 | sed 's/^/             /'
  [ "$DIRTY" -le 5 ] || echo "             ..."
else
  echo "status       clean"
fi

if [ "$BRANCH" = "DETACHED" ]; then
  echo "behind       unknown (detached HEAD) - create a named branch"
else
  BEHIND="$(git -C "$WORKTREE" rev-list --count "HEAD..origin/main" 2>/dev/null || echo '?')"
  AHEAD="$(git -C "$WORKTREE" rev-list --count "origin/main..HEAD" 2>/dev/null || echo '?')"
  echo "ahead        $AHEAD commit(s) not on origin/main"
  echo "behind       $BEHIND commit(s) behind origin/main"
  if [ "${BEHIND:-0}" != "0" ] && [ "$BEHIND" != "?" ]; then
    echo "             WARNING: rebase onto origin/main before starting (do not pull blindly)"
  fi
fi

echo
echo "== node_modules =="
NM="$WORKTREE/frontend/node_modules"
if [ -L "$NM" ]; then
  echo "frontend/node_modules  symlink -> $(readlink "$NM")"
  echo "                       shared with the main checkout; do NOT run npm ci here"
elif [ -d "$NM" ]; then
  echo "frontend/node_modules  real directory ($(du -sh "$NM" 2>/dev/null | cut -f1))"
  echo "                       a fresh worktree can share it: bash frontend/scripts/link-node-modules.sh"
else
  echo "frontend/node_modules  missing"
  echo "                       link it: bash frontend/scripts/link-node-modules.sh"
  echo "                       or install once: (cd frontend && npm ci)"
fi

echo
echo "== preview ports =="
PORTS="$(ss -H -ltn 2>/dev/null | awk '{print $4}' | sed 's/.*://' | grep -E '^(4173|43[0-9][0-9])$' | sort -n | uniq || true)"
if [ -n "$PORTS" ]; then
  while IFS= read -r port; do
    pid="$(ss -H -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $0}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
    label=""
    if [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ]; then
      label="$(tr '\0' ' ' < "/proc/$pid/cmdline" | cut -c1-80)"
    fi
    printf '  :%-5s pid=%-7s %s\n' "$port" "${pid:-?}" "$label"
  done <<< "$PORTS"
  echo "  (another agent's server or an orphan; never reuse a port you did not start)"
else
  echo "  none listening on 4173 or 43xx"
fi

echo
echo "== agent env =="
if [ -f "$WORKTREE/.agent/env" ]; then
  echo "  .agent/env present"
  # shellcheck disable=SC1090
  (set -a; . "$WORKTREE/.agent/env" >/dev/null 2>&1 || true; echo "  PW_PORT=${PW_PORT:-<unset>}  PW_BASE_URL=${PW_BASE_URL:-<unset>}")
else
  echo "  .agent/env missing (created by scripts/agent-worktree.sh; optional)"
fi

echo
echo "== fast commands (from frontend/) =="
cat <<'EOF'
  npm run verify:fast     unit + build, no browser            (~12 s)
  npm run verify          unit + 2 builds + smoke + Pages     (~21 s warm)
  npm run e2e:serve       one server for repeated e2e runs    (prints a free port)
  PW_BASE_URL=<url> npm run e2e:pages                         (no rebuild, no server)
  bash scripts/agent-status.sh                                (all worktrees, read-only)
  bash scripts/agent-cleanup.sh                               (dry-run; --apply to remove)
EOF
