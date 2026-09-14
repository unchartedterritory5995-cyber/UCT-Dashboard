"""Refresh wisdom_outcomes (outcomes-v1) for every CALL in an explicit wisdom.db.

Same function the daily chain calls: api.services.wisdom.evals.pipeline.run_outcomes.

    python tools/wisdom/evals_outcomes.py --db <wisdom.db> --bars-db <bars.db opened read-only> [--dry-run]

Without --bars-db the web store module (bars_sqlite) is used, which on this box resolves into the
census sandbox and is EMPTY — pass --bars-db on the PC.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.wisdom import evals_common  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True)
    ap.add_argument("--bars-db", help="bars.db path, opened with sqlite URI mode=ro")
    ap.add_argument("--now", help="ISO datetime to judge maturity against (default: now, ET)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    evals_common.bootstrap(args.db)

    from api.services.wisdom.core import store
    from api.services.wisdom.evals import pipeline
    from api.services.wisdom.evals.bars_asof import BarsAsOf, ReadOnlyFileReader

    store.init_db()
    bars = BarsAsOf(ReadOnlyFileReader(evals_common.require_file(args.bars_db, "--bars-db"))) if args.bars_db else None
    ctx = evals_common.job_context("tools_evals_outcomes", dry_run=args.dry_run, now_iso=args.now)
    print(json.dumps(pipeline.run_outcomes(ctx, bars=bars), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
