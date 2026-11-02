#!/usr/bin/env bash
# Share the main checkout's `frontend/node_modules` with a fresh worktree.
#
# Every worktree of this repo got its own `npm ci` (258 MB, 152 packages) just to run the
# suites once, and 50 parallel prep worktrees meant 50 copies of the same tree. The
# dependency set is identical as long as `package-lock.json` is, so a symlink is enough:
#
#   bash frontend/scripts/link-node-modules.sh
#
# Safety, in order:
#   - the main checkout must exist and have `frontend/node_modules`;
#   - its `package-lock.json` must be byte-identical to this worktree's, otherwise the link
#     is refused (run `npm ci` instead — a stale tree is worse than a slow one);
#   - an existing real `node_modules` directory is never deleted, only reported;
#   - re-running is a no-op.
#
# Do not run `npm install`/`npm ci` in a linked worktree: it would write through the
# symlink into the main checkout. `node_modules/` is git-ignored, so nothing is committed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # <worktree>/frontend/scripts
FRONTEND="$(dirname "$HERE")"                          # <worktree>/frontend
WORKTREE="$(dirname "$FRONTEND")"                      # <worktree>
LINK="$FRONTEND/node_modules"

die() {
  echo "[link-node-modules] $*" >&2
  exit 1
}

# The main checkout is the parent of the common git dir: <main>/.git for the primary
# worktree and for every linked one, so this works from inside any worktree.
COMMON_DIR="$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$COMMON_DIR")"
SOURCE="$MAIN/frontend/node_modules"

[ -f "$FRONTEND/package-lock.json" ] || die "no package-lock.json in $FRONTEND"
[ -d "$SOURCE" ] || die "$SOURCE is missing; run 'npm ci' in $MAIN/frontend once"
[ -f "$MAIN/frontend/package-lock.json" ] || die "$MAIN/frontend/package-lock.json is missing"

# Byte comparison, not a hash: it also catches line-ending and npm-version rewrites.
if ! cmp -s "$MAIN/frontend/package-lock.json" "$FRONTEND/package-lock.json"; then
  die "package-lock.json differs from $MAIN/frontend; run 'npm ci' here instead of linking"
fi

if [ "$FRONTEND" = "$MAIN/frontend" ]; then
  echo "[link-node-modules] this is the main checkout; nothing to link."
  exit 0
fi

# A relative link keeps working when the whole checkout directory is moved or renamed.
TARGET="$SOURCE"
if command -v realpath >/dev/null 2>&1; then
  TARGET="$(realpath --relative-to="$FRONTEND" "$SOURCE")"
fi

if [ -L "$LINK" ]; then
  CURRENT="$(readlink "$LINK")"
  if [ "$CURRENT" = "$TARGET" ]; then
    echo "[link-node-modules] already linked: frontend/node_modules -> $CURRENT"
    exit 0
  fi
  die "frontend/node_modules is a symlink to $CURRENT, expected $TARGET; remove it and re-run"
fi

if [ -e "$LINK" ]; then
  die "frontend/node_modules exists as a real directory; remove it yourself if you want the link (it may be a deliberate install)"
fi

ln -s "$TARGET" "$LINK"
echo "[link-node-modules] frontend/node_modules -> $TARGET"
echo "[link-node-modules] shared with $MAIN; do not run 'npm ci' in this worktree."
