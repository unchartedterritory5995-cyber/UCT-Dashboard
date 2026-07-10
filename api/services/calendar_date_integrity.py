"""
calendar_date_integrity.py — tracks earnings-date drift.

Wall Street Horizon sells exactly this to institutions: a wrong or shifted
earnings date burns options traders every quarter, and no retail product flags
it. We store each symbol's most-recently-observed next-report date; when a fresh
observation shows a DIFFERENT date, we record the move so the UI can surface a
"Date moved Jul 28 → Aug 4" chip.

Table: calendar_date_history(sym, report_date, prev_date, first_seen, updated_at)
  PRIMARY KEY (sym) — one row per symbol, the CURRENT belief + the last change.
  report_date : the date we currently believe the sym reports (ISO).
  prev_date   : the immediately-prior date if it changed (else NULL) — the "moved from".
  updated_at  : when we last touched this row.

Self-initialising on the Railway /data volume, mirroring cot.db / calendars.db.
No new provider — fed from the same Finnhub/FMP range payloads the calendar
already fetches, plus earnings_table._next_report_date for search lookups.
"""
from __future__ import annotations
import os
import sqlite3
import contextlib
import threading
from datetime import datetime, timezone

# ── DB path (own file on the /data volume) ─────────────────────────────────────
_DB_PATH = os.environ.get("CALENDAR_DATES_DB_PATH", "/data/calendar_dates.db")
if not os.path.exists(os.path.dirname(_DB_PATH)):
    _DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "calendar_dates.db")

_INIT_DONE = False
_INIT_LOCK = threading.Lock()


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.row_factory = sqlite3.Row
    return c


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
        with contextlib.closing(_conn()) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calendar_date_history (
                    sym         TEXT PRIMARY KEY,
                    report_date TEXT NOT NULL,
                    prev_date   TEXT,
                    first_seen  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
        _INIT_DONE = True


def observe(sym: str, report_date: str) -> None:
    """Record an observation of `sym`'s next-report date.

    First sighting → store it. Same date → touch updated_at. DIFFERENT date →
    record the move (prev_date = the old date). Only forward observations of a
    FUTURE-facing date should be fed here (the caller filters); this function
    stays dumb and idempotent-per-date.
    """
    sym = (sym or "").upper().strip()
    if not sym or not report_date:
        return
    _ensure_init()
    now = datetime.now(timezone.utc).isoformat()
    with contextlib.closing(_conn()) as conn:
        row = conn.execute(
            "SELECT report_date FROM calendar_date_history WHERE sym = ?", (sym,)
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO calendar_date_history (sym, report_date, prev_date, first_seen, updated_at) "
                "VALUES (?, ?, NULL, ?, ?)",
                (sym, report_date, now, now),
            )
        elif row["report_date"] != report_date:
            conn.execute(
                "UPDATE calendar_date_history SET prev_date = ?, report_date = ?, updated_at = ? WHERE sym = ?",
                (row["report_date"], report_date, now, sym),
            )
        else:
            conn.execute(
                "UPDATE calendar_date_history SET updated_at = ? WHERE sym = ?", (now, sym)
            )
        conn.commit()


def observe_many(pairs: list[tuple[str, str]]) -> None:
    """Batch observe — one connection for a whole week's reporters."""
    if not pairs:
        return
    _ensure_init()
    now = datetime.now(timezone.utc).isoformat()
    with contextlib.closing(_conn()) as conn:
        for sym, report_date in pairs:
            sym = (sym or "").upper().strip()
            if not sym or not report_date:
                continue
            row = conn.execute(
                "SELECT report_date FROM calendar_date_history WHERE sym = ?", (sym,)
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO calendar_date_history (sym, report_date, prev_date, first_seen, updated_at) "
                    "VALUES (?, ?, NULL, ?, ?)",
                    (sym, report_date, now, now),
                )
            elif row["report_date"] != report_date:
                conn.execute(
                    "UPDATE calendar_date_history SET prev_date = ?, report_date = ?, updated_at = ? WHERE sym = ?",
                    (row["report_date"], report_date, now, sym),
                )
        conn.commit()


def get_moves(syms: list[str]) -> dict[str, dict]:
    """For the given syms, return { SYM: {from, to} } for any whose CURRENT
    stored date differs from a recorded prior — i.e. the date moved. Only rows
    whose move still points at the current belief are returned (prev_date set).
    """
    if not syms:
        return {}
    _ensure_init()
    up = [s.upper().strip() for s in syms if s]
    if not up:
        return {}
    out: dict[str, dict] = {}
    with contextlib.closing(_conn()) as conn:
        qmarks = ",".join("?" * len(up))
        rows = conn.execute(
            f"SELECT sym, report_date, prev_date FROM calendar_date_history "
            f"WHERE sym IN ({qmarks}) AND prev_date IS NOT NULL",
            up,
        ).fetchall()
        for r in rows:
            # Only surface a real forward shift (both dates present, different).
            if r["prev_date"] and r["prev_date"] != r["report_date"]:
                out[r["sym"]] = {"from": r["prev_date"], "to": r["report_date"]}
    return out


def status() -> dict:
    """Small admin summary."""
    _ensure_init()
    with contextlib.closing(_conn()) as conn:
        total = conn.execute("SELECT COUNT(*) c FROM calendar_date_history").fetchone()["c"]
        moved = conn.execute(
            "SELECT COUNT(*) c FROM calendar_date_history WHERE prev_date IS NOT NULL"
        ).fetchone()["c"]
    return {"tracked": total, "with_moves": moved, "db": _DB_PATH}
