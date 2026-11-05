#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage: final-tip.sh <worktree-name> <outdir-label> [extra pytest files...]
# Runs under ONE heavy-lock hold: deploy-gate pytest + hygiene, extra pytest rails, full chart+hooks vitest (--maxWorkers=2).
# Refuses a tree with tracked changes (rc 5). Writes "TIP <sha> <time>" to <outdir>/TIP at start and FINAL_DONE at the end;
# scripts/ready-check.sh reads both. Optional env (OPS-SPEED.md):
#   FINAL_TIP_SCOPE=affected   vitest `--changed <FINAL_TIP_BASE>` (default base: merge-base HEAD origin/master) plus
#                              FINAL_TIP_RAILS (space-separated vitest paths, relative to app/) instead of the full run.
#   FINAL_TIP_SHARDS=N         full run as vitest --shard=i/N, sequential, or parallel when FINAL_TIP_PARALLEL=1; counts aggregated.
#   FINAL_TIP_WORKERS=2        vitest --maxWorkers per process (default 2).
set -u
TIP=$UCT_WORKTREES/$1; O=$UCT_RESUME/runs/$2; shift 2
mkdir -p $O; cd $TIP
strip() { tr '\r' '\n' < "$1" | sed -e 's/\x1b\[[0-9;]*m//g'; }
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then echo "final-tip: REFUSED, tracked changes in $TIP:"; echo "$DIRTY" | head -10; exit 5; fi
SHA=$(git rev-parse HEAD); rm -f $O/TIP $O/FINAL_DONE
echo "TIP $SHA $(date +%T)" | tee $O/TIP
SCOPE=${FINAL_TIP_SCOPE:-full}; WK=${FINAL_TIP_WORKERS:-2}; N=${FINAL_TIP_SHARDS:-1}
echo "== gate pytest"; python -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py -q > $O/gate.log 2>&1; echo "gate rc=$?"; tail -2 $O/gate.log
python tools/check_repo_hygiene.py > $O/hyg.log 2>&1; echo "hygiene rc=$?"; tail -2 $O/hyg.log
if [ $# -gt 0 ]; then echo "== rails pytest $*"; python -m pytest -q -p no:warnings "$@" > $O/py.log 2>&1; echo "py rc=$?"; grep -E "^FAILED|^ERROR|passed|failed" $O/py.log | tail -12; fi
cd app
VT="node node_modules/vitest/vitest.mjs run"; OPTS="--maxWorkers=$WK --testTimeout=300000"
if [ "$SCOPE" = affected ]; then
  B=${FINAL_TIP_BASE:-$(git merge-base HEAD origin/master)}
  echo "== AFFECTED vitest --changed $B + rails '${FINAL_TIP_RAILS:-}' $(date +%T)"
  $VT --changed $B --passWithNoTests $OPTS > $O/js.log 2>&1; echo "js(changed) rc=$?"
  if [ -n "${FINAL_TIP_RAILS:-}" ]; then $VT $FINAL_TIP_RAILS $OPTS > $O/js-rails.log 2>&1; echo "js(rails) rc=$?"; cat $O/js-rails.log >> $O/js.log; fi
elif [ "$N" -gt 1 ]; then
  echo "== full vitest chart+hooks, $N shards, parallel=${FINAL_TIP_PARALLEL:-0} $(date +%T)"
  pids=""
  for i in $(seq 1 $N); do
    if [ "${FINAL_TIP_PARALLEL:-0}" = 1 ]; then
      $VT src/components/chart src/hooks $OPTS --shard=$i/$N > $O/js-shard$i.log 2>&1 &
      pids="$pids $!"
    else
      $VT src/components/chart src/hooks $OPTS --shard=$i/$N > $O/js-shard$i.log 2>&1; echo "shard $i/$N rc=$?"
    fi
  done
  for p in $pids; do wait $p; echo "shard pid $p rc=$?"; done
  : > $O/js.log; for i in $(seq 1 $N); do cat $O/js-shard$i.log >> $O/js.log; done
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
else
  echo "== full vitest chart+hooks $(date +%T)"
  $VT src/components/chart src/hooks $OPTS > $O/js.log 2>&1; echo "js rc=$?"
fi
strip $O/js.log | grep -a -E "^ *(Test Files|Tests) |^ *FAIL |✗|×" | sort -u | tail -40
date +%T; echo "TIP $SHA done scope=$SCOPE shards=$N" > $O/FINAL_DONE; echo FINAL_DONE
