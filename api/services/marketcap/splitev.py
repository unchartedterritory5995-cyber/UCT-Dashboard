"""Authoritative HISTORICAL SPLIT evidence (owner decision B, 2026-10-02).

The bars are split-adjusted for corporate actions the Massive split ledger does not list (most pre-2003 splits: ABT
1998, AMAT 1995/1998/2002, KO 1992/1996 ...; and some later ones: HWM's 2016 1-for-3). Share states before such a
split stay on the OLD basis while prices are on today's, so the build DETECTS the transition (consecutive states at a
clean ratio k, price continuous across it, cap jumping) and HOLDS every earlier day.

A held transition is lifted ONLY by an AUTHORITATIVE statement of that split, from the issuer's own filings:
  * XBRL  us-gaap:StockholdersEquityNoteStockSplitConversionRatio1 / ...Ratio (companyfacts bulk, the filer's own tag);
  * TEXT  "two-for-one stock split", "3-for-2 split", "100% stock dividend", "one-for-ten reverse stock split",
          "share consolidation on a 1-for-10 basis" in the filing that first reports the post-split count, or the
          filing just before it.
The statement must give the SAME factor (within 2%) and (when dated) a date inside the transition window. Price or
share discontinuities only DETECT and CORROBORATE; they never manufacture a factor. Anything not established stays
held: HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED.

    python -m api.services.marketcap.splitev xbrl --companyfacts sec/companyfacts.zip --candidates c.json --out splitev.db
    python -m api.services.marketcap.splitev text --inputs inputs.db --candidates c.json --out splitev.db
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from . import textcover
from .textcover import DATE, for_matching, parse_date

DDL = """
CREATE TABLE IF NOT EXISTS split_evidence(cik INTEGER, ex_date TEXT, ratio REAL, source TEXT, accn TEXT, form TEXT,
  snippet TEXT, PRIMARY KEY(cik, ex_date, ratio, source, accn));
