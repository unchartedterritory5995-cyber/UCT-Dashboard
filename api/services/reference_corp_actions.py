"""D5 CHECKPOINT 3 — the one confirmed corporate-actions source: splits.

⛔⛔ WHAT "D1 ADAPTER" MEANS HERE. The programme's D1 layer (a generalized,
shared vendor-adapter boundary) is not yet built as reusable infrastructure —
today it is one retroactively-labelled instance (`calendar.py::_fmp_calendar_day`),
not an importable module. This file follows the SAME pattern D1 is meant to
generalize (one owned, purpose-built wrapper around a single vendor endpoint,
never duplicated) for the ONE feed D5 owns here — it does not claim to BE the
general D1 layer, which does not exist yet. Said plainly rather than pretended.

⛔ THE READ THIS RETIRES. `api/services/massive.py::get_split_tickers` was
built, tested green (by inspection — it had no test file) and reachable by
ZERO callers (`corp_actions_census.py`'s own measurement, a 106-importer
control). `api/services/polygon_extras.py::get_splits` reads the SAME Massive
endpoint for the voice assistant's corporate-actions tool, and is NOT touched
here: it is that consumer's own direct read, migrating it is a separate, later
change (nothing in this checkpoint reads the ledger below), and CP3 is not
authorized to build a second confirmed-source list beside this one.

⛔⛔ NOTHING READS THE LEDGER YET. This checkpoint is DETECT+CONFIRM only, per
the packet: "One confirmed source... WRITES confirmed rows. Nothing reads
them." CP4's dual-compute and CP7's member-visible label are later checkpoints
that will read from here; wiring either now would be scope this line was not
signed for.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from typing import Any

_log = logging.getLogger(__name__)

_DB_PATH = os.environ.get("REFERENCE_CORP_ACTIONS_DB_PATH", "/data/reference_corp_actions.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS confirmed_splits (
  ticker          TEXT NOT NULL,
  execution_date  TEXT NOT NULL,
  split_from      REAL,
  split_to        REAL,
  source          TEXT NOT NULL,
  confirmed_at    REAL NOT NULL,
  PRIMARY KEY (ticker, execution_date)
);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def fetch_confirmed_splits(from_iso: str, to_iso: str) -> list[dict[str, Any]]:
    """Every stock split with an execution date in [from_iso, to_iso], full
    detail, straight from Massive's own reference feed — which IS the
    confirmation; there is no separate detection stage for a vendor's own
    reference data. Returns `[]` on any provider failure; never raises.

    ⛔ Owns its OWN pagination rather than reusing `get_split_tickers`'s (now
    retired) — that function discarded everything but the ticker, which is not
    enough to write a confirmed ROW (execution date + ratio are the row).
    """
    from api.services import massive as _massive

    out: list[dict[str, Any]] = []
    try:
        client = _massive._get_client()
        url = (
            f"{_massive._REST_BASE}/v3/reference/splits"
            f"?execution_date.gte={from_iso}&execution_date.lte={to_iso}"
            f"&limit=1000&apiKey={client._api_key}"
        )
        for _ in range(20):  # safety cap on pagination, same bound as the retired reader
            data = client._get(url) or {}
            for r in (data.get("results") or []):
                ticker = r.get("ticker")
                execution_date = r.get("execution_date")
                if not (ticker and execution_date):
                    continue
                out.append({
                    "ticker": str(ticker).upper(),
                    "execution_date": str(execution_date),
                    "split_from": r.get("split_from"),
                    "split_to": r.get("split_to"),
                })
            nxt = data.get("next_url")
            if not nxt:
                break
            url = f"{nxt}&apiKey={client._api_key}"
    except Exception as e:
        _log.info("[reference-corp-actions] splits fetch failed: %s", e)
        return []
    return out


def record_confirmed_splits(rows: list[dict[str, Any]], *, now: float | None = None,
                             db_path: str | None = None) -> int:
    """Upsert every row into the confirmed-splits ledger. Idempotent on
    (ticker, execution_date) — a re-run over an overlapping window writes the
    same facts again rather than duplicating them. Returns the row count
    written (0 for an empty or all-invalid input, never an error)."""
    if not rows:
        return 0
    at = time.time() if now is None else now
    path = db_path or _DB_PATH
    written = 0
    with _WRITE_LOCK:
        conn = sqlite3.connect(path, timeout=5)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            with contextlib.closing(conn):
                for r in rows:
                    ticker = r.get("ticker")
                    execution_date = r.get("execution_date")
                    if not (ticker and execution_date):
                        continue
                    conn.execute(
                        "INSERT INTO confirmed_splits "
                        "(ticker, execution_date, split_from, split_to, source, confirmed_at) "
                        "VALUES (?, ?, ?, ?, 'massive', ?) "
                        "ON CONFLICT(ticker, execution_date) DO UPDATE SET "
                        "split_from=excluded.split_from, split_to=excluded.split_to, "
                        "confirmed_at=excluded.confirmed_at",
                        (ticker, execution_date, r.get("split_from"), r.get("split_to"), at),
                    )
                    written += 1
                conn.commit()
        except Exception as e:
            _log.warning("[reference-corp-actions] confirmed-splits write failed: %s", e)
            return 0
    return written


def refresh_confirmed_splits(from_iso: str, to_iso: str, *, now: float | None = None,
                              db_path: str | None = None) -> int:
    """One tick of the detect+confirm pipeline: fetch, then record. Returns
    the row count written. Never raises — a provider outage costs this tick,
    never a caller."""
    rows = fetch_confirmed_splits(from_iso, to_iso)
    return record_confirmed_splits(rows, now=now, db_path=db_path)


def read_confirmed_splits(ticker: str, *, db_path: str | None = None) -> list[tuple[str, float]]:
    """D5 CP4 — the first real reader of this ledger. Every confirmed split on
    record for `ticker`, as (execution_date, ratio) where
    ratio = split_to / split_from — the same shape `bars_sanitize._fetch_meta`
    already returns from FMP, so a dual-compute can compare like-for-like.

    Read-only, and never raises: a missing ledger, a locked file or a bad row
    all return `[]` rather than surfacing an exception into a caller that is
    comparing, not depending on, this answer."""
    path = db_path or _DB_PATH
    try:
        conn = sqlite3.connect(path, timeout=5)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            rows = conn.execute(
                "SELECT execution_date, split_from, split_to FROM confirmed_splits "
                "WHERE ticker = ? ORDER BY execution_date",
                (ticker.strip().upper(),),
            ).fetchall()
        finally:
            conn.close()
    except Exception as e:
        _log.info("[reference-corp-actions] read_confirmed_splits failed for %s: %s", ticker, e)
        return []
    out: list[tuple[str, float]] = []
    for execution_date, split_from, split_to in rows:
        try:
            ratio = float(split_to) / float(split_from)
        except (TypeError, ValueError, ZeroDivisionError):
            continue
        if execution_date and ratio > 0:
            out.append((str(execution_date), ratio))
    return out
