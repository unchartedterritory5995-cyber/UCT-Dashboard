"""GATE-S7-REGIME-CHANGE **CP3** (approval line 2, fingerprint `9f0575340`) —
the READ-ONLY PROJECTION over the `rollout:s7-dark` cohort, still fully dark.

The packet's §4 row, verbatim, including the warning that this type is unlike
its siblings:

    **CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY,
    still dark.** ⛔ Cohort via `rollout.cohort_user_ids(rollout.S7_DARK)` —
    never a role check. ⚠️ **For THIS type a projection is unusual and must be
    stated:** the predicate is global, so "projecting member rows" means
    projecting the *stake* test (does this member hold a position or watch a
    symbol) over the cohort, from `j2_positions` and `watchlist_items`
    read-only — the same two bulk queries `engine.py:44-63` already runs.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE LEDGER IS THE RECORD OF WHAT R4 SAW — AND THIS MODULE MUST NEVER WRITE IT
──────────────────────────────────────────────────────────────────────────────

`awareness/engine.py::_compute_regime_component` does a read-then-write:

    prev_label = regime_snapshots.get_last_label()     # what R4 compares against
    ...
    regime_snapshots.record_snapshot(label, confidence)   # ⛔ IT APPENDS

**So a dark run that called that function would APPEND TO THE LEGACY'S OWN
MEMORY** — corrupting the very `prev_label` the live R4 rule reads next cycle,
and turning a comparison into an intervention. `test_the_projection_NEVER_writes
_the_regime_ledger` asserts that from the source and behaviourally.

⭐ **AND THE LEDGER MAKES THE CLASSIFIER CALL UNNECESSARY.** The engine appends
exactly one row per scan cycle, so after a cycle:

  * the **newest** row's label is what the engine classified and acted on;
  * the **second-newest** row's label is exactly what `get_last_label()` returned
    to R4 *before* this cycle's append — the state it decided against.

Reading both is a faithful reconstruction and costs no classifier call. ⛔ Calling
`get_current_regime()` here instead would compare against a label re-derived at a
different moment behind a 15-minute TTL, and the dark period would measure CLOCK
SKEW rather than rule difference.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ ONE LEDGER ROW IS OBSERVED ONCE — OR THE COUNTS MEASURE THE SWEEP, NOT THE MARKET
──────────────────────────────────────────────────────────────────────────────

This is the third shape of the ordering hazard in this programme and the most
quietly wrong. The ledger only changes when the awareness engine runs. A sweep
ticking faster than that would re-observe **the same flip** on every tick, and
`observe()` increments the span counters each time — so `agreed` would become a
function of how often the sweep ran rather than of how often the market moved,
and a busier cadence would look like more agreement.

⭐ A WATERMARK, keyed by the ledger's own `id`, makes each row observable once.
A tick that finds no new row records nothing **and still beats**, because a flat
market is exactly the tick a success-detector would miss.

──────────────────────────────────────────────────────────────────────────────
⛔ STILL DARK. NOTHING IS ARMED.
──────────────────────────────────────────────────────────────────────────────

Comparison spans and a watermark, nothing else. No delivery import, no
`add_insight`, no write to `awareness_regime_snapshots`. The sweep is gated by
`ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED`, **default OFF**.
"""
from __future__ import annotations

import sqlite3
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import regime_change as _rc
from api.services.alert_taxonomy import regime_change_compare as _cmp

_ET = ZoneInfo("America/New_York")

PROJECTED_PREFIX = "legacy:"

#: The watermark. ⛔ Its OWN table, in the alert-taxonomy store — never a column
#: on the legacy ledger, which this module may not write at all.
_WATERMARK_DDL = """
CREATE TABLE IF NOT EXISTS regime_change_projection_watermark (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    last_ledger_id INTEGER NOT NULL,
    observed_at    REAL    NOT NULL
);
"""


def projected_predicate_id(user_id: str, prior_label_source: str) -> str:
    return f"{PROJECTED_PREFIX}{user_id}:{prior_label_source}"


def market_date(now: Optional[float] = None) -> str:
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def ledger_reading() -> dict[str, Any]:
    """`{ledger_id, current_label, confidence, prior_label}` — the legacy's own
    memory, READ-ONLY.

    ⛔ Two rows, one query, newest first. `prior_label` is `None` when the ledger
    holds fewer than two rows, which `would_fire` treats as "nothing to compare"
    rather than as a flip — the honest answer for a first-ever cycle.
    """
    from api.services.awareness import regime_snapshots as _snap

    conn = sqlite3.connect(_snap._DB_PATH, timeout=10.0)
    try:
        rows = conn.execute(
            "SELECT id, label, confidence FROM awareness_regime_snapshots "
            "ORDER BY id DESC LIMIT 2").fetchall()
    finally:
        conn.close()
    if not rows:
        return {"ledger_id": None, "current_label": None, "confidence": None,
                "prior_label": None}
    newest = rows[0]
    return {"ledger_id": int(newest[0]), "current_label": newest[1],
            "confidence": newest[2],
            "prior_label": rows[1][1] if len(rows) > 1 else None}


