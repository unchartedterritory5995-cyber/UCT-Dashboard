"""Local, read-only price store: daily split-adjusted closes exported from bars.db (never rewritten).

    python -m api.services.marketcap.prices --parts-dir DIR --out prices.db

bars.db is split-adjusted to TODAY's basis and keyed by TICKER (with reuse across issuers); this store keeps
that exactly -- the identity layer decides which days of a ticker belong to which security.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
import sqlite3
import sys
from datetime import date

from .inputs import sha256

DDL = """
CREATE TABLE IF NOT EXISTS bar(ticker TEXT, d INTEGER, c REAL, v REAL, PRIMARY KEY(ticker, d)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS input_file(name TEXT PRIMARY KEY, sha256 TEXT, size INTEGER);
"""


def build(parts_dir: str, out: str) -> dict:
    db = sqlite3.connect(out)
    db.executescript(DDL)
    n_t = n_b = 0
    for p in sorted(glob.glob(os.path.join(parts_dir, "part-*.jsonl.gz"))):
        db.execute("INSERT OR REPLACE INTO input_file VALUES(?,?,?)", (os.path.basename(p), sha256(p), os.path.getsize(p)))
        with gzip.open(p, "rt") as f:
            for line in f:
                t, rows = json.loads(line)
                db.executemany("INSERT OR REPLACE INTO bar VALUES(?,?,?,?)", ((t, r[0], r[1], r[2]) for r in rows))
                n_t += 1
                n_b += len(rows)
    db.commit()
    return {"tickers": n_t, "bars": n_b}


def closes(db: sqlite3.Connection, ticker: str) -> dict[date, float]:
    out = {}
    for d, c in db.execute("SELECT d, c FROM bar WHERE ticker=? ORDER BY d", (ticker,)):
        out[date(d // 10000, d // 100 % 100, d % 100)] = c
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parts-dir", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    print(json.dumps(build(a.parts_dir, a.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
