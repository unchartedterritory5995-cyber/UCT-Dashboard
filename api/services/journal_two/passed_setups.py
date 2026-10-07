"""Wave 13 lane 13G-1 -- the "Passed setups" journal.

A name the member SAVED (a scanner or Screener capture in one of their notes, a name added to
one of their own watchlists, or one they add here) and did NOT trade is scored on what
happened next: the return over the next 1, 5, 10 and 20 sessions and the best move within 20
sessions, from the daily bars already in the store. Nothing is fetched.

THE RULES, each a decision with a rail (`tests/test_notebook_passed_setups.py`):

  * THE REFERENCE CLOSE. A save at or after the 16:00 ET close is measured from that day's
    close; any earlier save from the PREVIOUS stored session's close -- the last price the
    member could have acted on with daily bars. `base_rule` is the one place it is decided.
  * FROZEN AT SAVE. The reference close is fixed the first time it is found, and each
    horizon once filled is never recomputed, so a later bar revision cannot rewrite what a
    pass was worth. A row is final (`scored`) when +20 and the best move are both in.
  * DETERMINISTIC, NEVER INVENTED. A horizon with no bar carries a LABEL, not a number:
      - ``no_bars``  -- no stored daily bar on or before the reference day;
      - ``missing``  -- the market has had that many sessions since (counted on SPY's stored
                        bars) but the store lacks this symbol's bars;
      - ``pending``  -- that many sessions have not happened yet;
      - ``unknown``  -- neither this symbol nor SPY has a stored bar after the reference day,
                        so whether the session happened cannot be told from the store.
  * TRADED LEAVES THE LIST. A position in the name opened from the save day through the 10th
    session after the reference close (or held across the save) marks the row ``traded``; it
    stays in the table, is counted, and is not listed as a pass.
  * BOUNDED. Saves from the last 60 days, at most 300 rows a member; the refresh is
    idempotent (INSERT OR IGNORE on (user_id, symbol, saved_at, source)).

Table `j2_passed_setups`, self-ensured here (the `daily_counters` precedent), purged with the
account (`account_purge._DIRECT_USER_TABLES`). Zero model calls, zero vendor calls.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import re
import sqlite3
import uuid
from typing import Any, Iterable

from api.services.journal_two import sample_marker
from api.services.notebook_flags import flag_on

_log = logging.getLogger(__name__)

FLAG = "NOTEBOOK_PASSED_SETUPS_ENABLED"

#: The horizons, in sessions after the reference close.
HORIZONS = (1, 5, 10, 20)
#: The best move (highest high over the reference close) is read over this many sessions.
BEST_WINDOW = 20
#: A position opened within this many sessions of the reference close means the name was traded.
TRADED_WITHIN = 10
#: When the session calendar cannot be read from the store, the trade window falls back to
#: this many calendar days after the save (10 sessions is two weeks).
TRADED_FALLBACK_DAYS = 14
LOOKBACK_DAYS = 60
MAX_ROWS_PER_MEMBER = 300
#: The regular-session close, ET. A save at or after it is measured from that day's close.
CLOSE_HOUR_ET = 16
#: Widgets whose captured rows are names the member saved from a scan.
SCAN_WIDGETS = ("scanner", "screener")
#: The session calendar: SPY's stored daily bars.
CALENDAR_SYMBOL = "SPY"

#: The source of the ONE row the sample notebook adds (`add_example`). It is this table's own
#: durable marker for "the sample made this row": removal finds the row by it, and no
#: member-facing door can write it.
SOURCE_SAMPLE = "sample"
SOURCES = ("scanner", "watchlist", "manual", SOURCE_SAMPLE)
STATUS_PENDING, STATUS_SCORED, STATUS_NO_BARS, STATUS_TRADED = "pending", "scored", "no_bars", "traded"

LABELS = {
    "no_bars": "No stored daily bars for this name on or before the save",
    "missing": "Bars missing from the store",
    "pending": "Not yet",
    "unknown": "Not in the store yet",
}

_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS j2_passed_setups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    saved_at        TEXT NOT NULL,          -- ISO-8601 UTC, the save event
    source          TEXT NOT NULL,          -- scanner | watchlist | manual
    source_ref      TEXT,                   -- the note id (scanner) or list name (watchlist)
    saved_day       TEXT NOT NULL,          -- ET date of the save
    base_date       TEXT,                   -- the reference session (frozen once found)
    base_close      REAL,
    r1              REAL,
    r5              REAL,
    r10             REAL,
    r20             REAL,
    best20          REAL,
    gaps            TEXT,                   -- {horizon: label} for each horizon not filled
    sessions_stored INTEGER,
    status          TEXT NOT NULL DEFAULT 'pending',
    traded_on       TEXT,
    dismissed_at    TEXT,
    scored_at       TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (user_id, symbol, saved_at, source)
);
CREATE INDEX IF NOT EXISTS idx_j2_passed_setups_user ON j2_passed_setups(user_id, saved_at);
"""


