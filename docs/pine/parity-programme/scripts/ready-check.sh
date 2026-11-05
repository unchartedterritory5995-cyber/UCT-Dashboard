#!/usr/bin/env bash
# usage: ready-check.sh <worktree> <outdir>      (outdir = the final-tip.sh output dir, e.g. $UCT_RESUME/runs/<label>)
# PASS only if: local branch == origin/<branch> (after a fetch); the tree is clean (no tracked changes, no untracked files
# except .uct-session-owner); <outdir>/TIP and FINAL_DONE exist and name one sha; that sha is the last commit touching a non-docs
# path or a later one; and only docs/ changed between it and HEAD. One-line verdict; exit 0 PASS, 1 FAIL.
set -u
W=${1:-}; O=${2:-}
fail() { echo "READY-CHECK FAIL: $*"; exit 1; }
[ -d "$W" ] && [ -d "$O" ] || fail "usage: ready-check.sh <worktree> <outdir>"
cd "$W" || fail "cannot cd $W"
BR=$(git branch --show-current); [ -n "$BR" ] || fail "detached HEAD"
git fetch -q origin "$BR" 2>/dev/null || fail "fetch origin/$BR failed (not pushed?)"
HEAD=$(git rev-parse HEAD); OR=$(git rev-parse "origin/$BR")
[ "$HEAD" = "$OR" ] || fail "local ${HEAD:0:10} != origin/$BR ${OR:0:10}"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "tracked changes in tree"
U=$(git status --porcelain | grep -v -F '.uct-session-owner'); [ -z "$U" ] || fail "untracked files: $(echo "$U" | head -2 | tr '\n' ' ')"
[ -f "$O/TIP" ] && [ -f "$O/FINAL_DONE" ] || fail "no completed final-tip in $O (TIP/FINAL_DONE missing)"
TIP=$(awk '{print $2}' "$O/TIP"); git cat-file -e "$TIP^{commit}" 2>/dev/null || fail "TIP $TIP unknown commit"
[ "$(awk '{print $2}' "$O/FINAL_DONE")" = "$TIP" ] || fail "FINAL_DONE sha differs from TIP"
LAST=$(git log -1 --format=%H -- . ':(exclude)docs')
if [ -n "$LAST" ]; then git merge-base --is-ancestor "$LAST" "$TIP" || fail "TIP ${TIP:0:10} predates last non-docs commit ${LAST:0:10}"; fi
git merge-base --is-ancestor "$TIP" "$HEAD" || fail "TIP ${TIP:0:10} is not an ancestor of HEAD"
NON=$(git diff --name-only "$TIP" "$HEAD" | grep -v '^docs/' | head -3 | tr '\n' ' '); [ -z "$NON" ] || fail "non-docs changed after TIP: $NON"
echo "READY-CHECK PASS: HEAD ${HEAD:0:10} == origin/$BR, clean, TIP ${TIP:0:10} (last non-docs ${LAST:0:10}), docs-only after TIP"
