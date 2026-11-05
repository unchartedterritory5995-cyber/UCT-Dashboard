#!/usr/bin/env bash
# usage: retire-worktree.sh <worktree>
# Retire a finished lane worktree: only if clean and local == origin/<branch>. Unlinks app/node_modules if it is a junction
# (non-recursive, `cmd rmdir`; REFUSES a real directory), removes .uct-session-owner, then `git worktree remove` (no --force).
set -u
W=${1:-}; die() { echo "retire-worktree: REFUSED: $*"; exit 1; }
[ -d "$W" ] || die "usage: retire-worktree.sh <worktree>"
cd "$W" || die "cannot cd"
[ -f .git ] || die "not a linked worktree (.git is not a file)"
BR=$(git branch --show-current); [ -n "$BR" ] || die "detached HEAD"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "tracked changes"
U=$(git status --porcelain | grep -v -F '.uct-session-owner'); [ -z "$U" ] || die "untracked files: $(echo "$U" | head -2 | tr '\n' ' ')"
git fetch -q origin "$BR" 2>/dev/null || die "origin/$BR not found (not pushed)"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BR)" ] || die "local != origin/$BR"
ROOT=$(git rev-parse --show-toplevel); MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
NM=$ROOT/app/node_modules
if [ -e "$NM" ] || [ -L "$NM" ]; then
  # a junction is a reparse point; a real directory is not
  ISJ=$(powershell.exe -NoProfile -Command "if((Get-Item -LiteralPath '$(cygpath -w "$NM")' -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){'J'}else{'D'}" | tr -d '\r')
  [ "$ISJ" = J ] || die "app/node_modules is a real directory, not a junction"
  cmd //c rmdir "$(cygpath -w "$NM")" || die "rmdir of junction failed"
fi
rm -f .uct-session-owner
cd "$MAIN" || die "cannot cd main worktree $MAIN"
git worktree remove "$ROOT" || die "git worktree remove failed (left in place)"
echo "retire-worktree: removed $ROOT (branch $BR kept)"
