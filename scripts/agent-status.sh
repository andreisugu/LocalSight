#!/usr/bin/env bash
# Read-only inventory of every worktree, for the orchestrator's merge order.
#
#   bash scripts/agent-status.sh
#
# Columns: slug, branch, ahead/behind origin/main, dirty path count, merged into
# origin/main, node_modules shape, last commit subject. It never fetches, never
# checks out and never writes: run scripts/agent-preflight.sh first if origin/main
# might be stale.
set -uo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-status] not inside a git worktree" >&2
  exit 2
fi

WORKTREE="$(git rev-parse --show-toplevel)"
MAIN_SHA="$(git -C "$WORKTREE" rev-parse --short origin/main 2>/dev/null || echo '?')"
CURRENT="$(git -C "$WORKTREE" rev-parse --show-toplevel)"

echo "origin/main $MAIN_SHA  (not fetched by this script; run agent-preflight.sh)"
printf '%-24s\t%-28s\t%5s\t%6s\t%5s\t%-6s\t%-4s\t%s\n' \
  "SLUG" "BRANCH" "AHEAD" "BEHIND" "DIRTY" "MERGED" "NM" "LAST COMMIT"

total=0 n_merged=0 n_dirty=0 n_unmerged=0 n_linked=0
rows="$(mktemp)"
trap 'rm -f "$rows"' EXIT

emit() {
  local path="$1" branch="$2" slug ahead behind dirty merged nm subject
  slug="$(basename "$path")"
  [ "$path" = "$CURRENT" ] && slug="$slug*"

  if [ -z "$branch" ]; then
    branch="(detached)"
    ahead="-"; behind="-"; merged="no"
  else
    ahead="$(git -C "$path" rev-list --count "origin/main..HEAD" 2>/dev/null || echo '?')"
    behind="$(git -C "$path" rev-list --count "HEAD..origin/main" 2>/dev/null || echo '?')"
    if [ "$branch" = "main" ]; then
      merged="base"
    elif git -C "$path" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
      merged="yes"
    else
      merged="no"
    fi
  fi

  dirty="$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  local nm="$path/frontend/node_modules"
  if [ -L "$nm" ]; then nm="link"; elif [ -d "$nm" ]; then nm="real"; else nm="-"; fi
  subject="$(git -C "$path" log -1 --format=%s 2>/dev/null | cut -c1-56)"

  total=$((total + 1))
  [ "$merged" = "yes" ] && n_merged=$((n_merged + 1))
  [ "$merged" = "no" ] && n_unmerged=$((n_unmerged + 1))
  [ "$dirty" != "0" ] && n_dirty=$((n_dirty + 1))
  [ "$nm" = "link" ] && n_linked=$((n_linked + 1))

  printf '%-24s\t%-28s\t%5s\t%6s\t%5s\t%-6s\t%-4s\t%s\n' \
    "$slug" "$branch" "$ahead" "$behind" "$dirty" "$merged" "$nm" "$subject" >> "$rows"
}

path=""
branch=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) path="${line#worktree }"; branch="" ;;
    "branch refs/heads/"*) branch="${line#branch refs/heads/}" ;;
    "") if [ -n "$path" ]; then emit "$path" "$branch"; path=""; fi ;;
  esac
done < <(git -C "$WORKTREE" worktree list --porcelain; echo)
[ -n "$path" ] && emit "$path" "$branch"

sort -t $'\t' -k1,1 "$rows" | column -t -s $'\t'

echo
echo "worktrees: $total   merged: $n_merged   unmerged: $n_unmerged   dirty: $n_dirty   linked node_modules: $n_linked"
echo "* = current worktree. 'merged' means the branch tip is an ancestor of origin/main."
echo "Merge order: clean+merged first, then unmerged by last commit; never a dirty tree."
