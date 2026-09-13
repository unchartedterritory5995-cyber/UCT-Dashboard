"""F-S7-3 forward-only comparison for `regime-change` (CP2).

⛔ NO REPLAY, EVER. Both sides are evaluated on the SAME tick against the SAME
reading, and only forward. This type's reason is the sixth distinct one the
programme has met and it is structural rather than economic: **the classifier is
a 15-minute TTL cache (`voice_regime_classifier._TTL_SECONDS = 900`) over a
morning-wire push, and no prior `signals` dict is persisted anywhere.** The
ledger stores only `(label, confidence)` (`regime_snapshots.py:21-30`), so a past
cycle's vote cannot be reconstructed and "what would this predicate have said on
Tuesday" has no input at all.

⛔⛔ AND THE HARNESS MUST NEVER APPEND TO THAT LEDGER. `record_snapshot` is called
unconditionally on every awareness cycle (`engine.py:161`) and the legacy rule's
own `prev_label` is whatever it last wrote. A second writer would MOVE the thing
being measured — the comparison would be measuring the harness. This module
therefore never imports `regime_snapshots` and never names the table;
`test_the_harness_NEVER_writes_the_ledger_it_is_measuring` is the rail.

──────────────────────────────────────────────────────────────────────────────
⛔ FOUR OUTCOMES, NEVER A PASS RATE
──────────────────────────────────────────────────────────────────────────────
  agreed          -- both rules alert this member on this reading
  new_only        -- the dark rule alerts and the legacy one does not.
                     At the flip this member STARTS getting an alert they do not
                     get today.
  legacy_only     -- the legacy rule alerts and the dark one does not.
                     At the flip this member LOSES an alert they get today.
  not_comparable  -- the predicate changed firing identity, so the accumulated
                     ticks can no longer be attributed to the migration.

⛔ THE GRAIN IS PER MEMBER PER TICK, and unlike `catalyst-match` that is right
here: both legacy emitters produce AT MOST ONE insight per member per cycle, and
the fire carries no ticker to fan out over.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ NO DATA vs NO FLIP vs QUIET — THREE FACTS THAT ALL PRINT FOUR ZEROES
──────────────────────────────────────────────────────────────────────────────
This type's event may happen **once a day at best** — the classifier's inputs are
the morning wire's breadth push, so the label can only move when breadth moves.
Five sessions of forward data is a handful of comparable events, and a dark run
over zero flips prints exactly what perfect agreement prints.

So `report()` LEADS with what it OBSERVED and separates:

  NO DATA          -- no span exists. The sweep never ran for this predicate.
  NO FLIP OBSERVED -- the sweep ran, and the regime never changed. The four
                      zeroes say NOTHING about the two rules.
  QUIET            -- flips were seen and neither side fired (a stake or label
                      filter excluded them). An outcome-free observation.
  OBSERVED         -- at least one of the four outcomes was recorded.

⛔ `observed`, `ticks` and `flips_seen` are separate fields for exactly this
reason, and `verdict_ready` requires BOTH five sessions AND at least one observed
flip — a session count alone cannot distinguish a live sweep from a dead one over
a flat market.

──────────────────────────────────────────────────────────────────────────────
⛔ ONE SIDE IS THE REAL FUNCTION; THE OTHER HAS TO BE A MIRROR
──────────────────────────────────────────────────────────────────────────────
**Path A is driven for real.** `awareness.rules.rule_regime_flip` is PURE —
`rules.py`'s own docstring: *"Rules never touch the database or the network —
engine.py owns all I/O"* — so this harness calls the SHIPPED FUNCTION rather than
restating it. There is no mirror to drift, and that is the whole reason
`awareness.rules` is the one legacy import this module has.

**Path B cannot be.** `maybe_emit_regime_shift` calls `get_current_regime()`,
`list_summaries()` and `add_insight()`, and `add_insight` WRITES a
`voice_proactive_insights` row and mirrors it into the member's Compass thread.
Running it to find out what it would do would tell a member about a dark
comparison. So `legacy_session_summary_fires` is a MIRROR, and a mirror is only
honest with a rail on it: `test_the_session_summary_mirror_matches_the_REAL_function`
drives the real `maybe_emit_regime_shift` with those three stubbed and asserts it
agrees, and `test_the_session_summary_mirror_rail_CAN_FAIL` proves that rail can
go red (`lesson_rail_the_mirror_not_just_the_lane`).

⛔ §2a ITEM 4 — A LIVENESS STAMP, NOT JUST A RESULT STORE. `beat` is written on
EVERY call, including the quiet ones and the ones with no flip. A heartbeat that
only beats on success is a success detector.
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import regime_change as _rc
from api.services.awareness import rules as _legacy_rules

MIN_SESSIONS_FOR_VERDICT = 5

#: ⛔ ONE, AND IT IS A FLOOR RATHER THAN A SUFFICIENCY CLAIM. Below one observed
#: flip the four counts are literally about nothing. The number that would make a
#: verdict SOUND is how often the label actually flips, and that is measured from
#: `awareness_regime_snapshots` — which this pass did NOT open (see BLIND_SPOTS).
#: Picking a bigger number here would be an acceptance number nobody derived.
MIN_FLIPS_FOR_VERDICT = 1

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

STATUS_NO_DATA = "NO DATA"
STATUS_NO_FLIP = "NO FLIP OBSERVED"
STATUS_QUIET = "QUIET"
STATUS_OBSERVED = "OBSERVED"

HEARTBEAT_KEY = "regime_change_sweep_heartbeat"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS regime_change_comparison_spans (
    id              INTEGER PRIMARY KEY,
    predicate_id    TEXT NOT NULL,
    params_version  INTEGER NOT NULL DEFAULT 0,
    opened_at       REAL NOT NULL,
    closed_at       REAL,
    close_reason    TEXT,
    twin            TEXT NOT NULL DEFAULT '{}',
    sessions        TEXT NOT NULL DEFAULT '[]',
    ticks           INTEGER NOT NULL DEFAULT 0,
    flips_seen      INTEGER NOT NULL DEFAULT 0,
    agreed          INTEGER NOT NULL DEFAULT 0,
    new_only        INTEGER NOT NULL DEFAULT 0,
    legacy_only     INTEGER NOT NULL DEFAULT 0,
    not_comparable  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rc_spans_pred
    ON regime_change_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS regime_change_heartbeat (
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
    after five wall-clock days regardless of how many ticks actually happened."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def beat(market_date: str, *, now: Optional[float] = None,
         db_path: str | None = None) -> dict[str, Any]:
    """§2a item 4. Written on every tick — quiet ones and flat-market ones."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO regime_change_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "ticks = ticks + 1, last_tick_at = excluded.last_tick_at, "
            "last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, market_date))
        conn.commit()
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM regime_change_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM regime_change_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# The legacy side — one real function, one railed mirror
# ─────────────────────────────────────────────────────────────────────────────

