"""Nightly implied-move + grade snapshot store (web-side, /data SQLite).

Why nightly & pre-report: 'implied at the time' history for the paired-bars
hero. A morning-after capture stores IV-crushed values and poisons the pair —
capture runs post-close (options quotes settle ~4:15 ET) for tonight's AMC +
reporters through today+WINDOW (env IMPLIED_CAPTURE_WINDOW_DAYS, default 1),
with bmo-today excluded (it already reported this morning; a post-report
capture would store IV-crushed values).
First-write-wins per (sym, report_date): with the narrowed window the first
write IS the T-1/T-0-pre-report write — the earliest snapshot is the honest
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
from zoneinfo import ZoneInfo

import httpx

from api.services import implied_move
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("IMPLIED_STORE_DB", os.path.join(_DATA_DIR, "implied_moves.db"))

_REPORTERS_CACHE = TTLCache()
_REPORTERS_TTL = 6 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS implied_snapshots (
  sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL,
  pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL,
  iv_atm REAL, source TEXT, fiscal_year INTEGER, fiscal_quarter INTEGER,
  PRIMARY KEY (sym, report_date)
);
CREATE TABLE IF NOT EXISTS grade_snapshots (
  sym TEXT NOT NULL, date TEXT NOT NULL, surface TEXT NOT NULL,
  grade TEXT NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (sym, date, surface)
);
"""

# Additive migration for a DB file created before fiscal_year/fiscal_quarter
# existed — CREATE TABLE IF NOT EXISTS above never adds columns to an already-
# existing table, so an existing /data/implied_moves.db needs an explicit
# ALTER. Mirrors the PRAGMA table_info(...) guard used by desk_session_announce
# / education_service / modelbook_service elsewhere in this codebase.
_FISCAL_KEY_ALTERS = (
    ("fiscal_year", "ALTER TABLE implied_snapshots ADD COLUMN fiscal_year INTEGER"),
    ("fiscal_quarter", "ALTER TABLE implied_snapshots ADD COLUMN fiscal_quarter INTEGER"),
)

_INIT_LOCK = threading.Lock()
_INITIALIZED: set[str] = set()


def _int_or_none(v):
    """int(v) preserving None — an absent fiscal_year/fiscal_quarter must never
    coerce to a phantom 0, and a genuine 0 (however implausible) must survive."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _float_or_none(v):
    """float(v) preserving None — used for eps_estimate's presence check in
    `_reporter_preferred`; a real negative estimate must never be treated as
    falsy/absent, and a malformed value must never crash the tie-break."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _canon(sym: str) -> str:
    """Canonical store form — matches the repo-wide convention in
    groups.py/theme_index.py/theme_performance.py: uppercase, dot→hyphen
    class-share notation (BRK.B and BRK-B must key the same row)."""
    return (sym or "").strip().upper().replace(".", "-")


def _connect() -> sqlite3.Connection:
    """Open a connection with WAL pragma (no schema init, no directory creation —
    see _ensure_init)."""
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _ensure_init() -> None:
    """Run schema initialization once per DB_PATH (double-checked lock pattern).
    Also owns directory creation — a bare filename DB_PATH (no directory
    component, e.g. in tests) must not crash `os.makedirs`, and this runs once
    per process instead of on every connection."""
    global _INITIALIZED
    if DB_PATH in _INITIALIZED:
        return
    with _INIT_LOCK:
        if DB_PATH in _INITIALIZED:
            return
        d = os.path.dirname(DB_PATH)
        if d:
            os.makedirs(d, exist_ok=True)
        with closing(_connect()) as c:
            c.executescript(_SCHEMA)
            cols = {r["name"] for r in c.execute("PRAGMA table_info(implied_snapshots)")}
            for col_name, alter_sql in _FISCAL_KEY_ALTERS:
                if col_name not in cols:
                    c.execute(alter_sql)
            c.commit()
        _INITIALIZED.add(DB_PATH)


