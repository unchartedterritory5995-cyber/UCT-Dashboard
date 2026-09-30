"""Harvest rendered cover reports (per-class counts, trading symbols, 12(b) titles) for selected XBRL filings.

    python -m api.services.marketcap.harvest_covers --inputs inputs.db --out covers.db [--workers 6]

Selection (deterministic, from inputs.db):
  * every XBRL periodic filing whose non-dimensional cover count is ABSENT from companyfacts
    (dimensional-only covers = multi-class; or no cover at all);
  * the latest XBRL periodic filing of every issuer (current class structure / symbols / titles);
  * every XBRL 20-F / 40-F (ADS titles carry the depositary ratio).
Resumable: filings already in cover_status are skipped. Every fetch is cached by fetch.get.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from . import cover as C
from .fetch import filing_base, get
from api.services.fundamentals_pit import sec_client as SEC

PERIODIC = ("10-K", "10-Q", "20-F", "40-F", "10-K/A", "10-Q/A", "20-F/A", "40-F/A", "10-KT")
DDL = """
CREATE TABLE IF NOT EXISTS cover_status(cik INTEGER, accn TEXT PRIMARY KEY, status TEXT, files TEXT);
CREATE TABLE IF NOT EXISTS cover_fact(cik INTEGER, accn TEXT, file TEXT, member TEXT, label TEXT, concept TEXT,
  col INTEGER, as_of TEXT, text TEXT, share_scale REAL);
CREATE INDEX IF NOT EXISTS cover_fact_cik ON cover_fact(cik, concept);
"""
KEEP = ("dei:EntityCommonStockSharesOutstanding", "dei:TradingSymbol", "dei:Security12bTitle", "dei:SecurityExchangeName",
        "dei:DocumentType", "dei:DocumentPeriodEndDate", "dei:AmendmentFlag", "dei:EntityRegistrantName",
        "dei:NoTradingSymbolFlag", "dei:SecurityReportingObligation", "dei:EntityCentralIndexKey")


def select(inputs: sqlite3.Connection) -> list[tuple[int, str]]:
    q = ",".join("?" * len(PERIODIC))
    have = {a for (a,) in inputs.execute("SELECT DISTINCT accn FROM fact WHERE tag='dei:EntityCommonStockSharesOutstanding'")}
    rows = inputs.execute(f"SELECT cik, accn, form, filing_date FROM filing WHERE is_xbrl=1 AND form IN ({q})", PERIODIC).fetchall()
    sel = set()
    latest: dict[int, tuple] = {}
    for cik, accn, form, fd in rows:
        if accn not in have:
            sel.add((cik, accn))
        if form in ("20-F", "40-F", "20-F/A", "40-F/A"):
            sel.add((cik, accn))
        if not form.endswith("/A") and (cik not in latest or fd > latest[cik][1]):
            latest[cik] = (accn, fd)
    sel |= {(c, a) for c, (a, _fd) in latest.items()}
    return sorted(sel)


def harvest_one(cik: int, accn: str) -> tuple[str, list, list]:
    base = filing_base(cik, accn)
    fs = get(base + "/FilingSummary.xml")
    if fs is None:
        return "NO_FILING_SUMMARY", [], []
    files = C.find_cover_files(fs.decode("utf-8", "replace"))
    if not files:
        return "NO_COVER_REPORT", [], []
    facts = []
    for fn in files:
        body = get(base + "/" + fn)
        if body is None:
            continue
        cov = C.parse_any(fn, body)
        if cov is None:
            continue
        for mem, lab, concept, col, text in cov.facts:
            if concept in KEEP:
                d = cov.columns[col] if col < len(cov.columns) else None
                facts.append((cik, accn, fn, mem, lab, concept, col, d.isoformat() if d else None, text[:500], cov.share_scale))
    return ("OK" if facts else "EMPTY"), files, facts


def run(inputs_path: str, out: str, workers: int = 6, limit: int | None = None) -> dict:
    inp = sqlite3.connect(inputs_path)
    db = sqlite3.connect(out, check_same_thread=False)
    db.executescript(DDL)
    done = {a for (a,) in db.execute("SELECT accn FROM cover_status")}
    todo = [x for x in select(inp) if x[1] not in done]
    if limit:
        todo = todo[:limit]
    lock = threading.Lock()
    n = [0]

    def work(x):
        cik, accn = x
        try:
            st, files, facts = harvest_one(cik, accn)
        except Exception as e:                       # recorded, retried on the next run
            st, files, facts = f"ERROR:{type(e).__name__}:{str(e)[:120]}", [], []
        with lock:
            db.executemany("INSERT INTO cover_fact VALUES(?,?,?,?,?,?,?,?,?,?)", facts)
            if not st.startswith("ERROR"):
                db.execute("INSERT OR REPLACE INTO cover_status VALUES(?,?,?,?)", (cik, accn, st, json.dumps(files)))
            n[0] += 1
            if n[0] % 200 == 0:
                db.commit()
                print(f"{n[0]}/{len(todo)} {SEC.stats()}", flush=True)

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(work, todo))
    db.commit()
    return {"selected": len(todo) + len(done), "processed": n[0],
            "status": dict(db.execute("SELECT status, COUNT(*) FROM cover_status GROUP BY status").fetchall())}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args(argv)
    print(json.dumps(run(a.inputs, a.out, a.workers, a.limit)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