class PassedSetupError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse."""
    return flag_on(FLAG, False)


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def _conn() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    c = get_connection()
    ensure_schema(c)
    return c


def clean_symbol(raw: Any) -> str:
    sym = str(raw or "").strip().upper().lstrip("$")
    if not _SYMBOL_RE.match(sym):
        raise PassedSetupError("That is not a ticker symbol.")
    return sym


# ── time ─────────────────────────────────────────────────────────────────────

def _et():
    from api.services.journal_two.timeutil import ET
    return ET


def _now_utc() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def parse_saved_at(raw: Any) -> _dt.datetime | None:
    """An aware UTC datetime from an ISO string or SQLite's `YYYY-MM-DD HH:MM:SS` (UTC)."""
    if not raw:
        return None
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = _dt.datetime.fromisoformat(s.replace(" ", "T", 1) if "T" not in s else s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt.astimezone(_dt.timezone.utc)


def base_rule(saved_at: _dt.datetime) -> tuple[str, int]:
    """(saved ET day 'YYYY-MM-DD', the YYYYMMDD key the reference bar must be at or before).

    ⛔ THE ONE PLACE THE REFERENCE IS DECIDED. At or after the 16:00 ET close: that day's
    close. Before it: the last stored session BEFORE that day."""
    et = saved_at.astimezone(_et())
    day = et.date()
    if et.hour >= CLOSE_HOUR_ET:
        cutoff = day
    else:
        cutoff = day - _dt.timedelta(days=1)
    return day.isoformat(), int(cutoff.strftime("%Y%m%d"))


def _ymd_iso(ts: Any) -> str | None:
    s = str(ts or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else None


# ── bars (the local store only) ──────────────────────────────────────────────

def _usable(rows: Iterable) -> list[dict]:
    from api.services.screener.technicals import usable_bars
    out = []
    for r in rows or []:
        try:
            out.append({"t": int(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4]})
        except (IndexError, TypeError, ValueError):
            continue
    return [b for b in usable_bars(out) if b["c"] > 0]


def _absent_if_no_table(fn, absent):
    try:
        return fn()
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower() or "unable to open" in str(e).lower():
            return absent
        raise


def read_base(symbol: str, cutoff_key: int) -> dict | None:
    from api.services import bars_sqlite
    rows = _absent_if_no_table(lambda: bars_sqlite.get_bars_before(symbol, "D", 5, cutoff_key), [])
    bars = _usable(rows)
    return bars[-1] if bars else None


def read_after(symbol: str, base_ts: int, limit: int) -> list[dict]:
    from api.services import bars_sqlite
    rows = _absent_if_no_table(lambda: bars_sqlite.get_bars_since(symbol, "D", int(base_ts)), [])
    return _usable(rows)[:limit]


# ── scoring (pure) ───────────────────────────────────────────────────────────

def _pct(a: float, b: float) -> float:
    return round((a / b - 1.0) * 100.0, 4)


def score(base_close: float, forward: list[dict], calendar_sessions: int | None) -> dict[str, Any]:
    """Returns {r1, r5, r10, r20, best20, gaps, sessions_stored}. Pure.

    `forward` are this symbol's stored bars after the reference, oldest first;
    `calendar_sessions` is how many sessions the market has had since (SPY's stored bars),
    or None when that cannot be read."""
    out: dict[str, Any] = {"gaps": {}, "sessions_stored": len(forward)}
    for h in HORIZONS:
        key = f"r{h}"
        if len(forward) >= h:
            out[key] = _pct(forward[h - 1]["c"], base_close)
        else:
            out[key] = None
            out["gaps"][str(h)] = _gap(h, len(forward), calendar_sessions)
    if len(forward) >= BEST_WINDOW:
        out["best20"] = _pct(max(b["h"] for b in forward[:BEST_WINDOW]), base_close)
    else:
        out["best20"] = None
        out["gaps"]["best20"] = _gap(BEST_WINDOW, len(forward), calendar_sessions)
    return out


def _gap(h: int, have: int, calendar_sessions: int | None) -> str:
    if calendar_sessions is None:
        return "unknown"
    return "missing" if calendar_sessions >= h > have else "pending"


# ── candidates (read-only on the member's notes and watchlists) ──────────────

def _watchlist_candidates(conn, user_id: str, since: _dt.datetime) -> list[dict]:
    try:
        rows = conn.execute(
            "SELECT wi.sym AS sym, wi.added_at AS added_at, w.name AS name"
            " FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id"
            " WHERE w.user_id = ? AND COALESCE(w.is_prebuilt, 0) = 0",
            (user_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        at = parse_saved_at(r["added_at"])
        if at is None or at < since:
            continue
        out.append({"symbol": r["sym"], "saved_at": at, "source": "watchlist", "source_ref": r["name"]})
    return out


def _parse_body(body_json: Any) -> Any:
    """A stored note body as a document, or None when it cannot be read. A body nested too
    deeply for the JSON parser raises RecursionError, which is not a ValueError; it reads as a
    note with no scan capture, never as an error (mirrors `chart_blocks.parse_body`)."""
    try:
        return json.loads(body_json or "{}")
    except (TypeError, ValueError, RecursionError):
        return None


def _walk_scan_embeds(node: Any, found: list[dict]) -> None:
    """Append the attrs of every scanner or Screener `widgetEmbed` under `node`, in document
    order.

    ⛔ A LOOP, NEVER A RECURSION (security review M-4). The walk used to call itself once per
    level of nesting, so a very deeply nested body raised RecursionError and this member's
    passed-setups page answered 500. The same fix, in the same shape, as lane SEC's
    `chart_blocks.iter_chart_attrs` (that helper reads chart embeds only and lives in that
    lane's file, so it is mirrored here, not shared): children are pushed in reverse so they
    come off the stack in document order."""
    stack: list[Any] = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, list):
            stack.extend(reversed(cur))
            continue
        if not isinstance(cur, dict):
            continue
        if cur.get("type") == "widgetEmbed":
            attrs = cur.get("attrs") if isinstance(cur.get("attrs"), dict) else {}
            if attrs.get("widgetId") in SCAN_WIDGETS:
                found.append(attrs)
        children = cur.get("content")
        if isinstance(children, list):
            stack.extend(reversed(children))


def _scanner_candidates(conn, user_id: str, since: _dt.datetime) -> list[dict]:
    try:
        notes = conn.execute(
            "SELECT n.id AS id, n.body_json AS body_json, n.created_at AS created_at"
            " FROM j2_notes n WHERE n.user_id = ? AND n.deleted_at IS NULL"
            # A scan captured inside a sample note is not a name the member saved (fin-data I3).
            f" AND {sample_marker.not_sample_sql('n')} AND n.id IN ("
            "   SELECT DISTINCT e.note_id FROM j2_note_embeds e"
            f"  WHERE e.user_id = ? AND e.widget_id IN ({','.join('?' * len(SCAN_WIDGETS))}))",
            (user_id, user_id, *SCAN_WIDGETS)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for n in notes:
        body = _parse_body(n["body_json"])
        if body is None:
            continue
        embeds: list[dict] = []
        _walk_scan_embeds(body, embeds)
        for attrs in embeds:
            at = parse_saved_at(attrs.get("capturedAt")) or parse_saved_at(n["created_at"])
            if at is None or at < since:
                continue
            params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
            for row in (params.get("rows") or [])[:50]:
                if not isinstance(row, dict):
                    continue
                sym = row.get("sym") or row.get("ticker")
                if isinstance(sym, str) and sym:
                    out.append({"symbol": sym, "saved_at": at, "source": "scanner",
                                "source_ref": n["id"]})
    return out


def collect(conn, user_id: str, now: _dt.datetime | None = None) -> int:
    """Insert every new candidate (idempotent). Returns how many rows were added."""
    now = now or _now_utc()
    since = now - _dt.timedelta(days=LOOKBACK_DAYS)
    cands = _scanner_candidates(conn, user_id, since) + _watchlist_candidates(conn, user_id, since)
    # One row per (symbol, ET save day): the earliest save of a name that day wins, so a name
    # in two captures of one morning is one pass, not two.
    best: dict[tuple[str, str], dict] = {}
    for c in cands:
        try:
            sym = clean_symbol(c["symbol"])
        except PassedSetupError:
            continue
        day, _ = base_rule(c["saved_at"])
        k = (sym, day)
        if k not in best or c["saved_at"] < best[k]["saved_at"]:
            best[k] = {**c, "symbol": sym}
    have = conn.execute("SELECT symbol, saved_day, source FROM j2_passed_setups WHERE user_id = ?",
                        (user_id,)).fetchall()
    # The sample's own row never stands in for a save the member made (fin-data I4).
    taken = {(r["symbol"], r["saved_day"]) for r in have if r["source"] != SOURCE_SAMPLE}
    room = MAX_ROWS_PER_MEMBER - len(have)
    added = 0
    for k in sorted(best, key=lambda k: best[k]["saved_at"], reverse=True):
        if room <= 0:
            break
        if k in taken:
            continue
        c = best[k]
        added += _insert(conn, user_id, c["symbol"], c["saved_at"], c["source"], c.get("source_ref"))
        room -= 1
    conn.commit()
    return added


def _insert(conn, user_id: str, sym: str, saved_at: _dt.datetime, source: str,
            source_ref: str | None) -> int:
    day, _ = base_rule(saved_at)
    cur = conn.execute(
        "INSERT OR IGNORE INTO j2_passed_setups"
        " (id, user_id, symbol, saved_at, source, source_ref, saved_day, status, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (uuid.uuid4().hex, user_id, sym, saved_at.isoformat(), source, source_ref, day,
         STATUS_PENDING, _now_utc().isoformat()))
    return cur.rowcount or 0


# ── traded? ──────────────────────────────────────────────────────────────────

def traded_on(conn, user_id: str, sym: str, saved_day: str, until_day: str) -> str | None:
    """The entry day of a position in `sym` opened from `saved_day` through `until_day`, or
    held across the save; None when the member did not trade it. Read-only."""
    try:
        r = conn.execute(
            "SELECT substr(entry_date, 1, 10) AS d FROM j2_positions"
            " WHERE user_id = ? AND upper(symbol) = ? AND ("
            "   (substr(entry_date, 1, 10) >= ? AND substr(entry_date, 1, 10) <= ?)"
            "   OR (substr(entry_date, 1, 10) < ?"
            "       AND (closed_at IS NULL OR substr(closed_at, 1, 10) >= ?)))"
            " ORDER BY entry_date LIMIT 1",
            (user_id, sym, saved_day, until_day, saved_day, saved_day)).fetchone()
    except sqlite3.OperationalError:
        return None
    if r:
        return r["d"]
    try:
        r = conn.execute(
            "SELECT substr(entry_date, 1, 10) AS d FROM j2_trades WHERE user_id = ? AND upper(symbol) = ?"
            " AND substr(entry_date, 1, 10) >= ? AND substr(entry_date, 1, 10) <= ?"
            " ORDER BY entry_date LIMIT 1",
            (user_id, sym, saved_day, until_day)).fetchone()
    except sqlite3.OperationalError:
        return None
    return r["d"] if r else None


# ── the refresh ──────────────────────────────────────────────────────────────

def score_row(conn, row: sqlite3.Row) -> None:
    """Score one open row in place. Frozen: a found reference and a filled horizon never move."""
    sym = row["symbol"]
    saved_at = parse_saved_at(row["saved_at"])
    if saved_at is None:
        return
    saved_day, cutoff = base_rule(saved_at)
    base_date, base_close = row["base_date"], row["base_close"]
    if base_close is None:
        base = read_base(sym, cutoff)
        if base is not None:
            base_date, base_close = _ymd_iso(base["t"]), float(base["c"])
    base_ts = int(base_date.replace("-", "")) if base_date else cutoff
    forward = read_after(sym, base_ts, BEST_WINDOW) if base_date else []
    calendar = read_after(CALENDAR_SYMBOL, base_ts, BEST_WINDOW)

    # ⛔ TRADED FIRST, whatever the bars say: a name the member traded is not a pass even when
    # the store holds no bars for it. The window ends at the 10th session after the reference
    # close (read on the session calendar, else this name's own bars, else two calendar weeks).
    sessions = calendar or forward
    if len(sessions) >= TRADED_WITHIN:
        until = _ymd_iso(sessions[TRADED_WITHIN - 1]["t"])
    else:
        until = (_dt.date.fromisoformat(saved_day) + _dt.timedelta(days=TRADED_FALLBACK_DAYS)).isoformat()
    t_on = traded_on(conn, row["user_id"], sym, saved_day, until)
    if t_on:
        conn.execute(
            "UPDATE j2_passed_setups SET status = ?, traded_on = ?, base_date = ?, base_close = ?,"
            " scored_at = ? WHERE id = ?",
            (STATUS_TRADED, t_on, base_date, base_close, _now_utc().isoformat(), row["id"]))
        return

    if base_close is None:
        conn.execute(
            "UPDATE j2_passed_setups SET status = ?, gaps = ?, sessions_stored = 0, scored_at = ?"
            " WHERE id = ?",
            (STATUS_NO_BARS, json.dumps({"base": "no_bars"}), _now_utc().isoformat(), row["id"]))
        return

    if calendar:
        calendar_n: int | None = len(calendar)
    else:
        # No SPY session after the reference: zero sessions have passed IF the calendar is
        # stored up to the reference day itself; otherwise the store cannot tell.
        spy = read_base(CALENDAR_SYMBOL, base_ts)
        calendar_n = 0 if (spy and spy["t"] == base_ts) else None

    s = score(base_close, forward, calendar_n)
    # ⛔ FROZEN: COALESCE keeps every value already filled; only an empty slot takes a new one.
    done = all(s[f"r{h}"] is not None for h in HORIZONS) and s["best20"] is not None
    conn.execute(
        "UPDATE j2_passed_setups SET base_date = COALESCE(base_date, ?),"
        " base_close = COALESCE(base_close, ?),"
        " r1 = COALESCE(r1, ?), r5 = COALESCE(r5, ?), r10 = COALESCE(r10, ?), r20 = COALESCE(r20, ?),"
        " best20 = COALESCE(best20, ?), gaps = ?, sessions_stored = ?, status = ?, scored_at = ?"
        " WHERE id = ?",
        (base_date, base_close, s["r1"], s["r5"], s["r10"], s["r20"], s["best20"],
         json.dumps(s["gaps"]), s["sessions_stored"],
         STATUS_SCORED if done else STATUS_PENDING, _now_utc().isoformat(), row["id"]))


def refresh(user_id: str, *, conn: sqlite3.Connection | None = None,
            now: _dt.datetime | None = None) -> dict[str, int]:
    """Collect new candidates, then score every row that is not final. Idempotent."""
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        added = collect(conn, user_id, now=now)
        open_rows = conn.execute(
            "SELECT * FROM j2_passed_setups WHERE user_id = ? AND dismissed_at IS NULL"
            " AND status IN (?, ?)", (user_id, STATUS_PENDING, STATUS_NO_BARS)).fetchall()
        for r in open_rows:
            try:
                score_row(conn, r)
            except Exception as e:  # noqa: BLE001 -- one bad row never blanks the others
                _log.warning("[passed_setups] scoring %s failed: %s", r["symbol"], e)
        conn.commit()
        return {"added": added, "scored": len(open_rows)}
    finally:
        if owned:
            conn.close()


def add_manual(user_id: str, symbol: Any, saved_on: Any = None, *,
               conn: sqlite3.Connection | None = None,
               now: _dt.datetime | None = None) -> dict[str, Any]:
    """A name the member passed on, added by hand. Dated today unless they name a day in the
    last 60 (a past day is taken as after that day's close)."""
    sym = clean_symbol(symbol)
    now = now or _now_utc()
    today = now.astimezone(_et()).date()
    if saved_on:
        try:
            day = _dt.date.fromisoformat(str(saved_on)[:10])
        except ValueError:
            raise PassedSetupError("That is not a date (expected YYYY-MM-DD).")
        if day > today:
            raise PassedSetupError("A pass cannot be dated in the future.")
        if day < today - _dt.timedelta(days=LOOKBACK_DAYS):
            raise PassedSetupError(f"A pass can be dated at most {LOOKBACK_DAYS} days back.")
    else:
        day = today
    if day == today:
        saved_at = now
    else:
        saved_at = _dt.datetime(day.year, day.month, day.day, CLOSE_HOUR_ET, 0,
                                tzinfo=_et()).astimezone(_dt.timezone.utc)
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        n = conn.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ?",
                         (user_id,)).fetchone()[0]
        if n >= MAX_ROWS_PER_MEMBER:
            raise PassedSetupError(
                f"Your passed-setups list is full ({MAX_ROWS_PER_MEMBER}). Remove one first.", status=409)
        day_iso, _ = base_rule(saved_at)
        # ⛔ The member's OWN rows only (fin-data I4): the sample's row for this name and day is
        # neither a duplicate of theirs nor a row this door may hand back or un-dismiss.
        own = "user_id = ? AND symbol = ? AND saved_day = ? AND source != ?"
        key = (user_id, sym, day_iso, SOURCE_SAMPLE)
        dup = conn.execute(f"SELECT id FROM j2_passed_setups WHERE {own}", key).fetchone()
        if dup is None:
            _insert(conn, user_id, sym, saved_at, "manual", None)
            conn.commit()
        row = conn.execute(f"SELECT * FROM j2_passed_setups WHERE {own}", key).fetchone()
        if row["status"] in (STATUS_PENDING, STATUS_NO_BARS) and row["dismissed_at"] is None:
            score_row(conn, row)
            conn.commit()
        if row["dismissed_at"] is not None:
            conn.execute("UPDATE j2_passed_setups SET dismissed_at = NULL WHERE id = ?", (row["id"],))
            conn.commit()
        fresh = conn.execute("SELECT * FROM j2_passed_setups WHERE id = ?", (row["id"],)).fetchone()
        return {"item": serialize(fresh), "deduped": dup is not None}
    finally:
        if owned:
            conn.close()


def add_example(user_id: str, symbol: Any, saved_on: str, *,
                conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """The sample notebook's one passed setup: a row marked `SOURCE_SAMPLE`, or None.

    ⛔ IT NEVER TOUCHES A ROW IT DID NOT MAKE (fin-data I4). `add_manual` answers the member's
    EXISTING row for the same name and day, and un-dismisses it; the sample then recorded that
    id and "Remove sample" dismissed the member's own pass. Here an existing row for the name
    and day -- any source, dismissed or not -- means the sample adds nothing and returns None:
    the member already has their own."""
    sym = clean_symbol(symbol)
    day = _dt.date.fromisoformat(str(saved_on)[:10])
    saved_at = _dt.datetime(day.year, day.month, day.day, CLOSE_HOUR_ET, 0,
                            tzinfo=_et()).astimezone(_dt.timezone.utc)
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        day_iso, _ = base_rule(saved_at)
        if conn.execute("SELECT 1 FROM j2_passed_setups WHERE user_id = ? AND symbol = ? AND saved_day = ?",
                        (user_id, sym, day_iso)).fetchone() is not None:
            return None
        if not _insert(conn, user_id, sym, saved_at, SOURCE_SAMPLE, None):
            return None
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_passed_setups WHERE user_id = ? AND symbol = ? AND saved_day = ? AND source = ?",
            (user_id, sym, day_iso, SOURCE_SAMPLE)).fetchone()
        score_row(conn, row)
        conn.commit()
        return serialize(conn.execute("SELECT * FROM j2_passed_setups WHERE id = ?", (row["id"],)).fetchone())
    finally:
        if owned:
            conn.close()


def dismiss_examples(user_id: str, *, conn: sqlite3.Connection | None = None) -> int:
    """Dismiss every row the sample made for this member, found by the row's OWN marker
    (`source = SOURCE_SAMPLE`) and nothing else -- never by an id a preference names, which a
    client can write. Returns how many were dismissed."""
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        cur = conn.execute(
            "UPDATE j2_passed_setups SET dismissed_at = ? WHERE user_id = ? AND source = ?"
            " AND dismissed_at IS NULL", (_now_utc().isoformat(), user_id, SOURCE_SAMPLE))
        conn.commit()
        return cur.rowcount or 0
    finally:
        if owned:
            conn.close()


def dismiss(user_id: str, item_id: str, *, conn: sqlite3.Connection | None = None) -> bool:
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        cur = conn.execute(
            "UPDATE j2_passed_setups SET dismissed_at = ? WHERE id = ? AND user_id = ?"
            " AND dismissed_at IS NULL", (_now_utc().isoformat(), item_id, user_id))
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        if owned:
            conn.close()


def serialize(r: sqlite3.Row) -> dict[str, Any]:
    gaps = {}
    try:
        gaps = json.loads(r["gaps"] or "{}") or {}
    except (TypeError, ValueError):
        gaps = {}
    outcomes = []
    for h in HORIZONS:
        v = r[f"r{h}"]
        g = None if v is not None else (gaps.get(str(h)) or ("no_bars" if r["status"] == STATUS_NO_BARS else "pending"))
        outcomes.append({"key": f"r{h}", "sessions": h, "pct": v, "missing": g,
                         "label": LABELS.get(g) if g else None})
    v = r["best20"]
    g = None if v is not None else (gaps.get("best20") or ("no_bars" if r["status"] == STATUS_NO_BARS else "pending"))
    outcomes.append({"key": "best20", "sessions": BEST_WINDOW, "pct": v, "missing": g,
                     "label": LABELS.get(g) if g else None, "best": True})
    return {
        "id": r["id"], "symbol": r["symbol"], "savedAt": r["saved_at"], "savedDay": r["saved_day"],
        "source": r["source"], "sourceRef": r["source_ref"], "status": r["status"],
        "baseDate": r["base_date"], "baseClose": r["base_close"],
        "sessionsStored": r["sessions_stored"], "tradedOn": r["traded_on"],
        "outcomes": outcomes,
        "noBarsLabel": LABELS["no_bars"] if r["status"] == STATUS_NO_BARS else None,
    }


def list_items(user_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    owned = conn is None
    conn = conn or _conn()
    try:
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM j2_passed_setups WHERE user_id = ? AND dismissed_at IS NULL"
            " ORDER BY saved_at DESC, symbol", (user_id,)).fetchall()
        items = [serialize(r) for r in rows if r["status"] != STATUS_TRADED]
        traded = [r["symbol"] for r in rows if r["status"] == STATUS_TRADED]
        return {"items": items, "tradedCount": len(traded), "horizons": list(HORIZONS),
                "bestWindow": BEST_WINDOW, "tradedWithin": TRADED_WITHIN,
                "lookbackDays": LOOKBACK_DAYS}
    finally:
        if owned:
            conn.close()


def nightly_job() -> None:
    """The nightly refresh: every member who has a passed-setups row. A no-op while the gate is
    off; never raises (a scheduler job that raises is logged and forgotten)."""
    if not enabled():
        return
    try:
        conn = _conn()
    except Exception as e:  # noqa: BLE001
        _log.warning("[passed_setups] nightly: no connection: %s", e)
        return
    try:
        users = [r[0] for r in conn.execute(
            "SELECT DISTINCT user_id FROM j2_passed_setups LIMIT 2000").fetchall()]
        for uid in users:
            try:
                refresh(uid, conn=conn)
            except Exception as e:  # noqa: BLE001
                _log.warning("[passed_setups] nightly refresh failed for a member: %s", e)
    finally:
        conn.close()
