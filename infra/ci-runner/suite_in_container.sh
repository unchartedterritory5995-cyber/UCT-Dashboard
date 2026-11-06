#!/bin/bash
# Runs one suite in a fresh container, mirroring the workflow's steps. Offline-runner validation only.
# Code arrives as a tar of a fresh clone on stdin (no host mount). Results leave as a tar on stdout.
#   usage: suite_in_container.sh <server|browser N|list|capreg-post|capreg-rth|fail-server|fail-pytest|fail-vitest|pass-vitest>
set -uo pipefail
suite=$1; arg=${2:-}
exec 3>&1 1>&2
W=/home/runner/work/UCT-Dashboard/UCT-Dashboard
R=/home/runner/results
mkdir -p "$W" "$R"
cd "$W" || exit 90
tar xf - || exit 91
export CI=true GITHUB_ACTIONS=true
AGENT_VITEST_PATHS=$(sed -n 's/^  AGENT_VITEST_PATHS: //p' .github/workflows/master-deploy-gate.yml)
start=$(date +%s)
echo "suite=$suite arg=$arg sha=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l) cpus=$(nproc) node=$(node -v) py=$(python -V 2>&1) tz=$(date +%Z)"

case "$suite" in
  server)
    sudo mkdir -p /data && sudo chown "$(id -u):$(id -g)" /data
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt pytest httpx
    python -m pytest tests/test_uct_agent*.py -q -p no:cacheprovider --junitxml="$R/server.xml" 2>&1 | tee "$R/server.log"
    rc=${PIPESTATUS[0]} ;;
  browser)
    cd app || exit 92
    npm ci --no-audit --no-fund >/dev/null
    npx vitest run $AGENT_VITEST_PATHS --shard="$arg/4" --reporter=default --reporter=json --outputFile="$R/shard-$arg.json" 2>&1 | tail -40
    rc=${PIPESTATUS[0]} ;;
  gate-server)
    # The gate's agent-server job, step for step. fetch-depth 0, so this clone holds all the history it was given.
    # The SHA proof runs first, as in the job.
    git clone -q "file://$PWD" /tmp/full 2>/dev/null
    cd /tmp/full || exit 92
    export GITHUB_SHA=$(git rev-parse HEAD)
    echo "commits=$(git rev-list --count HEAD)"
    sudo mkdir -p /data && sudo chown "$(id -u):$(id -g)" /data
    python -m venv /tmp/prodvenv
    /tmp/prodvenv/bin/python -m pip install --quiet --upgrade pip
    /tmp/prodvenv/bin/python -m pip install --quiet -r requirements.txt pytest httpx
    if GITHUB_SHA=0000000000000000000000000000000000000000 bash -c 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'; then
      echo "SHA proof FAILED TO REFUSE a wrong commit"; rc=98
    else
      echo "SHA proof refuses a wrong commit"
      test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
      echo "testing exactly $GITHUB_SHA"
      /tmp/prodvenv/bin/python -m pytest tests/test_uct_agent*.py -q -p no:cacheprovider 2>&1 | tee "$R/gate-server.log" | tail -3
      rc=${PIPESTATUS[0]}
    fi ;;
  server-slow)
    sudo mkdir -p /data && sudo chown "$(id -u):$(id -g)" /data
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt pytest httpx
    # where the time goes: fsync on the container's disk, and the slowest tests
    python - <<'PY' 2>&1 | tee "$R/fsync.log"
import os, time
for d in ("/data", "/tmp", "/dev/shm"):
    p = os.path.join(d, "fsync-probe")
    t = time.time()
    with open(p, "wb") as f:
        for _ in range(200):
            f.write(b"x" * 4096); f.flush(); os.fsync(f.fileno())
    print(d, "fsync ms each: %.2f" % ((time.time() - t) / 200 * 1000))
    os.remove(p)
PY
    python -m pytest tests/test_uct_agent*.py -q -p no:cacheprovider --durations=12 2>&1 | tee "$R/server-slow.log" | tail -22
    rc=${PIPESTATUS[0]} ;;
  list)
    cd app || exit 92
    npm ci --no-audit --no-fund >/dev/null
    npx vitest list $AGENT_VITEST_PATHS --filesOnly > "$R/expected-files.txt"
    rc=$?; wc -l "$R/expected-files.txt" ;;
  capreg-post)
    python -m pip install --quiet pytest
    python -m pytest tests/test_uct_agent_capreg_*.py -q -p no:cacheprovider 2>&1 | tee "$R/capreg-post.log"
    rc=${PIPESTATUS[0]} ;;
  capreg-rth)
    cd app || exit 92
    npm ci --no-audit --no-fund >/dev/null
    CAPREG_CLOCK=rth npx vitest run src/agent/qa/capabilityRegression --reporter=default --reporter=json --outputFile="$R/capreg-rth.json" 2>&1 | tee "$R/capreg-rth.log" | tail -8
    rc=${PIPESTATUS[0]} ;;
  fail-server)
    # AUDIT proof 6: a failing server test turns the gate's step red, through the step's real glob.
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt pytest httpx
    printf 'def test_deliberate_failure():\n    assert 1 == 2\n' > tests/test_uct_agent_zz_deliberate.py
    python -m pytest tests/test_uct_agent*.py -q -p no:cacheprovider -k deliberate_failure 2>&1 | tail -4
    rc=${PIPESTATUS[0]} ;;
  fail-pytest)
    python -m pip install --quiet pytest
    printf 'def test_deliberate_failure():\n    assert 1 == 2\n' > tests/test_zz_deliberate_failure.py
    python -m pytest tests/test_zz_deliberate_failure.py -q -p no:cacheprovider --noconftest 2>&1 | tail -4
    rc=${PIPESTATUS[0]} ;;
  fail-vitest|pass-vitest)
    want=2; if [ "$suite" = pass-vitest ]; then want=1; fi
    cd app || exit 92
    npm ci --no-audit --no-fund >/dev/null
    printf "import { test, expect } from 'vitest'\ntest('deliberate', () => { expect(1).toBe($want) })\n" > src/agent/zzDeliberate.test.js
    npx vitest run src/agent/zzDeliberate.test.js --reporter=default --reporter=json --outputFile="$R/$suite.json" 2>&1 | tail -6
    rc=${PIPESTATUS[0]} ;;
  *) echo "unknown suite $suite"; rc=99 ;;
esac
echo "suite=$suite arg=$arg rc=$rc wall=$(( $(date +%s) - start ))s peak_mem_gib=$(( $(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0) / 1073741824 ))" | tee "$R/summary-$suite$arg.txt"
tar cf - -C "$R" . >&3
exit "$rc"
