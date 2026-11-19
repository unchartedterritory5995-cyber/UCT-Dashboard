"""Deep daily history rebuilt from ONE source (2026-11-18; plan: reports/2026-11-18 deep daily history rebuild plan.md).

Why: the served daily history is a patchwork (yfinance before the vendor's first bar, the vendor's per-TICKER
bars after it, gap fills, serve-time corrections). A census against an independent vendor found 470 of 3,612
symbols disagreeing for 15+ bars, cliffs at 2003-09-10 (the vendor's archive start: MNST x75), one-bar spikes,
and other companies inside a ticker's history (GEN held GenOn and Genesis Healthcare).

What this builds, per CURRENT universe symbol T:
  * the vendor's OFFICIAL daily bars (day_aggs_v1, one file per session from 2003-09-10, D:/uct-history/raw_day)
  * of TODAY's company only (`identity.plan`, from the vendor's ticker events): T's own bars from the day
    today's company took T (`since`), and before that only the company's EARLIER tickers inside the windows it
    traded under each. ⛔ T's own bars before `since` are never used: they are whoever held T then, including a
    delisted holder the events file cannot name (GEN's GenOn / Genesis).
  * on today's split basis (`factors`): one split table for the whole lineage, each split taken from the symbol
    it executed under, inside that symbol's window (FI's 2021 reverse split is Frank's International's, never
    Fiserv's).
Nothing is served from here; `check` compares the result with an independent vendor and the served series.

  python tools/history_lake/daily_build.py ingest --root D:/uct-history
  python tools/history_lake/daily_build.py build  --root D:/uct-history
Reads only files on this PC; writes only under --root.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from tools.history_lake import factors, identity  # noqa: E402

UNIVERSE = HERE.parents[1] / "api" / "data" / "cap_universe.json"


def universe() -> List[str]:
    u = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    syms = u if isinstance(u, list) else (u.get("tickers") or u.get("symbols") or list(u))
    return sorted({(s if isinstance(s, str) else (s.get("ticker") or s.get("symbol"))) for s in syms} - {None, ""})


def app_to_vendor(sym: str) -> str:
    """The app keys class shares with a hyphen (BRK-B); the vendor's files with a dot (BRK.B)."""
    return sym.replace("-", ".")


def lineage(records: List[dict], syms: Iterable[str]) -> Dict[str, dict]:
    """{T: {"since": ISO or None, "segments": [{"sym", "from", "until"}, ...oldest first]}} for every T.
    `since` None: no usable events record (T's own bars are taken whole)."""
    plans = identity.plan(records)
    by_t = {r["ticker"]: r for r in records}
    out = {}
    for t in syms:
        v = app_to_vendor(t)
        p = plans.get(v)
        if p is not None:
            out[t] = {"since": p["since"], "segments": p["segments"], "cut": p["cut"]}
            continue
        ev = identity._events(by_t[v]) if v in by_t else []
        since = None
        if ev and ev[-1][1] == v:
            i = len(ev) - 1
            while i > 0 and ev[i - 1][1] == v:
                i -= 1
            since = ev[i][0]
        out[t] = {"since": since, "segments": [], "cut": False}
    return out


def splits_for(sym: str, by_sym: Dict[str, list]) -> list:
    """A symbol's splits. ⚠️ The vendor's split reference files a class share's events under BOTH spellings
    (2026-11-18: BF.B's 2004 and 2008 splits under `BF.B`, its 2012 / 2016 / 2018 ones under `BFB`; BF.A's
    only under `BFA`, HEI.A's only under `HEIA`) while the day files always say `BF.A`. A dotted symbol reads
    both, one split per execution date (the same event filed twice is never applied twice)."""
    rows = list(by_sym.get(sym, ()))
    if "." in sym:
        seen = {r[0] for r in rows}
        rows += [r for r in by_sym.get(sym.replace(".", ""), ()) if r[0] not in seen]
    return sorted(rows)


def split_table(lin: dict, t: str, by_sym: Dict[str, list]) -> list:
    """One [[execution_date, ratio], ...] for the whole lineage: each segment's splits inside its window,
    and T's own from `since` on."""
    rows = []
    own = splits_for(app_to_vendor(t), by_sym)
    for seg in lin["segments"]:
        got = [r for r in splits_for(seg["sym"], by_sym) if seg["from"] <= r[0] < seg["until"]]
        # ⚠️ The vendor files SOME of a renamed company's splits under its CURRENT ticker (2026-11-18: Ball's
        # 2004 and 2017 2:1 splits sit under BALL, though it traded as BLL until 2022; Balchem's 2006 3:2s
        # under BCPC, not BCP). Inside a segment's window T's own entries count too, but ONLY when no other
        # company ever held T (`cut` False): FI's 2021 reverse split is Frank's International's, never Fiserv's.
        if not lin.get("cut"):
            seen = {r[0] for r in got}
            got += [r for r in own if seg["from"] <= r[0] < seg["until"] and r[0] not in seen]
        rows += got
    since = lin["since"]
    rows += [r for r in own if since is None or r[0] >= since]
    return sorted(rows)


# ── ingest ─────────────────────────────────────────────────────────────────────────────────────────

