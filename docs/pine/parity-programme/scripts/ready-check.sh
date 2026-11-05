#!/usr/bin/env bash
# usage: ready-check.sh <worktree> <outdir>      (outdir = the final-tip.sh output dir, e.g. $UCT_RESUME/runs/<label>)
# PASS only if: local branch == origin/<branch> (after a fetch); the tree is clean (no tracked changes, no untracked files
# except .uct-session-owner); <outdir>/TIP and FINAL_DONE exist and name one sha; that sha is the last commit touching a non-docs
# path or a later one; and only docs/ changed between it and HEAD. ALSO the FINAL_DONE record must show: scope=full (affected
# runs never pass), integrity=ok, totals=ok (every vitest run/shard reported), gate/hygiene/py rc 0, and js rc 0 or ONLY the
# named baseline failures (BASELINE_FAIL_RE: pollingSites.rail, settingsScope.rail). One-line verdict; exit 0 PASS, 1 FAIL.
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
[ "$(head -1 "$O/FINAL_DONE" | awk '{print $2}')" = "$TIP" ] || fail "FINAL_DONE sha differs from TIP"
fd() { grep -m1 -o -E "(^|[ ])$1=[^ ]*" "$O/FINAL_DONE" | head -1 | sed -E "s/^ ?$1=//"; }
BASELINE_FAIL_RE='^(pollingSites\.rail|settingsScope\.rail)\.test\.jsx?$'
SCOPE=$(fd scope); [ "$SCOPE" = full ] || fail "final-tip scope is '${SCOPE:-unknown}', only a FULL run counts (shards allowed)"
[ "$(fd integrity)" = ok ] || fail "final-tip integrity=$(fd integrity) (HEAD or tree moved during the run, or old-format FINAL_DONE)"
[ "$(fd totals)" = ok ] || fail "totals=$(fd totals): a vitest run/shard reported no totals"
for k in gate hyg; do [ "$(fd $k)" = 0 ] || fail "$k rc=$(fd $k)"; done
PYRC=$(fd py); case "$PYRC" in NA|0) ;; *) fail "py rc=$PYRC";; esac
ERRS=$(fd errors); [ "$ERRS" = 0 ] || fail "vitest reported errors=${ERRS:-missing} (unhandled errors have no FAIL line; shard_errors=$(fd shard_errors))"
JSRC=$(fd js); JF=$(fd jsfail)
if [ "$JSRC" != 0 ]; then
  [ -n "$JF" ] && [ "$JF" != none ] || fail "js rc=$JSRC with no named failing test file (crash/unhandled error)"
  for f in $(echo "$JF" | tr ',' ' '); do echo "$f" | grep -q -E "$BASELINE_FAIL_RE" || fail "js failure outside the baseline allowlist: $f"; done
fi
RCS="scope=$SCOPE shards=$(fd shards) rc gate=0 hyg=0 py=$PYRC js=$JSRC jsfail=$JF"
LAST=$(git log -1 --format=%H -- . ':(exclude)docs')
if [ -n "$LAST" ]; then git merge-base --is-ancestor "$LAST" "$TIP" || fail "TIP ${TIP:0:10} predates last non-docs commit ${LAST:0:10}"; fi
git merge-base --is-ancestor "$TIP" "$HEAD" || fail "TIP ${TIP:0:10} is not an ancestor of HEAD"
NON=$(git diff --name-only "$TIP" "$HEAD" | grep -v '^docs/' | head -3 | tr '\n' ' '); [ -z "$NON" ] || fail "non-docs changed after TIP: $NON"
echo "READY-CHECK PASS: HEAD ${HEAD:0:10} == origin/$BR, clean, TIP ${TIP:0:10} (last non-docs ${LAST:0:10}), docs-only after TIP; $RCS"
