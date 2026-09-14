"""Compute metrics 6.1-6.3 (metrics-v1) from an explicit wisdom.db and print the latest overall rows.

Same function the daily chain calls: api.services.wisdom.evals.pipeline.run_metrics.

    python tools/wisdom/evals_metrics.py --db <wisdom.db> [--dry-run] [--all-slices]
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
    ap.add_argument("--now")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all-slices", action="store_true")
    args = ap.parse_args(argv)
    evals_common.bootstrap(args.db)

    from api.services.wisdom.core import store
    from api.services.wisdom.evals import metrics, pipeline

    store.init_db()
    ctx = evals_common.job_context("tools_evals_metrics", dry_run=args.dry_run, now_iso=args.now)
    summary = pipeline.run_metrics(ctx)
    print(json.dumps(summary, indent=2, default=str))
    if not args.dry_run:
        with store.read() as conn:
            for row in metrics.latest_metrics(conn):
                if args.all_slices or row["slice"] == {"status": "combined"}:
                    print(f"{row['metric']:<30} {json.dumps(row['slice'], sort_keys=True):<45} {row['display']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