def legacy_ledger_fires(*, current_label: Optional[str], confidence: Any = None,
                        ledger_label: Optional[str] = None,
                        has_positions: bool = False,
                        has_watch: bool = False) -> bool:
    """Path A, THE REAL SHIPPED RULE. Not a mirror.

    ⛔ `rule_regime_flip` is pure by design and by its module's own contract, so
    the honest comparison calls it. Restating it here would create a second
    authority over one value for no benefit whatsoever.

    The two ctx dicts are built in `engine.py`'s own shape: `scan_ctx["regime"]`
    carries `{label, confidence, prev_label}` (`engine.py:162-163`) and
    `user_ctx` carries `positions` and `watch_syms` (`engine.py:33-63`).
    ⛔ The position dict is deliberately EMPTY-BUT-PRESENT rather than realistic:
    `rule_regime_flip` only ever asks `bool(user_ctx.get("positions"))`, and
    handing it a fabricated stop/entry would invite a reader to think this
    harness models a book. It does not.
    """
    scan_ctx = {"regime": {"label": current_label, "confidence": confidence,
                           "prev_label": ledger_label}}
    user_ctx = {"positions": [{}] if has_positions else [],
                "watch_syms": {"__STAKE__"} if has_watch else set()}
    return bool(_legacy_rules.rule_regime_flip(scan_ctx, user_ctx))


