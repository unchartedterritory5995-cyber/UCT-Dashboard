"""Insider cluster-buy capture — OpenInsider cluster prints ratcheted per
ticker, read back as days-since-last-cluster.

Own SQLite store (`SCREENER_INSIDER_DB_PATH`, mirrors wire_prints /
catalysts.db / cot.db) — NOT the snapshot DB; the builder joins this via
`read_insider_fields`. `run_capture()` pulls
`api.services.insider_clusters.get_recent_clusters` (the OpenInsider
scraper) and ratchet-upserts each ticker's LATEST cluster trade — same
MAX-on-conflict idiom as `api/services/wire/store.py::upsert_print`
(`peak_move_pct`/`confirmed`): an older trade_date arriving on a later run
can never regress a newer one already stored, and `insiders`/`value_usd`
move together with whichever trade_date wins (they describe ONE cluster
event, not two independent ratchets).

⛔ A scrape `error` payload (dead site, timeout, parse failure — see
`insider_clusters.get_recent_clusters`'s `{"error": ..., "clusters": [],
"count": 0}` shape) upserts NOTHING. The receipt records the error; the
store from the last good run is left completely untouched — never blank a
good store because tonight's fetch failed.

`read_insider_fields` answers in DAYS-SINCE, not a raw date: an INT column
where the key is simply ABSENT means "no recent cluster" — the honest
reading of BOTH never-clustered and long-ago. A 0-fill would claim a
cluster happened TODAY. Only trades within the last 90 days answer at all
(`_DAYS_CUTOFF`); older clusters age out of the signal, same absent-key
idiom as `context_joins.read_index_flags`.

⚠️ Dict-literal writes only (`{"insider_cluster_days": v}`) — the
scalar-population rail derives writers by AST over that exact shape.

Shape note (adaptation from the task brief, which assumed a plainer
scraper return): the REAL `insider_clusters.get_recent_clusters(days=7,
count=50)` returns `{"clusters": [{"ticker", "company", "insider_count",
"insider_names", "qty", "value_usd", "filing_date", "trade_date"}], ...}`
on success, or `{"error": "...", "clusters": [], "count": 0}` on a dead
scrape. This module reads `insider_count` -> `cluster_latest.insiders` and
`value_usd` -> `cluster_latest.value_usd` (both already the right field
names/units — no unit conversion needed) and gates entirely on the
presence of the `error` key, per the module's own error contract.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from datetime import date, datetime

_WRITE_LOCK = threading.Lock()

_DAYS_CUTOFF = 90

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cluster_latest (
  ticker          TEXT PRIMARY KEY,
  last_trade_date TEXT,
  insiders        INTEGER,
  value_usd       REAL,
  captured_at     INTEGER
);
"""


def _db_path() -> str:
    p = os.environ.get("SCREENER_INSIDER_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/screener_insider.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/screener_insider.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db() -> None:
    """Idempotent — CREATE TABLE IF NOT EXISTS, cheap enough to call on
    every entry point. Deliberately NOT gated by a cached "already inited"
    flag: the env var (`SCREENER_INSIDER_DB_PATH`) can legitimately point
    at a different path between calls in tests, and a cached flag would
    skip schema creation for the second path."""
    parent = os.path.dirname(_db_path())
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _parse_trade_date(raw):
    """OpenInsider's trade-date cell arrives 'YYYY-MM-DD'. Defensive: any
    other shape (blank, malformed, a stray timestamp) parses to None
    rather than raising — the caller counts and skips it."""
    if not raw:
        return None
    text = str(raw).strip()[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def run_capture() -> dict:
    """Pull latest OpenInsider cluster buys and ratchet-upsert into the store.

    Receipt: {"ok", "seen", "upserted", "skipped", "error"}. `seen` is the
    count of clusters the scrape returned; `upserted` is rows written (a
    ratchet no-op where an older date arrives still counts as upserted —
    the ticker WAS seen and processed, its stored row just didn't move);
    `skipped` counts rows dropped for a missing ticker or an unparseable
    trade_date. An `error` payload from the scrape writes nothing at all.
    """
    _init_db()
    from api.services import insider_clusters
    result = insider_clusters.get_recent_clusters(days=7, count=50) or {}

    if result.get("error"):
        return {"ok": False, "error": result["error"], "seen": 0,
                "upserted": 0, "skipped": 0}

    clusters = result.get("clusters") or []
    upserted = 0
    skipped = 0
    now_ts = int(time.time())

    with _WRITE_LOCK, contextlib.closing(_connect()) as conn:
        for c in clusters:
            ticker = str(c.get("ticker") or "").strip().upper()
            trade_date = _parse_trade_date(c.get("trade_date"))
            if not ticker or trade_date is None:
                skipped += 1
                continue
            conn.execute(
                """INSERT INTO cluster_latest
                       (ticker, last_trade_date, insiders, value_usd, captured_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(ticker) DO UPDATE SET
                     insiders = CASE
                       WHEN excluded.last_trade_date >= cluster_latest.last_trade_date
                       THEN excluded.insiders ELSE cluster_latest.insiders END,
                     value_usd = CASE
                       WHEN excluded.last_trade_date >= cluster_latest.last_trade_date
                       THEN excluded.value_usd ELSE cluster_latest.value_usd END,
                     last_trade_date = MAX(excluded.last_trade_date,
                                            cluster_latest.last_trade_date),
                     captured_at = excluded.captured_at
                """,
                (ticker, trade_date.isoformat(), c.get("insider_count"),
                 c.get("value_usd"), now_ts))
            upserted += 1
        conn.commit()

    return {"ok": True, "error": None, "seen": len(clusters),
            "upserted": upserted, "skipped": skipped}


def read_insider_fields(targets, failures=None) -> dict:
    """Days since each ticker's latest captured cluster-buy trade date.

    Absent key = no cluster on record within the last 90 days — never a
    fabricated 0 (which would claim a cluster happened today).
    """
    _init_db()
    try:
        with contextlib.closing(_connect()) as conn:
            rows = conn.execute(
                "SELECT ticker, last_trade_date FROM cluster_latest").fetchall()
    except Exception as e:
        _note(failures, "insider_capture", e)
        return {}

    by_ticker = {}
    for r in rows:
        d = _parse_trade_date(r["last_trade_date"])
        if d is not None:
            by_ticker[r["ticker"]] = d

    today = date.today()
    out = {}
    for t in targets:
        tu = str(t).upper()
        d = by_ticker.get(tu)
        row = {}
        if d is not None:
            days = (today - d).days
            if 0 <= days <= _DAYS_CUTOFF:
                row["insider_cluster_days"] = days
        out[tu] = row
    return out
