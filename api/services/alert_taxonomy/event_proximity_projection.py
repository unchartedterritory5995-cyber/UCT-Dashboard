"""GATE-S7-EVENT-PROXIMITY Checkpoint 3 — the READ-ONLY PROJECTION of the legacy
cohort, ADMIN-ROLE ACCOUNTS ONLY, still fully dark.

⛔ Approval line 2 (owner, 2026-09-12). No delivery. No legacy change. CP4 and
the flip each need a new line.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE RULING THAT SHAPES THIS MODULE — WHO REFRESHES THE EVENT DATE
──────────────────────────────────────────────────────────────────────────────

CP2's mirror rail exposed a structural difference between the two rules: the
LEGACY path **re-reads the calendar every run**, while a stored `event_date` is
just a snapshot. Left alone, a rescheduled call makes the two describe different
worlds — legacy follows the calendar, a stale predicate keeps firing against the
old date — and the dark period would spend its week measuring *that* instead of
the rule difference it exists to size.

**The owner's ruling: the projection re-reads the calendar every tick, same as
legacy. The stored `event_date` is an AUDIT SNAPSHOT, not the truth.** When the
calendar disagrees with the snapshot, that IS a reschedule:

  1. the comparison clock RESETS for that predicate,
  2. the pre-reschedule span's counts are discarded into `not_comparable`,
  3. the snapshot is updated with a **version bump**.

⭐ **The two worlds then converge BY CONSTRUCTION**, and the dark week is left
measuring only genuine rule disagreement. That is the point: a harness whose
headline number is dominated by a data-freshness artefact is measuring its own
plumbing.

──────────────────────────────────────────────────────────────────────────────
⛔ PROJECTION, NOT MIRROR — and the cohort is the LEGACY cohort
──────────────────────────────────────────────────────────────────────────────

There is no per-user alert row to project here: `run_prereport_alerts` computes
its cohort as *(every user's "My Stocks") × (the reporters for a market_date)*.
So the projection computes the SAME intersection, from the SAME two sources,
narrowed to admin-role accounts — and holds nothing of its own. A projection
cannot drift because there is nothing in it to drift.

⛔ The calendar is read through **`calendar_alerts._get_reporters_for_date`**,
the legacy module's own function, rather than a reimplementation. A second
reader would answer differently the day one of them changed provider fallbacks,
and the comparison would be measuring the two readers instead of the two rules.
⚠️ That is a READ of a legacy helper, not a change to it: `calendar_alerts.py`
stays byte-identical, and a rail asserts it.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date as _date, timedelta as _timedelta
from typing import Any, Optional

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import event_proximity as _ep
from api.services.alert_taxonomy import event_proximity_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

PROJECTED_PREFIX = "ep:"
ADMIN_ROLE = "admin"

#: ⛔ CP4 — all members. Default OFF, its own flag, read at call time. Same
#: shape and same reasoning as price-level's: one variable arms the sweep, a
#: different one decides WHO it reads, so the owner can change either alone.
CP4_ALL_MEMBERS_FLAG = "ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ALL_MEMBERS"


def all_members_enabled() -> bool:
    raw = (os.environ.get(CP4_ALL_MEMBERS_FLAG) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def projected_predicate_id(user_id: str, ticker: str) -> str:
    """⛔ Keyed by the LEGACY IDENTITY — (user, ticker) — because that is what
    the legacy dedup PK is keyed on, minus the date. Keying in the date would
    make every reschedule look like a brand-new predicate and hide exactly the
    reset this checkpoint exists to perform."""
    return f"{PROJECTED_PREFIX}{user_id}:{ticker}"


def _cohort_user_ids() -> set[str]:
    """The `rollout:s7-dark` cohort — S12's first migration.

    ⚰️ THIS WAS A ROLE CHECK, AND THAT WAS A ROLLOUT GATE WEARING A PRIVILEGE'S
    CLOTHES. The retired body, kept verbatim:

        conn = _auth_db.get_connection()
        try:
            if all_members_enabled():
                rows = conn.execute("SELECT id FROM users").fetchall()
            else:
                rows = conn.execute("SELECT id FROM users WHERE role = ?", (ADMIN_ROLE,)).fetchall()
        finally:
            conn.close()
        return {str(dict(r)["id"]) for r in rows}

    Its own docstring said *"the existing role check, never a hardcoded list …
    a typed list is a second authority"* — which was right about typed lists and
    still left the cohort unable to shrink, unable to include a non-admin, and
    duplicated in `price_level_projection.py`.

    ⛔⛔ AN EMPTY COHORT MEANS NO MEMBERS. There is no fallback to admins here and
    there must never be one (owner ruling, 2026-09-12). The swap is a no-op only
    because `main.py` seeds the tag from the role at boot, and
    `test_the_swap_projects_an_IDENTICAL_cohort` is what proves it.

    ⛔ AND THE CP4 FLAG IS NO LONGER A CODE PATH. Widening to all members is now
    a TAG ASSIGNMENT, not a branch — so the `all_members_enabled()` test above is
    gone. `CP4_ALL_MEMBERS_FLAG` and its rail stay until a later line deletes
    them, asserting the thing that is now true by construction: **unset changes
    nothing, and so does set.**
    """
    return _rollout.cohort_user_ids(_rollout.S7_DARK)


def project_admin_event_predicates(today: _date) -> list[dict[str, Any]]:
    """The legacy cohort's decision, recomputed read-only for admin accounts.

    ⭐ The CALENDAR IS RE-READ HERE, every tick, through the legacy module's own
    `_get_reporters_for_date`. That is the ruling: a stored date is an audit
    snapshot, and the truth is whatever the calendar says now.
    """
    from api.services import calendar_alerts as _cal
    from api.services import calendar_personalization as _cp

    cohort = _cohort_user_ids()
    if not cohort:
        return []

    mine: dict[str, set[str]] = {}
    for uid in sorted(cohort):
        try:
            sets = _cp.get_user_ticker_sets(uid)
            tickers = sets.get("all_mine") or set()
        except Exception:
            # ⛔ One member's ticker-set failing must not empty the cohort. An
            # exception here would otherwise read downstream as "nobody is
            # watching anything", which is indistinguishable from a quiet day.
            tickers = set()
        if tickers:
            mine[uid] = {str(t).upper() for t in tickers}

    out: list[dict[str, Any]] = []
    for lead in _ep.LEGACY_LEAD_DAYS:
        market_date = (today + _timedelta(days=lead)).isoformat()
        try:
            reporters = {str(t).upper() for t in _cal._get_reporters_for_date(market_date)}
        except Exception:
            reporters = set()
        if not reporters:
            continue
        for uid, tickers in mine.items():
            for ticker in sorted(tickers & reporters):
                out.append({
                    "legacy_id": f"{uid}:{ticker}",
                    "user_id": uid,
                    "event_kind": _ep.EARNINGS,
                    "entity_ref": ticker,
                    "event_date": market_date,
                    "granularity": _ep.DAY,
                    "lead_days": lead,
                    "lead_hours": None,
                    "session": None,
                })
    return out


def run_projected_comparison(today: _date, *, now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One forward tick over the projected admin cohort.

    Per projected predicate:
      1. open a span if this is the first sighting;
      2. **detect a RESCHEDULE by comparing the calendar's answer against the
         span's snapshot** — the ruling's centre;
      3. evaluate both rules at the same instant;
      4. record one of the four outcomes.
    """
    now = time.time() if now is None else now
    projected = project_admin_event_predicates(today)
    outcomes: dict[str, str] = {}
    reschedules = 0

    for p in projected:
        pid = projected_predicate_id(p["user_id"], p["entity_ref"])
        span = _cmp.open_span_if_absent(pid, p, now=now, db_path=db_path)

        snapshot = json.loads(span["twin"]) or {}
        if _ep.event_fingerprint(snapshot) != _ep.event_fingerprint(p):
            # ⛔ THE RESCHEDULE RESET. The calendar disagrees with the audit
            # snapshot, so the pre-reschedule span is discarded into
            # not_comparable and a fresh one opens with a bumped version.
            _cmp.note_event_change(pid, p, now=now, db_path=db_path)
            span = _cmp.open_span_if_absent(pid, p, now=now, db_path=db_path)
            reschedules += 1

        dark = _ep.would_fire(p, today)
        legacy = _cmp.legacy_would_fire(p, today)

        if dark:
            _receipts.record_fire(
                predicate_id=pid, trigger_type=_ep.TYPE_ID, user_id=p["user_id"],
                entity_ref=p["entity_ref"],
                fire_key="ep:%s:%s:%s" % (p["entity_ref"], p["event_date"], p["lead_days"]),
                detail={"event_kind": p["event_kind"], "event_date": p["event_date"],
                        "lead_days": p["lead_days"], "projected": True, "dark": True},
                source_data_class="calendar", freshness_class="end_of_day",
                as_of=now, db_path=db_path)

        outcome = _cmp.observe(pid, p, today, now=now, db_path=db_path)
        if outcome:
            outcomes[pid] = outcome

    _beat(now, len(projected), reschedules, db_path=db_path)
    return {"projected": len(projected), "outcomes": outcomes,
            "reschedules": reschedules, "at": now, "today": today.isoformat()}


