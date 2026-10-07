"""Market Cap V1 DURABLE ISSUER IDENTITY LEDGER -- owner decision 2026-10-05 (methodology MCAP_V1-M2).

    python -m api.services.marketcap.identity_ledger seed   --inputs ACCEPTED/inputs.db --out identity.db
    python -m api.services.marketcap.identity_ledger record --inputs RUN/inputs.db      --db identity.db
    python -m api.services.marketcap.identity_ledger show   --db identity.db --cik 801337

ISSUER IDENTITY != CURRENT TICKER MAPPING != CURRENT LISTING STATUS.

The durable issuer is the SEC CIK (`issuer_id = cik:<n>`, unchanged since V1). SEC's submissions `tickers` field is the
CURRENT mapping only: when an issuer deregisters (WBS, Form 15-12G 2026-09-30) SEC empties it, and when a symbol moves
(RITR -> RITRF, KWM -> NXAT) SEC drops the old one. Before this ledger the build took its tickers from that field
alone, so every refresh erased the history of every issuer that stopped being current.

The ledger keeps every CIK -> ticker attribution SEC has ever made in an accepted evidence state, with the snapshot
dates it was observed on. It is EVIDENCE: carried forward from run to run, only ever added to, never rewritten. A
refresh records its own snapshot; the build then values an issuer over

    current tickers (this snapshot)  +  RETAINED tickers (attributed earlier, no longer current)

A retained ticker is NOT current: it is served with `listing.current = false`, and only its bars up to the LAST date SEC
attributed it to this issuer are attributed to the issuer (bars after that may be another issuer's reuse). It is
WITHHELD (with a reason, never silently) when Massive now names a DIFFERENT CIK for the symbol -- the symbol has been
reassigned and its reference record (splits, list date) describes someone else.

CURRENT DISCOVERY MAY ADD OR UPDATE MAPPINGS; IT MAY NOT ERASE PROVEN HISTORICAL IDENTITY.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
from datetime import date

DDL = """
CREATE TABLE IF NOT EXISTS snapshot(snapshot_id TEXT PRIMARY KEY, as_of TEXT, source TEXT, issuers INTEGER,
  tickers INTEGER, recorded_order INTEGER);
CREATE TABLE IF NOT EXISTS issuer_seen(cik INTEGER PRIMARY KEY, first_as_of TEXT, last_as_of TEXT);
CREATE TABLE IF NOT EXISTS ticker_seen(cik INTEGER, ticker TEXT, first_as_of TEXT, last_as_of TEXT,
  last_position INTEGER, PRIMARY KEY(cik, ticker));
