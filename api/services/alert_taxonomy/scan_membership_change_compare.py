"""F-S7-3 forward-only comparison for `scan-membership-change` (CP2).

⛔ NO REPLAY, EVER (F-S7-3). Both rules are evaluated on the SAME tick against
the SAME handed-in sessions, and only forward. The reason is this type's own and
is the fifth the programme has met: **a past session's hit set is retained only
until somebody wires a prune nobody has written yet, and `coverage(...) is None`
means "the sweep never ran" — which after a prune is FALSE.** A replay over the
surviving window would silently answer a different question from the one asked.

⛔ FOUR OUTCOMES, NEVER A PASS RATE, AND THE GRAIN IS **ONE ALERT**.
  agreed          -- both rules would send this member this definition's alert
                     for this session.
  new_only        -- the dark rule alerts and the legacy one does not.
                     At the flip this member starts getting an alert they do not
                     get today.
  legacy_only     -- the legacy rule alerts and the dark one does not.
                     At the flip this member LOSES an alert they get today.
  not_comparable  -- the diff could not be taken at all (fewer than two covered
                     sessions, or a session declared swept but absent from the
                     hit map), or the predicate changed identity so the
                     accumulated ticks can no longer be attributed to the
                     migration.

⛔⛔ THE GRAIN IS THE ALERT AND NOT THE SYMBOL, **and that is forced by the
legacy dedup key**. `screen_alerts_fired`'s PK is `(user_id, def_hash, as_of)`,
so one session produces at most ONE message however many names moved — a
per-symbol grain would count a five-name night as five alerts and make
`legacy_only` stop meaning "an alert a member loses".

⭐ BUT AN ALERT THAT FIRES ON BOTH SIDES CAN STILL CARRY DIFFERENT NAMES, and
the four outcomes are structurally unable to see that. So symbol drift is
counted SEPARATELY and is never mixed into them: `drift_new_only` and
`drift_legacy_only` are movements (`entered:NVDA`, `left:AMD`) present on only
one side of an alert both rules agree to send. A drift is a wrong MESSAGE, not a
lost alert; folding it into `legacy_only` would overstate the loss, and dropping
it would hide a member being told about the wrong stock.

⛔ NO DATA vs QUIET vs NOT COMPARABLE — three facts, and `report()` LEADS with
which one it is. An empty comparison store prints four zeroes and reads exactly
like perfect agreement, and for THIS type that matters most: the sweep is
nightly, so a quiet market and a broken sweep produce the identical observation
from outside unless the harness says which it saw.

⛔ §2a ITEM 4 — A LIVENESS STAMP, NOT JUST A RESULT STORE. `observe` writes a
heartbeat on EVERY call, including the `no_previous` ones. A heartbeat that only
beats on success is a success detector — and this type's clock ticks ONCE A
NIGHT, so five trading sessions is five comparisons per subscribed definition,
not five hundred. `report()` says so rather than letting a small `n` read as
agreement.
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Iterable, Mapping, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import scan_membership_change as _smc

#: ⚠️ THIS TYPE'S CLOCK TICKS ONCE A NIGHT. Five sessions is five comparisons
#: per subscribed definition, not five hundred, and the report says so.
MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

DRIFT_NEW_ONLY = "drift_new_only"
DRIFT_LEGACY_ONLY = "drift_legacy_only"

HEARTBEAT_KEY = "scan_membership_change_sweep_heartbeat"

#: ⛔ THE GRAINS, DECLARED ONCE AND CARRIED IN EVERY REPORT. They are constants
#: rather than inline literals for two reasons: a report that has to explain its
#: own grain every time will eventually explain it differently in two places, and
#: a prose-stripping source search must be able to blank them by name (the
#: `catalyst-match` lesson — a schema that DESCRIBES the table it must not touch
#: is documentation, and a substring search over it answers a question about the
#: documentation).
OUTCOME_GRAIN = ("one alert per member per definition per session — the PRIMARY "
                 "KEY of the legacy dedup table screen_alerts_fired")
DRIFT_GRAIN = ("one named movement (entered:SYM / left:SYM) inside an alert BOTH "
               "rules would send — a wrong message, never a lost alert, and "
               "never folded into the four outcomes")
CLOCK = ("NIGHTLY — one comparison per subscribed definition per trading "
         "session. Five sessions is five comparisons, not five hundred.")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scan_membership_comparison_spans (
    id                INTEGER PRIMARY KEY,
    predicate_id      TEXT NOT NULL,
    params_version    INTEGER NOT NULL DEFAULT 0,
    opened_at         REAL NOT NULL,
    closed_at         REAL,
    close_reason      TEXT,
    twin              TEXT NOT NULL DEFAULT '{}',
    sessions          TEXT NOT NULL DEFAULT '[]',
    reasons           TEXT NOT NULL DEFAULT '{}',
    agreed            INTEGER NOT NULL DEFAULT 0,
    new_only          INTEGER NOT NULL DEFAULT 0,
    legacy_only       INTEGER NOT NULL DEFAULT 0,
    not_comparable    INTEGER NOT NULL DEFAULT 0,
    drift_new_only    INTEGER NOT NULL DEFAULT 0,
    drift_legacy_only INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_smc_spans_pred
    ON scan_membership_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS scan_membership_heartbeat (
    key              TEXT PRIMARY KEY,
    ticks            INTEGER NOT NULL DEFAULT 0,
    last_tick_at     REAL,
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
    the same defect as a heartbeat that only beats on success."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def _merged_reasons(raw: str, reason: Optional[str]) -> str:
    """A histogram of WHY each tick answered as it did.

    ⛔ Without it, `no_previous` and `quiet` both contribute zero to the four
    outcomes and become indistinguishable in the total — which is exactly
    finding A's failure mode wearing the harness's clothes.
    """
    try:
        seen = dict(json.loads(raw or "{}"))
    except ValueError:
        seen = {}
    if reason:
        seen[reason] = int(seen.get(reason, 0)) + 1
    return json.dumps(seen, sort_keys=True)


def beat(market_date: str, *, now: Optional[float] = None,
         db_path: str | None = None) -> dict[str, Any]:
    """§2a item 4. Written on every tick, the `no_previous` ones included."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO scan_membership_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "ticks = ticks + 1, last_tick_at = excluded.last_tick_at, "
            "last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, market_date))
        conn.commit()
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM scan_membership_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM scan_membership_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def legacy_would_fire(params: dict[str, Any], *,
                      covered_sessions: Iterable[Any],
                      hits_by_as_of: Mapping[Any, Iterable[Any]],
                      already_fired: Iterable[Any] = ()) -> dict[str, Any]:
    """The LEGACY rule, restated read-only.

    ⛔ `screen_alerts.run_nightly` IS NOT CALLED. It DELIVERS
    (`watchlist_alert_service.deliver_alert_payload` = in-app + email + Discord)
    and MUTATES (`INSERT OR REPLACE INTO screen_alerts_fired`). Running it to
    find out what it would do would tell a member about a dark comparison — the
    one outcome this checkpoint exists to prevent.

    ⭐ SO THIS IS A MIRROR, AND A MIRROR IS ONLY HONEST WITH A RAIL ON IT.
    `test_the_mirror_matches_the_real_diff_for` drives the REAL
    `screen_alerts.diff_for` against a real temp `screener.db` and asserts this
    returns the same entered/exited sets
    (`lesson_rail_the_mirror_not_just_the_lane`).

    Reduced, what the legacy path decides for one (member, definition):

        sessions = scan_store.recent_covered_as_ofs(def_hash, tf, limit=2)
        if len(sessions) < 2:            -> no_previous, say NOTHING
        entered  = hits(now)  - hits(prev)
        exited   = hits(prev) - hits(now)
        want_in  = entered if mode in ("entry","both") else []
        want_out = exited  if mode in ("exit", "both") else []
        if not want_in and not want_out: -> skipped_quiet, say NOTHING
        if already fired for this as_of: -> skipped_dedup
        else                             -> ONE alert naming both lists

    ⛔ THE PREVIOUS SESSION COMES FROM `scan_coverage`, NEVER `scan_hits`
    (finding B). This mirror is handed the session list rather than deriving one,
    and the rail that the derivation stays coverage-based is
    `test_a_QUIET_SESSION_IN_THE_MIDDLE_is_the_previous_session`, which
    demonstrates the mass false alert a hits-derived list produces.

    ⚠️ WHAT THIS MIRROR DELIBERATELY DOES NOT MODEL: `MAX_PER_USER = 6`, the
    per-member per-run cap. It is a property of the whole RUN across every
    definition a member subscribes, not of this predicate, so a single-predicate
    mirror cannot see it. It is named in BLIND_SPOTS rather than approximated —
    an approximated cap would manufacture `legacy_only` rows for a member whose
    other five screens were quiet.
    """
    want_in, want_out = _smc.wants(params.get("direction"))
    d = _smc.diff(covered_sessions, hits_by_as_of)

    if d["reason"] in _smc.NOT_COMPARABLE_REASONS:
        return {"fires": False, "as_of": None, "entered": [], "exited": [],
                "named": [], "reason": d["reason"]}

    entered = list(d["entered"]) if want_in else []
    exited = list(d["exited"]) if want_out else []
    named = ([f"{_smc.DIRECTION_ENTERED}:{s}" for s in entered]
             + [f"{_smc.DIRECTION_LEFT}:{s}" for s in exited])

    if not named:
        return {"fires": False, "as_of": d["as_of"], "entered": [], "exited": [],
                "named": [], "reason": _smc.REASON_QUIET}

    if int(d["as_of"]) in {int(a) for a in (already_fired or ())}:
        return {"fires": False, "as_of": d["as_of"], "entered": entered,
                "exited": exited, "named": named, "reason": _smc.REASON_DEDUPED}

    return {"fires": True, "as_of": d["as_of"], "entered": entered,
            "exited": exited, "named": named, "reason": _smc.REASON_FIRES}


