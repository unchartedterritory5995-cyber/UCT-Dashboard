"""Study -- fill the INTRADAY course charts from the provider, on the pod, checking each one (2026-11-15).

WHY
---
The intraday setup lessons (opening range, 30-minute pivot, Go Signal, red to green, opening drive) teach a decision
inside the day, so their charts are 5 to 60-minute bars of the dossier's real examples. The import resolves a course
chart from the pod's own bars.db only (B3), and the pod keeps a few months of intraday bars for a few dozen names, so
most of these charts arrive as a MISS: the item is stored as a draft with no bars and cannot be approved. This fetches
each such chart's bars ONCE from the provider (where the key lives; it is never printed), keeps the regular session only
(09:30 to 16:00 New York), and runs the same checks every daily course chart passes (check_course_charts.check_bars:
the last visible bar IS the decision bar, enough history, enough replay, a drawn trade traded in that bar with its stop
beyond the bar, stop within 6%). Only a chart that passes is stored (study_store.upsert_bars under the item's own
bars_ref), so a chart the bars contradict stays a miss and never reaches the review screen with a picture. Nothing is
written to bars.db (the app's shared chart cache): the snapshot is the item's own record.

HOW TO RUN (on the pod, from PowerShell; after the bank import)
---------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_intraday.py --dry-run
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_intraday.py
It prints counts and each failing chart's reasons (ids and numbers only). Re-runs skip charts already filled
(`--refresh` re-fetches). Off the pod it refuses unless STUDY_DB_PATH names an existing sandbox study.db (never C:/data);
`--from-db <bars.db copy>` reads bars from a local copy instead of the provider (a local check).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import pathlib
import sys
import time
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scripts.study.check_course_charts import check_bars  # noqa: E402
from scripts.study.courses_lib import INTRADAY_TFS, INTRADAY_WARMUP, _ny  # noqa: E402

BANK_DIR = REPO / "docs" / "study" / "bank"
MAX_ERRORS_IN_A_ROW = 5


def intraday_charts(bank_dir: pathlib.Path = BANK_DIR) -> list[dict]:
    """Every course item in the bank whose chart is intraday: {id, sym, tf, asof_key, window, forward, trade}."""
    out = []
    for p in sorted(bank_dir.glob("course.*.json")):
        for it in json.loads(p.read_text(encoding="utf-8")):
            b = it.get("bars") or {}
            if str(b.get("tf") or "D") not in INTRADAY_TFS or b.get("asof_key") is None:
                continue
            tr = (it.get("reveal_json") or {}).get("trade")
            out.append({"id": it["id"], "sym": str(b["sym"]).upper(), "tf": str(b["tf"]), "asof_key": int(b["asof_key"]),
                        "window": int(b["window"]) - INTRADAY_WARMUP, "forward": int(b.get("forward") or 0),
                        "trade": ({"entry": tr["entry"], "stop": tr["stop"], "direction": tr.get("direction")} if tr else None)})
    return out


def regular_session(rows: list[dict]) -> list[dict]:
    """Bars that START inside 09:30-16:00 New York (the provider also returns the extended session)."""
    ny = _ny()
    keep = []
    for r in rows:
        t = dt.datetime.fromtimestamp(int(r["t"]), ny)
        m = t.hour * 60 + t.minute
        if 9 * 60 + 30 <= m < 16 * 60 and t.weekday() < 5:
            keep.append(r)
    return keep


def fetch_span(ch: dict) -> tuple[str, str]:
    """The calendar dates to fetch: enough sessions back for the window and the warm-up, enough ahead for the replay."""
    per = 390 // int(ch["tf"])
    back = math.ceil((ch["window"] + INTRADAY_WARMUP) / per) + 1
    ahead = math.ceil(max(1, ch["forward"]) / per) + 1
    day = dt.datetime.fromtimestamp(ch["asof_key"], _ny()).date()
    return ((day - dt.timedelta(days=int(back * 1.6) + 5)).isoformat(), (day + dt.timedelta(days=int(ahead * 1.6) + 5)).isoformat())


def cut(ch: dict, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """The visible bars (the window plus the warm-up, ending AT the decision bar) and the replay after it."""
    rows = sorted(regular_session(rows), key=lambda r: int(r["t"]))
    upto = [r for r in rows if int(r["t"]) <= ch["asof_key"]]
    after = [r for r in rows if int(r["t"]) > ch["asof_key"]]
    return upto[-(ch["window"] + INTRADAY_WARMUP):], after[:ch["forward"]]


def as_rows(bars: list[dict]) -> list[tuple]:
    return [(int(b["t"]), b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and check, write nothing")
    ap.add_argument("--refresh", action="store_true", help="re-fetch charts already filled")
    ap.add_argument("--only", default="", help="comma-separated item ids")
    ap.add_argument("--max-minutes", type=float, default=25.0)
    ap.add_argument("--pause", type=float, default=0.1, help="seconds between provider requests")
    ap.add_argument("--from-db", default="", help="read bars from this bars.db copy instead of the provider (local check)")
    args = ap.parse_args(argv)

    from api.services import study_store
    db = os.path.abspath(study_store._DB_PATH)   # noqa: SLF001
    if os.name == "nt" and (not os.environ.get("STUDY_DB_PATH") or os.path.normcase(db).startswith(os.path.normcase("C:/data"))):
        print(json.dumps({"refused": "set STUDY_DB_PATH to a local sandbox study.db (never C:/data)"}))
        return 2
    if not os.path.isfile(db):
        print(json.dumps({"refused": "no study database at the configured path; the fill never creates one"}))
        return 2

    charts = intraday_charts()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    if only:
        charts = [c for c in charts if c["id"] in only]
    if args.from_db:
        import sqlite3
        local = sqlite3.connect(f"file:{pathlib.Path(args.from_db).as_posix()}?mode=ro", uri=True)
    else:
        from api.services import bars_fetch
    tally: Counter = Counter()
    failed: list[dict] = []
    started = time.monotonic()
    errors_in_a_row = 0
    for ch in charts:
        if (time.monotonic() - started) / 60.0 > args.max_minutes:
            tally["stopped_for_time"] = 1
            break
        item = study_store.get_item_full(ch["id"])
        if not item:
            tally["not_imported"] += 1
            continue
        have = study_store.get_visible_bars(ch["id"], approved_only=False) or {}
        if have.get("bars") and not args.refresh:
            tally["already_filled"] += 1
            continue
        frm, to = fetch_span(ch)
        try:
            if args.from_db:
                a = int(dt.datetime.fromisoformat(frm).replace(tzinfo=_ny()).timestamp())
                b = int(dt.datetime.fromisoformat(to).replace(tzinfo=_ny()).timestamp())
                rows = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in local.execute(
                    "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND ts<? ORDER BY ts", (ch["sym"], ch["tf"], a, b))]
            else:
                rows = bars_fetch._fetch_intraday_range(ch["sym"], ch["tf"], frm, to, raise_errors=True)  # noqa: SLF001
                time.sleep(max(0.0, args.pause))
            errors_in_a_row = 0
        except Exception as e:  # noqa: BLE001  (the type only: a provider error can carry the request URL)
            tally["fetch_errors"] += 1
            failed.append({"id": ch["id"], "why": [f"fetch:{type(e).__name__}"]})
            errors_in_a_row += 1
            if errors_in_a_row >= MAX_ERRORS_IN_A_ROW:
                tally["stopped_for_errors"] = 1
                break
            continue
        vis, fwd = cut(ch, rows or [])
        spec = {"tf": ch["tf"], "asof": dt.datetime.fromtimestamp(ch["asof_key"], _ny()).strftime("%Y-%m-%d %H:%M"),
                "window": ch["window"], "forward": ch["forward"], "trade": ch["trade"]}
        problems, notes = check_bars(spec, as_rows(vis), as_rows(fwd))
        tally["checked"] += 1
        if problems:
            tally["failed"] += 1
            failed.append({"id": ch["id"], "sym": ch["sym"], "why": problems})
            continue
        tally["passed"] += 1
        if not args.dry_run:
            bars_ref = item.get("bars_ref") or f"sb_{ch['id']}"
            study_store.upsert_bars(bars_ref, ch["tf"], vis, fwd)
            tally["stored"] += 1
    print(json.dumps({"dry_run": args.dry_run, "intraday_charts": len(charts), **dict(tally), "failed": failed,
                      "minutes": round((time.monotonic() - started) / 60, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
