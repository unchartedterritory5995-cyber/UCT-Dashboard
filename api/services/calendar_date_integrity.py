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
from typing import Optional

# ── DB path (own file on the /data volume) ─────────────────────────────────────
_DB_PATH = os.environ.get("CALENDAR_DATES_DB_PATH", "/data/calendar_dates.db")
if not os.path.exists(os.path.dirname(_DB_PATH)):
    _DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "calendar_dates.db")

_INIT_DONE = False
_INIT_LOCK = threading.Lock()

# ── D-1 / D-2 (Lane R): the date-status lifecycle, per CURRENT report date ────
# ⛔ Every timestamp below is WHEN UCT'S CALENDAR BUILD FIRST SAW the fact, never the
# company's own announcement time: no provider we hold carries that.
#   date_first_seen_at   first observation of the CURRENT report_date (reset on a move)
#   status               the highest state seen for the current date (STATUS_RANK)
#   status_basis         the field reading that produced `status`
#   status_at            when `status` was first reached for the current date
#   first_estimated_at   first time the current date was seen as an estimate
#   first_confirmed_at   D-2: first time the current date was seen confirmed
#   prev_status          the status the OLD date had when it moved, so a drift chip
#                        can tell "an estimate was revised" from "a confirmed date
#                        changed"
#   moved_at             when that move was recorded
# The columns are ADDED in place (`_ensure_init`), so the one row per symbol stays
# the one row per symbol; `screener/earnings_movement` reads this table by named
# columns and never sees them.
_STATUS_COLUMNS = (
    "date_first_seen_at", "status", "status_basis", "status_at",
    "first_estimated_at", "first_confirmed_at", "prev_status", "moved_at",
)
# A status only ever RISES for one report date: provider legs are first-placement-
# wins and can alternate between builds, and "a provider gave a session" does not
# un-happen because a later build placed the name from a sessionless leg.
STATUS_RANK = {"unstated": 0, "estimated": 1, "confirmed": 2, "reported": 3}


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
            have = {r[1] for r in conn.execute("PRAGMA table_info(calendar_date_history)")}
            for col in _STATUS_COLUMNS:
                if col not in have:
                    conn.execute(f"ALTER TABLE calendar_date_history ADD COLUMN {col} TEXT")
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


