#!/bin/bash
# S1 (PHASE3-RUNTIME-PLAN 4.1): member logic runs only in the member's own browser worker; no eval, no network,
# the server never executes it. This is the POINT-IN-TIME search behind the packet's S1 verdict: it is not a
# standing rail (section 10, item 9). Run from the repo root; the output on the final tree is s1-grep.txt
# (characters outside printable ASCII in the matched source lines are shown as ?).
#
#   bash docs/pine/evidence/w2-arming-2026-11-02/s1-grep.sh > docs/pine/evidence/w2-arming-2026-11-02/s1-grep.txt
cd "$(git rev-parse --show-toplevel)" || exit 90
LANE=app/src/components/chart/engine/runtime
ENGINE=app/src/components/chart/engine

search() {
  echo "# S1 point-in-time search, tree $(git rev-parse --short=10 HEAD)"
  echo "# 1. the lane directory $LANE/ (tests excluded): eval( new Function Function( importScripts XMLHttpRequest WebSocket EventSource sendBeacon fetch( navigator. and a dynamic import("
  grep -rnE '\beval\(|new Function|\bFunction\(|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bfetch\(|navigator\.|\bimport\(' "$LANE" --include=*.js --exclude-dir=__tests__ --exclude='*.test.js' | cut -c1-200
  echo "# 2. the whole engine directory $ENGINE/ (tests excluded): eval( new Function and a call of the Function constructor (word boundary)"
  grep -rnE '\beval\(|new Function|\bFunction\(' "$ENGINE" --include=*.js --exclude-dir=__tests__ --exclude='*.test.js' | cut -c1-200
  echo "# 3. the two main-thread reads on the lane's path outside the runtime directory: fetch("
  grep -nE '\bfetch\(' app/src/lib/runtimePanePermission.js "$ENGINE/runtimeKill.js" | cut -c1-200
  echo "# 4. the server modules api/services/runtime_definitions.py and api/routers/pine_runtime_telemetry.py: eval( exec( subprocess compile( __import__ importlib"
  grep -nE '\beval\(|\bexec\(|subprocess|\bcompile\(|__import__|importlib' api/services/runtime_definitions.py api/routers/pine_runtime_telemetry.py | cut -c1-200
  echo "# 5. mentions of the lane's modules anywhere under api/ (*.py)"
  grep -rnE 'engine/runtime|runtimeRepaint|runtimeWorker|runtimeColumns|pineRuntimeFrontend|runtimeAsync' api --include=*.py | cut -c1-200
  echo "# 6. api/ lines that run node as a subprocess"
  grep -rnE "['\"]node['\"]" api --include=*.py | grep -iE 'subprocess|Popen|run\(' | cut -c1-200
  echo "# end"
}

search | LC_ALL=C sed 's/[^ -~]/?/g'
