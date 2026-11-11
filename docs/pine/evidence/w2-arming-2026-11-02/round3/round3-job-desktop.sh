#!/bin/bash
source /c/Users/Patrick/uct-worktrees/pine-handoff-dsk/docs/pine/parity-programme/scripts/env-desktop.sh
S=/c/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/w2r3
W=/c/Users/Patrick/uct-worktrees/pine-dsk-w2
LIST=$W/docs/pine/evidence/w2-arming-2026-11-02/round2/p11-failing-files.txt
P=$S/p11; M=$S/merged; mkdir -p $P $M/harness-on $M/harness-prod
ST=$S/status.txt; : > $ST; st() { echo "$(date +%T) $*" | tee -a $ST; }
: > $P/results.txt
for side in branch:$W master:/c/Users/Patrick/uct-worktrees/pine-dsk-w2-mst mb:/c/Users/Patrick/uct-worktrees/pine-dsk-w2-mb; do
  nm=${side%%:*}; T=${side#*:}
  st "P11 $nm $(git -C $T rev-parse HEAD) dirty=$(git -C $T status --porcelain | wc -l)"
  cd $T/app
  for f in $(tr -d '\r' < $LIST); do
    n=$(echo $f | tr '/' '_')
    node node_modules/vitest/vitest.mjs run $f --maxWorkers=2 > $P/$nm.$n.log 2>&1
    echo "$nm $? $f" | tee -a $P/results.txt
  done
done
st "P11 done"
G=/c/Users/Patrick/uct-worktrees/pine-dsk-w2-mrg; cd $G/app
RW=$(cygpath -m $S)
P1=src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js
E=src/components/chart/engine/runtime/__tests__
st "A vitest merged $(git -C $G rev-parse HEAD)"
node node_modules/vitest/vitest.mjs run $P1 \
  $E/runtimeStringMemory.test.js $E/runtimePaneSafety.test.jsx \
  src/components/chart/engine/__tests__/runtimeKillSwitch.test.js src/components/chart/engine/__tests__/runtimeSwitchOn.test.js \
  src/lib/runtimePaneRevocation.test.js src/components/chart/engine/__tests__/runtimeRunGate.test.js \
  $E/runtimeStopBeacon.test.js $E/graphRuntimeDifferential.test.js \
  $E/conditionalCallSite.test.js $E/conditionalArmsParams.test.js $E/conditionalReviewFollowups.test.js \
  $E/loops.test.js $E/c18WhileAndLastBar.test.js $E/arrays.test.js $E/carriedState.test.js $E/declarationPersistence.test.js \
  $E/elseIfChain.test.js $E/elseGuardShape.test.js $E/blockValuedBinding.test.js \
  $E/functionBodyBlockValue.test.js $E/functionGlobalReads.test.js $E/callForEffect.test.js \
  src/components/chart/engine/ast/listingSeed.test.js \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h4Loops.test.js \
  $E/w1BareConditionalHistory.test.js src/components/chart/builder/memberPane/memberPaneDefinition.test.js \
  --maxWorkers=2 > "$M/vitest.log" 2>&1
st "A exit $?"
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT="$RW/merged/harness-on" VENDOR_HARNESS_RUNTIME_ON=1 \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > "$M/j3a.log" 2>&1
st "J3a exit $?"
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT="$RW/merged/harness-prod" VENDOR_HARNESS_RUNTIME_ON=0 \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > "$M/j3b.log" 2>&1
st "J3b exit $?"
cd $G
"$UCT_PY" -m pytest tests/test_pine_runtime_shared_stamp.py tests/test_pine_runtime_stop_telemetry.py \
  tests/test_pine_runtime_switch_on.py tests/test_runtime_definitions.py tests/test_runtime_document_round_trip.py \
  tests/test_runtime_repaint.py tests/test_rollout.py -v -p no:cacheprovider > "$M/pytest-rails.log" 2>&1
st "C pytest exit $?"
"$UCT_PY" -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py \
  tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py tests/test_script_engine_version_gate.py \
  tests/test_pine_coverage_conditional_ta.py -v -p no:cacheprovider > "$M/deploy-gate.log" 2>&1
st "D deploy gate exit $?"
st ALLDONE
