"""Command line of the Leader score test::

    python -m api.services.rs_leader_test --bars-db PATH --screener-db PATH --out PATH
        [--max-formation-dates N] [--unlock-holdout]

Reads the two databases read-only, writes ONE file (``--out``, JSON) and prints the
verdict last. Exit status: 0 the test passed, 1 it failed, 2 the run could not start.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys

from . import spec
from .run import run_test

HOLDOUT_BANNER = (
    "=" * 78 + "\n"
    "HOLDOUT UNLOCKED. This run READS the newest {n} rating sessions, which the test\n"
    "holds back so its rules cannot be fitted to them. A holdout is read once.\n"
    + "=" * 78)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m api.services.rs_leader_test",
        description="The Leader score's pre-registered test. Read-only; writes only --out.")
    p.add_argument("--bars-db", required=True, help="the daily bars store (bars.db), opened read-only")
    p.add_argument("--screener-db", required=True,
                   help="screener.db (rating history and today's industry map), opened read-only")
    p.add_argument("--out", required=True, help="the JSON file to write (the only file written)")
    p.add_argument("--max-formation-dates", type=int, default=None, metavar="N",
                   help="a quick run on the newest N formation dates; not a test record")
    p.add_argument("--unlock-holdout", action="store_true",
                   help=f"also read the newest {spec.HOLDOUT_SESSIONS} rating sessions (said loudly)")
    return p


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    if args.max_formation_dates is not None and args.max_formation_dates < 1:
        print("--max-formation-dates must be 1 or more", file=sys.stderr)
        return 2
    if args.unlock_holdout:
        print(HOLDOUT_BANNER.format(n=spec.HOLDOUT_SESSIONS), flush=True)
    try:
        result = run_test(args.bars_db, args.screener_db, unlock_holdout=args.unlock_holdout,
                          max_formation_dates=args.max_formation_dates,
                          progress=lambda msg: print(msg, file=sys.stderr, flush=True))
    except sqlite3.Error as e:
        print(f"could not read the databases: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    # allow_nan=False: a number this file cannot state honestly is null, never NaN.
    text = json.dumps(result, indent=1, sort_keys=True, allow_nan=False)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    if args.unlock_holdout:
        print(HOLDOUT_BANNER.format(n=spec.HOLDOUT_SESSIONS))
    print("\n".join(result["verdict_lines"]))
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