def member_stakes(cohort: set[str]) -> dict[str, tuple[bool, bool]]:
    """`{user_id: (has_positions, has_watch)}` — §4's stake test, from the same
    two bulk queries `engine.py:44-63` runs, narrowed to the cohort.

    ⛔ Two queries, not one per member. The legacy loads the whole population in
    two statements precisely to avoid an N+1, and a projection that fanned out
    per member would put a load profile on the pod the legacy never had.
    """
    if not cohort:
        return {}
    from api.services.auth_db import get_connection

    ph = ",".join("?" * len(cohort))
    ids = tuple(sorted(cohort))
    conn = get_connection()
    try:
        pos = {str(dict(r)["user_id"]) for r in conn.execute(
            f"SELECT DISTINCT user_id FROM j2_positions "
            f"WHERE closed_at IS NULL AND user_id IN ({ph})", ids).fetchall()}
        watch = {str(dict(r)["user_id"]) for r in conn.execute(
            f"SELECT DISTINCT w.user_id AS user_id FROM watchlist_items wi "
            f"JOIN watchlists w ON w.id = wi.watchlist_id "
            f"WHERE w.user_id IN ({ph})", ids).fetchall()}
    finally:
        conn.close()
    return {uid: (uid in pos, uid in watch) for uid in cohort}


def last_summary_text(user_id: str) -> Optional[str]:
    """Path B's per-member input — the member's most recent voice-session
    summary. Read-only, and best-effort: a member with no voice history has no
    summary, which is not an error and is not a flip."""
    try:
        from api.services.voice_memory_service import list_summaries
        rows = list_summaries(user_id, limit=1) or []
    except Exception:                                   # noqa: BLE001
        return None
    return (rows[0].get("summary_text") if rows else None)


def _params(prior_label_source: str) -> dict[str, Any]:
    """The legacy emitter, as this type's params.

    ⛔ THE TWO LEGACY PATHS DISAGREE ON THE STAKE AXIS AND THE SCHEMA SAYS BOTH.
    R4 (the ledger path) gates on an open position OR a watched symbol;
    `maybe_emit_regime_shift` (the summary path) applies **no stake test at
    all** — its eligibility is "has a voice-session summary", a property of the
    SOURCE, not of the member's book. Flattening them to one value here would
    invent an agreement the legacy does not have.
    """
    if prior_label_source == _rc.LEDGER:
        return {"prior_label_source": _rc.LEDGER, "stake": _rc.LEGACY_STAKE_LEDGER}
    return {"prior_label_source": _rc.SESSION_SUMMARY,
            "stake": _rc.LEGACY_STAKE_SESSION_SUMMARY}


def _watermark(db_path: str | None = None) -> Optional[int]:
    conn = _db.connect(db_path)
    try:
        conn.executescript(_WATERMARK_DDL)
        row = conn.execute(
            "SELECT last_ledger_id FROM regime_change_projection_watermark "
            "WHERE id = 1").fetchone()
        return int(row[0]) if row else None
    finally:
        conn.close()


def _set_watermark(ledger_id: int, at: float, db_path: str | None = None) -> None:
    conn = _db.connect(db_path)
    try:
        conn.executescript(_WATERMARK_DDL)
        conn.execute(
            "INSERT INTO regime_change_projection_watermark "
            "(id, last_ledger_id, observed_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET last_ledger_id = excluded.last_ledger_id, "
            "observed_at = excluded.observed_at", (int(ledger_id), float(at)))
        conn.commit()
    finally:
        conn.close()


def run_dark_sweep(*, now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One forward tick of the DARK comparison over the cohort.

    ⛔ THIS IS THE ONLY THING THAT MAKES CP3 MORE THAN A LIBRARY.
    ⛔ STILL DARK — spans and a watermark, no delivery, no ledger write.
    """
    at = time.time() if now is None else now
    day = market_date(at)
    reading = ledger_reading()

    def _quiet(reason: str) -> dict[str, Any]:
        # ⛔⛔ BEAT ANYWAY. A flat market is exactly the tick a success-detector
        # would miss, and for this type most ticks are flat by nature.
        _cmp.beat(day, now=at, db_path=db_path)
        return {"members": 0, "evaluated": 0, "outcomes": {},
                "ledger_id": reading["ledger_id"], "skipped": reason, "at": at}

    if reading["ledger_id"] is None:
        return _quiet("no_ledger_rows")
    if _watermark(db_path) == reading["ledger_id"]:
        # ⛔ ALREADY OBSERVED. Re-counting one flip on every tick would make
        # `agreed` a function of the sweep's cadence rather than of the market.
        return _quiet("already_observed")

    cohort = _rollout.cohort_user_ids(_rollout.S7_DARK)
    if not cohort:
        _set_watermark(reading["ledger_id"], at, db_path=db_path)
        return _quiet("empty_cohort")

    stakes = member_stakes(cohort)
    outcomes: dict[str, dict[str, int]] = {}
    evaluated = 0

    for user_id in sorted(cohort):
        has_positions, has_watch = stakes.get(user_id, (False, False))
        summary = last_summary_text(user_id)
        for source in _rc.PRIOR_LABEL_SOURCES:
            pid = projected_predicate_id(user_id, source)
            params = _params(source)
            evaluated += 1
            tally = _cmp.observe(
                pid, params, day,
                current_label=reading["current_label"],
                confidence=reading["confidence"],
                ledger_label=reading["prior_label"],
                last_summary_text=summary,
                has_positions=has_positions, has_watch=has_watch,
                now=at, db_path=db_path)
            if any(v for k, v in tally.items() if k != "flip_seen"):
                outcomes[pid] = tally

    _set_watermark(reading["ledger_id"], at, db_path=db_path)
    return {"members": len(cohort), "evaluated": evaluated, "outcomes": outcomes,
            "ledger_id": reading["ledger_id"],
            "current_label": reading["current_label"],
            "prior_label": reading["prior_label"], "skipped": None, "at": at}
