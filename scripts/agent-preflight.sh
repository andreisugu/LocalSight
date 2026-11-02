#!/usr/bin/env bash
set -euo pipefail

# Sincronizează repo-ul LocalSight înainte de un task.
# Un singur remote: `origin`. Nu mai există repo de docs separat — `docs/` e în acest repo.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${LOCALSIGHT_PREFLIGHT_REMOTE:-origin}"

if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ nu e un repo git: $ROOT" >&2
  exit 1
fi

echo "== LocalSight ($ROOT)"

if ! git -C "$ROOT" fetch --prune "$REMOTE"; then
  echo "✗ fetch a eșuat pe $REMOTE" >&2
  exit 1
fi

branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "✗ detached HEAD; treci pe un branch numit înainte de task." >&2
  exit 1
fi

dirty="$(git -C "$ROOT" status --porcelain)"
if [[ -n "$dirty" ]]; then
  echo "  ! modificări locale; nu fac pull. Rezolvă sau fă stash înainte de task."
  exit 1
fi

if [[ "$branch" == "main" ]]; then
  if ! git -C "$ROOT" pull --ff-only "$REMOTE" main; then
    echo "✗ pull --ff-only a eșuat; istoric divergent." >&2
    exit 1
  fi
else
  echo "  • pe branch-ul $branch; am făcut doar fetch (nu schimb branch-ul)."
fi

behind="$(git -C "$ROOT" rev-list --count "HEAD..@{u}" 2>/dev/null || echo "?")"
echo "  → $(git -C "$ROOT" rev-parse --short HEAD) pe $branch, în urma $REMOTE: $behind commituri"

echo ""
echo "Preflight OK: $REMOTE e sincronizat."
