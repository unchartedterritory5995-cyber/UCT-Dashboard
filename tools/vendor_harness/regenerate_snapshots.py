# -*- coding: utf-8 -*-
"""regenerate_snapshots.py - THE ONE COMMAND that regrades the committed harness snapshots with production's store.

    python tools/vendor_harness/regenerate_snapshots.py --store <dir> [--lane production|runtime-on|both]

WHY (libraries chain, coordinator ruling 2026-11-19). Production's library store serves the allowlist's `promote`
rows, so the committed snapshots (`docs/pine/vendor-harness/<lane>/verdicts.json`) are graded with exactly that
store loaded: a script importing a promoted version is graded on what members are drawn, and each row that needed
the store names its versions (`storeHeld`), so a run without it skips that row by name (`store_held.py`).

WHAT IT DOES, in order, and it stops at the first refusal:
  1. `promotion_check.check(<dir>, allowlist, exact=True)`: the store holds exactly the promote rows, each at its
     pinned sha256. Library code lives only in that scratch directory, never in the repository.
  2. Per lane, ONE heavy-lock hold (coordinator, 2026-11-19: the fair queue interleaves other jobs between lanes):
     the corpus harness from app/ with PINE_LIBRARY_STORE=<dir>, VENDOR_HARNESS_RUNTIME_ON=0|1 and
     VENDOR_HARNESS_OUT=../docs/pine/vendor-harness/<lane>, the command the admission-freshness runbook names.
  3. The written snapshot's `libraryStore` equals the promote rows (`store_held.snapshot_store_problems`).
The lock is `$UCT_HEAVY_LOCK` (default: this PC's `uct-clips/tools/heavy_lock.py`), `--priority normal`.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "pine_library"))

import promotion_check as PC  # noqa: E402 -- the owner's exact-store check: one authority
import store_held as SH  # noqa: E402

LOCK = os.environ.get("UCT_HEAVY_LOCK", os.path.join(os.path.expanduser("~"), "uct-clips", "tools", "heavy_lock.py"))
CORPUS_TEST = "src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js"
LANES = {"production": "0", "runtime-on": "1"}


def lane_command(lane, store):
    """(argv, env) of one lane's run, under its own lock hold."""
    env = dict(os.environ, PINE_LIBRARY_STORE=os.path.abspath(store), VENDOR_HARNESS_RUNTIME_ON=LANES[lane],
               VENDOR_HARNESS_OUT="../docs/pine/vendor-harness/%s" % lane, VITEST_MAX_WORKERS="1")
    env.pop("VENDOR_HARNESS_DIR", None)  # the default: every committed capture
    argv = [sys.executable, LOCK, "--timeout", "14400", "--priority", "normal",
            "--label", "snapshot-%s-with-store" % lane, "run", "--",
            "node", "node_modules/vitest/vitest.mjs", "run", CORPUS_TEST, "--maxWorkers=1"]
    return argv, env


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store", required=True, help="a scratch store holding exactly the allowlist's promote rows")
    ap.add_argument("--lane", default="both", choices=("production", "runtime-on", "both"))
    a = ap.parse_args(argv)
    allow = json.load(open(SH.ALLOWLIST, encoding="utf-8"))
    problems, lines = PC.check(a.store, allow, exact=True)
    for line in lines:
        print(line)
    if problems:
        print("REFUSED: the store is not exactly production's (%d problem(s))" % len(problems))
        return 2
    for lane in (("production", "runtime-on") if a.lane == "both" else (a.lane,)):
        cmd, env = lane_command(lane, a.store)
        print("lane %s: %s" % (lane, " ".join(cmd)), flush=True)
        rc = subprocess.call(cmd, cwd=os.path.join(ROOT, "app"), env=env)
        if rc != 0:
            print("REFUSED: the %s lane exited %d" % (lane, rc))
            return 1
        doc = json.load(open(SH.SNAPSHOTS[lane], encoding="utf-8"))
        bad = SH.snapshot_store_problems(doc, SH.promoted_store())
        if bad:
            print("REFUSED: the %s snapshot was not graded with production's store: %s" % (lane, bad[:3]))
            return 1
        held = sum(1 for r in doc["results"] if SH.pins_of(r))
        print("lane %s: %d rows, %d store-held, engine %s" % (lane, len(doc["results"]), held, doc.get("scriptEngineVersion")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
