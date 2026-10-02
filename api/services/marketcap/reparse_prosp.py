"""Re-parse every CACHED offering document with the current prospectus parser (no network).

    python -m api.services.marketcap.reparse_prosp --inputs inputs.db --done prosp.db --out prosp_v2.db [--procs 8]

The harvest (harvest_text --mode prosp) fetched newest-first; this re-applies the final parser to exactly the documents
it fetched, so one parser version describes the whole evidence file (recorded in the build manifest by hash).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
from datetime import date
from multiprocessing import Pool

from . import prospectus, textcover
from .fetch import _path, filing_base
from .harvest_text import DDL


def _one(r):
    cik, accn, form, fd, doc = r
    p = _path(filing_base(cik, accn) + "/" + doc + "#head350000") if doc else None
    if not p or not os.path.exists(p):
        return None
    b = gzip.decompress(open(p, "rb").read())
    if b == b"\x00404":
        return [(cik, accn, form, fd, "NO_FILE", None, None, None, None, None, None)]
    res = prospectus.parse(textcover.normalize(b), date.fromisoformat(fd))
    if not res.hits:
        return [(cik, accn, form, fd, res.status, None, None, None, None, None, res.note[:300])]
    return [(cik, accn, form, fd, res.status, h.class_label, h.count, h.as_of.isoformat(), h.rule, h.snippet[:400], res.note[:300])
            for h in res.hits]


def run(inputs: str, done: str, out: str, procs: int = 8) -> dict:
    inp = sqlite3.connect(inputs)
    src = sqlite3.connect(done)
    accns = {a for (a,) in src.execute("SELECT accn FROM done WHERE mode='prosp'")}
    jobs = [r for r in inp.execute("SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE form IN "
                                   "('424B1','424B4','424B5','424B7','S-1','F-1','S-3','F-3')") if r[1] in accns]
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.executescript(DDL)
    n = miss = 0
    with Pool(procs) as pool:
        for job, rows in zip(jobs, pool.imap(_one, jobs, chunksize=64)):
            if rows is None:
                miss += 1
                continue
            db.executemany("INSERT INTO prosp_obs VALUES(?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.execute("INSERT OR REPLACE INTO done VALUES('prosp',?,?)", (job[0], job[1]))
            n += 1
    db.execute("CREATE INDEX IF NOT EXISTS prosp_obs_cik ON prosp_obs(cik)")
    db.commit()
    lo, hi = db.execute("SELECT MIN(filing_date), MAX(filing_date) FROM prosp_obs").fetchone()
    return {"documents": n, "not_cached": miss, "filing_dates": [lo, hi],
            "status": dict(db.execute("SELECT status, COUNT(*) FROM prosp_obs GROUP BY status").fetchall())}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--done", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--procs", type=int, default=8)
    a = ap.parse_args(argv)
    print(json.dumps(run(a.inputs, a.done, a.out, a.procs)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