_BEAT_DDL = """
CREATE TABLE IF NOT EXISTS event_proximity_sweep_heartbeat (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    last_tick    REAL NOT NULL,
    ticks        INTEGER NOT NULL DEFAULT 0,
    projected    INTEGER NOT NULL DEFAULT 0,
    reschedules  INTEGER NOT NULL DEFAULT 0
);
"""


def _beat_conn(db_path: str | None = None):
    """The heartbeat's OWN seam — so "a heartbeat failure never takes the
    comparison down" is a testable claim rather than an assertion about a system
    that has already failed."""
    return _db.connect(db_path)


def _beat(at: float, projected: int, reschedules: int, *,
          db_path: str | None = None) -> None:
    """⛔ Stamped on EVERY tick, including the ones that project nobody. A
    heartbeat that only beats on success is a success detector, not a liveness
    one — and spans carry no per-tick timestamp, so nothing else can tell a sweep
    that died on its first morning from one still running."""
    try:
        conn = _beat_conn(db_path)
        try:
            conn.executescript(_BEAT_DDL)
            conn.execute(
                "INSERT INTO event_proximity_sweep_heartbeat "
                "(id, last_tick, ticks, projected, reschedules) VALUES (1,?,1,?,?) "
                "ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick, "
                "ticks = event_proximity_sweep_heartbeat.ticks + 1, "
                "projected=excluded.projected, reschedules=excluded.reschedules",
                (at, int(projected), int(reschedules)))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def run_dark_sweep(*, today: Optional[_date] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """⛔ THE ONLY THING THAT MAKES CP3 MORE THAN A LIBRARY.

    price-level shipped a dark run that nothing called — registered, built,
    eighteen tests green, and on nobody's tick. §2a item 3 of the completion plan
    exists because of it, and this is that item's answer for this type.
    """
    today = _date.today() if today is None else today
    return run_projected_comparison(today, db_path=db_path)
