#!/usr/bin/env bash
# Remove only worktrees that are provably disposable.
#
#   bash scripts/agent-cleanup.sh               # dry-run (default): print, change nothing
#   bash scripts/agent-cleanup.sh --apply       # remove merged, clean, idle worktrees
#   bash scripts/agent-cleanup.sh --json        # machine-readable dry-run
#   bash scripts/agent-cleanup.sh --apply --json
#
# A worktree is removable only when all of these hold:
#   - it is not the main checkout and not the worktree this script runs from;
#   - it has a named branch (never a detached HEAD);
#   - `git status --porcelain` is empty (no modified, staged or untracked paths;
#     ignored files such as node_modules do not count);
#   - its branch tip is an ancestor of origin/main (fully merged, nothing to lose);
#   - no live process has its working directory inside it (no dev server).
#
# Anything else is skipped and the reason is printed. Removal is `git worktree remove`
# without --force, so git gets the last word. Local prep/* branches that are merged
# and no longer checked out are pruned afterwards, and `git worktree prune` clears
# stale metadata. No fetch: run scripts/agent-preflight.sh first if origin/main may
# be stale, otherwise a branch merged on the remote but not in your refs is "unmerged"
# and stays, which is the safe direction.
set -uo pipefail

APPLY=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --json) JSON=1 ;;
    --help|-h)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[cleanup] unknown argument: $arg (use --apply and/or --json)" >&2
      exit 2
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[cleanup] not inside a git worktree" >&2
  exit 2
fi

WORKTREE="$(git rev-parse --show-toplevel)"
CURRENT="$WORKTREE"
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$COMMON_DIR")"
MAIN_SHA="$(git rev-parse --short origin/main 2>/dev/null || echo '?')"

# Snapshot process cwd once; scanning /proc per worktree would be needlessly slow.
PROCS="$(mktemp)"
ROWS="$(mktemp)"
trap 'rm -f "$PROCS" "$ROWS"' EXIT
for d in /proc/[0-9]*; do
  pid="${d#/proc/}"
  [ "$pid" = "$$" ] && continue
  cwd="$(readlink "$d/cwd" 2>/dev/null)" || continue
  [ -n "$cwd" ] && printf '%s\t%s\n' "$pid" "$cwd" >> "$PROCS"
done

active_pid() {
  local w="$1"
  awk -F '\t' -v p="$w" '$2 == p || index($2, p "/") == 1 { print $1; exit }' "$PROCS"
}

human_mb() {
  local mb="$1"
  if [ "$mb" -ge 1024 ]; then
    awk -v m="$mb" 'BEGIN { printf "%.1f GB", m / 1024 }'
  else
    printf '%s MB' "$mb"
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g'
}

total=0
candidates=0
skipped=0
reclaim_mb=0
removed_mb=0
removed=0
failed=0
branches_deleted=0

json_candidates=""
json_skipped=""
json_removed=""
json_failed=""

add_json_item() {
  local var="$1" item="$2"
  local current="${!var}"
  if [ -n "$current" ]; then
    printf -v "$var" '%s,%s' "$current" "$item"
  else
    printf -v "$var" '%s' "$item"
  fi
}

