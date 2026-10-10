"""FT-034 SHADOW MODE for `rating-change`: a forward-only dark log, like the other
seven S7 types, so `tools/alert_type_readiness.py` can read it against ADR-0036.

⛔ THIS TYPE HAS NO LEGACY TWIN. No member alert reports analyst upgrades or
downgrades today, so there is no second rule to compare against. What a dark run
CAN measure is the one thing that would hurt a member at the flip: whether the
rule's own decisions stay TRUE against the feed the member is sent to read
(`analyst_grades._recent_actions`, the research page's Analyst Ratings tab). So
the four outcomes here are judged against the NEXT read of that feed:

  agreed          -- the dark rule would have fired on an action, and the next
                     read of the feed still carries it. The member would find it.
  new_only        -- the dark rule would have fired on an action that has VANISHED
                     from the feed by the next read (a retracted or rewritten row).
                     At the flip this member gets an alert they cannot find.
  legacy_only     -- a wanted action (an upgrade / downgrade dated on or after the
                     shadow's baseline) that the feed carries and the rule NEVER
                     covered: a back-dated insert below the watermark's date floor,
                     for one. At the flip this member misses it.
  not_comparable  -- the predicate's firing identity changed (its `actions` list),
                     so earlier ticks cannot be attributed.

⭐ THE RULE IS THE SHIPPED ONE, NEVER A MIRROR. `rating_change._new_actions`,
`_watermark` and `action_key` are called directly, so this log can only ever
describe what `_evaluate_one` would decide. Nothing here records a fire, delivers,
or touches a member predicate: the shadow keeps its OWN watermark per ticker.

⛔ THE POPULATION. One shadow predicate per distinct ticker on the S7 dark cohort's
watchlists (`rollout.S7_DARK`, the same cohort every other dark type projects),
capped at `RATING_CHANGE_SHADOW_MAX_TICKERS` (default 150) and fetched ONCE per
ticker per sweep (SPEC section 18 batching). A fetch that fails is
could-not-evaluate: no outcome is recorded for that ticker that tick.

DARK: `ALERT_TAXONOMY_RATING_CHANGE_DARK_ENABLED` (default off, read per call).
Off, `run_dark_sweep` returns at once and writes nothing; the scheduler job is
registered only while it is on.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import rating_change as _rc

FLAG = "ALERT_TAXONOMY_RATING_CHANGE_DARK_ENABLED"
MIN_SESSIONS_FOR_VERDICT = 5
DEFAULT_MAX_TICKERS = 150
PREFIX = "shadow:"

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

HEARTBEAT_KEY = "rating_change_sweep_heartbeat"
_ET = ZoneInfo("America/New_York")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS rating_change_comparison_spans (
    id              INTEGER PRIMARY KEY,
    predicate_id    TEXT NOT NULL,
    params_version  INTEGER NOT NULL DEFAULT 0,
    opened_at       REAL NOT NULL,
    closed_at       REAL,
    close_reason    TEXT,
    twin            TEXT NOT NULL DEFAULT '{}',
    sessions        TEXT NOT NULL DEFAULT '[]',
    agreed          INTEGER NOT NULL DEFAULT 0,
    new_only        INTEGER NOT NULL DEFAULT 0,
    legacy_only     INTEGER NOT NULL DEFAULT 0,
    not_comparable  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rc_spans_pred
    ON rating_change_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS rating_change_shadow_state (
    predicate_id    TEXT PRIMARY KEY,
    last_key        TEXT,
    last_date       TEXT,
    baseline_date   TEXT,
    pending         TEXT NOT NULL DEFAULT '[]',
    covered         TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS rating_change_heartbeat (
    key         TEXT PRIMARY KEY,
    ticks       INTEGER NOT NULL DEFAULT 0,
    last_tick_at REAL,
    last_market_date TEXT
);
"""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def max_tickers() -> int:
    try:
        return max(1, int(os.environ.get("RATING_CHANGE_SHADOW_MAX_TICKERS", DEFAULT_MAX_TICKERS)))
    except ValueError:
        return DEFAULT_MAX_TICKERS