def legacy_session_summary_fires(*, current_label: Optional[str],
                                 last_summary_text: Optional[str] = None) -> bool:
    """Path B, A MIRROR — because the real one writes and delivers.

    `maybe_emit_regime_shift` reduced to its decision, in the legacy's own order:

      1. no current label            -> no
      2. no session summary at all   -> no      (`if not summaries: return 0`)
      3. the FIRST label in the hard-coded tuple that is a SUBSTRING of the
         lowercased summary text and differs from the current label -> YES

    ⛔ NO STAKE TEST. Path B never looks at positions or watchlists; that
    asymmetry with path A is real and is `stake`'s whole reason for existing in
    the schema.

    ⛔ NO CONFIDENCE TEST either, and `importance` is hard-coded 8 rather than
    computed — so a `min_confidence` predicate on this source produces
    `legacy_only` by construction, which is a MIGRATION FACT and not a bug in
    either side.
    """
    if not current_label:
        return False
    if last_summary_text is None:
        return False
    text = str(last_summary_text).lower()
    for label in _rc.SESSION_SUMMARY_SCAN_ORDER:
        if label in text and label != current_label:
            return True
    return False


def legacy_fires(params: dict[str, Any], *, current_label: Optional[str],
                 confidence: Any = None, ledger_label: Optional[str] = None,
                 last_summary_text: Optional[str] = None,
                 has_positions: bool = False, has_watch: bool = False) -> bool:
    """Dispatch to the emitter this predicate DECLARED.

    ⛔ There is no default. A predicate that named no `prior_label_source` has no
    legacy counterpart to compare against, and inventing one would be the
    assumption the field was added to remove.
    """
    src = params.get("prior_label_source")
    if src == _rc.LEDGER:
        return legacy_ledger_fires(current_label=current_label, confidence=confidence,
                                   ledger_label=ledger_label,
                                   has_positions=has_positions, has_watch=has_watch)
    if src == _rc.SESSION_SUMMARY:
        return legacy_session_summary_fires(current_label=current_label,
                                            last_summary_text=last_summary_text)
    return False


def flip_seen(params: dict[str, Any], *, current_label: Optional[str],
              ledger_label: Optional[str] = None,
              last_summary_text: Optional[str] = None) -> bool:
    """Did the EVENT this type is about happen on this tick, under this
    predicate's declared prior-label authority?

    ⛔ Measured BEFORE any of the predicate's own filters. This is the number
    that separates *"the two rules agree"* from *"nothing happened"*, and the
    two look identical in every outcome column.
    """
    prev = _rc.prior_label(params, current_label=current_label,
                           ledger_label=ledger_label,
                           last_summary_text=last_summary_text)
    return bool(current_label and prev and current_label != prev)


# ─────────────────────────────────────────────────────────────────────────────
# Spans
# ─────────────────────────────────────────────────────────────────────────────