process_worktree() {
  local path="$1" branch="$2" slug reason="" size
  slug="$(basename "$path")"

  if [ "$path" = "$MAIN" ]; then reason="main checkout"
  elif [ "$path" = "$CURRENT" ]; then reason="current worktree"
  elif [ -z "$branch" ]; then reason="detached HEAD"
  else
    local dirty
    dirty="$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$dirty" != "0" ]; then
      reason="dirty ($dirty path(s))"
    elif ! git -C "$path" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
      reason="unmerged ($(git -C "$path" rev-list --count origin/main..HEAD 2>/dev/null) commit(s) ahead)"
    else
      local pid
      pid="$(active_pid "$path")"
      [ -n "$pid" ] && reason="active process (pid $pid)"
    fi
  fi

  total=$((total + 1))

  if [ -n "$reason" ]; then
    skipped=$((skipped + 1))
    if [ "$JSON" -eq 0 ]; then
      printf '  skip  %-24s %-30s %s\n' "$slug" "${branch:-detached}" "$reason"
    fi
    add_json_item json_skipped "$(printf '{"slug":"%s","branch":"%s","path":"%s","reason":"%s"}' \
      "$(json_escape "$slug")" "$(json_escape "${branch:-}")" "$(json_escape "$path")" "$(json_escape "$reason")")"
    return
  fi

  size="$(du -sm "$path" 2>/dev/null | cut -f1)"
  [ -n "$size" ] || size=0
  candidates=$((candidates + 1))
  reclaim_mb=$((reclaim_mb + size))

  if [ "$APPLY" -eq 0 ]; then
    [ "$JSON" -eq 0 ] && printf '  would remove %-24s %-30s %s\n' "$slug" "$branch" "$(human_mb "$size")"
    add_json_item json_candidates "$(printf '{"slug":"%s","branch":"%s","path":"%s","size_mb":%s}' \
      "$(json_escape "$slug")" "$(json_escape "$branch")" "$(json_escape "$path")" "$size")"
    return
  fi

  if git -C "$WORKTREE" worktree remove "$path"; then
    removed=$((removed + 1))
    removed_mb=$((removed_mb + size))
    if git -C "$WORKTREE" show-ref --verify --quiet "refs/heads/$branch"; then
      # The merge check above is the safety gate; -d would compare against the
      # current HEAD, which may legitimately be behind origin/main.
      if git -C "$WORKTREE" branch -D "$branch" >/dev/null 2>&1; then
        branches_deleted=$((branches_deleted + 1))
      fi
    fi
    [ "$JSON" -eq 0 ] && printf '  removed %-24s %-30s %s\n' "$slug" "$branch" "$(human_mb "$size")"
    add_json_item json_removed "$(printf '{"slug":"%s","branch":"%s","path":"%s","size_mb":%s}' \
      "$(json_escape "$slug")" "$(json_escape "$branch")" "$(json_escape "$path")" "$size")"
  else
    failed=$((failed + 1))
    [ "$JSON" -eq 0 ] && printf '  FAILED  %-24s %-30s git worktree remove refused; left in place\n' "$slug" "$branch"
    add_json_item json_failed "$(printf '{"slug":"%s","branch":"%s","path":"%s","reason":"git worktree remove failed"}' \
      "$(json_escape "$slug")" "$(json_escape "$branch")" "$(json_escape "$path")")"
  fi
}

path=""
branch=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) path="${line#worktree }"; branch="" ;;
    "branch refs/heads/"*) branch="${line#branch refs/heads/}" ;;
    "") if [ -n "$path" ]; then process_worktree "$path" "$branch"; path=""; fi ;;
  esac
done < <(git -C "$WORKTREE" worktree list --porcelain; echo)
[ -n "$path" ] && process_worktree "$path" "$branch"

if [ "$APPLY" -eq 1 ]; then
  git -C "$WORKTREE" worktree prune >/dev/null 2>&1 || true
  # Prune local prep/* branches that are merged and no longer checked out anywhere.
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    git -C "$WORKTREE" merge-base --is-ancestor "$b" origin/main 2>/dev/null || continue
    if git -C "$WORKTREE" worktree list --porcelain | grep -Fxq "branch refs/heads/$b"; then
      continue
    fi
    if git -C "$WORKTREE" branch -D "$b" >/dev/null 2>&1; then
      branches_deleted=$((branches_deleted + 1))
    fi
  done < <(git -C "$WORKTREE" for-each-ref --format='%(refname:short)' 'refs/heads/prep/*')
fi

if [ "$JSON" -eq 1 ]; then
  cat <<EOF
{
  "apply": $([ "$APPLY" -eq 1 ] && echo true || echo false),
  "origin_main": "$MAIN_SHA",
  "current": "$(json_escape "$CURRENT")",
  "candidates": [${json_candidates}],
  "skipped": [${json_skipped}],
  "removed": [${json_removed}],
  "failed": [${json_failed}],
  "summary": {
    "total": $total,
    "candidates": $candidates,
    "skipped": $skipped,
    "removed": $removed,
    "failed": $failed,
    "branches_deleted": $branches_deleted,
    "reclaim_mb": $reclaim_mb,
    "removed_mb": $removed_mb
  }
}
EOF
  exit 0
fi

echo
if [ "$APPLY" -eq 0 ]; then
  echo "[cleanup] dry-run: nothing changed. origin/main@$MAIN_SHA"
  echo "[cleanup] $candidates worktree(s) removable, $(human_mb "$reclaim_mb") reclaimable; $skipped kept"
  echo "[cleanup] re-run with --apply to remove them (git worktree remove, never --force)"
else
  echo "[cleanup] removed $removed worktree(s), branches deleted $branches_deleted, failed $failed; $(human_mb "$removed_mb")"
  [ "$failed" -eq 0 ] || echo "[cleanup] failed worktrees were left untouched; inspect with scripts/agent-status.sh"
fi
