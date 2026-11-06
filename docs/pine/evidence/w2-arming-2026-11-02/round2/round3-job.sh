#!/bin/bash
# W2 round 2b: ONE heavy job (run under hl). Step 1: re-run the 25 P11 failing files alone on branch and pine-base (master).
# Step 2: merge origin/production into the branch. Step 3: re-run the rails + J3a/J3b on the merged tree.
source /c/Users/pgosz/uct-worktrees/pine-handoff/docs/pine/parity-programme/scripts/env-laptop.sh
R=/c/Users/pgosz/uct-worktrees/_resume-laptop/runs/w2/round2
RW=$(cygpath -m "$R")
SP=/c/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/af33efb6-d49a-4904-bfb1-ae2325322678/scratchpad
W=/c/Users/pgosz/uct-worktrees/pine-w2
P=$R/p11-rerun; M=$R/merged; mkdir -p $P $M $M/harness-on $M/harness-prod
ST=$R/status3.txt; : > $ST
st() { echo "$(date +%T) $*" | tee -a "$ST"; }
: > $P/results.txt
for side in branch base; do
  if [ $side = branch ]; then T=$W; else T=/c/Users/pgosz/uct-worktrees/pine-base; fi
  st "P11 rerun $side tree $(git -C $T rev-parse HEAD) dirty=$(git -C $T status --porcelain | wc -l) free RAM $(freeram) MB"
  cd $T/app
  for f in $(cat $SP/p11-files2.txt); do
    n=$(echo $f | tr '/' '_')
    node node_modules/vitest/vitest.mjs run $f --maxWorkers=2 > $P/$side.$n.log 2>&1
    echo "$side $? $f" | tee -a $P/results.txt
  done
done
st "P11 rerun done"
cd $W
st "merge origin/production $(git rev-parse origin/production)"
git merge --no-edit -m "Merge origin/production ($(git rev-parse --short=10 origin/production)) into feat/pine-w2-arming

Re-pin for the W2 arming packet: the rails and the harness are re-run on this tree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLUzavr5VFBN7yU8q7DEpZ" origin/production > $M/merge.log 2>&1
st "merge exit $? tree $(git rev-parse HEAD) dirty=[$(git status --porcelain | wc -l)]"
P1=src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js
E=src/components/chart/engine/runtime/__tests__
cd "$W/app"
st "A vitest"
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
st "B J3a harness runtime-on"
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT="$RW/merged/harness-on" VENDOR_HARNESS_RUNTIME_ON=1 \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > "$M/j3a.log" 2>&1
st "B J3a exit $?"
st "B J3b harness production"
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT="$RW/merged/harness-prod" VENDOR_HARNESS_RUNTIME_ON=0 \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > "$M/j3b.log" 2>&1
st "B J3b exit $?"
cd "$W"
st "C pytest rails"
PYTHONPATH="$RW/pydeps" "$UCT_PY" -m pytest tests/test_pine_runtime_shared_stamp.py tests/test_pine_runtime_stop_telemetry.py \
  tests/test_pine_runtime_switch_on.py tests/test_runtime_definitions.py tests/test_runtime_document_round_trip.py \
  tests/test_runtime_repaint.py tests/test_rollout.py -v -p no:cacheprovider > "$M/pytest-rails.log" 2>&1
st "C exit $?"
st "D deploy gate + census detector pytest"
PYTHONPATH="$RW/pydeps" "$UCT_PY" -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py \
  tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py tests/test_script_engine_version_gate.py \
  tests/test_pine_coverage_conditional_ta.py -v -p no:cacheprovider > "$M/deploy-gate.log" 2>&1
st "D exit $?"
st "end tree $(git rev-parse HEAD) dirty=[$(git status --porcelain | tr '\n' ';')]"
st "ALLDONE"