def open_span_if_absent(predicate_id: str, twin: dict, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM regime_change_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO regime_change_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM regime_change_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def note_params_change(predicate_id: str, new_twin: dict[str, Any], *,
                       now: Optional[float] = None,
                       db_path: str | None = None) -> dict[str, int]:
    """The predicate's firing identity changed — the clock RESETS.

    ⛔ The open span closes and its accumulated OUTCOME counts are **discarded
    into `not_comparable`**, never carried. What the two sides did under the OLD
    parameters cannot be attributed to the migration.

    ⭐ `ticks` and `flips_seen` are NOT discarded, and the distinction is
    deliberate: they are OBSERVATIONS, not conclusions. *"The sweep ran forty
    times and the regime moved twice"* stays true no matter what the predicate's
    parameters were, and it is the fact `report()` has to lead with. Zeroing it
    on a parameter edit would re-create the blindness this whole design exists to
    remove.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, params_version, agreed, new_only, legacy_only, not_comparable "
            "FROM regime_change_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["params_version"])
            conn.execute(
                "UPDATE regime_change_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                "WHERE id=?", (now, "params_change", discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO regime_change_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_params_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, params: dict[str, Any], market_date: str, *,
            current_label: Optional[str],
            confidence: Any = None,
            ledger_label: Optional[str] = None,
            last_summary_text: Optional[str] = None,
            has_positions: bool = False,
            has_watch: bool = False,
            now: Optional[float] = None,
            db_path: str | None = None) -> dict[str, int]:
    """One forward tick. Both sides evaluated at the SAME instant on the SAME
    reading, then the outcome recorded.

    ⛔ Neither side firing is NOT an outcome — it is an ordinary quiet tick, and
    for this type most ticks are quiet by nature. Counting them as `agreed` would
    make the result a function of how often the sweep ran.

    Returns the per-tick tally plus `flip_seen`, so a caller can tell a tick that
    recorded nothing because the rules agreed from a tick that recorded nothing
    because the market did not move.
    """
    now = time.time() if now is None else now

    span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)
    try:
        twin = json.loads(span["twin"]) or {}
    except (ValueError, TypeError):
        twin = {}
    if _rc.predicate_fingerprint(twin) != _rc.predicate_fingerprint(params):
        note_params_change(predicate_id, params, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    dark = _rc.would_fire(params, current_label=current_label, confidence=confidence,
                          ledger_label=ledger_label, last_summary_text=last_summary_text,
                          has_positions=has_positions, has_watch=has_watch)
    legacy = legacy_fires(params, current_label=current_label, confidence=confidence,
                          ledger_label=ledger_label, last_summary_text=last_summary_text,
                          has_positions=has_positions, has_watch=has_watch)
    flipped = flip_seen(params, current_label=current_label, ledger_label=ledger_label,
                        last_summary_text=last_summary_text)

    tally = {AGREED: int(dark and legacy),
             NEW_ONLY: int(dark and not legacy),
             LEGACY_ONLY: int(legacy and not dark)}

    # ⛔ THE HEARTBEAT IS WRITTEN UNCONDITIONALLY. A flat-market tick is exactly
    # the tick a success-detector would miss, and this type has mostly those.
    beat(market_date, now=now, db_path=db_path)

    conn = _conn(db_path)
    try:
        sets = ", ".join("%s = %s + ?" % (k, k) for k in (AGREED, NEW_ONLY, LEGACY_ONLY))
        conn.execute(
            "UPDATE regime_change_comparison_spans SET %s, ticks = ticks + 1, "
            "flips_seen = flips_seen + ?, sessions = ? WHERE id = ?" % sets,
            (tally[AGREED], tally[NEW_ONLY], tally[LEGACY_ONLY], int(flipped),
             _merged_sessions(span["sessions"], market_date), int(span["id"])))
        conn.commit()
    finally:
        conn.close()

    return {**tally, "flip_seen": int(flipped)}


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The four counts, what was OBSERVED, the liveness stamp, and what this
    comparison CANNOT see.

    ⛔ `observed`, `ticks` and `flips_seen` LEAD. An empty store, a sweep that
    ran over a flat market, and a sweep that found perfect agreement print the
    SAME four zeroes — *a dark run that never ran, a market that never moved and
    two rules that never disagreed are three different facts.*

    ⛔ `verdict_ready` is its own field, never baked into a pass/fail, and it
    requires an observed FLIP as well as five sessions: five sessions of a flat
    tape is not five sessions of evidence.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM regime_change_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    sessions: set = set()
    sources: set = set()
    ticks = flips = 0
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        ticks += int(r["ticks"])
        flips += int(r["flips_seen"])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        sources.add((json.loads(r["twin"]) or {}).get("prior_label_source"))

    observed = sum(totals.values())
    if not rows:
        status = STATUS_NO_DATA
    elif observed:
        status = STATUS_OBSERVED
    elif flips == 0:
        status = STATUS_NO_FLIP
    else:
        status = STATUS_QUIET

    return {
        "predicate_id": predicate_id,
        "observed": observed,
        "ticks": ticks,
        "flips_seen": flips,
        "status": status,
        **totals,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "prior_label_sources": sorted(s for s in sources if s),
        "verdict_ready": (len(sessions) >= MIN_SESSIONS_FOR_VERDICT
                          and flips >= MIN_FLIPS_FOR_VERDICT),
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "min_flips_for_verdict": MIN_FLIPS_FOR_VERDICT,
        "heartbeat": heartbeat(db_path=db_path),
        "blind_spots": BLIND_SPOTS,
    }


#: ⛔ §2a item 2's last clause — the report STATES WHAT IT CANNOT SEE, every
#: time, so nobody sizes the next checkpoint against a blind spot.
BLIND_SPOTS = (
    "ONE SPAN DESCRIBES ONE EMITTER. There are TWO legacy emitters with different "
    "prior-label authorities, and a span whose predicate declared "
    "prior_label_source='ledger' says NOTHING about what "
    "voice_proactive_service.maybe_emit_regime_shift did on the same tick, or "
    "the reverse. An absorption that reproduces only one of them reports "
    "legacy_only for every fire the other makes -- an alert a member LOSES at "
    "the flip -- and this harness will not show it unless BOTH sources are "
    "armed as separate predicates.",

    "THE SHARED 8/DAY INSIGHT CAP IS NOT MODELLED. add_insight's "
    "MAX_INSIGHTS_PER_USER_PER_DAY is shared across every insight kind, so a "
    "real legacy fire can be suppressed by an unrelated stop_hit earlier that "
    "day. This harness compares RULES, not queues, and will read such a "
    "suppression as new_only.",

    "THE LEDGER IS AN INPUT, NOT AN OBSERVATION. This harness is HANDED "
    "prev_label and never appends to awareness_regime_snapshots -- deliberately, "
    "because a second writer would move the legacy rule's own prior label. So "
    "if nothing else drives the awareness scan, prev_label never advances and "
    "the harness sees no flip at all: a flat flips_seen can mean the market did "
    "not move OR that the legacy cycle is not running.",

    "THE LEGACY GATES ARE ON, AND THIS HARNESS STILL SAYS NOTHING ABOUT MEMBERS. "
    "Read live on web 2026-09-12: AWARENESS_ENGINE_ENABLED=1 and "
    "COMPASS_AUTOMATION_ENABLED=1, so BOTH emitters run in production today. "
    "That makes the comparison worth doing and does NOT make these counts a "
    "statement about anybody's inbox -- every predicate here is harness-armed.",

    "HOW OFTEN THE LABEL ACTUALLY FLIPS WAS NOT MEASURED. "
    "awareness_regime_snapshots was not opened -- the production ledger lives on "
    "the pod and reading it is outside this checkpoint's authorization. So the "
    "sample size a verdict would need is UNKNOWN, and min_flips_for_verdict is a "
    "floor rather than a derived acceptance number.",

    "THE AWAY-DELIVERY SILENCE IS NOT MEASURED HERE. That regime flips reach no "
    "inbox is a property of awareness/engine.py:241's `and candidate.symbol`, "
    "not of anything this harness observes. regime_change pins channels and "
    "entity_ref as FIXED VALUES for that reason; the schema rail is the "
    "evidence, not these counts.",

    "CADENCE. The classifier is a 15-minute TTL cache over a morning-wire "
    "breadth push, so the label can only move when breadth moves -- honestly "
    "about once a day. A small flips_seen is the normal state and must never be "
    "read as agreement; how often the label ACTUALLY flips was not measured, "
    "because awareness_regime_snapshots was not opened this pass.",

    "NO MEMBER ROW IS PROJECTED AT CP1-CP2. Every predicate here is "
    "HARNESS-ARMED, so these counts describe the RULE, not the population. A "
    "zero in any column is a fact about the fixtures until CP3 projects real "
    "cohort rows.",
)
