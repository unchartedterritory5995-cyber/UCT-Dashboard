"""A tiny but real Market Cap V1 --data dir (inputs.db / prices.db / ref.jsonl / acceptance.db) that build.py runs on.

Every issuer has quarterly cover counts (dei:EntityCommonStockSharesOutstanding, 10-Q, accepted 14:00Z on the filing
date) and daily bars; `snapshot` sets which tickers SEC's CURRENT submissions list for each CIK.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, timedelta

from api.services.marketcap import inputs as I
from api.services.marketcap.acceptance import SCHEMA as ACC_DDL
from api.services.marketcap.prices import DDL as PX_DDL


def sessions(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def quarter_ends(start: date, end: date) -> list[date]:
    out = []
    for y in range(start.year, end.year + 1):
        for m, dd in ((3, 31), (6, 30), (9, 30), (12, 31)):
            q = date(y, m, dd)
            if start <= q <= end:
                out.append(q)
    return out


class Fixture:
    """issuers: {cik: {"name", "shares", "span": (first, last), "bars": {ticker: (first, last, close)}}}"""

    def __init__(self, root: str, issuers: dict, refs: dict | None = None):
        self.root, self.issuers, self.refs = root, issuers, refs or {}

    def write(self, snapshot: dict[int, list[str]], name: str = "data", extra_filings: dict | None = None,
              bars: dict | None = None, refs: dict | None = None) -> str:
        """`bars` {ticker: (first, last, close) | None} overrides the issuers' bars for this snapshot (a provider re-keying
        a renamed history, a reused symbol); `refs` overrides the Massive reference records."""
        d = os.path.join(self.root, name)
        os.makedirs(d, exist_ok=True)
        inp = sqlite3.connect(os.path.join(d, "inputs.db"))
        inp.executescript(I.DDL)
        acc = sqlite3.connect(os.path.join(d, "acceptance.db"))
        acc.executescript(ACC_DDL)
        for cik, spec in self.issuers.items():
            inp.execute("INSERT INTO issuer VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (cik, spec["name"], "operating", None, "1000", "DE", "1231", json.dumps(snapshot.get(cik, [])),
                         json.dumps(["NYSE"] * len(snapshot.get(cik, []))), "[]"))
            first, last = spec["span"]
            for i, q in enumerate(quarter_ends(first, last)):
                filed = q + timedelta(days=35)
                accn = f"{cik:010d}-{q.year % 100:02d}-{i:06d}"
                pub = f"{filed.isoformat()}T14:00:00+00:00"
                inp.execute("INSERT INTO filing VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (cik, accn, "10-Q", filed.isoformat(), q.isoformat(), pub, pub, "q.htm", 1, 0))
                inp.execute("INSERT INTO fact VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (cik, "dei:EntityCommonStockSharesOutstanding", (q + timedelta(days=30)).isoformat(),
                             spec["shares"], accn, "10-Q", filed.isoformat(), q.year, "Q", None))
                acc.execute("INSERT INTO acceptance VALUES (?,?,?,?)", (accn, pub, "FIXTURE", None))
            for form, fd in (extra_filings or {}).get(cik, []):
                accn = f"{cik:010d}-x-{form}"
                pub = f"{fd.isoformat()}T14:00:00+00:00"
                inp.execute("INSERT INTO filing VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (cik, accn, form, fd.isoformat(), None, pub, pub, "x.htm", 0, 0))
                acc.execute("INSERT INTO acceptance VALUES (?,?,?,?)", (accn, pub, "FIXTURE", None))
        inp.commit()
        inp.close()
        acc.commit()
        acc.close()
        px = sqlite3.connect(os.path.join(d, "prices.db"))
        px.executescript(PX_DDL)
        series: dict = {}
        for spec in self.issuers.values():
            for t, b in spec["bars"].items():
                series.setdefault(t, []).append(b)
        for t, b in (bars or {}).items():
            series[t] = [] if b is None else (b if isinstance(b, list) else [b])
        for t, segs in series.items():
            for b0, b1, c in segs:
                px.executemany("INSERT OR REPLACE INTO bar VALUES (?,?,?,?)",
                               ((t, int(x.strftime("%Y%m%d")), c, 1000) for x in sessions(b0, b1)))
        px.commit()
        px.close()
        with open(os.path.join(d, "ref.jsonl"), "w") as f:
            for t, r in (self.refs if refs is None else refs).items():
                f.write(json.dumps([t, r, [], []]) + "\n")
        return d


def build(data: str, out: str) -> str:
    from api.services.marketcap import build as B
    before = set(os.listdir(out)) if os.path.exists(out) else set()
    assert B.main(["--data", data, "--out", out, "--no-hash"]) == 0
    new = [n for n in os.listdir(out) if n not in before and n.endswith(".db")]
    assert len(new) == 1, new
    return os.path.join(out, new[0])


def valued(build_db: str, cik: int) -> dict[int, float]:
    c = sqlite3.connect(f"file:{build_db}?mode=ro", uri=True)
    try:
        return dict(c.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,)))
    finally:
        c.close()


def rows(build_db: str, sql: str, *args) -> list:
    c = sqlite3.connect(f"file:{build_db}?mode=ro", uri=True)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()
