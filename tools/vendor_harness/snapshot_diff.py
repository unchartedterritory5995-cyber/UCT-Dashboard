# -*- coding: utf-8 -*-
"""snapshot_diff.py - a harness run's verdicts against the committed snapshot of its lane, store-held rows by name.

    python tools/vendor_harness/snapshot_diff.py <run verdicts.json> [--snapshot <verdicts.json>]

Prints every verdict that moved, MATCH lost and MATCH -> DIVERGE first, and names each store-held row (a row the
snapshot graded with a library store this run does not hold: `store_held.py`). Exit 1 when a MATCH was lost or
went to DIVERGE, else 0. A store-held row never counts either way: a run without the store cannot grade it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import store_held as SH  # noqa: E402 -- the one authority over the store-held rule


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run")
    ap.add_argument("--snapshot", default=None, help="default: the committed snapshot of the run's lane")
    a = ap.parse_args(argv)
    run = json.load(open(a.run, encoding="utf-8"))
    snap_path = a.snapshot or SH.SNAPSHOTS.get(run.get("lane"))
    if not snap_path:
        print("the run names no lane this tool knows (%r): pass --snapshot" % run.get("lane"))
        return 2
    snap = json.load(open(snap_path, encoding="utf-8"))
    if snap.get("lane") != run.get("lane"):
        print("lanes differ: snapshot %r, run %r" % (snap.get("lane"), run.get("lane")))
        return 2
    d = SH.compare(snap, run)
    print("lane %s: %d moved, %d MATCH lost, %d MATCH -> DIVERGE, %d store-held"
          % (run.get("lane"), len(d["moved"]), len(d["lost"]), len(d["toDiverge"]), len(d["storeHeld"])))
    for cid in d["toDiverge"]:
        print("  MATCH -> DIVERGE  %s" % cid)
    for cid in d["lost"]:
        if cid not in d["toDiverge"]:
            print("  MATCH lost        %s" % cid)
    for cid, was, now in d["moved"]:
        if cid not in d["lost"]:
            print("  moved %-12s -> %-12s %s" % (was, now, cid))
    for cid, why in sorted(d["storeHeld"].items()):
        print("  %s  %s" % (why, cid))
    return 1 if d["lost"] else 0


if __name__ == "__main__":
    sys.exit(main())
