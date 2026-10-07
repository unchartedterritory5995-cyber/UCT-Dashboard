"""A tiny but schema-true Market Cap V1 build (the tables serve.Authority reads) + a price store, for lifecycle tests."""
from __future__ import annotations

import json
import sqlite3

from api.services.marketcap import methodology as M

DDL = """
CREATE TABLE manifest(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE ticker_map(ticker TEXT, cik INTEGER, security_id TEXT, start TEXT, end TEXT, basis TEXT, pre_reason TEXT,
  post_reason TEXT);
CREATE TABLE state_run(issuer_id TEXT, class_key TEXT, start TEXT, end TEXT, shares REAL, obs_accession TEXT,
  as_of TEXT, source_type TEXT);
CREATE TABLE regime(issuer_id TEXT, start TEXT, end TEXT, classes TEXT, kind TEXT, reason TEXT, note TEXT, components TEXT);
CREATE TABLE cap_daily(cik INTEGER, d INTEGER, cap REAL, PRIMARY KEY(cik, d)) WITHOUT ROWID;
CREATE TABLE gap_run(cik INTEGER, start INTEGER, end INTEGER, reason TEXT, n_days INTEGER);
"""


def make_build(path: str, build_id: str, *, last_day: int = 20261001, bump: float = 1.0) -> str:
    db = sqlite3.connect(path)
    db.executescript(DDL)
    db.executemany("INSERT INTO manifest VALUES (?,?)", [("dataset", "MCAP_V1"), ("build_id", build_id)])
    db.executemany("INSERT INTO ticker_map VALUES (?,?,?,?,?,?,?,?)", [
        ("AAA", 1, "s1", "2020-01-01", None, "B", None, None),
        ("GOOG", 2, "s2c", "2014-04-03", None, "B", None, None),
        ("GOOGL", 2, "s2a", "2004-08-19", None, "B", None, None),
        ("ARM", 3, "s3", "2023-09-14", None, "MASSIVE_LIST_DATE", "TICKER_REUSE_DIFFERENT_ISSUER", None)])
    days = [20260928, 20260929, 20260930, last_day] if last_day > 20260930 else [20260928, 20260929, 20260930]
    for cik, base in ((1, 1e9), (2, 2e12), (3, 1e11)):
        for i, d in enumerate(days):
            db.execute("INSERT INTO cap_daily VALUES (?,?,?)", (cik, d, base * bump * (1 + i / 100)))
    db.executemany("INSERT INTO gap_run VALUES (?,?,?,?,?)", [
        (1, 20200101, 20200301, "PRE_FIRST_AUTHORITATIVE_STATE", 40), (3, 20030101, 20110101, "TICKER_REUSE_DIFFERENT_ISSUER", 1902)])
    db.executemany("INSERT INTO state_run VALUES (?,?,?,?,?,?,?,?)", [
        ("cik:2", "CLASS_A", "2026-01-01", "2026-12-31", 5.8e9, "a", "2026-07-20", "COVER_XBRL"),
        ("cik:2", "CLASS_C", "2026-01-01", "2026-12-31", 5.5e9, "a", "2026-07-20", "COVER_XBRL")])
    db.execute("INSERT INTO regime VALUES (?,?,?,?,?,?,?,?)", ("cik:2", "2026-01-01", "2026-12-31", json.dumps(["CLASS_A", "CLASS_C"]),
                                                            "MULTI_CLASS", None, None,
                                                            json.dumps([["CLASS_A", "GOOGL", 1, None], ["CLASS_C", "GOOG", 1, None]])))
    db.commit()
    db.close()
    return path


def make_prices(path: str) -> str:
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE bar(ticker TEXT, d INTEGER, c REAL, v REAL, PRIMARY KEY(ticker, d)) WITHOUT ROWID")
    for t, c in (("GOOGL", 240.0), ("GOOG", 241.0), ("AAA", 10.0), ("ARM", 150.0)):
        for d in (20260928, 20260929, 20260930, 20261001):
            db.execute("INSERT INTO bar VALUES (?,?,?,?)", (t, d, c, 1))
    db.commit()
    db.close()
    return path


def manifest_fields(build_id: str, db_sha: str, *, latest="2026-10-01", cutoff="2026-10-01T23:00:00Z") -> dict:
    return {"format": 1, "dataset": "MCAP_V1", "build_id": build_id, "methodology": M.identity(),
            "code": {"commit": "x" * 40, "tree": "y" * 40, "dirty": False},
            "inputs": {"snapshot_id": "z" * 64, "files": {}, "provenance": {}},
            "build": {"started_at": "2026-10-02T05:00:00Z", "finished_at": "2026-10-02T05:05:00Z", "db_sha256": db_sha},
            "knowledge": {"latest_valued_session": latest, "filing_knowledge_cutoff": cutoff,
                          "latest_harvest_at": "2026-10-02T05:00:00Z"}}


def passing_validation() -> dict:
    return {"status": "PASS", "gates": {g: {"pass": True} for g in "ABCDEFGHIJKLMN"}}
