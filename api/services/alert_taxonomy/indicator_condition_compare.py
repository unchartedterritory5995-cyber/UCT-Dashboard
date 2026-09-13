"""F-S7-3 forward-only comparison for `indicator-condition` (CP2).

⛔⛔ NO REPLAY, EVER, and this type's reason is the strongest the programme has
met. The legacy lane's fire identity is `UNIQUE(alert_id, fire_key)` over an
**ARMED EPISODE** (`ep:<arm_epoch>` for a level condition, `bar:<t>` for a cross
one), and an episode is a LIVE STATE MACHINE, not a function of history.
Re-running today's evaluator over cached bars would manufacture episodes that
never existed and then measure them. Both sides are evaluated at the SAME
instant, on the SAME value, and only forward.

⛔ FOUR OUTCOMES, NEVER A PASS RATE.
  agreed          -- both rules fire, on the same `fire_key`.
  new_only        -- the dark rule fires and the legacy one does not.
                     At the flip this member starts getting an alert they do not
                     get today.
  legacy_only     -- the legacy rule fires and the dark one does not.
                     **At the flip this member LOSES an alert they get today.**
  not_comparable  -- the predicate's firing identity changed, or the evaluation
                     lane moved, so the accumulated ticks can no longer be
                     attributed to the migration.

⛔ AND FOUR OBSERVATIONS THAT ARE NOT OUTCOMES, kept beside them and never
folded in: `dark_refused`, `legacy_refused`, `no_value` and `quiet_both`. **A
refused predicate and a quiet predicate are different facts** — that is this
checkpoint's whole thesis, and an instrument that collapsed them would reproduce
the §2b defect inside the tool built to measure it.

⛔ `eval_mode()` MOVES WITH NO DEPLOY (`api/main.py:5032-5036`: *"Read the
running answer from `GET /api/indicator-alerts/latency`, never from this
comment"*). A comparison whose two sides straddle a mode change is measuring the
MODE. It is therefore read AT CALL TIME, stamped on every span, and a change
CLOSES the span and discards its counts into `not_comparable` — the anchor-move
reset, in this type's vocabulary.

⛔ §2a ITEM 4 — A LIVENESS STAMP, NOT JUST A RESULT STORE. `observe` writes a
heartbeat on EVERY call, including the quiet ones and the refused ones. A
heartbeat that only beats on success is a success detector, and a dark run that
died on its first morning is otherwise indistinguishable at the end of the week
from one that ran every tick.

⛔ NEITHER SIDE IS A MIRROR. `alert_conditions.check_condition`,
`alert_fired_log.fire_key` and `indicator_alert_service.refusal_for` are all
PURE and are all DRIVEN here — none of them delivers, and none of them writes.
A restated copy of any of them would make the comparison measure two
implementations rather than two rules
(`lesson_rail_the_mirror_not_just_the_lane`).
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Optional

from api.services import alert_fired_log as _fires
from api.services.alert_conditions import check_condition as _check_condition
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import indicator_condition as _ic

MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"
OUTCOME_COLUMNS = (AGREED, NEW_ONLY, LEGACY_ONLY, NOT_COMPARABLE)

#: Observations. ⛔ NOT outcomes, and never summed with them.
DARK_REFUSED = "dark_refused"
LEGACY_REFUSED = "legacy_refused"
NO_VALUE = "no_value"
QUIET_BOTH = "quiet_both"
OBSERVATION_COLUMNS = (DARK_REFUSED, LEGACY_REFUSED, NO_VALUE, QUIET_BOTH)

HEARTBEAT_KEY = "indicator_condition_sweep_heartbeat"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_condition_comparison_spans (
    id              INTEGER PRIMARY KEY,
    predicate_id    TEXT NOT NULL,
    params_version  INTEGER NOT NULL DEFAULT 0,
    opened_at       REAL NOT NULL,
    closed_at       REAL,
    close_reason    TEXT,
    twin            TEXT NOT NULL DEFAULT '{}',
    eval_mode       TEXT,
    sessions        TEXT NOT NULL DEFAULT '[]',
    ticks           INTEGER NOT NULL DEFAULT 0,
    agreed          INTEGER NOT NULL DEFAULT 0,
    new_only        INTEGER NOT NULL DEFAULT 0,
    legacy_only     INTEGER NOT NULL DEFAULT 0,
    not_comparable  INTEGER NOT NULL DEFAULT 0,
    dark_refused    INTEGER NOT NULL DEFAULT 0,
    legacy_refused  INTEGER NOT NULL DEFAULT 0,
    no_value        INTEGER NOT NULL DEFAULT 0,
    quiet_both      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ic_spans_pred
    ON indicator_condition_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS indicator_condition_heartbeat (
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


def legacy_eval_mode() -> Optional[str]:
    """The lane the legacy evaluator is running, READ AT CALL TIME.

    ⛔ NEVER BOUND TO A MODULE CONSTANT. `eval_mode()` reads the environment on
    every call precisely so the lane can be rolled back with no deploy; a
    module-level capture would make every span after the first stamp a lane that
    is no longer running, and the harness would then be reporting agreement
    across a mode change it could not see.

    ⛔ The import is deliberately lazy: `indicator_alert_evaluator` is a
    2,630-line INERT STRAND and the TYPE module must not carry it. Returns
    `None` — never a guessed default — if it cannot be reached, and an unknown
    lane is treated as an anchor change like any other.
    """
    try:
        from api.services import indicator_alert_evaluator as _ev
        return _ev.eval_mode()
    except Exception:                                        # noqa: BLE001
        return None


def _merged_sessions(raw: str, day: str) -> str:
    """⭐ Sessions are counted by the TICK'S OWN market date, never
    `date.today()`. A harness stamping wall-clock days would report five sessions
    after five wall-clock days regardless of how many ticks actually happened —
    the same defect as a heartbeat that only beats on success."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def beat(market_date: str, *, now: Optional[float] = None,
         db_path: str | None = None) -> dict[str, Any]:
    """§2a item 4. Written on every tick — quiet, refused and no-value included."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO indicator_condition_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "ticks = ticks + 1, last_tick_at = excluded.last_tick_at, "
            "last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, market_date))
        conn.commit()
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM indicator_condition_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM indicator_condition_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def legacy_would_fire(params: dict[str, Any], *,
                      value: Optional[float],
                      prev_value: Optional[float] = None,
                      bar_time: Any = None,
                      arm_epoch: int = 0) -> dict[str, Any]:
    """The LEGACY rule, driven rather than mirrored.

    ⛔ NEITHER `_evaluate_one` NOR `_evaluate_one_closed` IS CALLED. Both fetch
    bars, WRITE (`record_evaluation`, `record_fire`) and can DELIVER — bell,
    email, Discord, browser notification and sound, through
    `watchlist_alert_service.deliver_alert_payload`. Running either to find out
    what it would do would tell a member about a dark comparison — the one
    outcome this checkpoint exists to prevent.

    ⭐ WHAT IS CALLED IS THE REAL DECIDING CODE, WHICH IS PURE:
      * `indicator_alert_service.refusal_for` — the registration gate, and the
        precedent this type's own gate was built on;
      * `alert_conditions.check_condition` — the SOLE decider of `triggered` in
        both lanes;
      * `alert_fired_log.fire_key` — the identity `UNIQUE(alert_id, fire_key)`
        dedups on.
    So there is nothing here to drift from the lane it models.

    ⚠️ IT IS NOT THE WHOLE LEGACY REGISTRATION GATE, and the harness says so in
    `BLIND_SPOTS`: the router refuses a price ALIAS (redirecting it to the
    watchlist-alert lane) and an address with no value function BEFORE it calls
    `refusal_for`, and neither of those is modelled here.
    """
    from api.services import indicator_alert_service as _svc

    condition = str(params.get("condition") or "")
    refusal = _svc.refusal_for(params.get("indicator"), condition,
                               params.get("tf"), params.get("threshold"))
    if refusal is not None:
        return {"outcome": _ic.OUTCOME_REFUSED, "refusal": refusal,
                "triggered": None, "fire_key": None}
    if value is None:
        return {"outcome": _ic.OUTCOME_NO_VALUE, "refusal": None,
                "triggered": None, "fire_key": None}
    triggered = bool(_check_condition(condition, value, prev_value,
                                      params.get("threshold")))
    if not triggered:
        return {"outcome": _ic.OUTCOME_QUIET, "refusal": None,
                "triggered": False, "fire_key": None}
    return {"outcome": _ic.OUTCOME_FIRED, "refusal": None, "triggered": True,
            "fire_key": _fires.fire_key(condition, bar_time, arm_epoch)}


def span_anchor(params: dict[str, Any], mode: Optional[str]) -> tuple:
    """What must hold still for a span's counts to mean anything.

    The predicate's firing identity AND the evaluation lane. §1b: a dark
    comparison whose two sides straddle a mode change is measuring the mode.
    """
    return (_ic.predicate_fingerprint(params), mode)


def open_span_if_absent(predicate_id: str, twin: dict, mode: Optional[str], *,
                        now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM indicator_condition_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO indicator_condition_comparison_spans "
            "(predicate_id, params_version, opened_at, twin, eval_mode) VALUES (?,?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin), mode))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM indicator_condition_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def note_anchor_change(predicate_id: str, new_twin: dict[str, Any],
                       new_mode: Optional[str], reason: str, *,
                       now: Optional[float] = None,
                       db_path: str | None = None) -> dict[str, int]:
    """The predicate's identity or the evaluation lane moved — the clock RESETS.

    ⛔ The open span closes and its accumulated OUTCOME counts are **discarded
    into `not_comparable`**, not carried. What the two sides did under the old
    parameters, or in the other lane, cannot be attributed to the migration, and
    keeping those ticks as `agreed` would be the flattering error this whole
    design exists to avoid.

    ⚠️ The OBSERVATION counters are discarded with them rather than being rolled
    into `not_comparable`: `not_comparable` counts comparisons that can no longer
    be attributed, and a tick on which neither side fired was never a comparison.
    Inflating it with quiet ticks would make the column mean two things.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, params_version, agreed, new_only, legacy_only, not_comparable "
            "FROM indicator_condition_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row[AGREED]) + int(row[NEW_ONLY]) + int(row[LEGACY_ONLY])
            version = int(row["params_version"])
            conn.execute(
                "UPDATE indicator_condition_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                "WHERE id=?", (now, reason, discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO indicator_condition_comparison_spans "
            "(predicate_id, params_version, opened_at, twin, eval_mode) VALUES (?,?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin), new_mode))
        conn.commit()
        return {"discarded_to_not_comparable": discarded,
                "new_params_version": version + 1, "close_reason": reason}
    finally:
        conn.close()


def classify(dark: dict[str, Any], legacy: dict[str, Any]) -> tuple[Optional[str], list[str]]:
    """One tick -> (outcome or None, observations).

    ⛔ NEITHER SIDE FIRING IS NOT AN OUTCOME. Counting quiet ticks as `agreed`
    would drown every real disagreement and make the result a function of how
    often the harness happened to run.

    ⛔ AND TWO FIRES WITH DIFFERENT `fire_key`s ARE NOT AGREEMENT. The fire key
    IS the identity the legacy lane dedups on; two sides that fire on different
    keys are two key functions, not two rules, and the tick is `not_comparable`.
    (Both sides drive the same real `alert_fired_log.fire_key`, so this branch
    should be unreachable — `test_both_sides_derive_the_fire_key_from_the_SAME_
    real_function` is what keeps it that way, and the branch is here so that if
    it ever becomes reachable the harness says so instead of reporting
    agreement.)
    """
    observations: list[str] = []
    if dark.get("outcome") == _ic.OUTCOME_REFUSED:
        observations.append(DARK_REFUSED)
    if legacy.get("outcome") == _ic.OUTCOME_REFUSED:
        observations.append(LEGACY_REFUSED)
    if _ic.OUTCOME_NO_VALUE in (dark.get("outcome"), legacy.get("outcome")):
        observations.append(NO_VALUE)

    dark_fired = dark.get("outcome") == _ic.OUTCOME_FIRED
    legacy_fired = legacy.get("outcome") == _ic.OUTCOME_FIRED

    if dark_fired and legacy_fired:
        if dark.get("fire_key") != legacy.get("fire_key"):
            return NOT_COMPARABLE, observations
        return AGREED, observations
    if dark_fired:
        return NEW_ONLY, observations
    if legacy_fired:
        return LEGACY_ONLY, observations

    if not observations:
        observations.append(QUIET_BOTH)
    return None, observations


def note_not_comparable(predicate_id: str, params: dict[str, Any], reason: str,
                        market_date: str, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict[str, Any]:
    """Record a tick that could NOT be compared — the vocabularies do not meet.

    ⛔⛔ THIS IS A FIRST-CLASS OUTCOME, NOT A SKIP. F-S7-IC-1 measured 31 legacy
    addresses against 142 book metrics with an EMPTY intersection: one rename
    (`close` -> `ohlcv.c`) and thirty genuine absences. For those thirty the two
    lanes never met, so a comparison is UNDEFINED — and the dangerous failure is
    not silence, it is `LEGACY_ONLY`. Letting such a predicate reach `classify()`
    would score it as a disagreement every time the legacy side fired, which
    reads as *"the new lane is missing fires"*. It is not missing them; it was
    never asked a question it could answer.

    ⭐ AND IT STILL BEATS. A tick that could not be compared is a tick that
    HAPPENED, and the liveness signal must not depend on comparability — or the
    heartbeat would stop dead on the thirty and look exactly like a dead sweep.
    """
    now = time.time() if now is None else now
    mode = legacy_eval_mode()
    span = open_span_if_absent(predicate_id, params, mode, now=now, db_path=db_path)
    beat(market_date, now=now, db_path=db_path)
    conn = _conn(db_path)
    try:
        conn.execute(
            "UPDATE indicator_condition_comparison_spans "
            "SET ticks = ticks + 1, not_comparable = not_comparable + 1, sessions = ? "
            "WHERE id = ?",
            (_merged_sessions(span["sessions"], market_date), int(span["id"])))
        conn.commit()
    finally:
        conn.close()
    return {"outcome": NOT_COMPARABLE, "reason": reason, "eval_mode": mode}


def observe(predicate_id: str, params: dict[str, Any], market_date: str, *,
            entity_ref: str,
            value: Optional[float],
            prev_value: Optional[float] = None,
            bar_time: Any = None,
            arm_epoch: int = 0,
            now: Optional[float] = None,
            db_path: str | None = None) -> dict[str, Any]:
    """One forward tick. Both rules evaluated at the SAME instant, on the SAME
    value, then the outcome and the observations recorded.

    Returns what this tick recorded, so a caller can see a tick that recorded
    nothing as a tick that recorded nothing.
    """
    now = time.time() if now is None else now
    mode = legacy_eval_mode()

    span = open_span_if_absent(predicate_id, params, mode, now=now, db_path=db_path)
    try:
        twin = json.loads(span["twin"]) or {}
    except (ValueError, TypeError):
        twin = {}
    if span_anchor(twin, span["eval_mode"]) != span_anchor(params, mode):
        reason = ("eval_mode_change"
                  if _ic.predicate_fingerprint(twin) == _ic.predicate_fingerprint(params)
                  else "params_change")
        note_anchor_change(predicate_id, params, mode, reason, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, mode, now=now, db_path=db_path)

    dark = _ic.would_fire(params, entity_ref=entity_ref, value=value,
                          prev_value=prev_value, bar_time=bar_time,
                          arm_epoch=arm_epoch)
    legacy = legacy_would_fire(params, value=value, prev_value=prev_value,
                               bar_time=bar_time, arm_epoch=arm_epoch)
    outcome, observations = classify(dark, legacy)

    # ⛔ THE HEARTBEAT IS WRITTEN BEFORE THE COUNTS, not after them. A quiet tick
    # and a refused tick are exactly the ticks a success detector would miss.
    beat(market_date, now=now, db_path=db_path)

    bumps = ["ticks"] + list(observations) + ([outcome] if outcome else [])
    conn = _conn(db_path)
    try:
        sets = ", ".join("%s = %s + 1" % (c, c) for c in bumps)
        conn.execute(
            "UPDATE indicator_condition_comparison_spans SET %s, sessions = ? WHERE id = ?" % sets,
            (_merged_sessions(span["sessions"], market_date), int(span["id"])))
        conn.commit()
    finally:
        conn.close()

    return {"outcome": outcome, "observations": observations,
            "dark": dark, "legacy": legacy, "eval_mode": mode}


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """What this comparison OBSERVED — and it leads with that, not with a score.

    ⛔ `observed`, `ticks` and `status` COME FIRST. An empty comparison store
    prints four zeroes and reads exactly like perfect agreement: *a dark run that
    never ran and a dark run that found no disagreement are different facts.*
    `NO DATA` (no span exists), `NO TICKS` (a span exists and nothing drove it),
    `QUIET` (ticks happened and neither side ever fired) and `OBSERVED` are four
    answers, not one.

    ⛔ THERE IS NO PASS RATE AND THERE WILL NOT BE ONE. `legacy_only` is not
    "n% failure" — it is a count of occasions on which a member would LOSE an
    alert they get today, and dividing it by anything is how that stops being
    legible. `verdict_ready` is its own field for the same reason: *"not enough
    data yet"* and *"they disagree"* are different answers.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM indicator_condition_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    outcomes = {k: 0 for k in OUTCOME_COLUMNS}
    observations = {k: 0 for k in OBSERVATION_COLUMNS}
    ticks = 0
    sessions: set = set()
    modes: set = set()
    for r in rows:
        for k in outcomes:
            outcomes[k] += int(r[k])
        for k in observations:
            observations[k] += int(r[k])
        ticks += int(r["ticks"])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        modes.add(r["eval_mode"])

    observed = sum(outcomes.values())
    if not rows:
        status = "NO DATA"
    elif ticks == 0:
        status = "NO TICKS"
    elif observed == 0:
        status = "QUIET"
    else:
        status = "OBSERVED"

    return {
        # ── what was observed, first ──
        "status": status,
        "observed": observed,
        "ticks": ticks,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "heartbeat": heartbeat(db_path=db_path),
        # ── the four outcomes ──
        **outcomes,
        # ── the observations that are NOT outcomes ──
        "observations": observations,
        # ── context ──
        "predicate_id": predicate_id,
        "eval_modes_seen": sorted(m for m in modes if m),
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "legacy_only_means": ("an alert a member GETS TODAY and would LOSE at "
                              "the flip — never a percentage"),
        "blind_spots": BLIND_SPOTS,
    }


#: ⛔ §2a item 2's last clause — the report STATES WHAT IT CANNOT SEE, every
#: time, so nobody sizes the next checkpoint against a blind spot.
BLIND_SPOTS = (
    "⛔⛔ THE LEGACY ALERT LANE AND D2's ADDRESS BOOK SHARE ZERO METRIC NAMES, "
    "MEASURED. `indicator_alert_evaluator.all_addresses()` declares 31 "
    "(`close`, `rsi`, `macd.histogram`, `ichimoku.chikou`, …); the book declares "
    "142 (137 nightly `screener_rows` scalars and `ohlcv.o/h/l/c/v`). The "
    "intersection is EMPTY. So at CP1 the cadence gate refuses every predicate "
    "the legacy lane can express, and for all 31 the reason is "
    "ADDRESS_UNRESOLVED rather than an undeclared cadence. `close` and `ohlcv.c` "
    "are the same quantity under two names and NOTHING joins them. Supplying "
    "that join here would be a second authority over metric identity — the exact "
    "thing the plan's §2b ruling killed — so it is REPORTED, not built.",

    "THE `legacy_only` COLUMN IS THEREFORE THE HEADLINE, NOT A FOOTNOTE. Every "
    "tick on which a real legacy predicate fires is a `legacy_only` today, "
    "because the dark side refuses it at registration. That is a true statement "
    "about the flip as it stands, and it is what this harness exists to make "
    "visible before anybody flips anything.",

    "⚠️ `new_only` IS STRUCTURALLY UNREACHABLE END-TO-END TODAY, AND THAT IS A "
    "MEASUREMENT, NOT A DESIGN. For the dark side to fire the metric must be in "
    "the book; for the legacy side to refuse, `refusal_for` must hit one of its "
    "three gates — and two of those (`instant_only_addresses`, "
    "`closed_lane_dead_addresses`) are subsets of the LEGACY vocabulary, which "
    "the book does not intersect, while the third (an unjudgeable condition, or "
    "a level rule with no threshold) also makes `check_condition` answer False "
    "for the dark side. So a zero in that column proves nothing yet. "
    "`test_new_only_is_reachable_in_the_classifier_and_unreachable_end_to_end` "
    "measures both halves so the day it becomes reachable is visible.",

    "NO MEMBER ROW IS READ AT CP1-CP2. `indicator_alerts` is never opened; every "
    "predicate here is HARNESS-ARMED, so these counts describe the RULE, not the "
    "population. A zero in any column is a fact about the fixtures.",

    "THE VALUE IS AN INPUT, NOT AN OBSERVATION. Both sides are handed `value` "
    "and `prev_value`. This says nothing about whether the indicator compute "
    "produced the right number, and a change there moves both sides together and "
    "shows up as continued agreement.",

    "THE ARMED EPISODE IS SUPPLIED, NEVER RECONSTRUCTED. `arm_epoch` and "
    "`bar_time` come from the caller. The harness cannot see an episode boundary "
    "the caller did not tell it about, which is also the reason there is no "
    "replay.",

    "THE ROUTER'S OWN EARLIER REFUSALS ARE NOT MODELLED. `refusal_for`'s "
    "docstring records that the router redirects the price ALIASES to the "
    "watchlist-alert lane and refuses an address with no value function BEFORE "
    "calling it. This harness drives `refusal_for` only, so a predicate the "
    "router would have turned away can still reach the legacy side here.",

    "A GAP IN TICKS IS INVISIBLE EXCEPT THROUGH THE HEARTBEAT. `eval_mode()` can "
    "move between two ticks the harness did not run; the span stamp catches a "
    "change it OBSERVES, not one it slept through. Read `heartbeat.ticks` beside "
    "`sessions_covered` before believing any span.",

    "PRODUCTION POPULATION UNKNOWN. `indicator_alert_service`'s own comments say "
    "both 'prod's indicator_alerts table has zero rows' and 'the 31 production "
    "soak rows'. Those cannot both be current and NO DATABASE WAS READ this "
    "pass, so how much a `legacy_only` costs in members is not a number this "
    "harness can produce.",
)
