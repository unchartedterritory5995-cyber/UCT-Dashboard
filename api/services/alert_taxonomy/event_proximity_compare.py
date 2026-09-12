"""GATE-S7-EVENT-PROXIMITY CP2 — the FORWARD-ONLY comparison harness.

⛔ Approved CP1–CP2 only. Harness-armed predicates; **no projection of member
rows** (that is CP3), no delivery, no legacy change.

──────────────────────────────────────────────────────────────────────────────
⛔ FORWARD-ONLY, AND WHY IT IS STRICTER HERE THAN FOR price-level
──────────────────────────────────────────────────────────────────────────────

F-S7-3 forbids replay. For `price-level` the reason was that a moved trendline's
history is unrecoverable. Here it is worse: **the event date itself moves.** A
company reschedules, a provider corrects a date, and the legacy row keeps no
record of what the date was when the alert armed. Replaying *"would this have
fired on Tuesday"* against today's calendar answers a question about **today's**
data wearing Tuesday's label.

So both sides are evaluated live on the same tick from the moment the predicate
arms, and **a change to the event identity resets the clock** — the pre-change
span's counts are discarded into `not_comparable`, never kept as agreement.

──────────────────────────────────────────────────────────────────────────────
⛔ FOUR OUTCOMES, NEVER A PASS RATE
──────────────────────────────────────────────────────────────────────────────

`agreed` · `new_only` · `legacy_only` · `not_comparable`. ⛔ Do not collapse
them: `legacy_only` is an alert somebody LOSES at the flip, `new_only` is one
they start getting TWICE, and `not_comparable` is span time this harness
deliberately refuses to score. Different defects, different members.

⚠️ **`not_comparable` is load-bearing, not bookkeeping.** Folding a rescheduled
earnings date into the denominator would make *the company moving its call* look
like agreement.

──────────────────────────────────────────────────────────────────────────────
⭐ ONE DIVERGENCE IS ALREADY VISIBLE FROM THE SOURCE, and the dark run exists to
size it
──────────────────────────────────────────────────────────────────────────────

The legacy path is **dedup-once per (user, ticker, market_date)** — `try_record_alert`
INSERTs and returns False on the second attempt. It has **no notion of a lead
day**: whichever slot runs first for a given `market_date` wins, and the other
slot is silently deduped away. The dark rule keys its own `fire_key` on
`(entity_ref, event_date, lead_days)`, so a member watching a name that is
BOTH "tomorrow's reporter" at 18:00 and "today's reporter" at 07:00 the next
morning gets ONE legacy alert and could get TWO dark ones.

⚠️ **Neither is a harness bug.** Which way it should settle is a product call,
and the flip is a separate approval line so it can be made on evidence.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import date as _date
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import event_proximity as _ep

MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS event_proximity_comparison_spans (
    id              INTEGER PRIMARY KEY,
    predicate_id    TEXT NOT NULL,
    event_version   INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_ep_spans_pred
    ON event_proximity_comparison_spans(predicate_id);
"""


def _conn(db_path: str | None = None) -> sqlite3.Connection:
    conn = _db.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def _merged_sessions(raw: str, day: str) -> str:
    """⭐ Sessions are counted by CALENDAR DAY, and the day is the tick's own —
    never `date.today()`. A harness that stamped wall-clock days would report
    five sessions after five wall-clock days regardless of how many ticks
    actually happened."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def legacy_would_fire(params: dict[str, Any], today: _date) -> bool:
    """The LEGACY rule, restated read-only.

    ⛔ `calendar_alerts.run_prereport_alerts` is NOT called: it MUTATES (its
    dedup table) and DELIVERS (in-app + email + Discord). Running it to find out
    what it would do would tell a member about a dark comparison — the one
    outcome this checkpoint exists to prevent.

    ⭐ So this is a MIRROR, and a mirror is only honest with a rail on it:
    `test_legacy_would_fire_matches_the_real_reporter_set` drives the real
    module's own membership test against the same inputs
    (`lesson_rail_the_mirror_not_just_the_lane`).

    What the legacy path actually decides, reduced: *is this entity in the set of
    reporters for the market_date this slot is asking about?* With the two slots
    expressing lead 0 and lead 1, that is exactly "the event date is `lead_days`
    days from today".
    """
    if params.get("event_kind") != _ep.EARNINGS:
        return False
    lead = params.get("lead_days")
    if lead is None or int(lead) not in _ep.LEGACY_LEAD_DAYS:
        return False
    d = _ep.days_until(params, today)
    return d is not None and d == int(lead)


def open_span_if_absent(predicate_id: str, twin: dict, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM event_proximity_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO event_proximity_comparison_spans "
            "(predicate_id, event_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM event_proximity_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def note_event_change(predicate_id: str, new_twin: dict[str, Any], *,
                      now: Optional[float] = None,
                      db_path: str | None = None) -> dict[str, int]:
    """The event identity changed — the clock RESETS.

    ⛔ The open span closes and its accumulated counts are **discarded into
    `not_comparable`**, not carried. The company moved its call; what the two
    sides did against the OLD date can no longer be attributed to the migration,
    and keeping those ticks as "agreed" would be the flattering error this whole
    design exists to avoid.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, event_version, agreed, new_only, legacy_only, not_comparable "
            "FROM event_proximity_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["event_version"])
            conn.execute(
                "UPDATE event_proximity_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                "WHERE id=?", (now, "event_change", discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO event_proximity_comparison_spans "
            "(predicate_id, event_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_event_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, params: dict[str, Any], today: _date, *,
            now: Optional[float] = None,
            db_path: str | None = None) -> Optional[str]:
    """One forward tick. Both rules evaluated at the SAME instant on the SAME
    inputs, then one of the four outcomes recorded.

    ⛔ Neither side firing is NOT an outcome — it is an ordinary quiet tick.
    Counting quiet ticks as `agreed` would drown every real disagreement and make
    the result a function of how often we sample.
    """
    now = time.time() if now is None else now
    span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    if _ep.event_fingerprint(json.loads(span["twin"]) or {}) != _ep.event_fingerprint(params):
        note_event_change(predicate_id, params, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    dark = _ep.would_fire(params, today)
    legacy = legacy_would_fire(params, today)
    if not dark and not legacy:
        conn = _conn(db_path)
        try:
            conn.execute(
                "UPDATE event_proximity_comparison_spans SET sessions=? WHERE id=?",
                (_merged_sessions(span["sessions"], today.isoformat()), int(span["id"])))
            conn.commit()
        finally:
            conn.close()
        return None

    outcome = AGREED if (dark and legacy) else (NEW_ONLY if dark else LEGACY_ONLY)
    conn = _conn(db_path)
    try:
        conn.execute(
            "UPDATE event_proximity_comparison_spans SET %s=%s+1, sessions=? WHERE id=?"
            % (outcome, outcome),
            (_merged_sessions(span["sessions"], today.isoformat()), int(span["id"])))
        conn.commit()
    finally:
        conn.close()
    return outcome


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The four counts, the sessions covered, and whether a verdict may be shown.

    ⛔ `verdict_ready` is its own field, never baked into a pass/fail: *"not
    enough data yet"* and *"they disagree"* are different answers and collapsing
    them is how a gate stops meaning anything.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM event_proximity_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    sessions: set = set()
    kinds: set = set()
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        kinds.add((json.loads(r["twin"]) or {}).get("event_kind"))

    return {
        "predicate_id": predicate_id,
        **totals,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "event_kinds": sorted(k for k in kinds if k),
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
    }
