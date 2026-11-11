#!/usr/bin/env bash
# W4 T0 measurement job (laptop): ONE heavy job. Instrument A/B on the same tree and sample:
#   after  = the committed tooling at HEAD;  before = origin/master's census test + coverage_map.py
set -u
source C:/Users/Patrick/uct-worktrees/pine-handoff-dsk/docs/pine/parity-programme/scripts/env-desktop.sh
O=$UCT_RESUME/runs/w0peel; WT=$UCT_WORKTREES/pine-dsk-w4t0
REF=$UCT_RESUME/runs/C/ref_rebuilt.json
T=src/components/chart/engine/ast; CT=$T/coverageMapDoorCensus.measure.test.js; BT=$T/coverageMapDoorCensusBefore.measure.test.js
H=src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
cd $WT
echo "START $(date +%T) HEAD=$(git rev-parse --short=10 HEAD) freeRAM=$(freeram)MB"
git show HEAD:docs/pine/coverage-map.json > $O/coverage-map-2026-11-02.json
# restore the temp files whatever happens
trap 'rm -f $WT/app/$BT $WT/tools/pine_coverage/coverage_map_before.py' EXIT
for L in after-prod after-rt before-prod before-rt; do rm -rf $O/$L; mkdir -p $O/$L; cp -r $UCT_RESUME/pine-sample/. $O/$L/; done
echo "== harness prod $(date +%T)"
cd $WT/app && VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-prod node node_modules/vitest/vitest.mjs run $H --maxWorkers=2 > $O/harness-prod.log 2>&1; echo "harness-prod rc=$?"; grep -a -E "^TOTAL" $O/harness-prod.log
echo "== harness rt $(date +%T)"
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-rt node node_modules/vitest/vitest.mjs run $H --maxWorkers=2 > $O/harness-rt.log 2>&1; echo "harness-rt rc=$?"; grep -a -E "^TOTAL" $O/harness-rt.log
cd $WT
echo "== engine-door probe $(date +%T)"
cd app && COVERAGE_DOOR_OUT=$O/engine_door.json node node_modules/vitest/vitest.mjs run $CT --maxWorkers=2 > $O/engine-door.log 2>&1; echo "engine-door rc=$?"; ls -la $O/engine_door.json; cd $WT
echo "== census after-prod $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --cache $O/after-prod --ref $REF > $O/after-prod.log 2>&1; echo "after-prod rc=$?"; tail -2 $O/after-prod.log
echo "== census after-rt $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --runtime-on --cache $O/after-rt --ref $REF > $O/after-rt.log 2>&1; echo "after-rt rc=$?"; tail -2 $O/after-rt.log
# BEFORE: origin/master's census test, beside the new one
git show origin/master:app/$CT > app/$BT
git show origin/master:tools/pine_coverage/coverage_map.py > tools/pine_coverage/coverage_map_before.py
echo "== census before-prod $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --census-test $BT --cache $O/before-prod --ref $REF > $O/before-prod.log 2>&1; echo "before-prod rc=$?"; tail -2 $O/before-prod.log
echo "== census before-rt $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --census-test $BT --runtime-on --cache $O/before-rt --ref $REF > $O/before-rt.log 2>&1; echo "before-rt rc=$?"; tail -2 $O/before-rt.log
echo "== maps $(date +%T)"
SHA=$(git rev-parse --short=10 origin/master)
"$UCT_PY" tools/pine_coverage/coverage_map.py --cache $O/after-prod --ref $REF --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/after-rt --runtime-verdicts $O/verdicts-rt/verdicts.json --engine-door $O/engine_door.json --out $O/after-map.json --measured-on 2026-11-03 --master-sha $SHA > $O/map-after.log 2>&1; echo "map-after rc=$?"; tail -3 $O/map-after.log
"$UCT_PY" tools/pine_coverage/coverage_map_before.py --cache $O/before-prod --ref $REF --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/before-rt --runtime-verdicts $O/verdicts-rt/verdicts.json --engine-door $O/engine_door.json --out $O/before-map.json --measured-on 2026-11-03 --master-sha $SHA > $O/map-before.log 2>&1; echo "map-before rc=$?"; tail -3 $O/map-before.log
echo "== targets + tables $(date +%T)"
"$UCT_PY" tools/pine_coverage/w0/targets.py --map $O/after-map.json --census-input $O/after-prod/census_input.json --ref $REF --out $O/coverage-targets-2026-11-03.json --old-map $O/coverage-map-2026-11-02.json > $O/targets.log 2>&1; echo "targets rc=$?"; tail -8 $O/targets.log
"$UCT_PY" tools/pine_coverage/w0/gen_md.py --map $O/after-map.json --old-map $O/coverage-map-2026-11-02.json --targets $O/coverage-targets-2026-11-03.json --out $O/tables.md > $O/gen_md.log 2>&1; echo "gen_md rc=$?"; tail -2 $O/gen_md.log
echo "== gates $(date +%T)"
"$UCT_PY" -m pytest tests/test_pine_coverage_w4_t0_honesty.py tests/test_pine_coverage_conditional_ta.py tests/test_pine_runtime_switch_on.py -q -p no:cacheprovider > $O/pytest-pine.log 2>&1; echo "PYTEST-PINE rc=$?"; tail -2 $O/pytest-pine.log
"$UCT_PY" -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py tests/test_script_engine_version_gate.py -q -p no:cacheprovider > $O/gates.log 2>&1; echo "GATES rc=$?"; tail -2 $O/gates.log
cd app && node node_modules/vitest/vitest.mjs run $CT --maxWorkers=2 > $O/rails.log 2>&1; echo "RAILS rc=$?"; grep -a -E "Tests|Test Files" $O/rails.log; cd $WT
"$UCT_PY" tools/check_repo_hygiene.py > $O/hyg.log 2>&1; echo "HYG rc=$?"; tail -3 $O/hyg.log
git status --short | head -5; echo "DONE $(date +%T)"; echo W0PEEL_JOB_DONE
