#!/usr/bin/env bash
# Re-measure PR #1016's execution coverage (owner decision 4, 2026-11-10) on a verified install. One script; re-run it as is.
#
#   bash docs/agent/program/evidence/remeasure-1016/remeasure.sh <attempt-dir-name>      (from anywhere; Git Bash on Windows)
#
# What it does, in order. Every log starts with the node_modules LinkType / Target, date -u, the tree commit and the harness commit.
#   0. header.log: the install (LinkType / Target, nmcheck.mjs = every package-lock.json pin installed at its version), node, tree SHA,
#      the app/ diff against MEASURED (must be empty: only docs are committed on this branch), the harness SHA (recount.mjs source).
#   1. packet/: #1016's own method. The 12 test files of PR-exec-chart-settings.md "Re-run of all 12 files", each once, single-file,
#      through the shared suite lock, default + json reporters (same command shape as #1016).
#   2. src-agent/: the coverage-ledger method (rec.mjs / ledger6). The whole src/agent vitest run, json reporter, through the lock.
#   3. recount.mjs (taken by `git show $HB:...`, harness pinned) over that run -> recount.json: which doc-VERIFIED rows are re-proved.
#   4. rec.mjs (this folder) -> ledger.md: per row, doc state + re-proved (*) / file-level (V~); compare.mjs: old (stale install) vs new.
#   5. recount-doc.py: the status doc's own "Counts by area" reproduced from its "All actions" table.
# Model: scripted, jsdom. Nothing here is a real model or a real browser. No network, no backend.
set -u
WT=${WT:-/c/w/pl-auto-remeasure}                 # the run tree: origin/master + this evidence folder only
MEASURED=${MEASURED:-75421184a33c10f42201c43f6bd2d6391594f4c1}   # origin/master at measurement time (attempt-1: 69ab78db82; attempt-2: 75421184a3)
HB=${HB:-6f9abd8515}                             # harness commit (agent/pl/autotest-2) that recount.mjs is taken from
WHO=${WHO:-pl-auto}
E=$WT/docs/agent/program/evidence/remeasure-1016
OUT=$E/${1:?attempt dir name, e.g. attempt-1}
mkdir -p "$OUT/packet" "$OUT/src-agent" "$OUT/tmp"
W() { cygpath -w "$1"; }

hdr() {   # header lines for every log
  powershell -NoProfile -Command "\$i=Get-Item '$(W $WT/app/node_modules)' -Force; 'node_modules LinkType=' + \$i.LinkType + ' Target=' + \$i.Target"
  echo "date -u: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "tree: $WT HEAD $(git -C $WT rev-parse HEAD) (measured master $MEASURED)"
  echo "harness: $HB ($(git -C $WT rev-parse $HB 2>/dev/null || echo 'not in repo')) - recount.mjs only; no harness file is in the run tree"
}
lockrun() {   # the shared suite lock, below-normal priority, temp under OUT/tmp
  ( cd $WT && BN_CWD="$(W $WT/app)" BN_TMP="$(W $OUT/tmp)" timeout 5400 python tools/agent_suite_lock.py run --who $WHO -- \
      powershell -NoProfile -ExecutionPolicy Bypass -File "$(W $E/bn.ps1)" "$@" )
}

# 0. header
{ hdr
  echo "node: $(node -v)"
  node $E/nmcheck.mjs "$(W $WT/app)"; echo "nmcheck exit $?"
  echo "app/ diff vs measured master (must be empty):"; git -C $WT diff --stat $MEASURED HEAD -- app | tail -1; echo "(end diff)"
  echo "uncommitted under app/ (must be empty):"; git -C $WT status --short -- app; echo "(end status)"
} > $OUT/header.log 2>&1
cat $OUT/header.log

# 1. #1016's 12 files
FILES="agent/qa/chartsOutcome/chartSettings.outcome.test.jsx agent/qa/chartsOutcome/multiChart.outcome.test.jsx agent/agentContracts.test.js
agent/agentExecReach.test.jsx agent/agentExecRound5.test.jsx agent/agentIndicatorAlertTruth.test.jsx
agent/qa/chartsOutcome/boardArrangement.outcome.test.jsx agent/qa/chartsOutcome/etfHoldings.outcome.test.jsx
agent/qa/chartsOutcome/teNewsWatchlist.outcome.test.jsx agent/qa/chartsOutcome/themeTracker.outcome.test.jsx
agent/qa/chartsOutcome/widgetControls.outcome.test.jsx agent/qa/chartsOutcome/widgetDoorRows.outcome.test.jsx"
first=1
for f in $FILES; do
  [ $first = 1 ] || sleep 30; first=0
  n=$(basename $f); n=${n%.jsx}; n=${n%.js}
  { hdr; echo "# cmd: vitest run src/$f --reporter=default --reporter=json"; } > $OUT/packet/$n.log 2>&1
  lockrun node node_modules/vitest/vitest.mjs run src/$f --reporter=default --reporter=json "--outputFile=$(W $OUT/packet/$n.json)" >> $OUT/packet/$n.log 2>&1
  echo "# exit=$? end $(date -u +%H:%M:%SZ)" >> $OUT/packet/$n.log
  echo "$n: $(sed 's/\x1b\[[0-9;]*m//g' $OUT/packet/$n.log | grep -E '^ *Test Files' | tail -1) /$(sed 's/\x1b\[[0-9;]*m//g' $OUT/packet/$n.log | grep -E '^ *Tests ' | tail -1) $(tail -1 $OUT/packet/$n.log)"
done

# 2. src/agent
sleep 30
{ hdr; echo "# cmd: vitest run src/agent --maxWorkers=4 --reporter=json (the ledger6 command)"; } > $OUT/src-agent/vitest.log 2>&1
lockrun node node_modules/vitest/vitest.mjs run src/agent --maxWorkers=4 --reporter=json "--outputFile=$(W $OUT/src-agent/vitest-agent.json)" >> $OUT/src-agent/vitest.log 2>&1
echo "# exit=$? end $(date -u +%H:%M:%SZ)" >> $OUT/src-agent/vitest.log
tail -1 $OUT/src-agent/vitest.log

# 3. recount (harness pinned)
git -C $WT show $HB:app/src/testing/agent/autotest/recount.mjs > $OUT/recount.mjs
{ hdr; ( cd $WT/app && node "$(W $OUT/recount.mjs)" --vitest "$(W $OUT/src-agent/vitest-agent.json)" --source remeasure-$MEASURED --repo "$(W $WT)" --out "$(W $OUT/recount.json)" ); echo "# recount exit $?"; } > $OUT/recount.log 2>&1
cat $OUT/recount.log | head -12

# 4. ledger + compare
node $E/mkcfg.mjs "$E" "$OUT" "$MEASURED" > $OUT/rec-cfg.json
{ hdr; node $E/rec.mjs "$(W $OUT/rec-cfg.json)" "$(W $OUT/ledger.md)"; echo "# rec exit $?"; node $E/compare.mjs "$(W $OUT/ledger.md)" > $OUT/compare.md; echo "# compare exit $?"; } > $OUT/rec.log 2>&1
cat $OUT/rec.log; cat $OUT/compare.md | head -30

# 5. the doc's own counts
{ hdr; python -I $E/recount-doc.py "$(W $WT/docs/agent/CHARTS_EXECUTION_STATUS.md)"; echo "# recount-doc exit $?"; } > $OUT/recount-doc.log 2>&1
tail -6 $OUT/recount-doc.log
gzip -kf $OUT/src-agent/vitest-agent.json
echo "done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