def ingest(root: Path, needed: Iterable[str], db: Path) -> int:
    """raw_day/YYYY/DATE.csv.gz -> db.day(ticker, ymd, o, h, l, c, v) for the needed vendor symbols."""
    needed = set(needed)
    con = sqlite3.connect(db)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE IF NOT EXISTS day (ticker TEXT NOT NULL, ymd INTEGER NOT NULL, o REAL, h REAL, "
                "l REAL, c REAL, v REAL, PRIMARY KEY (ticker, ymd)) WITHOUT ROWID")
    con.execute("CREATE TABLE IF NOT EXISTS ingested (day TEXT PRIMARY KEY)")
    done = {r[0] for r in con.execute("SELECT day FROM ingested")}
    files = sorted((root / "raw_day").glob("*/*.csv.gz"))
    n, t0 = 0, time.time()
    for k, f in enumerate(files):
        day = f.name[:10]
        if day in done:
            continue
        ymd = int(day.replace("-", ""))
        rows = []
        with gzip.open(f, "rt", newline="") as fh:
            rd = csv.reader(fh)
            hdr = next(rd)
            ix = {name: i for i, name in enumerate(hdr)}
            for r in rd:
                tk = r[ix["ticker"]]
                if tk in needed:
                    rows.append((tk, ymd, float(r[ix["open"]]), float(r[ix["high"]]), float(r[ix["low"]]),
                                 float(r[ix["close"]]), float(r[ix["volume"]])))
        with con:
            con.executemany("INSERT OR REPLACE INTO day VALUES (?,?,?,?,?,?,?)", rows)
            con.execute("INSERT OR REPLACE INTO ingested VALUES (?)", (day,))
        n += len(rows)
        if k % 500 == 0:
            print(f"ingest {k}/{len(files)} {day} rows {n} {time.time() - t0:.0f}s", flush=True)
    con.close()
    return n


# ── build ──────────────────────────────────────────────────────────────────────────────────────────

def _iso(ymd: int) -> str:
    s = str(ymd)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def build_one(con: sqlite3.Connection, t: str, lin: dict, by_sym: Dict[str, list]) -> dict:
    """T's rebuilt daily series: [[ISO date, o, h, l, c, v], ...] ascending, split-adjusted."""
    parts = []
    for seg in lin["segments"]:
        parts += con.execute("SELECT ymd,o,h,l,c,v FROM day WHERE ticker=? AND ymd>=? AND ymd<? ORDER BY ymd",
                             (seg["sym"], int(seg["from"].replace("-", "")), int(seg["until"].replace("-", "")))).fetchall()
    lo = int(lin["since"].replace("-", "")) if lin["since"] else 0
    parts += con.execute("SELECT ymd,o,h,l,c,v FROM day WHERE ticker=? AND ymd>=? ORDER BY ymd",
                         (app_to_vendor(t), lo)).fetchall()
    parts.sort()
    table = split_table(lin, t, by_sym)
    dates = [_iso(r[0]) for r in parts]
    o, h, l, c, v = factors.adjust_bars(dates, [r[1] for r in parts], [r[2] for r in parts], [r[3] for r in parts],
                                        [r[4] for r in parts], [r[5] for r in parts], table)
    bars = [[d, round(o[i], 4), round(h[i], 4), round(l[i], 4), round(c[i], 4), round(v[i])] for i, d in enumerate(dates)]
    return {"sym": t, "since": lin["since"], "segments": lin["segments"], "splits": table, "bars": bars}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("ingest", "build"))
    ap.add_argument("--root", default="D:/uct-history")
    ap.add_argument("--only", default="", help="comma-separated symbols (build)")
    a = ap.parse_args(argv)
    root = Path(a.root)
    db = root / "daily-v1" / "day.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    records = identity.load_records(root / "ref" / "ticker_events.jsonl")
    syms = universe()
    lin = lineage(records, syms)
    if a.cmd == "ingest":
        needed = {app_to_vendor(t) for t in syms} | {s["sym"] for p in lin.values() for s in p["segments"]}
        print("needed vendor symbols", len(needed), flush=True)
        print("rows", ingest(root, needed, db))
        return 0
    split_rows = json.loads((root / "ref" / "splits.json").read_text(encoding="utf-8"))["rows"]
    as_of = time.strftime("%Y-%m-%d")
    by_sym = factors.build_factor_tables(split_rows, as_of)
    con = sqlite3.connect(db)
    out_dir = root / "daily-v1" / "series"
    out_dir.mkdir(parents=True, exist_ok=True)
    only = [s for s in a.only.split(",") if s] or syms
    t0 = time.time()
    for k, t in enumerate(only):
        rec = build_one(con, t, lin[t] if t in lin else {"since": None, "segments": [], "cut": False}, by_sym)
        tmp = out_dir / f"{t}.json.tmp"
        tmp.write_text(json.dumps(rec, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, out_dir / f"{t}.json")
        if k % 500 == 0:
            print(f"build {k}/{len(only)} {t} {len(rec['bars'])} bars {time.time() - t0:.0f}s", flush=True)
    print("built", len(only))
    return 0


if __name__ == "__main__":
    sys.exit(main())
