#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage: final-tip.sh <worktree-name> <outdir-label> [extra pytest files...]
# Runs under ONE heavy-lock hold: deploy-gate pytest + hygiene, extra pytest rails, full chart+hooks vitest (--maxWorkers=2).
set -u
TIP=$UCT_WORKTREES/$1; O=$UCT_RESUME/runs/$2; shift 2
mkdir -p $O; cd $TIP
strip() { tr '\r' '\n' < "$1" | sed -e 's/\x1b\[[0-9;]*m//g'; }
echo "TIP $(git rev-parse HEAD) $(date +%T)"; git status --short | head -5
echo "== gate pytest"; python -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py -q > $O/gate.log 2>&1; echo "gate rc=$?"; tail -2 $O/gate.log
python tools/check_repo_hygiene.py > $O/hyg.log 2>&1; echo "hygiene rc=$?"; tail -2 $O/hyg.log
if [ $# -gt 0 ]; then echo "== rails pytest $*"; python -m pytest -q -p no:warnings "$@" > $O/py.log 2>&1; echo "py rc=$?"; grep -E "^FAILED|^ERROR|passed|failed" $O/py.log | tail -12; fi
echo "== full vitest chart+hooks $(date +%T)"; cd app
node node_modules/vitest/vitest.mjs run src/components/chart src/hooks --maxWorkers=2 --testTimeout=300000 > $O/js.log 2>&1; echo "js rc=$?"
strip $O/js.log | grep -a -E "^ *(Test Files|Tests) |^ *FAIL |✗|×" | sort -u | tail -40
date +%T; echo FINAL_DONE
