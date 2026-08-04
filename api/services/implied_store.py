"""Nightly implied-move + grade snapshot store (web-side, /data SQLite).

Why nightly & pre-report: 'implied at the time' history for the paired-bars
hero. A morning-after capture stores IV-crushed values and poisons the pair —
capture runs post-close (options quotes settle ~4:15 ET) for tonight's AMC
and all names reporting within the next 14 days.
First-write-wins per (sym, report_date): the earliest snapshot is the honest
pre-report implied; later recaptures never overwrite it.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import sqlite3
import threading
from contextlib import closing

import httpx

from api.services import implied_move
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("IMPLIED_STORE_DB", os.path.join(_DATA_DIR, "implied_moves.db"))

_REPORTERS_CACHE = TTLCache()
_REPORTERS_TTL = 6 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS implied_snapshots (
  sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL,
  pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL,
  iv_atm REAL, source TEXT, PRIMARY KEY (sym, report_date)
);
CREATE TABLE IF NOT EXISTS grade_snapshots (
  sym TEXT NOT NULL, date TEXT NOT NULL, surface TEXT NOT NULL,
  grade TEXT NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (sym, date, surface)
);
"""

_INIT_LOCK = threading.Lock()
_INITIALIZED: set[str] = set()


def _connect() -> sqlite3.Connection:
    """Open a connection with WAL pragma (no schema init)."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _ensure_init() -> None:
    """Run schema initialization once per DB_PATH (double-checked lock pattern)."""
    global _INITIALIZED
    if DB_PATH in _INITIALIZED:
        return
    with _INIT_LOCK:
        if DB_PATH in _INITIALIZED:
            return
        with closing(_connect()) as c:
            c.executescript(_SCHEMA)
        _INITIALIZED.add(DB_PATH)


def _has_snapshot(sym: str, report_date: str) -> bool:
    """Check if a snapshot exists for this (sym, report_date) pair."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT 1 FROM implied_snapshots WHERE sym = ? AND report_date = ? LIMIT 1",
            (sym.upper(), report_date),
        ).fetchone()
    return row is not None


def record_implied(sym: str, report_date: str, payload: dict, captured_at: str) -> None:
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR IGNORE INTO implied_snapshots "
            "(sym, report_date, captured_at, pct, dollar, expiry, strike, spot, iv_atm, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (sym.upper(), report_date, captured_at, payload["pct"], payload["dollar"],
             payload.get("expiry"), payload.get("strike"), payload.get("spot"),
             payload.get("iv_atm"), payload.get("source")),
        )


def get_implied_history(sym: str, limit: int = 8) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, report_date, captured_at, pct, dollar, expiry FROM implied_snapshots "
            "WHERE sym = ? ORDER BY report_date DESC LIMIT ?", (sym.upper(), int(limit)),
        ).fetchall()
    return [dict(r) for r in rows]


def record_grade(sym: str, date: str, surface: str, grade: str, inputs: dict) -> None:
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR REPLACE INTO grade_snapshots (sym, date, surface, grade, inputs_json) "
            "VALUES (?,?,?,?,?)",
            (sym.upper(), date, surface, grade, json.dumps(inputs, separators=(",", ":"))),
        )


def get_grade_history(sym: str, surface: str, limit: int = 30) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, date, surface, grade, inputs_json FROM grade_snapshots "
            "WHERE sym = ? AND surface = ? ORDER BY date DESC LIMIT ?",
            (sym.upper(), surface, int(limit)),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["inputs"] = json.loads(d.pop("inputs_json"))
        out.append(d)
    return out


def upcoming_reporters(days: int = 14, now: dt.datetime | None = None) -> list[dict]:
    """Symbols reporting within `days`, via Finnhub's calendar range.
    Empty list on ANY failure — the nightly job then no-ops (holiday-safe)."""
    key = f"impstore::reporters::{days}"
    cached = _REPORTERS_CACHE.get(key)
    if cached is not None:
        return list(cached)
    api_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not api_key:
        return []
    today = (now or dt.datetime.now()).date()
    try:
        r = httpx.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today.isoformat(),
                    "to": (today + dt.timedelta(days=days)).isoformat(),
                    "token": api_key},
            timeout=10,
        )
        r.raise_for_status()
        rows = (r.json() or {}).get("earningsCalendar") or []
    except Exception as e:  # noqa: BLE001 — any failure → empty, never cached
        _log.warning("upcoming_reporters fetch failed: %s", e)
        return []
    out = [{"sym": (row.get("symbol") or "").upper(), "report_date": row.get("date")}
           for row in rows if row.get("symbol") and row.get("date")]
    if out:
        _REPORTERS_CACHE.set(key, list(out), _REPORTERS_TTL)
    return out


def run_nightly_capture(now: dt.datetime | None = None) -> dict:
    """Post-close capture for every symbol reporting within 14 days.
    Never stores a failure; existing (sym, report_date) rows are kept (first-write-wins).
    Exception isolation: one bad symbol never truncates the batch."""
    reporters = upcoming_reporters(days=14, now=now)
    summary = {"captured": 0, "skipped": 0, "failed": 0}
    captured_at = (now or dt.datetime.now()).isoformat(timespec="seconds")
    for rep in reporters:
        try:
            if _has_snapshot(rep["sym"], rep["report_date"]):
                summary["skipped"] += 1
                continue
            payload = implied_move.get_expected_move(rep["sym"], rep["report_date"])
            if payload is None:
                summary["failed"] += 1
                continue
            record_implied(rep["sym"], rep["report_date"], payload, captured_at)
            summary["captured"] += 1
        except Exception:  # noqa: BLE001 — one bad symbol must never truncate the batch
            _log.warning("[implied-store] capture failed for %s", rep.get("sym"), exc_info=True)
            summary["failed"] += 1
    _log.info("[implied-store] nightly capture: %s", summary)
    return summary
