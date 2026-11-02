#!/bin/bash
cd C:/Users/Patrick/uct-worktrees/pine-w1/app
W1="C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/4f6b7973-3f6b-449e-85dd-943a3359950a/scratchpad/w1"
V="node node_modules/vitest/vitest.mjs run"
$V src/components/chart/engine/ast/pineW1Builtins.test.js src/components/chart/engine/ast/pinePhase1Builtins.test.js --maxWorkers=2 > "$W1/tests2.log" 2>&1; echo "TESTS rc=$?" > "$W1/job2.status"
python "$W1/mutate.py" "$W1/muts1.json" src/components/chart/engine/ast/pineW1Builtins.test.js > "$W1/mut1.log" 2>&1; echo "MUT rc=$?" >> "$W1/job2.status"
echo DONE >> "$W1/job2.status"
