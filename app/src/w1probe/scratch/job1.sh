#!/bin/bash
cd C:/Users/Patrick/uct-worktrees/pine-w1/app
W1="C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/4f6b7973-3f6b-449e-85dd-943a3359950a/scratchpad/w1"
V="node node_modules/vitest/vitest.mjs run"
W1_CASES="$W1/cases1.json" W1_OUT="$W1/out1.json" $V src/w1probe/probe.measure.test.js --maxWorkers=2 > "$W1/probe1.log" 2>&1; echo "PROBE rc=$?" > "$W1/job1.status"
WRITE_DOOR_NAME_COVERAGE=1 $V src/components/chart/supportLoop/doorNameCoverage.test.js --maxWorkers=2 > "$W1/door1.log" 2>&1; echo "DOORGEN rc=$?" >> "$W1/job1.status"
$V $(cat "$W1/tests1.txt" | tr '\n' ' ') --maxWorkers=2 > "$W1/tests1.log" 2>&1; echo "TESTS rc=$?" >> "$W1/job1.status"
echo DONE >> "$W1/job1.status"
