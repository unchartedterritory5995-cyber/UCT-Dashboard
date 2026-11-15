"""Command line of the Leader score test::

    python -m api.services.rs_leader_test --bars-db PATH --screener-db PATH --out PATH
        [--ratings computed|stored] [--industry-db PATH] [--from-date YYYY-MM-DD]
        [--max-formation-dates N] [--unlock-holdout]

Reads the databases read-only, writes ONE file (``--out``, JSON), prints the plan
first (the session range, the formation dates, the non-overlapping windows) and the
verdict last. Exit status: 0 the test passed, 1 it failed, 2 the run could not start.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sqlite3
import sys

from . import spec
from .data import COMPUTED, MODES
from .run import run_test

HOLDOUT_BANNER = (
    "=" * 78 + "\n"
    "HOLDOUT UNLOCKED. This run READS the newest {n} sessions, which the test\n"
    "holds back so its rules cannot be fitted to them. A holdout is read once.\n"
    + "=" * 78)


def _day(text: str) -> str:
    try:
        return _dt.date.fromisoformat(text).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not a date (YYYY-MM-DD)") from None


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m api.services.rs_leader_test",
        description="The Leader score's pre-registered test. Read-only; writes only --out.")
    p.add_argument("--bars-db", required=True, help="the daily bars store (bars.db), opened read-only")
    p.add_argument("--screener-db", required=True,
                   help="screener.db (today's industry map, the split-list memo, stored ratings), "
                        "opened read-only")
    p.add_argument("--out", required=True, help="the JSON file to write (the only file written)")
    p.add_argument("--ratings", choices=MODES, default=COMPUTED,
                   help="where a formation date's ratings come from: computed from bars in memory "
                        "(default; needs no stored history) or read from rs_rating_history")
    p.add_argument("--industry-db", default=None, metavar="PATH",
                   help="the industry map (industry_map.db), opened read-only: the rating job's "
                        "ETF list reads it. Give it in computed mode, or ETFs known only there "
                        "are ranked as stocks")
    p.add_argument("--from-date", type=_day, default=None, metavar="YYYY-MM-DD",
                   help="no formation date before this day (default: as far back as the bars go)")
    p.add_argument("--max-formation-dates", type=int, default=None, metavar="N",
                   help="a quick run on the newest N formation dates; not a test record")
    p.add_argument("--unlock-holdout", action="store_true",
                   help=f"also read the newest {spec.HOLDOUT_SESSIONS} sessions (said loudly)")
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
                          max_formation_dates=args.max_formation_dates, ratings=args.ratings,
                          from_date=args.from_date, industry_db=args.industry_db,
                          announce=lambda lines: print("\n".join(lines), flush=True),
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