CREATE TABLE IF NOT EXISTS text_done(cik INTEGER, accn TEXT PRIMARY KEY, status TEXT, n INTEGER);
"""
WORD = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "twenty-five": 25, "thirty": 30, "forty": 40, "fifty": 50,
        "sixty": 60, "seventy-five": 75, "eighty": 80, "one hundred": 100, "hundred": 100, "two hundred": 200}
N = r"(\d{1,3}|one hundred|two hundred|twenty-five|seventy-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|eighty)"
SPLIT_RX = [
    # "two-for-one stock split", "3-for-2 split", "1-for-10 reverse stock split", "one for twenty reverse split"
    ("N_FOR_M_SPLIT", re.compile(rf"\b{N}\s*(?:\(\d+\)\s*)?[-\s]?for[-\s]?\s*{N}\s*(?:\(\d+\)\s*)?(reverse\s+)?(?:stock\s+|share\s+|common\s+stock\s+)?split", re.I)),
    ("REVERSE_N_FOR_M", re.compile(rf"reverse\s+(?:stock\s+|share\s+)?split[^.;]{{0,80}}?(?:ratio\s+of\s+|on\s+a\s+|at\s+a\s+ratio\s+of\s+)?{N}\s*(?:\(\d+\)\s*)?[-\s]?(?:for|:)[-\s]?\s*{N}", re.I)),
    ("N_TO_M_SPLIT", re.compile(rf"\b(\d{{1,3}})\s*:\s*(\d{{1,3}})\s+(reverse\s+)?(?:stock\s+|share\s+)?split", re.I)),
    ("PCT_STOCK_DIVIDEND", re.compile(r"\b(100|50|200|300|25|33\s*1/3)\s*(?:%|percent)\s+stock\s+dividend", re.I)),
    ("CONSOLIDATION", re.compile(rf"(?:share|stock)\s+consolidation[^.;]{{0,80}}?{N}\s*(?:\(\d+\)\s*)?[-\s]?(?:for|:)[-\s]?\s*{N}", re.I)),
]


def _n(tok: str) -> float | None:
    t = tok.lower().strip()
    if t in WORD:
        return float(WORD[t])
    try:
        return float(t)
    except ValueError:
        return None


def parse_splits(text: str) -> list[tuple[float, date | None, str]]:
    """-> [(ratio new-per-old, date or None, snippet)] for every split statement in the text."""
    t = for_matching(text)
    out = []
    for name, rx in SPLIT_RX:
        for m in rx.finditer(t):
            g = m.groups()
            if name == "PCT_STOCK_DIVIDEND":
                pct = 100 / 3 if g[0].startswith("33") else float(g[0])
                r = 1 + pct / 100
            else:
                a, b = _n(g[0]), _n(g[1])
                if not a or not b or a == b:
                    continue
                r = a / b
                rev = (len(g) > 2 and g[2]) or name in ("REVERSE_N_FOR_M", "CONSOLIDATION")
                if rev and r > 1:
                    r = 1 / r
            ctx = t[max(0, m.start() - 260):m.end() + 260]
            ds = [parse_date(x.group(0)) for x in re.finditer(DATE, ctx, re.I)]
            out.append((r, None, ctx[:600], [d for d in ds if d]))
    return [(r, None, snip, dates) for r, _d, snip, dates in out]


def matches(k: float, direction: str, r: float) -> bool:
    want = k if direction == "FORWARD" else 1 / k
    return abs(math.log(r) - math.log(want)) < 0.02


def xbrl(companyfacts: str, ciks: set, out: str) -> dict:
    db = sqlite3.connect(out)
    db.executescript(DDL)
    z = zipfile.ZipFile(companyfacts)
    names = set(z.namelist())
    n = 0
    for cik in sorted(ciks):
        nm = f"CIK{cik:010d}.json"
        if nm not in names:
            continue
        g = json.loads(z.read(nm)).get("facts", {}).get("us-gaap", {})
        for tag in ("StockholdersEquityNoteStockSplitConversionRatio1", "StockholdersEquityNoteStockSplitConversionRatio"):
            for _u, fs in (g.get(tag, {}).get("units") or {}).items():
                for f in fs:
                    v = f.get("val")
                    if not v or v <= 0 or abs(v - 1) < 1e-9:
                        continue
                    db.execute("INSERT OR IGNORE INTO split_evidence VALUES(?,?,?,?,?,?,?)",
                               (cik, f.get("end"), float(v), "XBRL:" + tag, f.get("accn"), f.get("form"),
                                f"{tag}={v} end={f.get('end')} filed={f.get('filed')}"))
                    n += 1
    db.commit()
    return {"xbrl_facts": n}


def text(inputs: str, candidates: list, out: str, workers: int = 16) -> dict:
    from .fetch import filing_base, get_head
    inp = sqlite3.connect(inputs, check_same_thread=False)
    db = sqlite3.connect(out, check_same_thread=False)
    db.executescript(DDL)
    done = {a for (a,) in db.execute("SELECT accn FROM text_done")}
    want = {}
    for c in candidates:
        for a in (c["next_accn"], c["prev_accn"]):
            if a and a not in done:
                want[a] = c["cik"]
    jobs = []
    for a, cik in want.items():
        r = inp.execute("SELECT form, primary_doc FROM filing WHERE cik=? AND accn=?", (cik, a)).fetchone()
        jobs.append((cik, a, r[0] if r else "", r[1] if r else None))
    import threading
    lock = threading.Lock()

    def one(j):
        cik, a, form, doc = j
        url = filing_base(cik, a) + ("/" + doc if doc else ".txt")
        if not doc:
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{a}.txt"
        try:
            b = get_head(url, 4_000_000)
        except Exception as e:                      # retried next run
            print("ERR", a, type(e).__name__, flush=True)
            return
        rows = []
        if b is not None:
            for r, _d, snip, dates in parse_splits(textcover.normalize(b)):
                rows.append((cik, json.dumps([d.isoformat() for d in dates]), r, "TEXT", a, form, snip[:600]))
        with lock:
            db.executemany("INSERT OR IGNORE INTO split_evidence VALUES(?,?,?,?,?,?,?)", rows)
            db.execute("INSERT OR REPLACE INTO text_done VALUES(?,?,?,?)", (cik, a, "OK" if b else "NO_FILE", len(rows)))
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, jobs))
    db.commit()
    return {"fetched": len(jobs)}


def confirm(evidence: list[tuple], k: float, direction: str, prev_asof: date, next_asof: date) -> tuple | None:
    """Evidence rows (ex_date|dates_json, ratio, source, accn, snippet) -> the first statement confirming the transition:
    same factor; an XBRL date (or, for text, ANY stated date) inside (prev_asof - 5d, next_asof + 5d]. Returns
    (ex_date, ratio, source, accn, snippet) or None."""
    lo, hi = prev_asof - timedelta(days=5), next_asof + timedelta(days=5)
    for ex, r, src, accn, snip in evidence:
        if not matches(k, direction, r):
            continue
        if src.startswith("XBRL"):
            try:
                d = date.fromisoformat(ex)
            except (TypeError, ValueError):
                continue
            if lo < d <= hi:
                return (min(max(d, prev_asof + timedelta(days=1)), next_asof), r, src, accn, snip)
        else:
            ds = [date.fromisoformat(x) for x in json.loads(ex or "[]")]
            inside = [d for d in ds if lo < d <= hi]
            if inside:
                d = min(inside)
                return (min(max(d, prev_asof + timedelta(days=1)), next_asof), r, src, accn, snip)
    return None


def contradicted(evidence: list[tuple], k: float, direction: str, prev_asof: date, next_asof: date) -> tuple | None:
    """A DATED statement inside the transition window that gives a DIFFERENT factor: the candidate is not that split
    (a false-positive candidate -- it stays held, and the contradiction is recorded)."""
    lo, hi = prev_asof - timedelta(days=5), next_asof + timedelta(days=5)
    for ex, r, src, accn, snip in evidence:
        if matches(k, direction, r):
            continue
        if src.startswith("XBRL"):
            try:
                ds = [date.fromisoformat(ex)]
            except (TypeError, ValueError):
                continue
        else:
            ds = [date.fromisoformat(x) for x in json.loads(ex or "[]")]
        if any(lo < d <= hi for d in ds):
            return (ex, r, src, accn, snip)
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("xbrl", "text"))
    ap.add_argument("--companyfacts")
    ap.add_argument("--inputs")
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args(argv)
    cands = json.load(open(a.candidates))
    if a.cmd == "xbrl":
        print(json.dumps(xbrl(a.companyfacts, {c["cik"] for c in cands}, a.out)))
    else:
        print(json.dumps(text(a.inputs, cands, a.out, a.workers)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