def observe_many(pairs: list[tuple]) -> None:
    """Batch observe — one connection for a whole week's reporters.

    Each item is `(sym, report_date)` or, from the calendar build (D-1/D-2),
    `(sym, report_date, status, basis)`. The 2-tuple path is byte-for-byte the old
    behaviour (an identical date writes nothing). A status-carrying item ALSO
    advances the status columns, and never touches `updated_at`, whose meaning
    (`screener/earnings_movement` reads it) stays "last date change"."""
    if not pairs:
        return
    _ensure_init()
    now = datetime.now(timezone.utc).isoformat()
    with contextlib.closing(_conn()) as conn:
        for item in pairs:
            sym, report_date = item[0], item[1]
            status = item[2] if len(item) > 2 else None
            basis = item[3] if len(item) > 3 else None
            sym = (sym or "").upper().strip()
            if not sym or not report_date:
                continue
            row = conn.execute(
                "SELECT report_date, status FROM calendar_date_history WHERE sym = ?", (sym,)
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO calendar_date_history (sym, report_date, prev_date, first_seen, updated_at, "
                    "date_first_seen_at) VALUES (?, ?, NULL, ?, ?, ?)",
                    (sym, report_date, now, now, now),
                )
                prior = None
            elif row["report_date"] != report_date:
                # A move: the lifecycle restarts for the NEW date. `prev_status` keeps
                # what the OLD date had reached, which is what tells a revised estimate
                # from a confirmed date that changed.
                conn.execute(
                    "UPDATE calendar_date_history SET prev_date = ?, report_date = ?, updated_at = ?, "
                    "prev_status = ?, moved_at = ?, date_first_seen_at = ?, status = NULL, "
                    "status_basis = NULL, status_at = NULL, first_estimated_at = NULL, "
                    "first_confirmed_at = NULL WHERE sym = ?",
                    (row["report_date"], report_date, now, row["status"], now, now, sym),
                )
                prior = None
            else:
                prior = row["status"]
            if status in STATUS_RANK:
                _advance_status(conn, sym, prior, status, basis, now)
        conn.commit()


def _advance_status(conn, sym: str, prior: Optional[str], status: str,
                    basis: Optional[str], now: str) -> None:
    """Raise the current date's status (never lower it) and stamp each first-reached
    moment once. `first_estimated_at` / `first_confirmed_at` are set the first time
    that state is SEEN, even when a higher one was seen earlier, so the lifecycle
    reads in the order UCT observed it."""
    sets, args = [], []
    if prior not in STATUS_RANK or STATUS_RANK[status] > STATUS_RANK[prior]:
        sets += ["status = ?", "status_basis = ?", "status_at = ?"]
        args += [status, basis, now]
    if status == "estimated":
        sets.append("first_estimated_at = COALESCE(first_estimated_at, ?)")
        args.append(now)
    if status in ("confirmed", "reported"):
        sets.append("first_confirmed_at = COALESCE(first_confirmed_at, ?)")
        args.append(now)
    if sets:
        conn.execute(f"UPDATE calendar_date_history SET {', '.join(sets)} WHERE sym = ?", (*args, sym))


def classify_entry(entry: dict, bucket: str) -> tuple[str, str]:
    """D-1: the date status a calendar entry SUPPORTS, from fields the payload
    already carries, with the reading that produced it. Never invents a state:

      reported   an actual (eps_act / rev_act) is on the entry
      estimated  `date_est` is true -- set by the Finnhub leg for a row with no
                 session hour, and by the FMP range leg (FMP carries no session
                 and no confirmation field)
      confirmed  a provider leg gave a reporting SESSION: the bmo/amc bucket
                 (EarningsWhispers schedule, Finnhub hour, or the Finviz session
                 leg), or Finnhub hour=dmh (`date_est` false in the tbd bucket).
                 The calendar's "confirmed only" filter uses this same reading.
      unstated   no leg said either

    ⛔ "Confirmed" is a provider placing a session, NOT the company's own
    confirmation announcement: no provider we hold carries that field, which is
    why a "company-signaled" state is not offered (see `COMPANY_SIGNALED`)."""
    if entry.get("eps_act") is not None or entry.get("rev_act") is not None:
        return "reported", "actuals on file (eps_act / rev_act)"
    if entry.get("date_est") is True:
        return "estimated", ("date_est=true: a Finnhub row with no session hour, or an FMP "
                             "range row (FMP carries no session or confirmation field)")
    if bucket in ("bmo", "amc"):
        return "confirmed", (f"session={bucket}: placed in a session by a provider leg "
                             "(EarningsWhispers schedule, Finnhub hour, or Finviz session)")
    if entry.get("date_est") is False:
        return "confirmed", "date_est=false in the tbd bucket: Finnhub hour=dmh (during market hours)"
    return "unstated", "no provider leg stated a session or an estimate flag"


COMPANY_SIGNALED = {
    "state": "unavailable",
    "reason": ("No provider UCT pays for returns a company-signaled (tentative) date as "
               "a field, so that middle state is not shown rather than guessed."),
}

_STATUS_SELECT = (
    "SELECT sym, report_date, prev_date, first_seen, updated_at, date_first_seen_at, status, "
    "status_basis, status_at, first_estimated_at, first_confirmed_at, prev_status, moved_at "
    "FROM calendar_date_history"
)


def get_status(syms: list[str]) -> dict[str, dict]:
    """D-1/D-2 read: { SYM: lifecycle } for the syms the store holds. A sym the
    calendar has never placed is ABSENT (never a default status). Raises on a store
    that cannot be read, so the route can say so instead of answering 'none'."""
    up = sorted({(s or "").upper().strip() for s in syms if s and (s or "").strip()})
    if not up:
        return {}
    _ensure_init()
    out: dict[str, dict] = {}
    with contextlib.closing(_conn()) as conn:
        qmarks = ",".join("?" * len(up))
        for r in conn.execute(f"{_STATUS_SELECT} WHERE sym IN ({qmarks})", up).fetchall():
            moved = None
            if r["prev_date"] and r["prev_date"] != r["report_date"]:
                prev = r["prev_status"]
                moved = {
                    "from": r["prev_date"], "to": r["report_date"], "at": r["moved_at"],
                    "from_status": prev,
                    # Only a date that had reached a session (or a print) is a CHANGE of a
                    # confirmed date; anything lower is a revised estimate; a move recorded
                    # before this lane carried no status, and says so.
                    "kind": ("confirmed_date_changed" if prev in ("confirmed", "reported")
                             else "estimate_revised" if prev in ("estimated", "unstated")
                             else "status_not_recorded"),
                }
            out[r["sym"]] = {
                "report_date": r["report_date"],
                "status": r["status"] or "not_recorded",
                "basis": r["status_basis"],
                "status_at": r["status_at"],
                "date_first_seen_at": r["date_first_seen_at"],
                "first_estimated_at": r["first_estimated_at"],
                "first_confirmed_at": r["first_confirmed_at"],
                "moved": moved,
            }
    return out


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