def _has_snapshot(sym: str, report_date: str) -> bool:
    """Check if a snapshot exists for this (sym, report_date) pair."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT 1 FROM implied_snapshots WHERE sym = ? AND report_date = ? LIMIT 1",
            (_canon(sym), report_date),
        ).fetchone()
    return row is not None


def record_implied(sym: str, report_date: str, payload: dict, captured_at: str,
                    fiscal_year: int | None = None, fiscal_quarter: int | None = None) -> None:
    """`fiscal_year`/`fiscal_quarter` are the provider's own fiscal identifiers
    (see `upcoming_reporters`) — the pairing key a client uses to join this
    snapshot to its history row by fiscal identity instead of by `report_date`
    string equality (a past history row's true announcement date is often
    unknown). Optional + additive: existing callers that omit them keep
    writing a row exactly as before (fiscal_year/fiscal_quarter = NULL).
    INSERT OR IGNORE + the (sym, report_date) PRIMARY KEY still make this
    first-write-wins and idempotent — a re-run with a different fiscal key on
    an already-captured (sym, report_date) is silently ignored, same as any
    other field."""
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR IGNORE INTO implied_snapshots "
            "(sym, report_date, captured_at, pct, dollar, expiry, strike, spot, iv_atm, source, "
            "fiscal_year, fiscal_quarter) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (_canon(sym), report_date, captured_at, payload["pct"], payload["dollar"],
             payload.get("expiry"), payload.get("strike"), payload.get("spot"),
             payload.get("iv_atm"), payload.get("source"),
             _int_or_none(fiscal_year), _int_or_none(fiscal_quarter)),
        )


def get_implied_history(sym: str, limit: int = 8) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, report_date, captured_at, pct, dollar, expiry, fiscal_year, fiscal_quarter "
            "FROM implied_snapshots WHERE sym = ? ORDER BY report_date DESC LIMIT ?",
            (_canon(sym), int(limit)),
        ).fetchall()
    return [dict(r) for r in rows]


def get_earliest_report_date(sym: str) -> str | None:
    """MIN(report_date) for a symbol — drives the router's `history_since`
    without drifting once more than `limit` snapshots exist for a name."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT MIN(report_date) AS md FROM implied_snapshots WHERE sym = ?",
            (_canon(sym),),
        ).fetchone()
    return row["md"] if row and row["md"] is not None else None


def record_grade(sym: str, date: str, surface: str, grade: str, inputs: dict) -> None:
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR REPLACE INTO grade_snapshots (sym, date, surface, grade, inputs_json) "
            "VALUES (?,?,?,?,?)",
            (_canon(sym), date, surface, grade, json.dumps(inputs, separators=(",", ":"))),
        )


def get_grade_history(sym: str, surface: str, limit: int = 30) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, date, surface, grade, inputs_json FROM grade_snapshots "
            "WHERE sym = ? AND surface = ? ORDER BY date DESC LIMIT ?",
            (_canon(sym), surface, int(limit)),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["inputs"] = json.loads(d.pop("inputs_json"))
        out.append(d)
    return out


def upcoming_reporters(days: int = 14, now: dt.datetime | None = None) -> list[dict]:
    """Symbols reporting within `days`, via Finnhub's calendar range. Each row
    carries Finnhub's `hour` field ("bmo"/"amc"/"dmh"/"") so callers can apply
    session-aware capture logic (see run_nightly_capture), plus Finnhub's own
    `fiscal_year`/`fiscal_quarter` (from /calendar/earnings' `year`/`quarter`)
    — the fiscal identity `record_implied` files the snapshot under, so a
    later history row keyed on the SAME provider quarter/year (but a different
    date — the period end, not this announcement date) can still pair with it.
    Empty list on ANY failure — the nightly job then no-ops (holiday-safe)."""
    today = (now or dt.datetime.now()).date()
    # Cache key includes the date — `days` alone collided across calendar days,
    # serving yesterday's reporter list (and yesterday's report_dates) all day.
    key = f"impstore::reporters::{days}::{today.isoformat()}"
    cached = _REPORTERS_CACHE.get(key)
    if cached is not None:
        return list(cached)
    api_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not api_key:
        return []
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
    out = [{"sym": _canon(row.get("symbol")), "report_date": row.get("date"),
            "hour": row.get("hour") or "",
            "fiscal_year": _int_or_none(row.get("year")),
            "fiscal_quarter": _int_or_none(row.get("quarter")),
            # Carried ONLY as `_dedupe_reporters`' tie-break input (review
            # round 1, CRITICAL) — a real epsEstimate marks the genuine row
            # when Finnhub lists the same (sym, date) twice under two
            # different fiscal quarters (observed live: GLOO 2026-08-17).
            "eps_estimate": _float_or_none(row.get("epsEstimate"))}
           for row in rows if row.get("symbol") and row.get("date")]
    if out:
        _REPORTERS_CACHE.set(key, list(out), _REPORTERS_TTL)
    return out


