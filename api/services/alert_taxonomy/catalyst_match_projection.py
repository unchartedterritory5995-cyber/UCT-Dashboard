"""GATE-S7-CATALYST-MATCH **CP3** (approval line 2, fingerprint `3ee80dc13`) —
the READ-ONLY PROJECTION of real member interest against today's catalyst rows,
`rollout:s7-dark` cohort ONLY, still fully dark.

The packet's **§9 — "What CP3 would have to name"** is the checkpoint
definition, and every one of its five items is answered here:

  1. **Which cohort.** `rollout.cohort_user_ids(S7_DARK)` — S12's tag. ⛔ NOT a
     third `_cohort_user_ids()` holding its own SQL; §9 names that as "the third
     authority" and S12's first migration exists to remove it.
  2. **The reconstruction branch.** Not reached: this projection writes no
     durable alert, so `alerts._s7_durable_alerts` has nothing to reconstruct.
     Stated rather than skipped — it becomes a precondition the moment a real
     fire lands, which is CP4 and the flip, not here.
  3. **`already_fired` from the REAL dedup table.** `catalyst_alerts_fired`,
     read live. ⛔ §9 item 3 is explicit that supplying anything else makes every
     suppressed alert read as `new_only` — see the block below.
  4. **The wire and its rail.** A scheduler entry, a flag defaulting OFF, and
     `test_the_dark_sweep_is_actually_wired_to_a_tick`.
  5. **The cadence: DAILY, not per-minute.** The dedup is per DAY, so a
     per-minute sweep would re-ask a question whose answer cannot change until
     tomorrow — the same call `event-proximity` CP3 made.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ §9 ITEM 3, AND IT CUTS BOTH WAYS
──────────────────────────────────────────────────────────────────────────────

`already_fired` must come from `catalyst_alerts_fired` — the table BOTH legacy
rules write. Two consequences, and the second is the one that bites:

**Supplying nothing** makes every alert the legacy path suppressed look like a
`new_only` — the dark rule "fires" on a name the member already heard about.

**Supplying it naively, AFTER the legacy engine has run today**, makes both
rules see today's rows and both answer "already fired" — the same ordering
hazard `scan_membership_change_projection` documents at length. ⭐ Here it is
milder and the reason is worth stating: this projection runs on a DAILY tick and
`already_fired` is keyed by MARKET DATE, so the honest reconstruction is the set
as it stood **before today's legacy run** — `dedup_keys_before_today()`.

⛔⛔ AND A THIRD THING, FOUND BUILDING THIS: `would_fire`'s `already_fired`
parameter is **RULE-AGNOSTIC** while the legacy dedup namespace is
**RULE-SPECIFIC**. Both branches compare the bare upper-cased ticker, but the
must-know rule's row is stored as `MUSTKNOW:TICKER` (F-S7-5, so an admin who also
WATCHES a name still gets the higher-severity alert). Handing the raw table to
the grade rule compares `AAA` against `MUSTKNOW:AAA`, never matches, and the dark
rule re-fires an alert the legacy suppressed — **a false `new_only`, on exactly
the names an operator cared most about.** `already_fired_for` splits the set per
rule; the prefix is read from `store.MUSTKNOW_DEDUP_PREFIX`, the one declaration.

⭐ That is the harness reproducing WHICH KEY each rule was actually asked about,
not the harness fixing the rule.

──────────────────────────────────────────────────────────────────────────────
⛔ STILL DARK. NOTHING IS ARMED.
──────────────────────────────────────────────────────────────────────────────

This module writes the comparison spans and receipts. It imports no delivery
path and never writes `catalyst_alerts_fired`. The sweep is gated by
`ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED`, **default OFF**.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import rollout as _rollout
from api.services.alert_taxonomy import catalyst_match as _cm
from api.services.alert_taxonomy import catalyst_match_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

_ET = ZoneInfo("America/New_York")

PROJECTED_PREFIX = "legacy:"


def projected_predicate_id(user_id: str, match_rule: str) -> str:
    return f"{PROJECTED_PREFIX}{user_id}:{match_rule}"


def market_date(now: Optional[float] = None) -> str:
    """The tick's own ET date — and for THIS type it is also the dedup key, so
    it has to be the same string `_fire_catalyst_alerts` uses."""
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def cohort_user_ids() -> set[str]:
    """⛔ §9 ITEM 1. S12's tag, through the one authority. A third copy of the
    admin SQL is exactly what the first migration removed."""
    return _rollout.cohort_user_ids(_rollout.S7_DARK)


def member_tickers_for(user_ids: set[str]) -> dict[str, set[str]]:
    """`{user_id: {TICKER}}` for the cohort, from watchlists — **the legacy
    query, narrowed to the cohort.**

    ⛔ `_collect_user_watchlist_tickers` reads `watchlists JOIN watchlist_items`
    and NOTHING ELSE. The type's schema names four member sets
    (`watchlists`, `tags`, `positions`, `uct20`) and `would_fire` refuses every
    one but `watchlists` as pinned-but-unauthorized — so projecting the others
    here would compare the dark rule against a legacy that cannot see them, and
    every extra name would read as `new_only`.
    """
    if not user_ids:
        return {}
    from api.services.auth_db import get_connection

    out: dict[str, set[str]] = {}
    placeholders = ",".join("?" * len(user_ids))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT w.user_id, wi.sym FROM watchlists w "
            "JOIN watchlist_items wi ON wi.watchlist_id = w.id "
            f"WHERE w.user_id IN ({placeholders})",
            tuple(sorted(user_ids)),
        ).fetchall()
    finally:
        conn.close()
    for r in rows:
        row = dict(r)
        uid, sym = row.get("user_id"), row.get("sym")
        if not uid or not sym:
            continue
        out.setdefault(str(uid), set()).add(str(sym).upper())
    return out


def is_admin(user_id: str) -> bool:
    """The must-know rule's own guard. ⛔ `users.role`, the column
    `ADMIN_EMAILS` promotion writes — never a typed list of ids."""
    from api.services.auth_db import get_connection

    conn = get_connection()
    try:
        row = conn.execute("SELECT role FROM users WHERE id = ?",
                           (str(user_id),)).fetchone()
    finally:
        conn.close()
    return bool(row) and dict(row).get("role") == _rollout.LEGACY_S7_ROLE


def displayed_rows(day: str) -> list[dict[str, Any]]:
    """Today's RANKED catalyst rows — what a member actually sees.

    ⛔ `ranked_only=True` is the legacy's own view: `_fire_catalyst_alerts`
    receives `top_n`, the ranked selection, not every row the engine scored.
    Projecting the unranked rows would hand the dark rule a wider world than the
    legacy ever had and manufacture `new_only` out of nothing.
    """
    from api.services.catalyst import store as _store
    return list(_store.get_for_date(day, ranked_only=True) or [])


def dedup_keys_before_today(user_id: str, day: str) -> list[str]:
    """Every dedup key this member was alerted under **before today**, verbatim.

    ⛔⛔ §9 ITEM 3, AND THE ORDERING HAZARD IN ONE FUNCTION. The dedup grain is
    per MARKET DATE, and the legacy engine writes today's rows as it fires. A
    read that included `market_date = day` would hand both rules today's own
    answer, both would suppress, and the tick would record nothing — the same
    shape `scan_membership_change_projection` documents at length.

    ⚠️ `try_record_alert` UPPER-CASES what it stores, so a must-know row comes
    back as `MUSTKNOW:AAA`. That is the store's own normalisation and is not
    undone here — `already_fired_for` handles it.
    """
    from api.services.catalyst import store as _store

    conn = _store._connect()
    try:
        rows = conn.execute(
            "SELECT ticker FROM catalyst_alerts_fired "
            "WHERE user_id = ? AND market_date < ?",
            (str(user_id), str(day))).fetchall()
    finally:
        conn.close()
    return [str(dict(r)["ticker"]) for r in rows]


def already_fired_for(match_rule: str, keys) -> list[str]:
    """The dedup set **in the shape the rule under comparison actually checks**.

    ⛔⛔ A FINDING, AND THE HARNESS HAS TO ABSORB IT. `catalyst_alerts_fired` is
    one table with a RULE-SPECIFIC namespace (F-S7-5): the watchlist rule writes
    the bare ticker, the must-know rule writes `mustknow:TICKER` so that an admin
    who also WATCHES a name still receives the higher-severity alert.

    But `would_fire`'s `already_fired` parameter is **rule-agnostic** — both
    branches compare the bare upper-cased ticker against it. So handing the raw
    table to the grade rule compares `AAA` against `MUSTKNOW:AAA`, never matches,
    and the dark rule re-fires an alert the legacy suppressed: **a false
    `new_only`, on exactly the names an operator cared most about.**

    ⭐ Splitting the set here is not the harness fixing the rule — it is the
    harness reproducing which key each rule was actually asked about. The
    prefix is read from `store.MUSTKNOW_DEDUP_PREFIX`, the one declaration.
    """
    from api.services.catalyst import store as _store

    prefix = _store.MUSTKNOW_DEDUP_PREFIX.upper()
    out: list[str] = []
    for raw in keys:
        k = str(raw).upper()
        if k.startswith(prefix):
            if match_rule == _cm.RULE_GRADE:
                out.append(k[len(prefix):])
        elif match_rule != _cm.RULE_GRADE:
            out.append(k)
    return out


def _params(match_rule: str) -> dict[str, Any]:
    """The legacy rule, as this type's params. ⛔ No narrowing filters: a
    predicate that narrowed would show up as `legacy_only`, which is the column
    that means a member LOSES an alert at the flip."""
    if match_rule == _cm.RULE_WATCHLIST:
        return {"match_rule": _cm.RULE_WATCHLIST, "member_set": _cm.SET_WATCHLISTS,
                "displayed_only": True,
                "dedup_grain": _cm.dedup_grain_for(_cm.RULE_WATCHLIST)}
    return {"match_rule": _cm.RULE_GRADE, "cohort": _cm.COHORT_ADMINS,
            "displayed_only": True,
            "dedup_grain": _cm.dedup_grain_for(_cm.RULE_GRADE)}


def run_projected_comparison(*, now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One DAILY tick over the projected cohort, one span per (member × rule)."""
    now = time.time() if now is None else now
    day = market_date(now)
    cohort = cohort_user_ids()
    if not cohort:
        return {"members": 0, "displayed": 0, "evaluated": 0,
                "outcomes": {}, "fires": 0, "at": now}

    rows = displayed_rows(day)
    tickers = member_tickers_for(cohort)

    outcomes: dict[str, dict[str, int]] = {}
    evaluated = 0
    fires = 0

    for user_id in sorted(cohort):
        mine = tickers.get(user_id, set())
        admin = is_admin(user_id)
        keys = dedup_keys_before_today(user_id, day)
        for rule in _cm.MATCH_RULES:
            pid = projected_predicate_id(user_id, rule)
            params = _params(rule)
            fired = already_fired_for(rule, keys)
            evaluated += 1

            tally = _cmp.observe(pid, params, day, displayed=rows,
                                 member_tickers=mine, is_admin=admin,
                                 already_fired=fired, now=now, db_path=db_path)
            if any(tally.values()):
                outcomes[pid] = tally

            for sym in _cm.would_fire(params, displayed=rows, member_tickers=mine,
                                      is_admin=admin, already_fired=fired):
                _receipts.record_fire(
                    predicate_id=pid, trigger_type=_cm.TYPE_ID, user_id=user_id,
                    entity_ref=sym,
                    # ⛔ The rule is IN the fire key. The two legacy rules write
                    # the same dedup table under different namespaces (F-S7-5),
                    # and collapsing them here would re-create the bug where an
                    # admin who WATCHED a name never got its must-know alert.
                    fire_key=f"proj:{user_id}:{rule}:{sym}:{day}",
                    detail={"ticker": sym, "match_rule": rule, "market_date": day,
                            "projected": True, "dark": True},
                    # A catalyst row is a daily synthesis, not a live quote.
                    source_data_class="catalyst_row", freshness_class="end_of_day",
                    as_of=now, db_path=db_path)
                fires += 1

    return {"members": len(cohort), "displayed": len(rows),
            "evaluated": evaluated, "outcomes": outcomes, "fires": fires,
            "at": now}


def run_dark_sweep(*, now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One DAILY forward tick of the DARK comparison.

    ⛔ THIS IS THE ONLY THING THAT MAKES CP3 MORE THAN A LIBRARY — §9 item 4.

    ⛔ STILL DARK. Comparison spans and receipts only: no delivery import, and it
    never writes `catalyst_alerts_fired`.
    """
    at = time.time() if now is None else now
    out = run_projected_comparison(now=now, db_path=db_path)
    if not out["evaluated"]:
        # ⛔⛔ BEAT ANYWAY. `observe()` carries the heartbeat and is never reached
        # when the cohort is empty, so without this the liveness signal stops
        # exactly when the sweep has nothing to say — indistinguishable from the
        # sweep being dead. **A heartbeat that only beats on success is a success
        # detector**, and on a DAILY clock a missed beat is a missed day.
        _cmp.beat(market_date(at), now=at, db_path=db_path)
    return out
