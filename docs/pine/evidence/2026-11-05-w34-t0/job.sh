#!/usr/bin/env bash
# W3W4-T0 measurement job: ONE heavy job. Fresh harness + census (both lanes) on this tree, then the map by the
# OLD walls_of (origin/master coverage_map.py) and the NEW one over the SAME census rows.
set -u
export H=C:/Users/Patrick/uct-worktrees/pine-handoff-dsk-ops; source $H/docs/pine/parity-programme/scripts/env-desktop.sh
source C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/node20.sh
O=$UCT_RESUME/runs/w34-t0; WT=$UCT_WORKTREES/pine-dsk-w34t0
REF=$UCT_RESUME/runs/C/ref_rebuilt.json
CT=src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js
HT=src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
cd $WT
echo "START $(date +%T) HEAD=$(git rev-parse --short=10 HEAD) freeRAM=$(freeram)MB"
for L in prod rt; do rm -rf $O/$L; mkdir -p $O/$L; cp -r $UCT_RESUME/pine-sample/. $O/$L/; done
cd $WT/app
echo "== harness prod $(date +%T)"
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-prod node node_modules/vitest/vitest.mjs run $HT --maxWorkers=2 > $O/harness-prod.log 2>&1; echo "harness-prod rc=$?"
echo "== harness rt $(date +%T)"
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-rt node node_modules/vitest/vitest.mjs run $HT --maxWorkers=2 > $O/harness-rt.log 2>&1; echo "harness-rt rc=$?"
echo "== engine-door $(date +%T)"
COVERAGE_DOOR_OUT=$O/engine_door.json node node_modules/vitest/vitest.mjs run $CT --maxWorkers=2 > $O/engine-door.log 2>&1; echo "engine-door rc=$?"
cd $WT
echo "== census prod $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --cache $O/prod --ref $REF > $O/census-prod.log 2>&1; echo "census-prod rc=$?"
echo "== census rt $(date +%T)"
"$UCT_PY" tools/pine_coverage/run_census.py --runtime-on --cache $O/rt --ref $REF > $O/census-rt.log 2>&1; echo "census-rt rc=$?"
SHA=$(git rev-parse --short=10 origin/master)
git show HEAD~1:tools/pine_coverage/coverage_map.py > tools/pine_coverage/coverage_map_before.py
trap 'rm -f $WT/tools/pine_coverage/coverage_map_before.py' EXIT
ARGS="--cache $O/prod --ref $REF --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/rt --runtime-verdicts $O/verdicts-rt/verdicts.json --engine-door $O/engine_door.json --measured-on 2026-11-05 --master-sha $SHA"
echo "== maps $(date +%T)"
"$UCT_PY" tools/pine_coverage/coverage_map.py $ARGS --out $O/after-map.json > $O/map-after.log 2>&1; echo "map-after rc=$?"
"$UCT_PY" tools/pine_coverage/coverage_map_before.py $ARGS --out $O/before-map.json > $O/map-before.log 2>&1; echo "map-before rc=$?"
echo "== targets + detail $(date +%T)"
"$UCT_PY" tools/pine_coverage/w0/targets.py --map $O/after-map.json --census-input $O/prod/census_input.json --ref $REF --out $O/coverage-targets-2026-11-05.json --old-map $O/before-map.json > $O/targets.log 2>&1; echo "targets rc=$?"
"$UCT_PY" tools/pine_coverage/wall_detail.py --cache $O/prod --runtime-cache $O/rt --out $O/wall-detail-2026-11-05.json --measured-on 2026-11-05 --master-sha $SHA > $O/detail.log 2>&1; echo "detail rc=$?"
echo "DONE $(date +%T)"; echo W34T0_JOB_DONE
