"""TERM-062 / FB-S7-02 -- publish the cooldowns, and show fire-frequency.

Two halves, each with ONE authority:

1. `published_cooldowns()` -- the re-arm rule each MEMBER-FACING trigger type
   applies, built at call time from the constants the alert code itself consumes
   (`document_arrival.SWEEP_EVERY_MINUTES` schedules the sweep in api/main.py,
   `FIRE_KEY_GRAIN` builds the fire key, `MAX_FIRES_PER_SWEEP` is what
   `_evaluate_one` does, `sweep_enabled()` gates the job). Nothing here is a
   typed copy of a number; the sentence is composed from the same values.

   ⛔ SCOPE: types a member can author today -- DERIVED from the router's
   `POST /api/alerts/taxonomy/<type>` routes (`member_create_type_ids`), and a
   rail requires this register to equal that set. The seven other registered
   types run DARK (comparison spans, no member delivery through the taxonomy),
   so publishing their grains to members would describe a path nobody is on.
   The day one of them gets a member create route, the rail reds by name until
   its cooldown is published here.

2. `fire_frequency()` -- how often an alert for one entity fired over the last
   `FREQUENCY_WINDOW_DAYS`, counted from `alert_fires` (the durable record,
   never `user_alerts`, never a process counter that a redeploy resets). It
   counts DISTINCT fire keys, so one filing seen by three members' watches is
   one alert-worth, and it reports COVERAGE beside the count: an entity no
   predicate watched in the window is `fires: None` (unobserved), never `0`.

   ⚠️ Coverage is read off `alert_predicates` (created_at / suspended_at). A
   predicate that was suspended and later reactivated keeps its original
   created_at and has no suspension history, so a gap inside the window reads as
   covered. That can only OVERSTATE coverage for a reactivated watch; it cannot
   invent fires.

   ⚠️ The count is across every member's matching predicates (that is what makes
   it answerable before saving). The response carries counts and timestamps only
   -- never a user id, a predicate id or how many members watch.
"""
from __future__ import annotations

import time
from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import document_arrival as _doc

#: The look-back the published fire-frequency covers, in calendar days.
FREQUENCY_WINDOW_DAYS = 30

#: The member create-route shape `member_create_type_ids` derives types from.
_CREATE_PREFIX = "/api/alerts/taxonomy/"

#: How a fire-key grain reads to a member. A grain with no entry is published
#: under its own field name -- awkward, but true, and never a stale noun.
_GRAIN_NOUN = {"accession": "filing"}


def _document_arrival() -> dict[str, Any]:
    grain = _doc.FIRE_KEY_GRAIN
    noun = _GRAIN_NOUN.get(grain, grain)
    checking = _doc.sweep_enabled()
    minutes = _doc.SWEEP_EVERY_MINUTES if checking else None
    per_check = _doc.MAX_FIRES_PER_SWEEP
    once = f"Each new {noun} alerts you once, and never again."
    if checking:
        sentence = (f"Checked every {minutes} minutes. {once} If several land between "
                    f"checks, you get {per_check} alert{'' if per_check == 1 else 's'}, "
                    f"for the newest.")
    else:
        sentence = (f"Checks are paused right now; your watches are kept and resume "
                    f"when checks restart. {once}")
    return {
        "type_id": _doc.TYPE_ID,
        "label": "Filing watch",
        "checking": checking,
        "check_every_minutes": minutes,
        "rearm_grain": grain,
        "max_alerts_per_check": per_check,
        "time_cooldown_seconds": None,   # no clock-based cooldown: re-arm is per grain
        "sentence": sentence,
    }


#: type_id -> builder. One entry per member-facing trigger type.
_PUBLISHERS = {
    _doc.TYPE_ID: _document_arrival,
}


def published_cooldowns() -> list[dict[str, Any]]:
    """Every member-facing trigger type's re-arm rule, derived at call time."""
    return [_PUBLISHERS[t]() for t in sorted(_PUBLISHERS)]


def published_cooldown(type_id: str) -> Optional[dict[str, Any]]:
    fn = _PUBLISHERS.get(type_id)
    return fn() if fn else None


def member_create_type_ids(routes: Iterable[Any]) -> set[str]:
    """The trigger types a member can author: every `POST /api/alerts/taxonomy/<type>`
    route (one path segment after the prefix). Admin routes live under
    `/api/admin/...` and never match."""
    out: set[str] = set()
    for r in routes:
        path = getattr(r, "path", "")
        methods = getattr(r, "methods", None) or set()
        if "POST" not in methods or not path.startswith(_CREATE_PREFIX):
            continue
        rest = path[len(_CREATE_PREFIX):]
        if rest and "/" not in rest and "{" not in rest:
            out.add(rest)
    return out


def fire_frequency(
    type_id: str,
    entity_id: str,
    *,
    form_type: Optional[str] = None,
    now: Optional[float] = None,
    window_days: int = FREQUENCY_WINDOW_DAYS,
    db_path: str | None = None,
) -> dict[str, Any]:
    """How often an alert of `type_id` on `entity_id` (with these params) fired
    in the window, from `alert_fires`. See the module docstring for coverage."""
    now = time.time() if now is None else float(now)
    start = now - window_days * 86400.0
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        cov = conn.execute(
            "SELECT MIN(created_at) AS first_created FROM alert_predicates "
            "WHERE type_id = ? AND json_extract(entity_scope, '$.id') = ? "
            "AND json_extract(params, '$.form_type') IS ? "
            "AND created_at <= ? AND (suspended_at IS NULL OR suspended_at >= ?)",
            (type_id, entity_id, form_type, now, start),
        ).fetchone()
        first_created = cov["first_created"] if cov else None
        fired = conn.execute(
            "SELECT COUNT(DISTINCT af.fire_key) AS n, MAX(af.fired_at) AS last_at "
            "FROM alert_fires af JOIN alert_predicates ap ON af.predicate_id = ap.id "
            "WHERE af.trigger_type = ? AND json_extract(ap.entity_scope, '$.id') = ? "
            "AND json_extract(ap.params, '$.form_type') IS ? "
            "AND af.fired_at >= ? AND af.fired_at <= ?",
            (type_id, entity_id, form_type, start, now),
        ).fetchone()
        type_last = conn.execute(
            "SELECT MAX(fired_at) AS last_at FROM alert_fires WHERE trigger_type = ?",
            (type_id,),
        ).fetchone()
    finally:
        conn.close()

    covered = first_created is not None
    return {
        "type_id": type_id,
        "entity_id": entity_id,
        "window_days": window_days,
        "window_start": start,
        "as_of": now,
        "covered": covered,
        "covered_since": max(start, first_created) if covered else None,
        "fires": int(fired["n"]) if covered else None,
        "last_fired_at": fired["last_at"] if covered else None,
        # Liveness of the TYPE (any entity), so "0 for this ticker" can be read
        # against "the sweep has fired for somebody recently". Names no entity.
        "type_last_fired_at": type_last["last_at"] if type_last else None,
        "source": "alert_fires",
    }