def _hour_rank(hour) -> int:
    """1 for 'bmo' (case/whitespace-insensitive), else 0. 'bmo' is the ONE
    hour value `run_nightly_capture` branches on (the bmo-today skip, read
    one line after `_dedupe_reporters` resolves) — review round 2 CRITICAL:
    a collision that ties on eps_estimate presence and fiscal_year/
    fiscal_quarter but genuinely differs on `hour` used to fall through to
    array order, meaning WHICH candidate's `hour` survived decided whether
    tonight's capture fired at all (or worse, ran under the wrong session
    and stored an IV-crushed value under first-write-wins). When ambiguous,
    bias toward 'bmo' — the SAFE direction: wrongly resolving to 'bmo' costs
    one quarter's pre-report snapshot (no data, honestly cold); wrongly
    resolving to anything else risks silently storing a corrupted
    post-report value forever. Per §12: showing nothing beats showing a
    confidently wrong number.

    Review round 3 CRITICAL — MUST normalize the same way
    `run_nightly_capture` does (`.lower()` at the bmo-today check, one line
    after this resolves) or the bias silently breaks: `_hour_rank("BMO")`
    with a bare `== "bmo"` returns 0, tying with 'amc' (also 0), and the
    canonical-string fallback then picks whichever sorts greater in plain
    ASCII — 'BMO' < 'amc' ('B'=66 < 'a'=97) — so 'amc' would win and a
    genuinely-bmo row could be captured as if pre-report, storing an
    IV-crushed value permanently. Verified live."""
    return 1 if (hour or "").strip().lower() == "bmo" else 0


def _reporter_sort_key(rep: dict) -> tuple:
    """A STRICT total order over a reporter row, so `_reporter_preferred`
    never falls through to "whichever came first" — review round 2 CRITICAL.
    The prior 3-field key `(eps_present, fiscal_year, fiscal_quarter)` could
    tie while the rows genuinely differed elsewhere (observed live: a
    same-date duplicate tying on all three but disagreeing on `hour` —
    'bmo' vs 'amc' — decided by Finnhub's array order whether tonight's
    capture fired at all). This key adds `hour` (the one remaining field
    `run_nightly_capture` branches on) and, as the unconditional final
    tie-break, a canonical JSON serialization of the WHOLE row — so two
    reporter dicts compare equal here if and ONLY IF they are content-
    identical (order genuinely can't matter then), and unequal otherwise
    resolves the SAME way regardless of which one was visited first.
    `eps_present` uses `is not None`, never a truthy check: a genuine
    `eps_estimate` of 0.0 must count as present, matching the module's
    phantom-zero standard everywhere else."""
    eps_present = rep.get("eps_estimate") is not None
    absent = -1  # sentinel below any real fiscal_year/fiscal_quarter (never 0 or negative in practice)
    fy = rep.get("fiscal_year") if rep.get("fiscal_year") is not None else absent
    fq = rep.get("fiscal_quarter") if rep.get("fiscal_quarter") is not None else absent
    hour_rank = _hour_rank(rep.get("hour"))
    canonical = json.dumps(rep, sort_keys=True, default=str)
    return (eps_present, fy, fq, hour_rank, canonical)


def _reporter_preferred(new: dict, old: dict) -> bool:
    """Deterministic, ORDER-INDEPENDENT tie-break between two reporter rows
    sharing the same (sym, report_date) — see `_dedupe_reporters`. Built on
    `_reporter_sort_key`'s strict total order: real `eps_estimate` first,
    then higher (fiscal_year, fiscal_quarter), then 'bmo'-biased `hour`, then
    (unconditionally) the row's own canonical serialization. Because the key
    is total, `new_key > old_key` picks the SAME winner regardless of which
    row is visited first — a true fixed comparison, not "first wins"."""
    return _reporter_sort_key(new) > _reporter_sort_key(old)


def _dedupe_reporters(reporters: list[dict]) -> tuple[list[dict], list[dict]]:
    """Finnhub's /calendar/earnings can list the SAME (sym, report_date)
    MORE THAN ONCE under DIFFERENT fiscal quarters — observed live:
        GLOO 2026-08-17 -> {"quarter":2,"year":2027,"epsEstimate":-0.187}
                        and {"quarter":2,"year":2026,"epsEstimate":null}
    `record_implied`'s identity is (sym, report_date) — see its docstring for
    why it can't be fiscal-keyed (SQLite doesn't dedupe NULLs in a composite
    PK, and a fiscal-keyed PK would break idempotency for every row written
    without a fiscal key). Left undeduped, whichever of these two rows
    happens to appear FIRST in Finnhub's array is the one `_has_snapshot`/
    `INSERT OR IGNORE` files the PERMANENT snapshot under — an artifact of
    provider array order, not anything meaningful. Once captured, that
    identity can never be corrected (the implied move at the time isn't
    reconstructible), and the wrong fiscal quarter either never pairs with
    its real history row (bar never draws) or pairs against the WRONG
    quarter's realized move (feeds a false number into the RICH/CHEAP chip).

    Resolves via `_reporter_preferred` — a genuinely fixed, total-order
    comparison (review round 2), so the result is the SAME regardless of the
    array's order, not just "usually the same".

    Returns (deduped_reporters, collisions) — `collisions` is one dict per
    resolved duplicate: `{"sym", "report_date", "distinct"}`, where `distinct`
    is False when the dropped row was content-identical to the survivor
    (harmless — either choice behaves the same) and True when it genuinely
    differed. Callers decide what's worth surfacing (see
    `run_nightly_capture`); `len(collisions)` is the raw total."""
    best: dict[tuple, dict] = {}
    collisions: list[dict] = []
    for rep in reporters:
        k = (rep.get("sym"), rep.get("report_date"))
        prev = best.get(k)
        if prev is None:
            best[k] = rep
            continue
        winner = rep if _reporter_preferred(rep, prev) else prev
        loser = prev if winner is rep else rep
        distinct = _reporter_sort_key(winner) != _reporter_sort_key(loser)
        collisions.append({"sym": rep.get("sym"), "report_date": rep.get("report_date"),
                            "distinct": distinct})
        best[k] = winner
    return list(best.values()), collisions