def open_span_if_absent(predicate_id: str, twin: dict, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM scan_membership_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO scan_membership_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM scan_membership_comparison_spans WHERE predicate_id=? "
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

    ⛔ Symbol drift is discarded with them and is NOT folded into
    `not_comparable`: drift is a different grain, and adding it to an outcome
    count would double-count the same night.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, params_version, agreed, new_only, legacy_only, not_comparable "
            "FROM scan_membership_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["params_version"])
            conn.execute(
                "UPDATE scan_membership_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, "
                "drift_new_only=0, drift_legacy_only=0, "
                "not_comparable=not_comparable+? WHERE id=?",
                (now, "params_change", discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO scan_membership_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_params_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, params: dict[str, Any], market_date: str, *,
            covered_sessions: Iterable[Any],
            hits_by_as_of: Mapping[Any, Iterable[Any]],
            already_fired: Iterable[Any] = (),
            now: Optional[float] = None,
            db_path: str | None = None) -> dict[str, int]:
    """One forward tick. Both rules evaluated at the SAME instant on the SAME
    sessions, then the outcome recorded at the ALERT grain.

    ⛔ Neither side alerting is NOT an outcome — it is an ordinary quiet night,
    which for a nightly diff is most of them. Counting quiet nights as `agreed`
    would drown every real disagreement and make the result a function of how
    often the market moved.

    ⛔ A tick whose diff could not be taken at all — `no_previous` (finding A's
    vanished window) or `undeclared_session` (finding B's structural refusal) —
    is `not_comparable`, NOT quiet. Both sides answer nothing for the same
    reason, and calling that agreement is exactly the flattering error.

    Returns the per-tick tally, so a caller can see a tick that recorded nothing
    as a tick that recorded nothing.
    """
    now = time.time() if now is None else now

    span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)
    try:
        twin = json.loads(span["twin"]) or {}
    except (ValueError, TypeError):
        twin = {}
    if _smc.predicate_fingerprint(twin) != _smc.predicate_fingerprint(params):
        note_params_change(predicate_id, params, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    dark = _smc.would_fire(params, covered_sessions=covered_sessions,
                           hits_by_as_of=hits_by_as_of, already_fired=already_fired)
    legacy = legacy_would_fire(params, covered_sessions=covered_sessions,
                               hits_by_as_of=hits_by_as_of, already_fired=already_fired)

    tally = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0,
             DRIFT_NEW_ONLY: 0, DRIFT_LEGACY_ONLY: 0}

    reason = None
    if (dark["reason"] in _smc.NOT_COMPARABLE_REASONS
            or legacy["reason"] in _smc.NOT_COMPARABLE_REASONS):
        tally[NOT_COMPARABLE] = 1
        reason = dark["reason"] or legacy["reason"]
    elif dark["fires"] and legacy["fires"]:
        tally[AGREED] = 1
        d_named, l_named = set(dark["named"]), set(legacy["named"])
        tally[DRIFT_NEW_ONLY] = len(d_named - l_named)
        tally[DRIFT_LEGACY_ONLY] = len(l_named - d_named)
        reason = _smc.REASON_FIRES
    elif dark["fires"]:
        tally[NEW_ONLY] = 1
        reason = legacy["reason"]
    elif legacy["fires"]:
        tally[LEGACY_ONLY] = 1
        reason = dark["reason"]
    else:
        reason = dark["reason"]

    # ⛔ THE HEARTBEAT IS WRITTEN BEFORE THE COUNTS ARE STORED, and on every tick
    # including the quiet ones and the not-comparable ones. A quiet night is
    # exactly the night a success-detector would miss, and on a NIGHTLY clock
    # most nights are quiet.
    beat(market_date, now=now, db_path=db_path)

    conn = _conn(db_path)
    try:
        keys = (AGREED, NEW_ONLY, LEGACY_ONLY, NOT_COMPARABLE,
                DRIFT_NEW_ONLY, DRIFT_LEGACY_ONLY)
        sets = ", ".join("%s = %s + ?" % (k, k) for k in keys)
        conn.execute(
            "UPDATE scan_membership_comparison_spans SET %s, sessions = ?, reasons = ? "
            "WHERE id = ?" % sets,
            (*[tally[k] for k in keys],
             _merged_sessions(span["sessions"], market_date),
             _merged_reasons(span["reasons"], reason),
             int(span["id"])))
        conn.commit()
    finally:
        conn.close()
    return tally


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The four counts, the drift beside them, the sessions covered, the liveness
    stamp, and what this comparison CANNOT see.

    ⛔ `observed` AND `status` LEAD. An empty comparison store prints four zeroes
    and reads exactly like perfect agreement — *a dark run that never ran and a
    dark run that found no disagreement are different facts.* For THIS type that
    is the whole game: the clock ticks once a night, so a broken sweep and a
    still market produce the same silence unless the report says which it saw.
    `reasons` is the histogram that tells them apart.

    ⛔ `verdict_ready` is its own field, never baked into a pass/fail: *"not
    enough data yet"* and *"they disagree"* are different answers, and collapsing
    them is how a gate stops meaning anything. On a nightly clock, five sessions
    is five comparisons — `sessions_covered` is printed in full so nobody reads a
    small `n` as agreement.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM scan_membership_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    drift = {DRIFT_NEW_ONLY: 0, DRIFT_LEGACY_ONLY: 0}
    sessions: set = set()
    reasons: dict[str, int] = {}
    definitions: set = set()
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        for k in drift:
            drift[k] += int(r[k])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        for k, v in (json.loads(r["reasons"] or "{}") or {}).items():
            reasons[k] = reasons.get(k, 0) + int(v)
        definitions.add((json.loads(r["twin"]) or {}).get("definition_id"))

    hb = heartbeat(db_path=db_path)
    observed = sum(totals.values())

    return {
        "predicate_id": predicate_id,
        # ⛔ THESE TWO FIRST, ALWAYS.
        "observed": observed,
        "status": "NO DATA" if not rows else ("QUIET" if observed == 0 else "OBSERVED"),
        **totals,
        "outcome_grain": OUTCOME_GRAIN,
        **drift,
        "drift_grain": DRIFT_GRAIN,
        "reasons": reasons,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "definitions": sorted(d for d in definitions if d),
        "clock": CLOCK,
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "heartbeat": hb,
        "blind_spots": BLIND_SPOTS,
    }


#: ⛔ §2a item 2's last clause — the report STATES WHAT IT CANNOT SEE, every
#: time, so nobody sizes the next checkpoint against a blind spot.
BLIND_SPOTS = (
    "HOW MANY MEMBERS THIS ABSORPTION HAS IS UNKNOWN. `screener.db` was not "
    "opened this pass, so the `screen_alert_subs` row count is unmeasured — and "
    "it is the number that decides whether this comparison can observe anything "
    "at all. A dark run over zero subscriptions prints four zeroes and reads "
    "like agreement, which is why `observed` and `status` lead the report.",

    "THE CLOCK TICKS ONCE A NIGHT. Five trading sessions of forward data is five "
    "comparisons per subscribed definition. A small `n` here is the normal case, "
    "not a sampling failure, and `verdict_ready` is a statement about session "
    "count and nothing else.",

    "`MAX_PER_USER = 6` IS NOT MODELLED. The legacy caps a member at six alerts "
    "across ALL their screens in one nightly run, which is a property of the "
    "whole run and not of any one predicate. A single-predicate mirror cannot "
    "see it; approximating it would manufacture `legacy_only` rows for a member "
    "whose other screens happened to be quiet. `MAX_NAMED = 12` is likewise not "
    "modelled — it truncates the MESSAGE, never the decision to alert.",

    "THE SESSIONS AND HIT SETS ARE INPUTS, NOT OBSERVATIONS. This harness "
    "compares two rules over sessions it is HANDED. It says nothing about "
    "whether the 05:00 ET sweep ran, whether it swept the right universe, or "
    "whether `scan_coverage` still holds two sessions for this definition — and "
    "a change in any of those moves both sides together and shows up as "
    "continued agreement.",

    "THE RETENTION THIS DEPENDS ON HAS NO OWNER. `scan_store.prune` exists with "
    "ZERO callers (measured: 0 occurrences of `scan_store.prune` in "
    "prose-stripped `api/**`, against 3 real `.prune(` call sites elsewhere). "
    "Two consecutive cycles survive because nobody prunes, not because a policy "
    "keeps them. The day it acquires a caller whose horizon reaches the previous "
    "session, every tick becomes `not_comparable` — which the harness reports "
    "honestly, and which is a fact about the STORE and not about the rules.",

    "NO MEMBER ROW IS PROJECTED AT CP1-CP2. Every predicate here is "
    "HARNESS-ARMED, so these counts describe the RULE, not the population. A "
    "zero in any column is a fact about the fixtures until CP3 projects real "
    "cohort rows.",
)
