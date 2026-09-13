"""GATE-S7-SCAN-MEMBERSHIP-CHANGE **CP3** (approval line 2, fingerprint
`d0415f251`) — the READ-ONLY PROJECTION of real member `screen_alert_subs` rows,
`rollout:s7-dark` cohort ONLY, still fully dark.

The packet's §4 row, verbatim:

    **CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY,
    still dark.** ⛔ The cohort is S12's tag, read through
    `api/services/rollout.py:100` `cohort_user_ids(rollout.S7_DARK)` — **never a
    role check**; `rollout.py:29-38` rules that an empty cohort means NO MEMBERS
    and never a fallback to admins. The projection reads `screen_alert_subs`
    **read-only, at evaluation time** — the `price_level_projection` idiom, no
    second table, no sync job.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE ORDERING HAZARD, AND IT WOULD HAVE MADE EVERY NIGHT LOOK QUIET
──────────────────────────────────────────────────────────────────────────────

**The legacy sweep WRITES `screen_alerts_fired`.** Its dedup key is
`(user_id, def_hash, as_of)`, and `run_nightly` inserts tonight's row the moment
it alerts.

`observe()` hands the SAME `already_fired` set to both rules. So a dark run that
read that table AFTER the legacy job would see tonight's `as_of` already present,
both rules would return `deduped`, neither would fire — and the tick would record
**a tally of all zeros, on every single night.** Not agreement, not disagreement:
nothing. A week of that is indistinguishable from a week of quiet markets, which
is the exact failure this whole dark programme exists to avoid.

⭐ **THE FIX IS TO RECONSTRUCT THE STATE THE LEGACY RULE ACTUALLY DECIDED
AGAINST**, not to re-order the jobs. `already_fired_before` returns only the
`as_of` values fired **strictly before tonight's session**, which is precisely
what `screen_alerts_fired` held when `run_nightly` asked its dedup question at
05:10. Both rules then answer the question the legacy rule was really asked.

⛔ This is NOT the harness "fixing" the rule — the rule is unchanged. It is the
harness refusing to feed it an input from its own future.

⚠️ **DECLARED BLIND SPOT:** the legacy job runs at `SWEEP_MINUTE_ET + 10` and
this one at `+ 20`, so a session that becomes covered inside that ten-minute
window would be diffed here and not there. Forward-only over many nights makes
that noise rather than bias, and it is recorded rather than assumed away.

──────────────────────────────────────────────────────────────────────────────
⛔ FINDING B IS STRUCTURAL AND THIS MODULE HAS TO HONOUR IT
──────────────────────────────────────────────────────────────────────────────

`hits_by_as_of` must **DECLARE every covered session as a key**, with an empty
list for a session that matched nothing. A caller who built that map out of
`scan_hits` alone would drop the quiet session's key entirely, and `diff()`
refuses (`undeclared_session`) rather than treat a missing key as "no hits".

⭐ So the map here is keyed **from `scan_coverage`** and filled from
`scan_store.hits`, which returns `[]` for a quiet session by construction. The
one source of the sessions is `recent_covered_as_ofs`, never the hit table.

──────────────────────────────────────────────────────────────────────────────
⛔ STILL DARK. NOTHING IS ARMED.
──────────────────────────────────────────────────────────────────────────────

This module writes the comparison spans and nothing else. It imports no delivery
path and never writes `screen_alerts_fired`. The sweep is gated by
`ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED`, **default OFF**.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import rollout as _rollout
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import scan_membership_change as _smc
from api.services.alert_taxonomy import scan_membership_change_compare as _cmp

_ET = ZoneInfo("America/New_York")

#: ⛔ Namespaced so a projected span can never be confused with a harness-armed
#: predicate's. Same prefix the other projections use, for the same reason.
PROJECTED_PREFIX = "legacy:"


def projected_predicate_id(user_id: str, def_hash: str) -> str:
    return f"{PROJECTED_PREFIX}{user_id}:{def_hash}"


def market_date(now: Optional[float] = None) -> str:
    """The tick's own ET date. ⛔ NOT `date.today()` — the box runs in Chicago
    and the pod in UTC, and `_merged_sessions` counts sessions by this string."""
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def project_cohort_subscriptions() -> list[dict[str, Any]]:
    """Every `screen_alert_subs` row belonging to a member of the
    `rollout:s7-dark` cohort. **One SELECT. Nothing else.**

    ⛔⛔ AN EMPTY COHORT MEANS NO MEMBERS — no fallback to admins, ever
    (`rollout.py:29-38`).

    ⚠️ The cohort lives in **auth.db** (`user_tags`) and the subscriptions live in
    the **screener snapshot db**. Two stores, one join done in Python, because
    there is no cross-database join to do and inventing one would mean copying a
    cohort into the screener store — a second authority over who is in the dark
    run.
    """
    cohort = _rollout.cohort_user_ids(_rollout.S7_DARK)
    if not cohort:
        # ⛔ RETURN EARLY RATHER THAN BUILD AN `IN ()`. An empty cohort and a
        # cohort with no subscriptions are different facts about a dark run, and
        # going through the query would make them identical in the logs.
        return []

    from api.services.screener import screen_alerts as _legacy
    from api.services.screener import snapshot_db as _snap

    _legacy._ensure()
    placeholders = ",".join("?" * len(cohort))
    with _snap.connect() as conn:
        rows = conn.execute(
            "SELECT user_id, def_hash, def_id, name, mode FROM screen_alert_subs "
            f"WHERE user_id IN ({placeholders}) ORDER BY user_id, def_hash",
            tuple(sorted(cohort)),
        ).fetchall()
    return [{"user_id": r["user_id"], "def_hash": r["def_hash"],
             "def_id": r["def_id"], "name": r["name"], "mode": r["mode"]}
            for r in rows]


def params_for(sub: dict[str, Any]) -> dict[str, Any]:
    """A subscription, shaped as this type's params.

    ⛔ `direction` comes from `DIRECTION_BY_MODE`, the mapping pinned beside the
    schema — never restated here. A legacy `mode` outside the vocabulary maps to
    `None`, which `wants()` treats as neither direction, so an unrecognised mode
    is silent rather than silently 'both'.
    """
    return {
        "definition_id": sub["def_hash"],
        "direction": _smc.DIRECTION_BY_MODE.get(sub.get("mode")),
        "timeframe": _smc.LEGACY_TIMEFRAME,
        "dedup_grain": _smc.DEDUP_GRAIN,
    }


def sessions_and_hits(def_hash: str,
                      tf: str = _smc.LEGACY_TIMEFRAME) -> tuple[list[int], dict[int, list[str]]]:
    """`(covered_sessions, hits_by_as_of)` for one definition, read-only.

    ⛔⛔ THE SESSIONS COME FROM `scan_coverage` AND THE MAP IS KEYED FROM THEM.
    Finding B: a swept session that matched nothing writes a coverage row and
    ZERO hit rows, so a map assembled from `scan_hits` would lack that key and
    `diff()` would (correctly) refuse. Keying from coverage means a quiet session
    says so with an empty list.
    """
    from api.services.screener import scan_store

    sessions = [int(s) for s in
                scan_store.recent_covered_as_ofs(def_hash, tf,
                                                 limit=_smc.SESSIONS_REQUIRED)]
    hits_by_as_of = {s: list(scan_store.hits(def_hash, tf, s)) for s in sessions}
    return sessions, hits_by_as_of


def already_fired_before(user_id: str, def_hash: str,
                         as_of: Optional[int]) -> list[int]:
    """The sessions this member was ALREADY alerted about for this definition,
    **strictly before `as_of`**.

    ⛔⛔ THE `<` IS THE WHOLE POINT — see the module docstring. Reading the table
    without it, after the legacy job has written tonight's row, makes both rules
    answer `deduped` and records a tally of zeros every night.
    """
    from api.services.screener import screen_alerts as _legacy
    from api.services.screener import snapshot_db as _snap

    _legacy._ensure()
    with _snap.connect() as conn:
        if as_of is None:
            rows = conn.execute(
                "SELECT as_of FROM screen_alerts_fired WHERE user_id=? AND def_hash=?",
                (str(user_id), str(def_hash))).fetchall()
        else:
            rows = conn.execute(
                "SELECT as_of FROM screen_alerts_fired WHERE user_id=? AND def_hash=? "
                "AND as_of < ?", (str(user_id), str(def_hash), int(as_of))).fetchall()
    return [int(r["as_of"]) for r in rows]


def run_projected_comparison(*, now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One nightly tick over the projected cohort, one span per subscription."""
    now = time.time() if now is None else now
    day = market_date(now)
    subs = project_cohort_subscriptions()

    outcomes: dict[str, dict[str, int]] = {}
    evaluated = 0
    fires = 0
    for sub in subs:
        pid = projected_predicate_id(sub["user_id"], sub["def_hash"])
        params = params_for(sub)
        sessions, hits_by_as_of = sessions_and_hits(sub["def_hash"],
                                                    params["timeframe"])
        tonight = sessions[0] if sessions else None
        fired = already_fired_before(sub["user_id"], sub["def_hash"], tonight)
        evaluated += 1

        tally = _cmp.observe(pid, params, day,
                             covered_sessions=sessions,
                             hits_by_as_of=hits_by_as_of,
                             already_fired=fired,
                             now=now, db_path=db_path)
        if any(tally.values()):
            outcomes[pid] = tally

        # ⛔ ONE RECEIPT PER ALERT, NEVER PER SYMBOL. The legacy dedup grain is
        # (user, definition, SESSION), so a night in which five names moved is
        # ONE alert naming five. A receipt per name would multiply this member's
        # dark record fivefold against a legacy record of one, and the flip would
        # be read against a number that never existed.
        decision = _smc.would_fire(params, covered_sessions=sessions,
                                   hits_by_as_of=hits_by_as_of,
                                   already_fired=fired)
        if decision["fires"]:
            _receipts.record_fire(
                predicate_id=pid, trigger_type=_smc.TYPE_ID,
                user_id=sub["user_id"],
                # The alert is about a DEFINITION, not a symbol; the names that
                # moved are the detail, and they are what a member would read.
                entity_ref=sub["def_hash"],
                fire_key=f"proj:{sub['user_id']}:{sub['def_hash']}:{decision['as_of']}",
                detail={"definition_id": sub["def_hash"], "name": sub.get("name"),
                        "as_of": decision["as_of"],
                        "entered": decision["entered"], "exited": decision["exited"],
                        "direction": params["direction"],
                        "projected": True, "dark": True},
                # ⛔ A nightly scan snapshot is END-OF-DAY, not real_time. Saying
                # otherwise would put a false freshness on every row of the dark
                # record, and D1's enum exists to stop exactly that.
                source_data_class="scan_snapshot", freshness_class="end_of_day",
                as_of=now, db_path=db_path)
            fires += 1

    return {"members": len({s["user_id"] for s in subs}),
            "subscriptions": len(subs), "evaluated": evaluated,
            "outcomes": outcomes, "fires": fires, "at": now}


def run_dark_sweep(*, now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One NIGHTLY forward tick of the DARK comparison.

    ⛔ THIS IS THE ONLY THING THAT MAKES CP3 MORE THAN A LIBRARY. `price-level`
    CP3 shipped for one commit with its evaluator called by nothing — built,
    tested, green and unreachable.

    ⛔ STILL DARK. It writes comparison spans and nothing else: no delivery
    import, and it never writes `screen_alerts_fired`.
    """
    at = time.time() if now is None else now
    subs = project_cohort_subscriptions()
    if not subs:
        # ⛔⛔ BEAT ANYWAY. `observe()` carries the heartbeat and is never reached
        # when there is nothing to project, so without this the liveness signal
        # would stop exactly when the sweep had nothing to say — indistinguishable
        # from the sweep being dead. **A heartbeat that only beats on success is a
        # success detector**, and on a NIGHTLY clock most nights are quiet.
        _cmp.beat(market_date(at), now=at, db_path=db_path)
        return {"members": 0, "subscriptions": 0, "evaluated": 0,
                "outcomes": {}, "fires": 0, "at": at}
    return run_projected_comparison(now=now, db_path=db_path)
