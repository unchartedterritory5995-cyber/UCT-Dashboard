"""F-S7-3 forward-only comparison for `catalyst-match` (CP2).

⛔ NO REPLAY, EVER. Both rules are evaluated on the SAME tick against the SAME
displayed rows, and only forward. The reason is this type's own and is the
strongest of the three the program has met: the candidate set is the output of a
PAID LLM synthesis pass behind a daily cost cap and a skip-if-stable hash, cut by
a quality gate that is tuned between runs. "Would this have fired on Tuesday"
re-runs today's gate over a stored row whose grade was written by a call that
will not be made again.

⛔ FOUR OUTCOMES, NEVER A PASS RATE.
  agreed          -- both rules alert the same member about the same ticker
  new_only        -- the dark rule alerts and the legacy one does not.
                     At the flip this member starts getting an alert they do not
                     get today.
  legacy_only     -- the legacy rule alerts and the dark one does not.
                     At the flip this member LOSES an alert they get today.
  not_comparable  -- the predicate changed identity, so the accumulated ticks
                     can no longer be attributed to the migration.

⛔ AND THE GRAIN IS PER TICKER, NOT PER TICK. One refresh fires once per matching
ticker and dedups per ticker, so a tick where the two rules alert on `{A,B}` and
`{A}` is ONE `agreed` and ONE `legacy_only` — not one "disagreement". Collapsing
it to a per-tick boolean would make an inbox that doubles look identical to one
that does not.

⛔ §2a ITEM 4 — A LIVENESS STAMP, NOT JUST A RESULT STORE. `observe` writes a
heartbeat on EVERY call, including the quiet ones that record no outcome. A
heartbeat that only beats on success is a success detector, and a dark run that
died on its first morning is otherwise indistinguishable at the end of the week
from one that ran every tick.
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import catalyst_match as _cm
from api.services.alert_taxonomy import db as _db

MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

HEARTBEAT_KEY = "catalyst_match_sweep_heartbeat"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalyst_match_comparison_spans (
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
CREATE INDEX IF NOT EXISTS idx_cm_spans_pred
    ON catalyst_match_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS catalyst_match_heartbeat (
    key         TEXT PRIMARY KEY,
    ticks       INTEGER NOT NULL DEFAULT 0,
    last_tick_at REAL,
    last_market_date TEXT
);
"""


def _conn(db_path: str | None = None) -> sqlite3.Connection:
    conn = _db.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def _merged_sessions(raw: str, day: str) -> str:
    """⭐ Sessions are counted by the TICK'S OWN market date, never
    `date.today()`. A harness stamping wall-clock days would report five sessions
    after five wall-clock days regardless of how many ticks actually happened —
    which is the same defect as a heartbeat that only beats on success."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def beat(market_date: str, *, now: Optional[float] = None,
         db_path: str | None = None) -> dict[str, Any]:
    """§2a item 4. Written on every tick, quiet ones included."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO catalyst_match_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "ticks = ticks + 1, last_tick_at = excluded.last_tick_at, "
            "last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, market_date))
        conn.commit()
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM catalyst_match_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM catalyst_match_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def legacy_would_fire(params: dict[str, Any], *,
                      displayed: Iterable[dict[str, Any]],
                      member_tickers: Iterable[str] = (),
                      is_admin: bool = False,
                      already_fired: Iterable[str] = ()) -> list[str]:
    """The LEGACY rule, restated read-only.

    ⛔ `_fire_catalyst_alerts` and `_fire_mustknow_alerts` are NOT called. Both
    MUTATE (`store.try_record_alert` writes `catalyst_alerts_fired`) and DELIVER
    (in-app + email + Discord). Running either to find out what it would do would
    tell a member about a dark comparison — the one outcome this checkpoint
    exists to prevent.

    ⭐ SO THIS IS A MIRROR, AND A MIRROR IS ONLY HONEST WITH A RAIL ON IT.
    `test_the_mirror_matches_the_real_legacy_functions` drives the REAL
    `_fire_catalyst_alerts` and `_fire_mustknow_alerts` with their delivery and
    their dedup store stubbed out, and asserts the ticker set this returns is the
    set they actually tried to fire on
    (`lesson_rail_the_mirror_not_just_the_lane`).

    Reduced, what the legacy path decides:
      rule A: is this displayed ticker on the user's watchlist, and has it not
              already been claimed for (user, ticker, market_date)?
      rule B: is this displayed row's normalised grade in the must-know set, is
              the user an admin, and not already claimed?
    """
    rule = params.get("match_rule")
    rows = list(displayed)
    fired = {str(t).upper() for t in already_fired}
    out: list[str] = []

    if rule == _cm.RULE_WATCHLIST:
        mine = {str(t).upper() for t in member_tickers}
        for r in rows:
            t = (r.get("ticker") or "").upper()
            if t and t in mine:
                out.append(t)
    elif rule == _cm.RULE_GRADE:
        if not is_admin:
            return []
        for r in rows:
            t = (r.get("ticker") or "").upper()
            # The real expression, verbatim in shape:
            #     (c.get("grade") or "").upper() in grades
            if t and (r.get("grade") or "").upper() in _cm.LEGACY_MUSTKNOW_GRADES:
                out.append(t)
    else:
        return []

    seen: set[str] = set()
    result: list[str] = []
    for t in out:
        if t in fired or t in seen:
            continue
        seen.add(t)
        result.append(t)
    return result


