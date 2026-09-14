"""CALL-REPLAY (replay-v1) for every CALL / NEGATIVE_CALL in an explicit wisdom.db.

Same function the daily chain calls: api.services.wisdom.evals.pipeline.run_replay. Every source
path is EXPLICIT and opened read-only; a source you do not pass answers `unproven`
(source_file_missing) — it is never resolved to a live store behind your back.

    python tools/wisdom/evals_replay.py --db <wisdom.db> --engine-db <uct_intelligence.db> \
        [--catalysts-db ...] [--pattern-vision-db ...] [--patterns-db ...] [--screener-db ...] \
        [--uct20-file ...] [--now ISO] [--dry-run]
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
    for flag in ("--engine-db", "--catalysts-db", "--pattern-vision-db", "--patterns-db", "--screener-db",
                 "--uct20-file"):
        ap.add_argument(flag)
    ap.add_argument("--now")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    evals_common.bootstrap(args.db)

    from api.services.wisdom.core import store
    from api.services.wisdom.evals import pipeline, replay

    store.init_db()
    ctx = evals_common.job_context("tools_evals_replay", dry_run=args.dry_run, now_iso=args.now)
    adapters, notes = replay.default_adapters(
        now=ctx.now_et, engine_db=args.engine_db, catalysts_db=args.catalysts_db,
        pattern_vision_db=args.pattern_vision_db, patterns_db=args.patterns_db, screener_db=args.screener_db,
        uct20_file=args.uct20_file, archive=None, resolve_missing=False)
    try:
        summary = pipeline.run_replay(ctx, adapters=adapters)
    finally:
        for adapter in adapters:
            adapter.close()
    summary["source_notes"] = notes
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
