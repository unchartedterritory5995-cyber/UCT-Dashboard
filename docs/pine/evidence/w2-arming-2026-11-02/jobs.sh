#!/bin/bash
# W2 arming measurements, each through the heavy lock, sequentially.
S=${S:?set S to a scratch dir}
L="python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --timeout 14400"
cd /c/Users/Patrick/uct-worktrees/pine-w2/app
echo "== J2 vitest rails $(date)"
$L --label w2-vitest-rails -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/runtime/__tests__/runtimeStringMemory.test.js \
  src/components/chart/engine/runtime/__tests__/runtimePaneSafety.test.jsx \
  src/components/chart/engine/__tests__/runtimeKillSwitch.test.js \
  src/components/chart/engine/__tests__/runtimeSwitchOn.test.js \
  src/lib/runtimePaneRevocation.test.js \
  src/components/chart/engine/__tests__/runtimeRunGate.test.js \
  src/components/chart/engine/runtime/__tests__/runtimeStopBeacon.test.js \
  src/components/chart/engine/runtime/__tests__/graphRuntimeDifferential.test.js \
  --maxWorkers=2 > $S/j2-vitest.log 2>&1; echo "J2 exit $?"
echo "== J3a harness runtime-on $(date)"
mkdir -p $S/harness-on $S/harness-prod
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$S/harness-on VENDOR_HARNESS_RUNTIME_ON=1 \
  $L --label w2-harness-runtime-on -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > $S/j3a.log 2>&1; echo "J3a exit $?"
echo "== J3b harness production $(date)"
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$S/harness-prod VENDOR_HARNESS_RUNTIME_ON=0 \
  $L --label w2-harness-prod -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2 > $S/j3b.log 2>&1; echo "J3b exit $?"
echo "== J4 readiness census $(date)"
RF_READINESS=1 RF_READINESS_OUT=$S/readiness.json RF_DEFS_OUT=$S/rf-defs.json \
  $L --label w2-rf-readiness -- node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
  src/components/chart/engine/__tests__/vendorHarness/runtimePaneReadiness.measure.test.js > $S/j4.log 2>&1; echo "J4 exit $?"
echo "== J5 vite build $(date)"
$L --label w2-vite-build -- node node_modules/vite/bin/vite.js build --outDir $S/dist > $S/j5.log 2>&1; echo "J5 exit $?"
echo "== done $(date)"