"""


class IdentityError(RuntimeError):
    pass


def _current(inputs_db: str) -> tuple[dict[int, list[str]], str]:
    """{cik: [SEC current tickers, in SEC's order]} and the snapshot's as-of (its newest filing date)."""
    c = sqlite3.connect(f"file:{inputs_db}?mode=ro", uri=True)
    try:
        cur = {int(k): [t for t in json.loads(tj or "[]") if t] for k, tj in c.execute("SELECT cik, tickers_json FROM issuer")}
        as_of = c.execute("SELECT MAX(filing_date) FROM filing").fetchone()[0]
    finally:
        c.close()
    if not as_of:
        raise IdentityError("inputs.db has no filings: cannot date the identity snapshot")
    return cur, as_of


def _snapshot_id(cur: dict, as_of: str) -> str:
    body = json.dumps({"as_of": as_of, "map": {str(k): v for k, v in sorted(cur.items())}}, sort_keys=True).encode()
    return hashlib.sha256(body).hexdigest()


def connect(path: str, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    c = sqlite3.connect(path)
    c.executescript(DDL)
    return c


def record(db_path: str, inputs_db: str, source: str = "SEC_SUBMISSIONS") -> dict:
    """Add one snapshot's attributions. Idempotent (the same snapshot twice is a no-op); refuses a snapshot older than
    one already recorded (the ledger's `last_as_of` must never move backwards)."""
    cur, as_of = _current(inputs_db)
    sid = _snapshot_id(cur, as_of)
    c = connect(db_path)
    try:
        if c.execute("SELECT 1 FROM snapshot WHERE snapshot_id=?", (sid,)).fetchone():
            return {"snapshot_id": sid, "as_of": as_of, "recorded": False}
        newest = c.execute("SELECT MAX(as_of) FROM snapshot").fetchone()[0]
        if newest and as_of < newest:
            raise IdentityError(f"snapshot as-of {as_of} is older than the ledger's newest {newest}")
        n = (c.execute("SELECT COALESCE(MAX(recorded_order), 0) FROM snapshot").fetchone()[0] or 0) + 1
        with c:
            c.execute("INSERT INTO snapshot VALUES (?,?,?,?,?,?)", (sid, as_of, source, len(cur), sum(map(len, cur.values())), n))
            for cik, ts in cur.items():
                c.execute("INSERT INTO issuer_seen VALUES (?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                          "first_as_of=MIN(first_as_of, excluded.first_as_of), last_as_of=MAX(last_as_of, excluded.last_as_of)",
                          (cik, as_of, as_of))
                for pos, t in enumerate(ts):
                    c.execute("INSERT INTO ticker_seen VALUES (?,?,?,?,?) ON CONFLICT(cik, ticker) DO UPDATE SET "
                              "first_as_of=MIN(first_as_of, excluded.first_as_of), last_as_of=MAX(last_as_of, excluded.last_as_of), "
                              "last_position=excluded.last_position", (cik, t, as_of, as_of, pos))
        return {"snapshot_id": sid, "as_of": as_of, "recorded": True, "issuers": len(cur)}
    finally:
        c.close()


def retained(conn: sqlite3.Connection | None, cik: int, current: list[str]) -> list[tuple[str, date]]:
    """[(ticker, last date SEC attributed it to this CIK)] for every ticker of this CIK that is no longer current,
    most recently attributed first, then in SEC's own order."""
    if conn is None:
        return []
    cur = set(current)
    rows = conn.execute("SELECT ticker, last_as_of, last_position FROM ticker_seen WHERE cik=? "
                        "ORDER BY last_as_of DESC, last_position, ticker", (cik,)).fetchall()
    return [(t, date.fromisoformat(last)) for t, last, _p in rows if t not in cur]


def durable_universe(db_path: str | None, current_universe: str, out: str) -> dict:
    """The universe a refresh acquires prices / reference for and stages: today's universe file ({cik: ["", [tickers]]})
    plus every previously attributed issuer and ticker that is no longer current. Without this, an issuer leaving the
    current universe would lose its prices and SEC inputs before the build ever saw it."""
    uni = json.loads(gzip.decompress(open(current_universe, "rb").read()))
    added_iss = added_t = 0
    if db_path and os.path.exists(db_path):
        c = connect(db_path, readonly=True)
        try:
            for cik, t in c.execute("SELECT cik, ticker FROM ticker_seen ORDER BY cik, last_as_of DESC, last_position"):
                k = str(cik)
                if k not in uni:
                    uni[k] = ["", []]
                    added_iss += 1
                if t not in uni[k][1]:
                    uni[k][1].append(t)
                    added_t += 1
            for (cik,) in c.execute("SELECT cik FROM issuer_seen"):
                if str(cik) not in uni:
                    uni[str(cik)] = ["", []]
                    added_iss += 1
        finally:
            c.close()
    open(out, "wb").write(gzip.compress(json.dumps(uni, sort_keys=True).encode(), mtime=0))
    return {"issuers": len(uni), "retained_issuers_added": added_iss, "retained_tickers_added": added_t}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("seed", "record", "show"))
    ap.add_argument("--inputs")
    ap.add_argument("--db")
    ap.add_argument("--out")
    ap.add_argument("--cik", type=int)
    a = ap.parse_args(argv)
    if a.cmd == "seed":
        if os.path.exists(a.out):
            raise SystemExit(f"refusing to overwrite {a.out}")
        print(json.dumps(record(a.out, a.inputs, source="ACCEPTED_EVIDENCE_SEED")))
    elif a.cmd == "record":
        print(json.dumps(record(a.db, a.inputs)))
    else:
        c = connect(a.db, readonly=True)
        print(json.dumps({"snapshots": c.execute("SELECT * FROM snapshot ORDER BY recorded_order").fetchall(),
                          "tickers": c.execute("SELECT * FROM ticker_seen WHERE cik=?", (a.cik,)).fetchall()}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
