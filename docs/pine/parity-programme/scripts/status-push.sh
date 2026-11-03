#!/usr/bin/env bash
# Two-machine channel: commit files onto a single-writer status branch WITHOUT checking it out.
#   status-push.sh <branch> "<commit message>" <path-in-branch>=<local-file> [<path>=<file> ...]
# Run from any UCT-Dashboard worktree. The branch has its own history (no repo files); only ONE
# machine ever writes a given branch (laptop: ops/pine-coord, desktop: ops/pine-desktop), so a push
# never races. Read the other side with:
#   git fetch -q origin <branch> && git show origin/<branch>:<path>
set -eu
B=$1; MSG=$2; shift 2
PARENT=""
if git fetch -q origin "$B" 2>/dev/null; then PARENT=$(git rev-parse "origin/$B"); fi
export GIT_INDEX_FILE="$(mktemp -u)"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
if [ -n "$PARENT" ]; then git read-tree "$PARENT"; else git read-tree --empty; fi
for pair in "$@"; do
  P=${pair%%=*}; F=${pair#*=}
  [ -f "$F" ] || { echo "status-push: no such file $F" >&2; exit 2; }
  git update-index --add --cacheinfo "100644,$(git hash-object -w "$F"),$P"
done
TREE=$(git write-tree)
if [ -n "$PARENT" ] && [ "$TREE" = "$(git rev-parse "$PARENT^{tree}")" ]; then echo "status-push: no change"; exit 0; fi
C=$(printf '%s\n' "$MSG" | git commit-tree "$TREE" ${PARENT:+-p "$PARENT"})
git push -q origin "$C:refs/heads/$B"
echo "status-push: $B -> $(git rev-parse --short=10 "$C")"
