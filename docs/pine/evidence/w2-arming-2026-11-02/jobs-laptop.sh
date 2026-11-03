#!/bin/bash
# W2 arming measurements, the laptop version of jobs.sh (adapted to env-laptop.sh).
# Every job is one process under the machine-wide heavy lock (hl), one at a time; waiting for
# the lock is normal. These are the commands that produced the evidence in this directory.
#
#   S=/c/Users/pgosz/uct-worktrees/_resume-laptop/runs/w2 bash docs/pine/evidence/w2-arming-2026-11-02/jobs-laptop.sh
#
# Logs go to $S. The committed copies in this directory are trimmed of colour codes.
#
# What the run actually did differently from this list (the commands are the same, the plumbing is not):
#  - steps 4 to 6 were launched from a small driver, each through a three-line wrapper; the build wrapper refuses to start
#    below 1,800 MB of free RAM (exit 75) and the driver retried it every five minutes;
#  - the census (step 4) ran twice: the first attempt failed on its own assertion and wrote nothing (census-first-run.log),
#    the instrument was fixed (commit 4a884aff97), the second attempt passed (census-run.log);
#  - the two probes (step 6) were queued as two separate lock waiters, so that the lock race had more than one waiter of ours;
#  - the pytest rails (step 3) never got the lock on the first-merge tree; they ran for the first time on the final tree,
#    inside final-job.sh (one lock hold: the parity rail, J2 and the lane rails in one vitest run, the pytest rails,
#    the deploy-gate and census-detector pytest, then the two harness runs of jobs.sh J3a and J3b).
source /c/Users/pgosz/uct-worktrees/pine-handoff/docs/pine/parity-programme/scripts/env-laptop.sh
S=${S:?set S to a scratch dir (a bash path)}
SW=$(cygpath -m "$S")                       # the same directory as C:/... for native programs
W=${W:-/c/Users/pgosz/uct-worktrees/pine-w2}
MUT=/c/Users/pgosz/uct-worktrees/pine-handoff/docs/pine/parity-programme/scripts/mutate.py
PARITY=src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js
R=src/components/chart/engine/runtime/__tests__
mkdir -p "$S"
cd "$W/app" || exit 90

echo "== 1. the allowlist re-grade rail (the committed list latched, not allow-every)"
hl w2-allowlist-parity -- node node_modules/vitest/vitest.mjs run $PARITY --maxWorkers=2 > "$S/parity.log" 2>&1

echo "== 1b. its mutation proof: (a) latch [] instead of listedHashes, (b) break the latch line in runtimeNotGradedOf, (c) normaliseAllowList drops every entry"
cat > "$S/muts-parity.json" <<'JSON'
[
  ["a-latch-empty-list-instead-of-listedHashes", "src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js",
   "setRuntimeAllowList(listedHashes)", "setRuntimeAllowList([])"],
  ["b-break-allowlist-latch-line-in-runtimeNotGradedOf", "src/components/chart/engine/runtimeKill.js",
   "if (h && _allow.some((e) => h.startsWith(e))) return null", "if (h) return null"],
  ["c-normaliseAllowList-drops-every-entry", "src/components/chart/engine/runtimeKill.js",
   "if (HASH_RE.test(v)) out.push(v)", "if (false && HASH_RE.test(v)) out.push(v)"]
]
JSON
hl w2-allowlist-mutations -- "$UCT_PY" $MUT "$S/muts-parity.json" $PARITY > "$S/parity-mutations.log" 2>&1
# afterwards: the CR-stripped sha256 of each mutated file must equal that of `git cat-file blob HEAD:<path>`

echo "== 2. the J2 vitest rails (S2, S3, S5, S6, S8 client, P2)"
hl w2-j2-vitest -- node node_modules/vitest/vitest.mjs run \
  $R/runtimeStringMemory.test.js $R/runtimePaneSafety.test.jsx \
  src/components/chart/engine/__tests__/runtimeKillSwitch.test.js src/components/chart/engine/__tests__/runtimeSwitchOn.test.js \
  src/lib/runtimePaneRevocation.test.js src/components/chart/engine/__tests__/runtimeRunGate.test.js \
  $R/runtimeStopBeacon.test.js $R/graphRuntimeDifferential.test.js --maxWorkers=2 > "$S/j2-vitest.log" 2>&1