def run_nightly_capture(now: dt.datetime | None = None) -> dict:
    """Post-close T-1 capture: only reporters whose report_date falls within
    [today, today+WINDOW] (env IMPLIED_CAPTURE_WINDOW_DAYS, default 1) are even
    considered — rows outside the window are silently filtered (not counted).
    Within that window, a report_date == today with hour == "bmo" is skipped
    (counted): it already reported this morning, and a post-report capture
    would store IV-crushed values instead of the honest pre-report implied.
    Never stores a failure; existing (sym, report_date) rows are kept
    (first-write-wins — with the narrow window the first write IS the
    T-1/T-0-pre-report write).
    Deduped by (sym, report_date) BEFORE the window filter (review round 1,
    CRITICAL) — see `_dedupe_reporters` — so a duplicate-fiscal-quarter row
    from Finnhub can never let array order decide which identity a permanent
    snapshot files under; `summary["collisions"]` counts how many resolved,
    across the FULL 14-day reporter list (not just tonight's window).
    Exception isolation: one bad symbol never truncates the batch."""
    now = now or dt.datetime.now(_ET)
    today = now.date()
    window_days = int(os.environ.get("IMPLIED_CAPTURE_WINDOW_DAYS", "1"))
    window_end = today + dt.timedelta(days=window_days)

    reporters = upcoming_reporters(days=14, now=now)
    reporters, collisions = _dedupe_reporters(reporters)

    in_window = []
    for rep in reporters:
        try:
            rd = dt.date.fromisoformat(rep.get("report_date") or "")
        except ValueError:
            continue  # malformed date — silently filtered, never counted
        if today <= rd <= window_end:
            in_window.append(rep)

    # Review round 2, IMPORTANT #2 — the WARNING is scoped tighter than the
    # summary total: only a collision that (a) actually lands in TONIGHT'S
    # capture window and (b) genuinely differed (not a harmless byte-
    # identical repeat, `distinct=False`) is worth a human noticing. The raw
    # 14-day total fires most nights once real reporters accrue (observed
    # live: 3 collisions in the window, 2 of them harmless ties) — an alert
    # that's noise from night one is an alert nobody reads by day thirty.
    # `summary["collisions"]` still carries the unfiltered total below.
    in_window_keys = {(rep.get("sym"), rep.get("report_date")) for rep in in_window}
    noisy = [c for c in collisions
             if c["distinct"] and (c["sym"], c["report_date"]) in in_window_keys]
    if noisy:
        _log.warning(
            "[implied-store] resolved %d duplicate (sym, report_date) reporter "
            "row(s) from Finnhub inside tonight's capture window (rows "
            "genuinely differed, not a harmless repeat): %s",
            len(noisy), ", ".join(f"{c['sym']}/{c['report_date']}" for c in noisy),
        )

    summary = {"captured": 0, "skipped": 0, "failed": 0, "collisions": len(collisions)}
    captured_at = now.isoformat(timespec="seconds")
    today_iso = today.isoformat()
    for rep in in_window:
        sym = rep.get("sym")
        report_date = rep.get("report_date")
        hour = (rep.get("hour") or "").lower()
        try:
            if report_date == today_iso and hour == "bmo":
                summary["skipped"] += 1
                continue
            if _has_snapshot(sym, report_date):
                summary["skipped"] += 1
                continue
            payload = implied_move.get_expected_move(sym, report_date)
            if payload is None:
                summary["failed"] += 1
                continue
            record_implied(sym, report_date, payload, captured_at,
                            fiscal_year=rep.get("fiscal_year"),
                            fiscal_quarter=rep.get("fiscal_quarter"))
            summary["captured"] += 1
        except Exception:  # noqa: BLE001 — one bad symbol must never truncate the batch
            _log.warning("[implied-store] capture failed for %s", sym, exc_info=True)
            summary["failed"] += 1
    _log.info("[implied-store] nightly capture: %s", summary)
    return summary
