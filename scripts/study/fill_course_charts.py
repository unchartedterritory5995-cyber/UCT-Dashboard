"""Study -- fill the course charts the import cannot resolve (intraday and index), on the pod, checking each one.

WHY
---
The import resolves a course chart from the pod's own bars.db only (B3). Two kinds of chart are not there:

  - INTRADAY (2026-11-15): the opening range, 30-minute pivot, Go Signal, red to green and opening drive lessons teach a
    decision inside the day, so their charts are 5 to 60-minute bars of the dossiers' real examples. The pod keeps a few
    months of intraday bars for a few dozen names, so most arrive as a MISS. This fetches each from the provider (where
    the key lives; it is never printed) and keeps the regular session only (09:30 to 16:00 New York).
  - INDEX (2026-11-16): a history question that quotes an index level is drawn on that index (courses_lib.INDEX_SERIES:
    SPX, IXIC, NDX, DJI, RUT), from Yahoo's daily history (yfinance, the source the app's index charts already use,
    api/index_bars.py). The import never reads bars.db for these (`source: "index"`).

Each chart then runs the checks every course chart passes (check_course_charts.check_bars: the last visible bar IS the
decision bar, enough history, enough replay, a drawn trade traded in that bar with its stop beyond it; an index chart
shows candles, not closes only, on every day the member sees). Only a chart that passes is stored
(study_store.upsert_bars under the item's own bars_ref), so a chart the bars contradict stays a miss and never reaches
the review screen with a picture. Nothing is written to bars.db (the app's shared chart cache).

HOW TO RUN (on the pod, from PowerShell; after the bank import)
---------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_charts.py --dry-run
  railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_charts.py
It prints counts and each failing chart's reasons (ids and numbers only). Re-runs skip charts already filled
(`--refresh` re-fetches; `--kind intraday|index` does one kind). Off the pod it refuses unless STUDY_DB_PATH names an
existing sandbox study.db (never C:/data); `--from-db <bars.db copy>` reads intraday bars from a local copy and
`--index-dir <folder>` index histories from <SYM>.json files instead of fetching (a local check). `--dump <folder>`
only writes each index's whole daily history there (for check_course_charts --index-dir) and touches no database.
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

from scripts.study.check_course_charts import check_bars, cut_daily, index_rows  # noqa: E402
from scripts.study.courses_lib import (  # noqa: E402
    INDEX_OWN_VOLUME, INDEX_SERIES, INTRADAY_TFS, INTRADAY_WARMUP, WARMUP_BARS, _ny,
)

BANK_DIR = REPO / "docs" / "study" / "bank"
MAX_ERRORS_IN_A_ROW = 5


def course_fill_charts(bank_dir: pathlib.Path = BANK_DIR) -> list[dict]:
    """Every course item whose chart the import leaves to this fill: {id, kind, sym, tf, asof_key, window, forward, trade}.
    asof_key is the bar's unix start for an intraday chart, YYYYMMDD for an index one; window is the chart's own (the
    warm-up taken off)."""
    out = []
    for p in sorted(bank_dir.glob("course.*.json")):
        for it in json.loads(p.read_text(encoding="utf-8")):
            b = it.get("bars") or {}
            tf = str(b.get("tf") or "D")
            if tf in INTRADAY_TFS and b.get("asof_key") is not None:
                kind, key, warm = "intraday", int(b["asof_key"]), INTRADAY_WARMUP
            elif b.get("source") == "index" and b.get("asof"):
                kind, key, warm = "index", int(str(b["asof"]).replace("-", "")), WARMUP_BARS
            else:
                continue
            tr = (it.get("reveal_json") or {}).get("trade")
            out.append({"id": it["id"], "kind": kind, "sym": str(b["sym"]).upper(), "tf": tf, "asof_key": key,
                        "window": int(b["window"]) - warm, "forward": int(b.get("forward") or 0),
                        "trade": ({"entry": tr["entry"], "stop": tr["stop"], "direction": tr.get("direction")} if tr else None)})
    return out


def intraday_charts(bank_dir: pathlib.Path = BANK_DIR) -> list[dict]:
    """The intraday ones only."""
    return [c for c in course_fill_charts(bank_dir) if c["kind"] == "intraday"]


def index_charts(bank_dir: pathlib.Path = BANK_DIR) -> list[dict]:
    """The index ones only."""
    return [c for c in course_fill_charts(bank_dir) if c["kind"] == "index"]


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


def _day_of(key: int) -> dt.date:
    return dt.date(key // 10000, (key // 100) % 100, key % 100)


def fetch_span(ch: dict) -> tuple[str, str]:
    """The calendar dates to fetch: enough sessions back for the window and the warm-up, enough ahead for the replay."""
    if ch.get("kind") == "index":
        day = _day_of(ch["asof_key"])
        back = ch["window"] + WARMUP_BARS
        return ((day - dt.timedelta(days=int(back * 1.5) + 10)).isoformat(),
                (day + dt.timedelta(days=int(max(1, ch["forward"]) * 1.6) + 10)).isoformat())
    per = 390 // int(ch["tf"])
    back = math.ceil((ch["window"] + INTRADAY_WARMUP) / per) + 1
    ahead = math.ceil(max(1, ch["forward"]) / per) + 1
    day = dt.datetime.fromtimestamp(ch["asof_key"], _ny()).date()
    return ((day - dt.timedelta(days=int(back * 1.6) + 5)).isoformat(), (day + dt.timedelta(days=int(ahead * 1.6) + 5)).isoformat())


def cut(ch: dict, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """An intraday chart's visible bars (the window plus the warm-up, ending AT the decision bar) and the replay after it."""
    rows = sorted(regular_session(rows), key=lambda r: int(r["t"]))
    upto = [r for r in rows if int(r["t"]) <= ch["asof_key"]]
    after = [r for r in rows if int(r["t"]) > ch["asof_key"]]
    return upto[-(ch["window"] + INTRADAY_WARMUP):], after[:ch["forward"]]


