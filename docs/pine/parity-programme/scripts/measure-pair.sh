#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage (under ONE heavy-lock hold): measure-pair.sh <outdir> <tipName>:<tipWorktree> <baseName>:<baseWorktree> [runtime_on 0|1] [census 0|1]
# Per side: C18 corpus audit, C18 constructed probes, reviewer probes1-6 (if REV_DIR set), runtime/production census (optional), vendor harness.
set -u
O=$1; shift; RT=${3:-1}; CEN=${4:-1}
R=$UCT_RESUME; A=${AUDIT_SRC:-$(cd "$(dirname "$0")/../audit" && pwd)}; mkdir -p $O
for pair in "$1" "$2"; do
  n=${pair%%:*}; W=${pair#*:}; T=$W/app/src/components/chart/engine/__tests__
  echo "== side $n $(git -C $W rev-parse --short=10 HEAD) $(date +%T)"
  cp ${AUDIT_FILE:-$A/zzAuditC18.measure.test.js} $T/zzMPAudit.measure.test.js; cp $A/zzAuditC18Probe.measure.test.js $T/zzMPProbe.measure.test.js
  [ -n "${REV_DIR:-}" ] && cp $REV_DIR/zzRevWsa3.measure.test.js $T/zzMPRev.measure.test.js
  cd $W/app
  AUDIT_C18_OUT=$O/out-$n.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPAudit.measure.test.js > $O/log-$n.txt 2>&1; echo "audit $n rc=$?"
  AUDIT_C18_PROBE_OUT=$O/probe-$n.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPProbe.measure.test.js > $O/plog-$n.txt 2>&1; echo "probe $n rc=$?"
  if [ -n "${REV_DIR:-}" ]; then for pf in probes probes2 probes3 probes4 probes5 probes6; do
    REV_PROBES=$REV_DIR/$pf.json REV_OUT=$O/rev-$n-$pf.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPRev.measure.test.js > $O/rlog-$n-$pf.txt 2>&1; echo "rev $n $pf rc=$?"; done; fi
  rm -f $T/zzMPAudit.measure.test.js $T/zzMPProbe.measure.test.js $T/zzMPRev.measure.test.js
  if [ "$CEN" = 1 ]; then
    mkdir -p $O/$n/census; cp -r $R/pine-sample/. $O/$n/census/
    flag=""; [ "$RT" = 1 ] && flag=--runtime-on
    cd $W && python tools/pine_coverage/run_census.py $flag --cache $O/$n/census --ref $R/runs/C/ref_rebuilt.json > $O/$n/census.log 2>&1; echo "census $n rc=$?"; tail -2 $O/$n/census.log
  fi
  cd $W/app && VENDOR_HARNESS_RUNTIME_ON=$RT VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/harness-$n node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js > $O/hlog-$n.txt 2>&1; echo "harness $n rc=$?"; grep -a -E "^TOTAL" $O/hlog-$n.txt
  git -C $W status --short | head -3
done
date +%T; echo MEASURE_DONE
