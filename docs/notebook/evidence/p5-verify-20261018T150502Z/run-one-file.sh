#!/usr/bin/env bash
# usage: p5run.sh py|vt <path-relative-to-repo-root>
# Runs ONE test file, writes raw output to the P5 evidence dir, records the exit code.
WT=/c/Users/Patrick/uct-worktrees/notebook-p5
E=$WT/docs/notebook/evidence/p5-verify-20261018T150502Z
kind=$1; f=$2
name=$(basename "$f")
log=$E/base-$kind-$name.log
if [ "$kind" = py ]; then
  cd "$WT" && python -m pytest "$f" -q -p no:cacheprovider > "$log" 2>&1
  rc=$?
else
  rel=${f#app/}
  cd "$WT/app" && npx vitest run "$rel" --maxWorkers=2 > "$log" 2>&1
  rc=$?
fi
echo "EXIT: $rc" >> "$log"
echo "$kind $f -> exit $rc" >> "$E/results-index.txt"
echo "== $f exit $rc"
if [ "$kind" = py ]; then grep -aE "passed|failed|error|no tests ran" "$log" | tail -2; grep -aE "^FAILED|^ERROR" "$log" | head -20; else grep -aE "Test Files|Tests  |FAIL " "$log" | head -20; fi
exit $rc