def _conn(db_path: str | None = None) -> sqlite3.Connection:
    conn = _db.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def market_date(now: Optional[float] = None) -> str:
    """The tick's own ET date. Sessions are counted by this, never `date.today()`."""
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def predicate_id_for(ticker: str) -> str:
    return f"{PREFIX}{ticker.upper()}"


def _merged_sessions(raw: str, day: str) -> str:
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def beat(day: str, *, now: Optional[float] = None, db_path: str | None = None) -> None:
    """Written on every sweep, quiet ones included: a heartbeat that only beats on
    success is a success detector."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO rating_change_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET ticks = ticks + 1, "
            "last_tick_at = excluded.last_tick_at, last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, day))
        conn.commit()
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute("SELECT ticks, last_tick_at, last_market_date FROM rating_change_heartbeat "
                           "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def _open_span(conn, pid: str, twin: dict, now: float) -> dict:
    row = conn.execute("SELECT * FROM rating_change_comparison_spans WHERE predicate_id=? "
                       "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (pid,)).fetchone()
    if row is not None:
        if json.loads(row["twin"] or "{}") == twin:
            return dict(row)
        # The firing identity changed: what the old parameters saw cannot be
        # attributed, so it is DISCARDED into not_comparable, never carried as agreed.
        moved = int(row[AGREED]) + int(row[NEW_ONLY]) + int(row[LEGACY_ONLY])
        conn.execute("UPDATE rating_change_comparison_spans SET closed_at=?, close_reason=?, "
                     "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                     "WHERE id=?", (now, "params_change", moved, int(row["id"])))
        version = int(row["params_version"]) + 1
    else:
        version = 0
    conn.execute("INSERT INTO rating_change_comparison_spans (predicate_id, params_version, "
                 "opened_at, twin) VALUES (?,?,?,?)", (pid, version, now, json.dumps(twin)))
    return dict(conn.execute("SELECT * FROM rating_change_comparison_spans WHERE predicate_id=? "
                             "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (pid,)).fetchone())


def observe(ticker: str, items: list[dict], day: str, *, actions: Iterable[str] | None = None,
            now: Optional[float] = None, db_path: str | None = None) -> dict[str, int]:
    """One forward tick for one ticker, from one read of the feed (newest first)."""
    now = time.time() if now is None else now
    wanted = sorted(set(actions or _rc.DEFAULT_ACTIONS))
    pid = predicate_id_for(ticker)
    tally = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0}
    keys_now = {_rc.action_key(a) for a in items}
    conn = _conn(db_path)
    try:
        span = _open_span(conn, pid, {"ticker": ticker.upper(), "actions": wanted}, now)
        st = conn.execute("SELECT * FROM rating_change_shadow_state WHERE predicate_id=?",
                          (pid,)).fetchone()
        if st is None:
            # NO HISTORY REPLAY: the first read is the baseline, exactly as
            # `register_predicate_for_user` sets it. Nothing is scored.
            mark = _rc._watermark(items)
            base = mark["date"] or day
            conn.execute("INSERT INTO rating_change_shadow_state (predicate_id, last_key, last_date, "
                         "baseline_date, pending, covered) VALUES (?,?,?,?, '[]', ?)",
                         (pid, mark["key"], mark["date"] or day, base,
                          json.dumps(sorted(keys_now))))
        else:
            pending = json.loads(st["pending"] or "[]")
            covered = set(json.loads(st["covered"] or "[]"))
            # 1. Last tick's would-fire, judged against THIS read of the feed.
            for k in pending:
                tally[AGREED if k in keys_now else NEW_ONLY] += 1
            # 2. The shipped rule, on its own watermark (`_evaluate_one`'s logic).
            fresh = _rc._new_actions(items, st["last_key"], st["last_date"])
            new_pending: list[str] = []
            last_key, last_date = st["last_key"], st["last_date"]
            if items and fresh:
                mark = _rc._watermark(items)
                last_key, last_date = mark["key"], mark["date"]
                hits = [a for a in fresh if (a.get("action") or "") in wanted]
                if hits:
                    new_pending = [_rc.action_key(hits[0])]   # one fire per sweep, as live
                    covered |= {_rc.action_key(a) for a in hits}
            # 3. A wanted action the feed carries, on or after the baseline, that the
            #    rule never covered: a member would miss it.
            for a in items:
                k = _rc.action_key(a)
                if k in covered or (a.get("action") or "") not in wanted:
                    continue
                if str(a.get("date") or "")[:10] >= (st["baseline_date"] or ""):
                    tally[LEGACY_ONLY] += 1
                covered.add(k)
            covered &= keys_now | set(new_pending)
            conn.execute("UPDATE rating_change_shadow_state SET last_key=?, last_date=?, pending=?, "
                         "covered=? WHERE predicate_id=?",
                         (last_key, last_date, json.dumps(new_pending), json.dumps(sorted(covered)), pid))
        sets = ", ".join(f"{k} = {k} + ?" for k in (AGREED, NEW_ONLY, LEGACY_ONLY))
        conn.execute(f"UPDATE rating_change_comparison_spans SET {sets}, sessions = ? WHERE id = ?",
                     (tally[AGREED], tally[NEW_ONLY], tally[LEGACY_ONLY],
                      _merged_sessions(span["sessions"], day), int(span["id"])))
        conn.commit()
    finally:
        conn.close()
    return tally


def cohort_tickers() -> list[str]:
    """Distinct watchlist tickers of the S7 dark cohort, sorted, capped."""
    from api.services.alert_taxonomy import catalyst_match_projection as _cmp
    by_user = _cmp.member_tickers_for(_cmp.cohort_user_ids())
    names = sorted({t for s in by_user.values() for t in s})
    return names[:max_tickers()]


def run_dark_sweep(*, now: Optional[float] = None, db_path: str | None = None,
                   tickers: Optional[list[str]] = None,
                   fetch: Optional[Callable[[str], dict]] = None) -> dict[str, Any]:
    """One forward tick of the shadow log. Records spans and a heartbeat only:
    no fire, no delivery, no member predicate is read or written."""
    if not is_enabled():
        return {"enabled": False, "evaluated": 0, "could_not_evaluate": 0}
    at = time.time() if now is None else now
    day = market_date(at)
    fetch = fetch or _rc._default_fetch
    names = cohort_tickers() if tickers is None else list(tickers)
    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0}
    evaluated = failed = 0
    for t in names:
        try:
            res = fetch(t)
        except Exception as e:  # noqa: BLE001 - one bad ticker never aborts the sweep
            res = {"error": str(e)}
        if "error" in res:
            failed += 1
            continue
        tally = observe(t, res.get("items") or [], day, now=at, db_path=db_path)
        evaluated += 1
        for k in totals:
            totals[k] += tally[k]
    beat(day, now=at, db_path=db_path)
    return {"enabled": True, "market_date": day, "evaluated": evaluated,
            "could_not_evaluate": failed, **totals}


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The four counts, the sessions covered and the liveness stamp. `observed`
    leads: an empty log prints four zeroes and reads like perfect agreement."""
    conn = _conn(db_path)
    try:
        rows = conn.execute("SELECT * FROM rating_change_comparison_spans WHERE predicate_id=? "
                            "ORDER BY id", (predicate_id,)).fetchall()
    finally:
        conn.close()
    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    sessions: set = set()
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        sessions |= set(json.loads(r["sessions"] or "[]"))
    observed = totals[AGREED] + totals[NEW_ONLY] + totals[LEGACY_ONLY]
    return {
        "predicate_id": predicate_id,
        **totals,
        "observed": observed,
        "status": "NO DATA" if not rows else ("QUIET" if observed == 0 else "OBSERVED"),
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT and observed > 0,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "heartbeat": heartbeat(db_path=db_path),
        "blind_spots": BLIND_SPOTS,
    }


BLIND_SPOTS = (
    "NO LEGACY TWIN. `legacy_only` here is not 'the old alert fired and the new one "
    "did not'; it is a wanted action the feed carries that the rule never covered.",
    "ONE FEED. The partner read is the same provider feed the rule reads, one sweep "
    "later. A provider error that is consistent across reads is invisible here.",
    "PER TICKER, NOT PER MEMBER. Every cohort member watching a ticker would get the "
    "same decision under the default `actions`, so the grain is the ticker.",
)
