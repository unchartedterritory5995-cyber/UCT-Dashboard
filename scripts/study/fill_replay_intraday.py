"""Study -- fill THE REPLAY WITHIN THE DAY for the approved bank charts (2026-11-08).

WHY
---
The owner, on the workbench: "Think we should tick by tick so each day has multiuple ticks like using each 30 min or
hourly close to show how everyday moved essentially". A chart's run-on is daily candles; the bank holds no intraday bars,
and a member's run-on may never call the price provider (B3). So this fetches each chart's 30-minute bars ONCE, on the
server (where the provider key lives; it is never printed), checks every day against the daily candle the chart already
draws (api/services/study_intraday.build: the close within 1%, the session's range inside the candle's, the open within
3%), and stores only the days that add up (study_store.upsert_intraday). A day that does not add up, or a chart before
the provider's intraday floor (2003-09-10), keeps the daily replay. Nothing is invented: every tick is a real bar.

WHAT IT COVERS
--------------
Every approved daily chart item that names its symbol, setups first (Hard mode, Spot the Setup, Boss, Draw it, the
lessons), each chart's forward strip exactly as the run-on serves it (the study router's `_forward_bars`: the stored
strip topped up from the server's own bars, up to 60 days). One provider request per chart; re-runs skip charts already
filled (`--retry-empty` re-tries the ones where no day added up; `--refresh` re-fetches all).

HOW TO RUN (on the pod; PowerShell, or Git Bash with MSYS_NO_PATHCONV=1)
-----------------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_replay_intraday.py --dry-run --limit 20
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_replay_intraday.py --max-minutes 25
Run the second line again until it prints "left": 0. It prints counts only.

LOCAL CHECK (no provider): `--from-file docs/study/setups/go_signal_hourly_bars.json --tf 60` reads real hourly bars the
pod fetched for the Go Signal build instead of the provider, for the charts whose days that file covers.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

MAX_ERRORS_IN_A_ROW = 5


def _ymd(key: int) -> str:
    s = str(key)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _file_source(path: str) -> dict[str, list[dict]]:
    """{SYM: [bar, ...]} from a bars file: the Go Signal hourly format ({"names": {"SYM|date": {"bars": [[t,o,h,l,c,v]]}}})
    or a plain {"SYM": [[t,o,h,l,c,v], ...]}."""
    raw = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    groups = raw.get("names", raw) if isinstance(raw, dict) else {}
    out: dict[str, dict[int, dict]] = {}
    for key, val in groups.items():
        rows = val.get("bars") if isinstance(val, dict) else val
        sym = str(key).split("|")[0].upper()
        for r in rows or []:
            b = {"t": int(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            out.setdefault(sym, {})[b["t"]] = b
    return {s: [m[t] for t in sorted(m)] for s, m in out.items()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tf", default="30", choices=("30", "60"), help="bar size in minutes (30 by default)")
    ap.add_argument("--limit", type=int, default=0, help="at most this many charts this run")
    ap.add_argument("--max-minutes", type=float, default=25.0, help="stop cleanly after this long; run again to go on")
    ap.add_argument("--pause", type=float, default=0.05, help="seconds between provider requests")
    ap.add_argument("--dry-run", action="store_true", help="fetch and check, write nothing")
    ap.add_argument("--retry-empty", action="store_true", help="re-try charts where no day added up")
    ap.add_argument("--refresh", action="store_true", help="re-fetch charts already filled")
    ap.add_argument("--only", default="", help="comma-separated item ids (a check on a few charts)")
    ap.add_argument("--from-file", default="", help="read bars from this file instead of the provider (local check)")
    args = ap.parse_args(argv)

    from api.services import study_store
    # ⛔ the fill never CREATES a database. study_store defaults to /data/study.db, which on a Windows box is C:/data (a
    # dry run on 2026-11-08 left an empty one there): off the pod, STUDY_DB_PATH must name an existing study.db, and
    # never one under C:/data
    db = os.path.abspath(study_store._DB_PATH)   # noqa: SLF001
    if os.name == "nt" and (not os.environ.get("STUDY_DB_PATH") or os.path.normcase(db).startswith(os.path.normcase("C:/data"))):
        print(json.dumps({"refused": "set STUDY_DB_PATH to a local sandbox study.db (never C:/data)"}))
        return 2
    if not os.path.isfile(db):
        print(json.dumps({"refused": "no study database at the configured path; the fill never creates one"}))
        return 2
    from api.services import study_hard, study_intraday
    from api.routers import study as study_router
    study_store.init_db()   # the table, on the existing database (idempotent)
    tf_min = int(args.tf)

    items = study_store.intraday_candidates()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    if only:
        items = [it for it in items if it["id"] in only]
    setups = set(study_hard.SETUP_RULES)
    # one chart per snapshot, setups first (the run-on modes play them), then the other chart items
    by_bars: dict[str, dict] = {}
    for it in sorted(items, key=lambda r: (0 if (r.get("type") == "spot" and r.get("skill_id") in setups) else 1, r["id"])):
        by_bars.setdefault(it["bars_ref"], it)
    done_rows = set() if args.refresh else study_store.intraday_filled(with_days_only=args.retry_empty)
    todo = [(bid, it) for bid, it in by_bars.items() if bid not in done_rows]

    file_bars = _file_source(args.from_file) if args.from_file else None
    if file_bars is None:
        from api.services import bars_fetch
    started = time.monotonic()
    tally: Counter = Counter()
    why: Counter = Counter()
    errors_in_a_row = 0
    for bid, it in todo:
        if args.limit and tally["charts"] >= args.limit:
            break
        if (time.monotonic() - started) / 60.0 > args.max_minutes:
            tally["stopped_for_time"] = 1
            break
        fwd = study_router._forward_bars(it)   # noqa: SLF001  (exactly the strip the run-on serves)
        keys = [k for k in (study_intraday.day_key(b.get("t")) for b in fwd) if k]
        if not keys:
            tally["no_forward"] += 1
            continue
        if keys[0] < study_intraday.INTRADAY_FLOOR:
            tally["before_floor"] += 1
            if not args.dry_run:
                study_store.upsert_intraday(bid, args.tf, {"days": {}, "passed": 0, "failed": 0,
                                                           "why": {"before_floor": len(keys)}}, source="none")
            continue
        sym = str(it["sym"]).upper()
        if file_bars is not None:
            bars = [b for b in file_bars.get(sym, []) if keys[0] <= (study_intraday.day_key(b["t"]) or 0) <= keys[-1]]
            if not bars:
                tally["not_in_file"] += 1
                continue
            source = f"file:{pathlib.Path(args.from_file).name}"
        else:
            try:
                bars = bars_fetch._fetch_intraday_range(sym, args.tf, _ymd(keys[0]), _ymd(keys[-1]), raise_errors=True)  # noqa: SLF001
                errors_in_a_row = 0
            except Exception as e:  # noqa: BLE001  (the type only: a provider error can carry the request URL)
                tally["fetch_errors"] += 1
                why[f"fetch:{type(e).__name__}"] += 1
                errors_in_a_row += 1
                if errors_in_a_row >= MAX_ERRORS_IN_A_ROW:
                    tally["stopped_for_errors"] = 1
                    break
                continue
            source = f"provider:{args.tf}m"
            time.sleep(max(0.0, args.pause))
        built = study_intraday.build(fwd, bars, tf_min)
        tally["charts"] += 1
        tally["days_passed"] += built["passed"]
        tally["days_failed"] += built["failed"]
        tally["charts_with_days"] += 1 if built["passed"] else 0
        why.update(built["why"])
        if not args.dry_run:
            study_store.upsert_intraday(bid, args.tf, built, source=source)
        if tally["charts"] % 25 == 0:
            print(json.dumps({"progress": tally["charts"], "of": len(todo), "minutes": round((time.monotonic() - started) / 60, 1)}), flush=True)

    left = len(todo) - tally["charts"] - tally["before_floor"] - tally["no_forward"] - tally["not_in_file"]
    print(json.dumps({"dry_run": args.dry_run, "tf": args.tf, "charts_total": len(by_bars),
                      "already_filled": len(by_bars) - len(todo), **dict(tally), "left": max(0, left),
                      "why_days_failed": dict(why), "minutes": round((time.monotonic() - started) / 60, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
