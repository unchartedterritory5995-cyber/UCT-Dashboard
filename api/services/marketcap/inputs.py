"""Stage SEC bulk inputs for the universe into one local inputs database (read-only w.r.t. production).

    python -m api.services.marketcap.inputs --companyfacts companyfacts.zip --submissions submissions.zip \
        --universe sec_t.json.gz --out inputs.db

Tables
  issuer(cik, name, entity_type, category, sic, state_inc, fiscal_ye, tickers_json, exchanges_json, former_json)
  filing(cik, accn, form, filing_date, report_date, accepted, public_at, primary_doc, is_xbrl, is_ixbrl)
  fact(cik, tag, as_of, value, accn, form, filed, fy, fp, frame)   -- share-count concepts, non-dimensional
  input_file(name, sha256, size)

Only facts in SHARE units for the concepts below are staged; weighted-average / issued / authorized
concepts are staged for DIAGNOSTICS ONLY (never evidence -- the evidence selector refuses them by tag).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import sys
import zipfile
from datetime import date

from api.services.fundamentals_pit.filings import _parse_accepted, public_at

EVIDENCE_TAGS = ("dei:EntityCommonStockSharesOutstanding", "us-gaap:CommonStockSharesOutstanding")
DIAG_TAGS = ("us-gaap:CommonStockSharesIssued", "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
             "us-gaap:TreasuryStockShares", "ifrs-full:NumberOfSharesOutstanding", "ifrs-full:NumberOfSharesIssued",
             "dei:EntityListingParValuePerShare")

DDL = """
CREATE TABLE IF NOT EXISTS issuer(cik INTEGER PRIMARY KEY, name TEXT, entity_type TEXT, category TEXT, sic TEXT,
  state_inc TEXT, fiscal_ye TEXT, tickers_json TEXT, exchanges_json TEXT, former_json TEXT);
CREATE TABLE IF NOT EXISTS filing(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, report_date TEXT, accepted TEXT,
  public_at TEXT, primary_doc TEXT, is_xbrl INTEGER, is_ixbrl INTEGER, PRIMARY KEY(cik, accn, form));
CREATE TABLE IF NOT EXISTS fact(cik INTEGER, tag TEXT, as_of TEXT, value REAL, accn TEXT, form TEXT, filed TEXT,
  fy INTEGER, fp TEXT, frame TEXT);
CREATE INDEX IF NOT EXISTS fact_cik ON fact(cik, tag);
CREATE TABLE IF NOT EXISTS input_file(name TEXT PRIMARY KEY, sha256 TEXT, size INTEGER);
"""


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def universe(path: str) -> dict[int, list[str]]:
    d = json.loads(gzip.decompress(open(path, "rb").read()))
    return {int(k): v[1] for k, v in d.items()}


def stage(cf_zip: str, sub_zip: str, uni_path: str, out: str) -> dict:
    uni = universe(uni_path)
    db = sqlite3.connect(out)
    db.executescript(DDL)
    for p in (cf_zip, sub_zip, uni_path):
        db.execute("INSERT OR REPLACE INTO input_file VALUES(?,?,?)", (os.path.basename(p), sha256(p), os.path.getsize(p)))
    n_fact = n_fil = 0
    cf = zipfile.ZipFile(cf_zip)
    names = set(cf.namelist())
    for cik in sorted(uni):
        nm = f"CIK{cik:010d}.json"
        if nm not in names:
            continue
        j = json.loads(cf.read(nm))
        rows = []
        for tag in EVIDENCE_TAGS + DIAG_TAGS:
            tax, c = tag.split(":")
            node = (j.get("facts", {}).get(tax) or {}).get(c)
            if not node:
                continue
            for unit, facts in node.get("units", {}).items():
                if unit != "shares" and not tag.endswith("ParValuePerShare"):
                    continue
                for x in facts:
                    rows.append((cik, tag, x["end"], x["val"], x["accn"], x.get("form"), x.get("filed"), x.get("fy"),
                                 x.get("fp"), x.get("frame")))
        db.executemany("INSERT INTO fact VALUES(?,?,?,?,?,?,?,?,?,?)", rows)
        n_fact += len(rows)
    sz = zipfile.ZipFile(sub_zip)
    snames = sz.namelist()
    by_cik: dict[int, list[str]] = {}
    for nm in snames:
        try:
            c = int(nm[3:13])
        except ValueError:
            continue
        if c in uni:
            by_cik.setdefault(c, []).append(nm)
    for cik in sorted(by_cik):
        main_nm = f"CIK{cik:010d}.json"
        if main_nm not in by_cik[cik]:
            continue
        m = json.loads(sz.read(main_nm))
        db.execute("INSERT OR REPLACE INTO issuer VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (cik, m.get("name"), m.get("entityType"), m.get("category"), m.get("sic"), m.get("stateOfIncorporation"),
                    m.get("fiscalYearEnd"), json.dumps(m.get("tickers")), json.dumps(m.get("exchanges")),
                    json.dumps(m.get("formerNames"))))
        pages = [m["filings"]["recent"]] + [json.loads(sz.read(n)) for n in sorted(by_cik[cik]) if n != main_nm]
        rows = []
        for pg in pages:
            n = len(pg.get("accessionNumber", []))
            for i in range(n):
                fd = pg["filingDate"][i]
                acc_raw = (pg.get("acceptanceDateTime") or [None] * n)[i]
                acc = _parse_accepted(acc_raw)
                pa = public_at(acc, date.fromisoformat(fd))
                rows.append((cik, pg["accessionNumber"][i], pg["form"][i], fd, (pg.get("reportDate") or [None] * n)[i] or None,
                             acc.isoformat() if acc else None, pa.isoformat(), (pg.get("primaryDocument") or [None] * n)[i],
                             (pg.get("isXBRL") or [0] * n)[i], (pg.get("isInlineXBRL") or [0] * n)[i]))
        db.executemany("INSERT OR IGNORE INTO filing VALUES(?,?,?,?,?,?,?,?,?,?)", rows)
        n_fil += len(rows)
    db.commit()
    return {"universe": len(uni), "facts": n_fact, "filings": n_fil,
            "issuers": db.execute("SELECT COUNT(*) FROM issuer").fetchone()[0]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--companyfacts", required=True)
    ap.add_argument("--submissions", required=True)
    ap.add_argument("--universe", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    print(json.dumps(stage(a.companyfacts, a.submissions, a.universe, a.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
