"""Measure the pre-XBRL text parser against XBRL truth on the OVERLAP: filings that carry both a structured
non-dimensional cover count (companyfacts) and a text cover (every filing does).

    python -m api.services.marketcap.validate_text --inputs inputs.db --n 1500 --out textval.json

Deterministic sample (sha1 of accession). A text result is CORRECT when its count is within 0.5% of the XBRL
cover value AND its as-of date equals the XBRL cover date (+-3 days). Precision is over OK outputs (the ones the
dataset would use); recall is OK-and-correct over the sample.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from datetime import date

from api.services.fundamentals_pit import sec_client as SEC

from . import textcover as T
from .fetch import get_head

FORMS = ("10-K", "10-Q", "20-F", "40-F")


def sample(inputs: sqlite3.Connection, n: int, lo: str, hi: str) -> list[tuple]:
    rows = inputs.execute(
        "SELECT f.cik, f.accn, f.form, fi.filing_date, fi.report_date, f.as_of, f.value FROM fact f "
        "JOIN filing fi ON fi.cik=f.cik AND fi.accn=f.accn AND fi.form=f.form "
        "WHERE f.tag='dei:EntityCommonStockSharesOutstanding' AND fi.filing_date BETWEEN ? AND ? "
        f"AND f.form IN ({','.join('?' * len(FORMS))})", (lo, hi, *FORMS)).fetchall()
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r[1], []).append(r)
    single = [v[0] for v in by.values() if len(v) == 1]   # one non-dim cover value per filing
    single.sort(key=lambda r: hashlib.sha1(r[1].encode()).hexdigest())
    return single[:n]


def run(inputs_path: str, n: int, lo: str, hi: str) -> dict:
    inp = sqlite3.connect(inputs_path)
    out = Counter()
    wrong, missing = [], []
    for cik, accn, form, fd, rd, as_of, val in sample(inp, n, lo, hi):
        b = get_head(f"{SEC.WWW}/Archives/edgar/data/{cik}/{accn}.txt")
        if b is None:
            out["NO_FILE"] += 1
            continue
        r = T.parse(T.normalize(b), date.fromisoformat(fd), form, report_date=date.fromisoformat(rd) if rd else None)
        out[f"status:{r.status}"] += 1
        if r.status != "OK":
            if len(missing) < 60:
                missing.append([cik, accn, form, r.status, r.note])
            continue
        h = r.hits[0]
        cnt_ok = abs(h.count / val - 1) <= 0.005
        date_ok = abs((h.as_of - date.fromisoformat(as_of)).days) <= 3
        if cnt_ok and date_ok:
            out["correct"] += 1
        else:
            out["wrong_count" if not cnt_ok else "wrong_date"] += 1
            wrong.append([cik, accn, form, h.count, str(h.as_of), val, as_of, h.rule, h.snippet[:220]])
    ok = out["status:OK"]
    tot = sum(v for k, v in out.items() if k.startswith("status:"))
    return {"sample": tot, "counts": dict(out), "precision": out["correct"] / ok if ok else None,
            "recall": out["correct"] / tot if tot else None, "wrong": wrong, "missing_examples": missing}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--lo", default="2009-06-01")
    ap.add_argument("--hi", default="2012-12-31")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.inputs, a.n, a.lo, a.hi)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: res[k] for k in ("sample", "counts", "precision", "recall")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