def fetch_index_daily(sym: str, start: str | None = None, end: str | None = None) -> list[list]:
    """An index's daily rows [[YYYYMMDD, o, h, l, c, v], ...] oldest first from Yahoo (start/end ISO dates, end exclusive;
    both None: the whole history). Prices to the cent, as the questions quote them. An index whose volume there is
    another index's (courses_lib.INDEX_OWN_VOLUME) gets 0: no volume is drawn rather than a wrong one."""
    import yfinance as yf
    yahoo = INDEX_SERIES[sym.upper()]
    own_volume = sym.upper() in INDEX_OWN_VOLUME
    kw = {"start": start, "end": end} if (start or end) else {"period": "max"}
    df = yf.download(yahoo, interval="1d", auto_adjust=False, prepost=False, progress=False, threads=False, **kw)
    if df is None or df.empty:
        return []
    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)
    rows = []
    for idx, r in df.iterrows():
        o, h, l, c = (float(r[k]) for k in ("Open", "High", "Low", "Close"))
        if any(x != x for x in (o, h, l, c)):
            continue
        v = r.get("Volume", 0) if own_volume else 0
        rows.append([int(idx.strftime("%Y%m%d")), round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v) if v == v else 0])
    return rows


def as_rows(bars: list[dict]) -> list[tuple]:
    return [(int(b["t"]), b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


def as_bars(rows: list) -> list[dict]:
    return [{"t": int(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _refuse_c_data(path: str) -> bool:
    """True for C:/data itself or anything inside it (the live data root); a sibling such as C:/data-studytest, the
    sandbox, is not inside it."""
    p, root = os.path.normcase(os.path.abspath(path)), os.path.normcase(os.path.abspath("C:/data"))
    return p == root or p.startswith(root + os.sep)


def main(argv=None, *, default_kind: str = "all") -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and check, write nothing")
    ap.add_argument("--refresh", action="store_true", help="re-fetch charts already filled")
    ap.add_argument("--kind", default=default_kind, choices=("all", "intraday", "index"))
    ap.add_argument("--only", default="", help="comma-separated item ids")
    ap.add_argument("--max-minutes", type=float, default=25.0)
    ap.add_argument("--pause", type=float, default=0.1, help="seconds between provider requests")
    ap.add_argument("--from-db", default="", help="read intraday bars from this bars.db copy instead of the provider (local check)")
    ap.add_argument("--index-dir", default="", help="read index histories from <SYM>.json here instead of Yahoo (local check)")
    ap.add_argument("--dump", default="", help="only write each index's whole daily history to <SYM>.json in this folder")
    args = ap.parse_args(argv)

    if args.dump:
        if _refuse_c_data(args.dump):
            print(json.dumps({"refused": "never write under C:/data"}))
            return 2
        out = pathlib.Path(args.dump)
        out.mkdir(parents=True, exist_ok=True)
        got = {}
        for sym in INDEX_SERIES:
            rows = fetch_index_daily(sym)
            (out / f"{sym}.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
            got[sym] = len(rows)
            time.sleep(max(0.0, args.pause))
        print(json.dumps({"dumped": got}))
        return 0

    from api.services import study_store
    db = os.path.abspath(study_store._DB_PATH)   # noqa: SLF001
    if os.name == "nt" and (not os.environ.get("STUDY_DB_PATH") or _refuse_c_data(db)):
        print(json.dumps({"refused": "set STUDY_DB_PATH to a local sandbox study.db (never C:/data)"}))
        return 2
    if not os.path.isfile(db):
        print(json.dumps({"refused": "no study database at the configured path; the fill never creates one"}))
        return 2

    charts = course_fill_charts(BANK_DIR)
    if args.kind != "all":
        charts = [c for c in charts if c["kind"] == args.kind]
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    if only:
        charts = [c for c in charts if c["id"] in only]
    local = None
    if args.from_db:
        import sqlite3
        local = sqlite3.connect(f"file:{pathlib.Path(args.from_db).as_posix()}?mode=ro", uri=True)
    bars_fetch = None
    index_cache: dict[str, list] = {}
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
        # a stored snapshot SHORTER than the window plus its warm-up is fetched again (the 2026-11-16 screen check: an
        # import from a bars copy holding part of a day stored 15 bars of a 241-bar chart, and the fill had counted any
        # stored bars as filled)
        want = ch["window"] + (WARMUP_BARS if ch["kind"] == "index" else INTRADAY_WARMUP)
        if have.get("bars") and len(have["bars"]) >= want and not args.refresh:
            tally["already_filled"] += 1
            continue
        if have.get("bars") and not args.refresh:
            tally["short_refetched"] += 1
        frm, to = fetch_span(ch)
        try:
            if ch["kind"] == "index":
                if args.index_dir:
                    if ch["sym"] not in index_cache:
                        index_cache[ch["sym"]] = list(index_rows(args.index_dir, ch["sym"]) or [])
                    lo, hi = int(frm.replace("-", "")), int(to.replace("-", ""))
                    rows = [r for r in index_cache[ch["sym"]] if lo <= int(r[0]) < hi]
                else:
                    rows = fetch_index_daily(ch["sym"], frm, to)
                    time.sleep(max(0.0, args.pause))
            elif local is not None:
                a = int(dt.datetime.fromisoformat(frm).replace(tzinfo=_ny()).timestamp())
                b = int(dt.datetime.fromisoformat(to).replace(tzinfo=_ny()).timestamp())
                rows = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in local.execute(
                    "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND ts<? ORDER BY ts", (ch["sym"], ch["tf"], a, b))]
            else:
                if bars_fetch is None:
                    from api.services import bars_fetch
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
        if ch["kind"] == "index":
            vrows, frows = cut_daily([tuple(r) for r in rows or []], ch["asof_key"], ch["window"] + WARMUP_BARS, ch["forward"])
            vis, fwd = as_bars(vrows), as_bars(frows)
            asof = _day_of(ch["asof_key"]).isoformat()
        else:
            vis, fwd = cut(ch, rows or [])
            asof = dt.datetime.fromtimestamp(ch["asof_key"], _ny()).strftime("%Y-%m-%d %H:%M")
        spec = {"sym": ch["sym"], "tf": ch["tf"], "asof": asof, "window": ch["window"], "forward": ch["forward"], "trade": ch["trade"]}
        problems, _notes = check_bars(spec, as_rows(vis), as_rows(fwd))
        tally["checked"] += 1
        tally[f"checked_{ch['kind']}"] += 1
        if problems:
            tally["failed"] += 1
            failed.append({"id": ch["id"], "sym": ch["sym"], "why": problems})
            continue
        tally["passed"] += 1
        if not args.dry_run:
            bars_ref = item.get("bars_ref") or f"sb_{ch['id']}"
            study_store.upsert_bars(bars_ref, ch["tf"], vis, fwd)
            tally["stored"] += 1
    print(json.dumps({"dry_run": args.dry_run, "kind": args.kind, "charts": len(charts), **dict(tally), "failed": failed,
                      "minutes": round((time.monotonic() - started) / 60, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
