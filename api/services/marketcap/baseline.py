"""BEFORE: production Market Cap exactly as a member's chart computes it today (re-runnable baseline).

    python -m api.services.marketcap.baseline --data C:/mcapdata --v5 C:/mcapdata/v5_shares.json.gz --out base.db

Production (app/src/components/chart/engine/fundamentalSource.js + fundamentalAsOf.js, unchanged by this project):
  market_cap(bar D) = close(D) x shares_outstanding(D)
  shares_outstanding(D) = the Fundamentals V5 served point [t, v, pe, method] with the latest t <= D 16:00 ET
                          (closeUtcSeconds), BLANK when that point is a gap (v null) or when its period end pe is
                          > 200 days old at D 16:00 ET (MAX_PERIOD_AGE_DAYS).
  The chart symbol resolves to a company through V5's ticker index (one CIK per ticker, every class of an issuer
  maps to the same CIK) -- bars are whatever the ticker's bars are, with no listing boundary.
Input `--v5` is the CURRENT V5 version's served shares_outstanding series (exported read-only from R2).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MAX_PERIOD_AGE_DAYS = 200
SCHEMA = """
CREATE TABLE manifest(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE base_daily(ticker TEXT, d INTEGER, cap REAL, PRIMARY KEY(ticker, d)) WITHOUT ROWID;
CREATE TABLE base_ticker(ticker TEXT PRIMARY KEY, cik INTEGER, first_bar INTEGER, last_bar INTEGER, bars INTEGER,
  valued INTEGER, first_value INTEGER, last_value INTEGER, internal_gap_days INTEGER, internal_gaps INTEGER,
  longest_gap INTEGER, trailing_gap INTEGER, blank_gap_point INTEGER, blank_stale INTEGER, blank_no_point INTEGER);
"""


def close_utc(d: int) -> int:
    day = date(d // 10000, d // 100 % 100, d % 100)
    return int(datetime.combine(day, time(16, 0), tzinfo=ET).timestamp())


def _pe_utc(pe: str) -> int:
    return int(datetime(int(pe[:4]), int(pe[5:7]), int(pe[8:10]), tzinfo=timezone.utc).timestamp())


def project(points: list, days: list[int], with_pe: bool = False) -> list[tuple]:
    """Per bar: (shares or None, why) -- why in {ok, no_point, gap_point, stale}. Mirrors projectAsOfIndices.
    with_pe=True appends the period end of the point in force (None when no point)."""
    pts = sorted(points, key=lambda p: p[0])
    out, j = [], -1
    for d in days:
        ref = close_utc(d)
        while j + 1 < len(pts) and pts[j + 1][0] <= ref:
            j += 1
        if j < 0:
            out.append((None, "no_point") + ((None,) if with_pe else ())); continue
        t, v, pe, _m = pts[j]
        tail = (str(pe) if pe else None,) if with_pe else ()
        if pe and (ref - _pe_utc(str(pe))) // 86400 > MAX_PERIOD_AGE_DAYS:
            out.append((None, "stale") + tail); continue
        if v is None:
            out.append((None, "gap_point") + tail); continue
        out.append((float(v), "ok") + tail)
    return out


def run(data: str, v5: str, out: str) -> dict:
    doc = json.load(gzip.open(v5, "rt"))
    px = sqlite3.connect(os.path.join(data, "prices.db"))
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.executescript(SCHEMA)
    tick = {t: int(c) for t, c in doc["tickers"].items()}
    have = {t for (t,) in px.execute("SELECT DISTINCT ticker FROM bar")}
    n = 0
    for t in sorted(have & set(tick)):
        cik = tick[t]
        comp = doc["companies"].get(str(cik)) or {}
        rows = px.execute("SELECT d, c FROM bar WHERE ticker=? ORDER BY d", (t,)).fetchall()
        if not rows:
            continue
        days = [d for d, _ in rows]
        sh = project(comp.get("pts") or [], days)
        val, why = [], {"gap_point": 0, "stale": 0, "no_point": 0}
        for (d, c), (s, w) in zip(rows, sh):
            if s is not None and c and c > 0:
                val.append((t, d, c * s))
            elif w in why:
                why[w] += 1
        db.executemany("INSERT INTO base_daily VALUES (?,?,?)", val)
        vd = {d for _, d, _ in val}
        first = min(vd) if vd else None
        last = max(vd) if vd else None
        gaps = longest = cur = gap_days = 0
        trailing = 0
        if first is not None:
            for d in days:
                if d < first:
                    continue
                if d in vd:
                    if cur:
                        gaps += 1; gap_days += cur; longest = max(longest, cur); cur = 0
                else:
                    cur += 1
            trailing = cur
        db.execute("INSERT INTO base_ticker VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (t, cik, days[0], days[-1], len(days), len(vd), first, last, gap_days, gaps, longest, trailing,
                    why["gap_point"], why["stale"], why["no_point"]))
        n += 1
        if n % 500 == 0:
            db.commit()
    for k, v in {"v5_version": doc["version"], "v5_manifest_sha256": doc["manifest_sha256"], "tickers": n,
                 "rule": "close x V5 shares_outstanding as-of D 16:00 ET; blank on gap point or period end > 200 d",
                 "built_at": datetime.now(timezone.utc).isoformat()}.items():
        db.execute("INSERT INTO manifest VALUES (?,?)", (k, json.dumps(v) if not isinstance(v, str) else v))
    db.commit()
    return {"tickers": n, "v5_version": doc["version"]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--v5", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    print(json.dumps(run(a.data, a.v5, a.out)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