def open_span_if_absent(predicate_id: str, twin: dict, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM catalyst_match_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO catalyst_match_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM catalyst_match_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def note_params_change(predicate_id: str, new_twin: dict[str, Any], *,
                       now: Optional[float] = None,
                       db_path: str | None = None) -> dict[str, int]:
    """The predicate's firing identity changed — the clock RESETS.

    ⛔ The open span closes and its accumulated counts are **discarded into
    `not_comparable`**, not carried. What the two sides did under the OLD
    parameters cannot be attributed to the migration, and keeping those ticks as
    `agreed` would be the flattering error this whole design exists to avoid.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, params_version, agreed, new_only, legacy_only, not_comparable "
            "FROM catalyst_match_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["params_version"])
            conn.execute(
                "UPDATE catalyst_match_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                "WHERE id=?", (now, "params_change", discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO catalyst_match_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_params_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, params: dict[str, Any], market_date: str, *,
            displayed: Iterable[dict[str, Any]],
            member_tickers: Iterable[str] = (),
            is_admin: bool = False,
            already_fired: Iterable[str] = (),
            now: Optional[float] = None,
            db_path: str | None = None) -> dict[str, int]:
    """One forward tick. Both rules evaluated at the SAME instant on the SAME
    displayed rows, then the per-ticker outcomes recorded.

    ⛔ Neither side firing on a ticker is NOT an outcome — it is an ordinary
    quiet row. Counting quiet rows as `agreed` would drown every real
    disagreement and make the result a function of how many names the engine
    happened to display.

    Returns the per-tick tally, so a caller can see a tick that recorded nothing
    as a tick that recorded nothing.
    """
    now = time.time() if now is None else now
    rows = list(displayed)

    span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)
    twin = {}
    try:
        twin = json.loads(span["twin"]) or {}
    except (ValueError, TypeError):
        twin = {}
    if _cm.predicate_fingerprint(twin) != _cm.predicate_fingerprint(params):
        note_params_change(predicate_id, params, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    dark = set(_cm.would_fire(params, displayed=rows, member_tickers=member_tickers,
                              is_admin=is_admin, already_fired=already_fired))
    legacy = set(legacy_would_fire(params, displayed=rows, member_tickers=member_tickers,
                                   is_admin=is_admin, already_fired=already_fired))

    tally = {AGREED: len(dark & legacy),
             NEW_ONLY: len(dark - legacy),
             LEGACY_ONLY: len(legacy - dark)}

    # ⛔ THE HEARTBEAT IS WRITTEN BEFORE THE EARLY RETURN, not after the counts.
    # A quiet tick is exactly the tick a success-detector would miss.
    beat(market_date, now=now, db_path=db_path)

    conn = _conn(db_path)
    try:
        sets = ", ".join("%s = %s + ?" % (k, k) for k in (AGREED, NEW_ONLY, LEGACY_ONLY))
        conn.execute(
            "UPDATE catalyst_match_comparison_spans SET %s, sessions = ? WHERE id = ?" % sets,
            (tally[AGREED], tally[NEW_ONLY], tally[LEGACY_ONLY],
             _merged_sessions(span["sessions"], market_date), int(span["id"])))
        conn.commit()
    finally:
        conn.close()
    return tally


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The four counts, the sessions covered, the liveness stamp, and what this
    comparison CANNOT see.

    ⛔ `verdict_ready` is its own field, never baked into a pass/fail: *"not
    enough data yet"* and *"they disagree"* are different answers, and collapsing
    them is how a gate stops meaning anything.

    ⛔ `observed` LEADS. An empty comparison store prints four zeroes and reads
    exactly like perfect agreement — *a dark run that never ran and a dark run
    that found no disagreement are different facts.*
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM catalyst_match_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    sessions: set = set()
    rules: set = set()
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        rules.add((json.loads(r["twin"]) or {}).get("match_rule"))

    hb = heartbeat(db_path=db_path)
    observed = sum(totals.values())

    return {
        "predicate_id": predicate_id,
        **totals,
        "observed": observed,
        "status": "NO DATA" if not rows else ("QUIET" if observed == 0 else "OBSERVED"),
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "match_rules": sorted(r for r in rules if r),
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "heartbeat": hb,
        "blind_spots": BLIND_SPOTS,
    }


#: ⛔ §2a item 2's last clause — the report STATES WHAT IT CANNOT SEE, every
#: time, so nobody sizes the next checkpoint against a blind spot.
BLIND_SPOTS = (
    "CROSS-RULE SUPPRESSION IS ONLY VISIBLE IF `already_fired` IS SUPPLIED. The "
    "legacy watchlist rule and grade rule share one dedup key, so for an admin "
    "who watches a name the grade alert never fires. A harness tick that passes "
    "an empty `already_fired` will not see that and will read the suppressed "
    "alert as `new_only`.",

    "THE DISPLAYED SET IS AN INPUT, NOT AN OBSERVATION. This harness compares two "
    "rules over rows it is HANDED. It says nothing about whether the catalyst "
    "engine's quality gate displayed the right rows, and a change there moves "
    "both sides together and shows up as continued agreement.",

    "`catalyst_type` IS UNVALIDATED MODEL OUTPUT AND WAS NOT MEASURED AGAINST "
    "PRODUCTION. A read-only probe of /data/catalysts.db was refused by tooling "
    "policy this pass, so the real distribution of that column is unknown. A "
    "`catalyst_types` filter agreeing with itself proves nothing about whether "
    "the model stays inside the fifteen labels its prompt asks for.",

    "NO MEMBER ROW IS PROJECTED AT CP1-CP2. Every predicate here is "
    "HARNESS-ARMED, so these counts describe the RULE, not the population. A "
    "zero in any column is a fact about the fixtures until CP3 projects real "
    "cohort rows.",
)