echo "== 3. the python rails (S4, S5, S6 server, S7, S8 server, the cohort stage, R1)"
cd "$W"
hl w2-pytest-rails -- "$UCT_PY" -m pytest tests/test_pine_runtime_shared_stamp.py tests/test_pine_runtime_stop_telemetry.py \
  tests/test_pine_runtime_switch_on.py tests/test_runtime_definitions.py tests/test_runtime_document_round_trip.py \
  tests/test_runtime_repaint.py tests/test_rollout.py -q -p no:cacheprovider > "$S/pytest-rails.log" 2>&1
cd "$W/app"

echo "== 4. J4: the readiness census (writes readiness.json and rf-defs.json)"
export RF_READINESS=1 RF_READINESS_OUT="$SW/readiness.json" RF_DEFS_OUT="$SW/rf-defs.json"
hl w2-rf-readiness -- node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
  src/components/chart/engine/__tests__/vendorHarness/runtimePaneReadiness.measure.test.js > "$S/j4-census.log" 2>&1
unset RF_READINESS RF_READINESS_OUT RF_DEFS_OUT

echo "== 5. J5: the vite build (the heaviest job; check free RAM first)"
echo "free RAM: $(freeram) MB"
hl w2-vite-build -- node node_modules/vite/bin/vite.js build --outDir "$SW/dist" > "$S/j5-build.log" 2>&1
WORKER=$(ls "$S"/dist/assets/runtimeWorker-*.js | head -1)
echo "B4 raw bytes: $(wc -c < "$WORKER")   gzip -9 bytes: $(gzip -9 -c "$WORKER" | wc -c)" | tee "$S/b4.txt"

echo "== 6. the worker probe, B1 / B2 / B5: a headless Chromium launched by the tool (Playwright), never a signed-in profile"
cd "$W"
hl w2-probe-desktop -- "$UCT_PY" tools/runtime_pane_worker_probe.py --worker "$WORKER" --defs "$SW/rf-defs.json" \
  --out "$SW/probe.json" --runs 11 --lengths "D 5000" --symbol AAPL:NASDAQ --checkpoint 20 > "$S/j6-probe.log" 2>&1
hl w2-probe-x4 -- "$UCT_PY" tools/runtime_pane_worker_probe.py --worker "$WORKER" --defs "$SW/rf-defs.json" \
  --out "$SW/probe-x4.json" --runs 11 --lengths "D 5000" --symbol AAPL:NASDAQ --checkpoint 20 --cpu-throttle 4 > "$S/j6-probe-x4.log" 2>&1

echo "== 7. the lane rails the owner items cite, and the census-detector rail"
cd "$W/app"
hl w2-lane-rails -- node node_modules/vitest/vitest.mjs run \
  $R/conditionalCallSite.test.js $R/conditionalArmsParams.test.js $R/conditionalReviewFollowups.test.js \
  $R/loops.test.js $R/c18WhileAndLastBar.test.js $R/arrays.test.js $R/carriedState.test.js $R/declarationPersistence.test.js \
  $R/elseIfChain.test.js $R/elseGuardShape.test.js $R/blockValuedBinding.test.js \
  $R/functionBodyBlockValue.test.js $R/functionGlobalReads.test.js $R/callForEffect.test.js \
  src/components/chart/engine/ast/listingSeed.test.js \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h4Loops.test.js --maxWorkers=2 > "$S/lane-rails.log" 2>&1
cd "$W"
hl w2-pytest-condta -- "$UCT_PY" -m pytest tests/test_pine_coverage_conditional_ta.py -q -p no:cacheprovider > "$S/pytest-condta.log" 2>&1

echo "== 8. the candidates tool (no heavy job: it reads committed files and the measurements above)"
"$UCT_PY" docs/pine/evidence/w2-arming-2026-11-02/candidates.py --readiness "$SW/readiness.json" \
  --probe "$SW/probe.json" --probe-x4 "$SW/probe-x4.json" \
  --out docs/pine/evidence/w2-arming-2026-11-02/stage1-candidates.json

echo "== 9. the deploy-gate pytest, once, before the final push"
hl w2-deploy-gate -- "$UCT_PY" -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py \
  tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py tests/test_script_engine_version_gate.py \
  -q -p no:cacheprovider > "$S/deploy-gate.log" 2>&1
echo "== done"
