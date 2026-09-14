"""D12 backfill CLI. DRY RUN BY DEFAULT; explicit store paths; never a data-root default.

    python tools/wisdom/capture_backfill.py catalysts  --catalysts-db PATH --wisdom-db PATH [--start D] [--end D] [--execute]
    python tools/wisdom/capture_backfill.py vision     --vision-db PATH    --wisdom-db PATH [--start D] [--end D] [--execute]
    python tools/wisdom/capture_backfill.py detections --patterns-db PATH  --wisdom-db PATH [--start D] [--end D] [--max-days N] [--execute]
    python tools/wisdom/capture_backfill.py x-posts    --wisdom-db PATH --since YYYY-MM-DD --until YYYY-MM-DD --max-usd 5 [--handles a,b] [--max-pages N] [--execute]
    python tools/wisdom/capture_backfill.py x-smoke    [--handle TSDR_Trading] [--execute]

Every subcommand prints a JSON plan (what would be captured, its size and its R2 /
TwitterAPI.io cost) and writes nothing unless --execute is given.

WHERE IT RUNS. The history lives on the web pod's volume, so catalysts / vision /
detections backfills are pod-side runs (``--on-railway``; one ``--max-days``
batch of detections at a time, outside 00:40-05:00 ET). R2 credentials
(DATA_SYNC_*) and TWITTERAPI_IO_API_KEY come from the environment; nothing here
prints a credential.

THE SANDBOX. Off the pod, the repo-root conftest census is applied BEFORE any
api.* import (CLAUDE.md "C:\\data IS REAL"): every derived data-root env pin is
pointed at a throwaway sandbox and the tripwire is armed, so a bare run on this
box cannot write the live mirrors. ``--on-railway`` skips that, and is refused
unless the process really is on a Railway Linux container.

PAID X CALLS additionally need WISDOM_X_BACKFILL_ENABLED=1 in the process and a
--max-usd no higher than x_backfill.HARD_MAX_USD; x-smoke --execute makes exactly
one call.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _refuse(message: str) -> None:
    print(json.dumps({"refused": message}))
    raise SystemExit(2)


def _prepare(args) -> None:
    sys.path.insert(0, REPO)
    if args.on_railway:
        on_pod = sys.platform.startswith("linux") and bool(
            os.environ.get("RAILWAY_ENVIRONMENT_NAME") or os.environ.get("RAILWAY_ENVIRONMENT"))
        if not on_pod:
            _refuse("--on-railway is only valid inside a Railway Linux container")
    else:
        import conftest  # noqa: F401 — census pins -> sandbox + tripwire, before any api.* import
    wisdom_db = getattr(args, "wisdom_db", None)
    if wisdom_db:
        os.environ["WISDOM_DB_PATH"] = os.path.abspath(wisdom_db)
        from api.services.wisdom.core import store

        store.init_db()


def _et_start(day: str) -> int:
    from api.services.wisdom.capture.families._base import et_day_start_epoch

    return et_day_start_epoch(dt.date.fromisoformat(day))


def _existing(path: str, label: str) -> str:
    if not path or not os.path.exists(path):
        _refuse(f"{label} not found: {path!r}")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="D12 capture backfills (dry run by default)")
    ap.add_argument("--on-railway", action="store_true", help="running on the web pod: skip the local sandbox")
    ap.add_argument("--out", default=None, help="also write the JSON result to this file")
    sub = ap.add_subparsers(dest="kind", required=True)

    def with_common(p, *, wisdom=True, window=True):
        if wisdom:
            p.add_argument("--wisdom-db", required=True, help="wisdom.db to record run rows in")
        if window:
            p.add_argument("--start", default=None, help="first date, YYYY-MM-DD")
            p.add_argument("--end", default=None, help="last date, YYYY-MM-DD")
        p.add_argument("--execute", action="store_true", help="actually write (default: dry run)")
        return p

    with_common(sub.add_parser("catalysts")).add_argument("--catalysts-db", required=True)
    with_common(sub.add_parser("vision")).add_argument("--vision-db", required=True)
    det = with_common(sub.add_parser("detections"))
    det.add_argument("--patterns-db", required=True)
    det.add_argument("--max-days", type=int, default=None)
    xp = with_common(sub.add_parser("x-posts"), window=False)
    xp.add_argument("--since", required=True)
    xp.add_argument("--until", required=True)
    xp.add_argument("--max-usd", type=float, required=True)
    xp.add_argument("--handles", default=None, help="comma-separated; default: tweet_store.OFFICIAL_ACCOUNTS")
    xp.add_argument("--max-pages", type=int, default=50)
    smoke = with_common(sub.add_parser("x-smoke"), wisdom=False, window=False)
    smoke.add_argument("--handle", default="TSDR_Trading")
    args = ap.parse_args(argv)

    _prepare(args)
    from api.services.wisdom.capture import backfill, x_backfill

    dry = not args.execute
    try:
        if args.kind == "catalysts":
            out = backfill.catalysts_history(_existing(args.catalysts_db, "--catalysts-db"),
                                             start=args.start, end=args.end, dry_run=dry)
        elif args.kind == "vision":
            out = backfill.vision_history(_existing(args.vision_db, "--vision-db"),
                                          start=args.start, end=args.end, dry_run=dry)
        elif args.kind == "detections":
            out = backfill.detections_retention(_existing(args.patterns_db, "--patterns-db"), start=args.start,
                                                end=args.end, dry_run=dry, max_days=args.max_days)
        elif args.kind == "x-posts":
            if args.handles:
                handles = [h.strip() for h in args.handles.split(",") if h.strip()]
            else:
                from api.services import tweet_store

                handles = [h for h, _ in tweet_store.OFFICIAL_ACCOUNTS]
            out = backfill.x_posts(handles, _et_start(args.since), _et_start(args.until), max_usd=args.max_usd,
                                   dry_run=dry, max_pages_per_handle=args.max_pages)
        else:
            out = x_backfill.smoke_test(args.handle, execute=args.execute)
    except x_backfill.BackfillRefused as exc:
        _refuse(str(exc))
    except ValueError as exc:
        _refuse(f"{type(exc).__name__}: {exc}")
    text = json.dumps(out, indent=1, default=str)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
