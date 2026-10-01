"""Harvest TEXT evidence into text.db (resumable, cached, rate-limited through the V5 SEC client).

    python -m api.services.marketcap.harvest_text --mode text  --inputs inputs.db --out text.db
    python -m api.services.marketcap.harvest_text --mode ipo   --inputs inputs.db --out text.db --ipo-list ipo.json
    python -m api.services.marketcap.harvest_text --mode econ  --inputs inputs.db --out text.db --ciks ciks.json
    python -m api.services.marketcap.harvest_text --mode adr   --inputs inputs.db --out text.db --ciks ciks.json

text  every periodic filing (10-K/10-Q/10-K405/10-KSB/10-QSB/10-KT/20-F/40-F) filed before the issuer's first
      XBRL share fact: the submission's first 90 KB -> textcover.parse
ipo   for each (cik, listing start): 424B*/S-1/F-1 (and amendments) filed in [start-120d, start+10d], primary
      document's first 1.5 MB -> ipo.parse
econ  per cik: every 10-K / 20-F / 40-F primary document (first 8 MB) -> classecon.extract (for multi-class issuers)
adr   per cik: every 20-F / 40-F primary document's first 150 KB -> adr.parse_ratio (ADS statements)
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from api.services.fundamentals_pit import sec_client as SEC

from . import adr, classecon, ipo, textcover
from .fetch import filing_base, get_head

TEXT_FORMS = ("10-K", "10-Q", "10-K405", "10-KSB", "10-QSB", "10-KT", "20-F", "40-F", "10-KSB40")
DDL = """
CREATE TABLE IF NOT EXISTS done(mode TEXT, cik INTEGER, accn TEXT, PRIMARY KEY(mode, accn));
CREATE TABLE IF NOT EXISTS text_obs(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, status TEXT, complete INTEGER,
  class TEXT, count REAL, as_of TEXT, rule TEXT, offset INTEGER, snippet TEXT, classes TEXT, complex_words TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS ipo_obs(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, listing_start TEXT, status TEXT,
  class TEXT, count REAL, snippet TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS econ(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS adr_ratio(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, status TEXT, ratio REAL, snippet TEXT);
"""


def _first_xbrl(inp) -> dict:
    return dict(inp.execute("SELECT cik, MIN(filed) FROM fact WHERE tag IN "
                            "('dei:EntityCommonStockSharesOutstanding','us-gaap:CommonStockSharesOutstanding') GROUP BY cik"))


def select_text(inp) -> list[tuple]:
    fx = _first_xbrl(inp)
    q = ",".join("?" * len(TEXT_FORMS))
    rows = inp.execute(f"SELECT cik, accn, form, filing_date, report_date FROM filing WHERE form IN ({q}) ORDER BY cik, filing_date",
                       TEXT_FORMS).fetchall()
    return [r for r in rows if r[3] < (fx.get(r[0]) or "2099-12-31")]


def text_one(cik, accn, form, fd, rd):
    b = get_head(f"{SEC.WWW}/Archives/edgar/data/{cik}/{accn}.txt")
    if b is None:
        return [(cik, accn, form, fd, "NO_FILE", 0, None, None, None, None, None, None, None, None, None)]
    r = textcover.parse(textcover.normalize(b), date.fromisoformat(fd), form,
                        report_date=date.fromisoformat(rd) if rd else None)
    base = (cik, accn, form, fd, r.status, int(r.complete))
    tail = (json.dumps(r.classes), json.dumps(r.complex_words), r.note[:300])
    if not r.hits:
        return [base + (None, None, None, None, None, None) + tail]
    return [base + (h.class_label, h.count, h.as_of.isoformat(), h.rule, h.offset, h.snippet[:400]) + tail for h in r.hits]


def select_ipo(inp, ipo_list: list) -> list[tuple]:
    """Final prospectuses (424B*) within 10 days of the listing start, plus the last THREE registration statements
    filed before it (the PIT evidence on the first trading day when the 424B lands after that close). ⛔ Three, not
    one: a final amendment is often EXHIBITS-ONLY (ARM 0001193125-23-230681, 54 KB) while the previous one is the full
    prospectus that states the post-offering capitalization; the builder uses the latest PUBLIC one that states it."""
    out = []
    for cik, start in ipo_list:
        s = date.fromisoformat(start)
        rows = inp.execute("SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE cik=? AND filing_date BETWEEN ? AND ? "
                           "AND form LIKE '424B%'", (cik, (s - timedelta(days=10)).isoformat(), (s + timedelta(days=10)).isoformat())).fetchall()
        reg = inp.execute("SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE cik=? AND filing_date BETWEEN ? AND ? "
                          "AND form IN ('S-1','S-1/A','F-1','F-1/A','S-11','S-11/A','F-10','F-10/A') ORDER BY filing_date DESC LIMIT 3",
                          (cik, (s - timedelta(days=180)).isoformat(), s.isoformat())).fetchall()
        out += [r + (start,) for r in rows + reg]
    return out


def ipo_one(cik, accn, form, fd, doc, start):
    b = get_head(filing_base(cik, accn) + "/" + doc, 600_000) if doc else None
    if b is None:
        return [(cik, accn, form, fd, start, "NO_FILE", None, None, None, None)]
    r = ipo.parse(textcover.normalize(b))
    if not r.counts:
        return [(cik, accn, form, fd, start, r.status, None, None, None, r.note)]
    snip = " | ".join(s[2] for s in r.snippets[:4])[:600]
    return [(cik, accn, form, fd, start, r.status, k, v if not isinstance(v, list) else None, snip, r.note or json.dumps(v))
            for k, v in r.counts.items()]


def select_docs(inp, ciks: list, forms: tuple) -> list[tuple]:
    """`ciks` is a list of CIKs (every filing of `forms`) or of [cik, accession] pairs (exactly those filings)."""
    q = ",".join("?" * len(forms))
    out = []
    for x in ciks:
        if isinstance(x, list):
            out += inp.execute("SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE cik=? AND accn=?", tuple(x)).fetchall()[:1]
        else:
            out += inp.execute(f"SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE cik=? AND form IN ({q})",
                               (x, *forms)).fetchall()
    return out


def econ_one(cik, accn, form, fd, doc):
    b = get_head(filing_base(cik, accn) + "/" + doc, 8_000_000) if doc else None
    if b is None:
        return [(cik, accn, form, fd, json.dumps({"status": "NO_FILE"}))]
    e = classecon.extract(textcover.normalize(b))
    res = {"conversions": {k: list(v) for k, v in e.conversions.items()},
           "convertible_no_ratio": {k: list(v) for k, v in e.convertible_no_ratio.items()},
           "equal_rights": [[sorted(c), s] for c, s in e.equal_rights],
           "voting_only": e.voting_only, "not_convertible": e.not_convertible, "complex": e.complex,
           "conflicts": [list(map(str, x)) for x in e.conflicts]}
    return [(cik, accn, form, fd, json.dumps(res))]


def adr_one(cik, accn, form, fd, doc):
    b = get_head(filing_base(cik, accn) + "/" + doc, 150_000) if doc else None
    if b is None:
        return [(cik, accn, form, fd, "NO_FILE", None, None)]
    v, st, snip = adr.parse_ratio(textcover.normalize(b))
    return [(cik, accn, form, fd, st, v, snip[:400])]


def run(mode: str, inputs_path: str, out: str, workers: int, arg_path: str | None) -> dict:
    inp = sqlite3.connect(inputs_path)
    db = sqlite3.connect(out, check_same_thread=False)
    db.executescript(DDL)
    done = {a for (a,) in db.execute("SELECT accn FROM done WHERE mode=?", (mode,))}
    arg = json.load(open(arg_path)) if arg_path else None
    if mode == "text":
        todo, fn, table, n = select_text(inp), text_one, "text_obs", 15
    elif mode == "ipo":
        todo, fn, table, n = select_ipo(inp, arg), ipo_one, "ipo_obs", 10
    elif mode == "econ":
        todo, fn, table, n = select_docs(inp, arg, ("10-K", "10-K405", "20-F", "40-F", "10-KT")), econ_one, "econ", 5
    elif mode == "adr":
        todo, fn, table, n = select_docs(inp, arg, ("20-F", "40-F", "20-F/A")), adr_one, "adr_ratio", 7
    else:
        raise SystemExit(f"unknown mode {mode}")
    todo = [x for x in todo if x[1] not in done]
    lock = threading.Lock()
    cnt = [0]

    def work(x):
        try:
            rows = fn(*x)
        except Exception as e:                        # not marked done: retried on the next run
            with lock:
                print(f"ERR {x[1]} {type(e).__name__}: {str(e)[:120]}", flush=True)
            return
        with lock:
            db.executemany(f"INSERT INTO {table} VALUES({','.join('?' * n)})", rows)
            db.execute("INSERT OR REPLACE INTO done VALUES(?,?,?)", (mode, x[0], x[1]))
            cnt[0] += 1
            if cnt[0] % 500 == 0:
                db.commit()
                print(f"{mode} {cnt[0]}/{len(todo)} {SEC.stats()}", flush=True)

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(work, todo))
    db.commit()
    return {"mode": mode, "todo": len(todo), "processed": cnt[0]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=("text", "ipo", "econ", "adr"))
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--arg", help="JSON: ipo -> [[cik, listing_start]], econ/adr -> [cik]")
    a = ap.parse_args(argv)
    print(json.dumps(run(a.mode, a.inputs, a.out, a.workers, a.arg)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
