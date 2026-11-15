#!/bin/bash
# TRAIN-1 ONLY. usage: measure.sh TAG [steps...]  (steps: c0 c1 f0 f1 h0 h1; default all)
# Measures whatever C:/Users/Patrick/uct-worktrees/train-1 has checked out. One heavy-lock hold per run.
TAG=$1; shift; STEPS=${*:-c0 c1 f0 f1 h0 h1}
O=C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/269630a0-d11b-41f6-8959-ec8ae95a9506/scratchpad/TRAIN1
W=C:/Users/Patrick/uct-worktrees/train-1
R=C:/Users/Patrick/AppData/Local/uct-vendor-batch/runs
HELD=$(cat $O/held_dirs.txt)
FIX=$O/fixtures
L="python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --timeout 21600 --label train1-$TAG run --"
H=src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
freegb() { powershell -NoProfile -c "[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB*10)/10" | tr -d '\r'; }
gate() {
  a=$(df -BG --output=avail /c | tail -1 | tr -dc 0-9); [ "$a" -ge 5 ] || { echo "STOP: C: free ${a}G < 5G"; exit 7; }
  for i in $(seq 1 120); do f=$(freegb); python -c "import sys; sys.exit(0 if float('$f') >= 6 else 1)" && { MW=$(python -c "print(max(1, min(4, int((float('$f') - 6) // 1.5))))"); echo "   freeGB=$f maxWorkers=$MW $(date +%T)"; return 0; }; sleep 60; done
  echo "STOP: free RAM stayed < 6 GB"; exit 8
}
mkdir -p $O/$TAG
echo "== $TAG at $(git -C $W rev-parse HEAD) $(date +%T)"
cd $W/app || exit 9
for s in $STEPS; do
  lane=${s:1:1}
  case $s in
    c?) gate; TRAIN_LANE=$lane TRAIN_IN=$O/sources.json TRAIN_OUT=$O/$TAG/census-$lane.json TRAIN_BARS=$FIX/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json \
          $L node node_modules/vitest/vitest.mjs run --config $O/vitest.train.config.mjs --maxWorkers=1 > $O/$TAG/census-$lane.log 2>&1; echo "   census lane $lane rc=$? $(date +%T)";;
    f?) gate; mkdir -p $O/$TAG/fix-$lane; VENDOR_HARNESS_RUNTIME_ON=$lane VENDOR_HARNESS_DIR="$FIX" VENDOR_HARNESS_OUT=$O/$TAG/fix-$lane \
          $L node node_modules/vitest/vitest.mjs run $H --maxWorkers=$MW > $O/$TAG/fix-$lane.log 2>&1; echo "   fixtures lane $lane rc=$? $(date +%T)";;
    h?) gate; mkdir -p $O/$TAG/held-$lane; VENDOR_HARNESS_RUNTIME_ON=$lane VENDOR_HARNESS_DIR="$HELD" VENDOR_HARNESS_OUT=$O/$TAG/held-$lane \
          $L node node_modules/vitest/vitest.mjs run $H --maxWorkers=$MW > $O/$TAG/held-$lane.log 2>&1; echo "   held lane $lane rc=$? $(date +%T)";;
  esac
done
echo "DONE-$TAG $(date +%T)"
