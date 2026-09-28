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

    TERM-022: reads through `massive_adapter` (one client, one budget, typed
    errors). The `[]` on failure is THIS sweep's own, logged decision — its only
    caller upserts — not the adapter's; and past 20 pages it now answers `[]`
    rather than upserting a silently truncated window.
    """
    from api.services import massive_adapter

    try:
        rows = massive_adapter.get_pages(
            "/v3/reference/splits",
            params={"execution_date.gte": from_iso, "execution_date.lte": to_iso, "limit": 1000},
            data_class="reference", activity="reference_corp_actions.fetch_confirmed_splits",
            max_pages=20,  # same bound as the retired reader
        ).value
    except Exception as e:
        _log.info("[reference-corp-actions] splits fetch failed: %s", e)
        return []
    out: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
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
    return out


# ─────────────────────────────────────────────────────────────────────────────
# TERM-036 (FB-D5-02) — per-ticker reads for the two consumers that used to
# read yfinance: `dividends_calendar.py` (Calendar's forward feed) and
# `earnings_estimates._build_chart_markers` (chart "S"/"D" markers).
#
# ⛔ NO TABLE. These are pass-through reads; nothing here writes the ledger
# above or any other store (CARD 5: "a table with no consumer is a second
# authority waiting to drift").
#
# ⛔ THEY RAISE, THEY DO NOT ANSWER EMPTY. Unlike `fetch_confirmed_splits`
# (a sweep whose caller only upserts), these callers render "no dividend"
# from an empty list — so an outage must be distinguishable from a real
# empty. `CorpActionsUnavailable` is that distinction; `[]` means Massive
# answered and had nothing.
# ─────────────────────────────────────────────────────────────────────────────

#: The provenance label every consumer stamps on a value read through here.
SOURCE = "massive"

_TICKER_READ_MAX_PAGES = 10   # 1000 rows/page; one ticker never needs more


class CorpActionsUnavailable(RuntimeError):
    """Massive could not answer (no key, HTTP error, truncated pagination).
    Never means "this ticker has no corporate actions"."""


def _ticker_read(path: str, date_field: str, ticker: str,
                 gte: str | None, lte: str | None) -> list[dict[str, Any]]:
    """`path` is the literal endpoint path, spelled out at each call site so
    `tools/corp_actions_census.py` (which reads URLs, not variables) sees both
    reads. The API key never enters an exception message.

    TERM-022: reads through `massive_adapter`, which raises on every failure —
    including more than `_TICKER_READ_MAX_PAGES` pages — so an outage stays
    distinguishable from a real empty answer."""
    from api.services import massive as _massive
    from api.services import massive_adapter

    sym = _massive.to_polygon_symbol((ticker or "").strip())
    if not sym:
        return []
    params: dict[str, Any] = {"ticker": sym}
    if gte:
        params[f"{date_field}.gte"] = gte
    if lte:
        params[f"{date_field}.lte"] = lte
    params.update({"order": "asc", "sort": date_field, "limit": 1000})
    try:
        rows = massive_adapter.get_pages(
            path, params=params, data_class="reference",
            activity=f"reference_corp_actions.{date_field}", max_pages=_TICKER_READ_MAX_PAGES,
        ).value
    except Exception as e:
        raise CorpActionsUnavailable(
            f"Massive {path} failed for {sym}: {type(e).__name__}") from e
    return [r for r in rows if isinstance(r, dict)]


def fetch_ticker_splits(ticker: str, *, gte: str | None = None,
                        lte: str | None = None) -> list[dict[str, Any]]:
    """Every split for `ticker` with an execution date in [gte, lte], oldest
    first: `{ticker, execution_date, split_from, split_to}`. Raises
    `CorpActionsUnavailable` if Massive could not answer."""
    rows = []
    for r in _ticker_read("/v3/reference/splits", "execution_date", ticker, gte, lte):
        if not r.get("execution_date"):
            continue
        rows.append({
            "ticker": str(r.get("ticker") or ticker).upper(),
            "execution_date": str(r["execution_date"])[:10],
            "split_from": r.get("split_from"),
            "split_to": r.get("split_to"),
        })
    return rows


def fetch_ticker_dividends(ticker: str, *, gte: str | None = None,
                           lte: str | None = None) -> list[dict[str, Any]]:
    """Every cash dividend for `ticker` with an ex-date in [gte, lte], oldest
    first: `{ticker, ex_dividend_date, cash_amount, pay_date, frequency,
    dividend_type, currency}`. Raises `CorpActionsUnavailable` if Massive could
    not answer."""
    rows = []
    for r in _ticker_read("/v3/reference/dividends", "ex_dividend_date", ticker, gte, lte):
        if not r.get("ex_dividend_date"):
            continue
        rows.append({
            "ticker": str(r.get("ticker") or ticker).upper(),
            "ex_dividend_date": str(r["ex_dividend_date"])[:10],
            "cash_amount": r.get("cash_amount"),
            "pay_date": r.get("pay_date"),
            "frequency": r.get("frequency"),
            "dividend_type": r.get("dividend_type"),
            "currency": r.get("currency"),
        })
    return rows


def split_ratio(split_from, split_to) -> float | None:
    """Shares after per share before (4.0 = 4-for-1, 0.1 = 1-for-10 reverse) —
    the same float yfinance's `.splits` series carried, so consumers keep their
    arithmetic. None when either side is missing or non-positive."""
    try:
        f, t = float(split_from), float(split_to)
    except (TypeError, ValueError):
        return None
    if f <= 0 or t <= 0:
        return None
    return t / f


def split_ratio_label(r: float) -> str:
    """'4:1' for a forward split, '1:10' for a reverse, '1.5:1' for a 3-for-2 —
    the chart markers' long-standing format, now shared with the Calendar."""
    if r >= 1:
        return f"{int(r)}:1" if r == int(r) else f"{round(r, 2)}:1"
    inv = 1.0 / r
    return f"1:{int(inv)}" if inv == int(inv) else f"1:{round(inv, 2)}"


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
