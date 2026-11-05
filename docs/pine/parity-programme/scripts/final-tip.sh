#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage: final-tip.sh <worktree-name> <outdir-label> [extra pytest files...]
# Runs under ONE heavy-lock hold: deploy-gate pytest + hygiene, extra pytest rails, full chart+hooks vitest (--maxWorkers=2).
# Refuses a tree with tracked changes OR untracked files other than .uct-session-owner (rc 5; app/node_modules is gitignored).
# Writes "TIP <sha> <time>" to <outdir>/TIP at start and FINAL_DONE at the end (line 1 "TIP <sha> done", then scope, every
# step's rc, per-shard rcs, whether every vitest run reported totals, the failing test files, and an integrity check that HEAD
# and the tree did not move during the run); scripts/ready-check.sh reads both. Exit 6 when a shard died / reported no totals
# or HEAD/tree moved (FINAL_DONE is still written, marked, so ready-check fails it). Test failures alone do not change the
# exit code; ready-check judges them. Optional env (OPS-SPEED.md):
#   FINAL_TIP_SCOPE=affected   vitest `--changed <FINAL_TIP_BASE>` (default base: merge-base HEAD origin/master) plus
#                              FINAL_TIP_RAILS (space-separated vitest paths, relative to app/) instead of the full run.
#   FINAL_TIP_SHARDS=N         full run as vitest --shard=i/N, sequential, or parallel when FINAL_TIP_PARALLEL=1; counts aggregated.
#   FINAL_TIP_WORKERS=2        vitest --maxWorkers per process (default 2).
set -u
TIP=$UCT_WORKTREES/$1; O=$UCT_RESUME/runs/$2; shift 2
mkdir -p $O; cd $TIP
strip() { tr '\r' '\n' < "$1" | sed -e 's/\x1b\[[0-9;]*m//g'; }
DIRTY=$(git status --porcelain | grep -v -F '.uct-session-owner')
if [ -n "$DIRTY" ]; then echo "final-tip: REFUSED, tracked changes or untracked files in $TIP:"; echo "$DIRTY" | head -10; exit 5; fi
SHA=$(git rev-parse HEAD); rm -f $O/TIP $O/FINAL_DONE
echo "TIP $SHA $(date +%T)" | tee $O/TIP
PY_RC=NA; SCOPE=${FINAL_TIP_SCOPE:-full}; WK=${FINAL_TIP_WORKERS:-2}; N=${FINAL_TIP_SHARDS:-1}
echo "== gate pytest"; python -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py -q > $O/gate.log 2>&1; GATE_RC=$?; echo "gate rc=$GATE_RC"; tail -2 $O/gate.log
python tools/check_repo_hygiene.py > $O/hyg.log 2>&1; HYG_RC=$?; echo "hygiene rc=$HYG_RC"; tail -2 $O/hyg.log
if [ $# -gt 0 ]; then echo "== rails pytest $*"; python -m pytest -q -p no:warnings "$@" > $O/py.log 2>&1; PY_RC=$?; echo "py rc=$PY_RC"; grep -E "^FAILED|^ERROR|passed|failed" $O/py.log | tail -12; fi
cd app
VT="node node_modules/vitest/vitest.mjs run"; OPTS="--maxWorkers=$WK --testTimeout=300000"
JS_RC=0; SHARD_RCS=""; TOTALS=ok; REPORTED=0
has_totals() { strip "$1" | grep -a -q -E '^ *Tests +[0-9]'; }
if [ "$SCOPE" = affected ]; then
  B=${FINAL_TIP_BASE:-$(git merge-base HEAD origin/master)}
  echo "== AFFECTED vitest --changed $B + rails '${FINAL_TIP_RAILS:-}' $(date +%T)"
  $VT --changed $B --passWithNoTests $OPTS > $O/js.log 2>&1; r=$?; echo "js(changed) rc=$r"; [ $r -gt $JS_RC ] && JS_RC=$r
  if [ -n "${FINAL_TIP_RAILS:-}" ]; then $VT $FINAL_TIP_RAILS $OPTS > $O/js-rails.log 2>&1; r=$?; echo "js(rails) rc=$r"; [ $r -gt $JS_RC ] && JS_RC=$r; cat $O/js-rails.log >> $O/js.log; fi
  TOTALS=na
elif [ "$N" -gt 1 ]; then
  echo "== full vitest chart+hooks, $N shards, parallel=${FINAL_TIP_PARALLEL:-0} $(date +%T)"
  pids=""
  for i in $(seq 1 $N); do
    if [ "${FINAL_TIP_PARALLEL:-0}" = 1 ]; then
      $VT src/components/chart src/hooks $OPTS --shard=$i/$N > $O/js-shard$i.log 2>&1 &
      pids="$pids $i:$!"
    else
      $VT src/components/chart src/hooks $OPTS --shard=$i/$N > $O/js-shard$i.log 2>&1; r=$?; echo "shard $i/$N rc=$r"; SHARD_RCS="$SHARD_RCS,$r"
    fi
  done
  for pp in $pids; do wait ${pp#*:}; r=$?; echo "shard ${pp%%:*}/$N rc=$r"; SHARD_RCS="$SHARD_RCS,$r"; done
  SHARD_RCS=${SHARD_RCS#,}
  : > $O/js.log
  for i in $(seq 1 $N); do
    cat $O/js-shard$i.log >> $O/js.log
    if has_totals $O/js-shard$i.log; then REPORTED=$((REPORTED+1)); else echo "final-tip: shard $i/$N reported NO totals"; fi
  done
  for r in ${SHARD_RCS//,/ }; do [ "$r" -gt "$JS_RC" ] && JS_RC=$r; done
  [ "$REPORTED" = "$N" ] || TOTALS=missing
  # aggregate: sum "Test Files" / "Tests" counts across shards
  for i in $(seq 1 $N); do strip $O/js-shard$i.log; done | python -c '
import re,sys,collections
t=collections.Counter()
for l in sys.stdin:
    m=re.match(r"\s*(Test Files|Tests)\s+(.*)",l)
    if m:
        for c,w in re.findall(r"(\d+) (passed|failed|skipped|todo)",m.group(2)): t[(m.group(1),w)]+=int(c)
for k in ("Test Files","Tests"): print("AGG %-10s %s"%(k," | ".join("%d %s"%(t[(k,w)],w) for w in ("failed","passed","skipped","todo") if t[(k,w)])))
'
  [ "$TOTALS" = ok ] || echo "AGG INCOMPLETE: $REPORTED of $N shards reported totals"
else
  echo "== full vitest chart+hooks $(date +%T)"
  $VT src/components/chart src/hooks $OPTS > $O/js.log 2>&1; JS_RC=$?; echo "js rc=$JS_RC"
  has_totals $O/js.log || { TOTALS=missing; echo "final-tip: vitest reported NO totals"; }
fi
strip $O/js.log | grep -a -E "^ *(Test Files|Tests) |^ *FAIL |✗|×" | sort -u | tail -40
JSFAIL=$(strip $O/js.log | grep -a -E '^ *FAIL +' | sed -E 's/^ *FAIL +([^ >]+).*/\1/' | sort -u | sed -E 's#.*/##' | paste -sd, -)
cd "$TIP"
INTEG=ok
[ "$(git rev-parse HEAD)" = "$SHA" ] || INTEG="HEAD-moved-to-$(git rev-parse HEAD)"
[ -z "$(git status --porcelain | grep -v -F '.uct-session-owner')" ] || INTEG="tree-changed-during-run"
{ echo "TIP $SHA done"; echo "scope=$SCOPE shards=$N parallel=${FINAL_TIP_PARALLEL:-0}"
  echo "rc gate=$GATE_RC hyg=$HYG_RC py=$PY_RC js=$JS_RC"; echo "shard_rcs=${SHARD_RCS:-na}"; echo "totals=$TOTALS"
  echo "jsfail=${JSFAIL:-none}"; echo "integrity=$INTEG"; } > $O/FINAL_DONE
tail -n +2 $O/FINAL_DONE
date +%T; echo FINAL_DONE
[ "$INTEG" = ok ] && [ "$TOTALS" != missing ] || { echo "final-tip: INCOMPLETE (integrity=$INTEG totals=$TOTALS)"; exit 6; }
