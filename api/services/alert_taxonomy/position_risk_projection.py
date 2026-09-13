"""GATE-S7-POSITION-RISK **CP3** (approval line 2, fingerprint `ec2b197f8`) —
the READ-ONLY PROJECTION of real member `j2_positions` rows, `rollout:s7-dark`
cohort ONLY, still fully dark.

The packet's §4 row, verbatim:

    **CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY,
    still dark.** ⛔ The cohort is S12's tag, read through
    `api/services/rollout.py:100` `cohort_user_ids(S7_DARK)` — **never a role
    check**; the role checks were deleted and `rollout.py:29-38` rules that an
    empty cohort means NO MEMBERS and never a fallback to admins.

──────────────────────────────────────────────────────────────────────────────
⛔ THE GRAIN IS (USER, SEVERITY) — NOT (POSITION), AND THE LEGACY RULE DECIDES THAT
──────────────────────────────────────────────────────────────────────────────

`price-level` projects ONE predicate per `watchlist_alerts` row, because a
legacy price alert **is** a row. `rule_stop_watch` is not row-shaped: it takes
`user_ctx['positions']` — a member's whole open book — and emits one candidate
per qualifying position, with the cooldown keyed per `(symbol, kind)`.

⭐ So the projected predicate is **one per (cohort member × absorbed
severity)**, which is exactly the call shape `position_risk_compare.observe()`
and `legacy_would_fire()` already take. That is not a convenience: it means the
comparison drives **the real `rule_stop_watch`** over the real book, rather than
a per-row reconstruction of it that would have to re-implement the fan-out and
could disagree about it silently.

⛔ A per-position grain would also make `legacy_only` unreadable. The legacy
rule's output for a member is a SET of symbols; splitting it across N predicates
and re-summing is arithmetic nobody asked for, and it would report a member who
holds six positions as six times more agreement than one who holds one.

──────────────────────────────────────────────────────────────────────────────
⛔ WHAT `legacy_only` MEANS FOR THIS TYPE, AND IT IS NOT A MISSING CARD
──────────────────────────────────────────────────────────────────────────────

`awareness/engine.py`'s `_DELIVER_IMPORTANCE_FLOOR = 8`, and `stop_hit` always
scores 10 with a symbol — so **every stop breach already emails and Discords the
member today**. A `legacy_only` row here is an email and a push notification a
member STOPS RECEIVING at the flip, not an in-app card they have to go looking
for. That is why the four outcomes are never collapsed into a rate.

──────────────────────────────────────────────────────────────────────────────
⛔ AGGREGATE_HEAT IS PROJECTED AND IS NOT COMPARED
──────────────────────────────────────────────────────────────────────────────

Only `ABSORBED_SEVERITIES` are projected. `aggregate_heat` has no incumbent —
no schedule, no delivery, nothing to be `legacy_only` against — and CP2 already
rules that a tick for it is one `not_comparable` with reason `no_incumbent`.
Projecting it here would manufacture a per-member stream of that same fact once
a minute, which is noise wearing the shape of evidence.

──────────────────────────────────────────────────────────────────────────────
⛔ STILL DARK. NOTHING IS ARMED.
──────────────────────────────────────────────────────────────────────────────

This module writes `alert_fires` + receipts and the comparison spans. It imports
no delivery path; `test_the_projection_never_reaches_a_delivery_path` asserts
that from the SOURCE rather than from this sentence. The sweep is gated by
`ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED`, **default OFF**, and arming it is
the owner's flip.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import position_risk as _pr
from api.services.alert_taxonomy import position_risk_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

_ET = ZoneInfo("America/New_York")

#: ⛔ Namespaced so a projected fire can never be confused with a harness-armed
#: predicate's. Same prefix `price_level_projection` uses, for the same reason.
PROJECTED_PREFIX = "legacy:"


def projected_predicate_id(user_id: str, severity: str) -> str:
    return f"{PROJECTED_PREFIX}{user_id}:{severity}"


def market_date(now: Optional[float] = None) -> str:
    """The tick's own ET date.

    ⛔ NOT `date.today()`. The box runs in Chicago and the pod in UTC; a session
    count stamped with either would drift from the market day the comparison is
    actually measuring, and `_merged_sessions` counts sessions by this string.
    """
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def project_cohort_positions() -> dict[str, list[dict[str, Any]]]:
    """Every OPEN position belonging to a member of the `rollout:s7-dark`
    cohort, in `rule_stop_watch`'s own row shape. **One SELECT. Nothing else.**

    ⛔ The query is `engine._bulk_load_user_contexts`' query with a cohort
    predicate bolted on — the same columns, the same `closed_at IS NULL`, the
    same upper-casing and the same falsy-symbol skip. Anything else would make
    the two sides disagree about the POPULATION, and a comparison whose two
    halves look at different rows measures nothing.

    ⛔⛔ AN EMPTY COHORT MEANS NO MEMBERS — no fallback to admins, ever
    (`rollout.py:29-38`). The swap is a no-op only because `main.py` seeds the
    tag from the role at boot.
    """
    cohort = _rollout.cohort_user_ids(_rollout.S7_DARK)
    if not cohort:
        # ⛔ RETURN EARLY RATHER THAN BUILD AN `IN ()`. SQLite reads an empty
        # `IN ()` as "match nothing", which is the right answer — but going
        # through the query makes an empty cohort and a cohort holding no open
        # positions indistinguishable in the logs, and those are different facts
        # about a dark run.
        return {}

    conn = _auth_db.get_connection()
    try:
        placeholders = ",".join("?" * len(cohort))
        rows = conn.execute(
            "SELECT user_id, symbol, side, entry_price, stop_price, source "
            f"FROM j2_positions WHERE closed_at IS NULL AND user_id IN ({placeholders})",
            tuple(sorted(cohort)),
        ).fetchall()
    finally:
        conn.close()

    by_user: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        row = dict(r)
        sym = (row.get("symbol") or "").upper()
        if not sym:
            continue          # `engine.py` skips it too; mirrored, not improved
        by_user.setdefault(row["user_id"], []).append({
            "symbol": sym,
            "side": row.get("side"),
            "entry_price": row.get("entry_price"),
            "stop_price": row.get("stop_price"),
            "source": row.get("source"),
        })
    return by_user


def projected_symbols() -> list[str]:
    """Every symbol the sweep will need a price for, deduped and sorted.

    ⭐ Derived from the projection rather than from `j2_positions` directly, so
    the cohort gate is applied exactly once and cannot be forgotten here.
    """
    out: set[str] = set()
    for positions in project_cohort_positions().values():
        for p in positions:
            if p.get("symbol"):
                out.add(p["symbol"])
    return sorted(out)


def _prices_for(symbols: list[str]) -> tuple[dict[str, float], list[str]]:
    """Resolve a price per symbol: the SHARED live-price cache first, one
    bounded batch fetch for the misses.

    ⭐ Cache-first is the load argument, not an optimisation: `live_px1_*` is
    already populated by `/api/live-prices` on the 15 s poll, and it is **the
    same cache the legacy rule reads** (`engine._build_market_scan_ctx`). Both
    sides therefore see one price snapshot, which is what makes an outcome a
    statement about the RULES rather than about two different market moments.

    ⛔ The fallback is bounded and never raises: a provider hiccup costs this
    sweep a tick, never the scheduler thread and never a member request.

    Returns `(prices, missing)`. ⭐ `missing` is RETURNED, not swallowed — a
    symbol the cache did not hold is a blind spot, and `unpriced_symbols`
    classifies it `not_comparable`. A sweep that quietly saw no price for half
    the cohort would otherwise bank agreement about ticks that never happened.
    """
    prices: dict[str, float] = {}
    missing: list[str] = []

    try:
        from api.routers.live_prices import cache as _px_cache, _px_key
    except Exception:
        _px_cache = _px_key = None

    for sym in symbols:
        px = None
        if _px_cache is not None:
            try:
                hit = _px_cache.get(_px_key(sym))
                px = (hit or {}).get("price") if hit else None
            except Exception:
                px = None
        if px:
            prices[sym] = float(px)
        else:
            missing.append(sym)

    if missing:
        try:
            from api.services import massive as _massive
            rich = _massive._get_client().get_batch_rich_snapshots(missing) or {}
            # ⛔ The provider keys its answer by CANONICAL UPPERCASE ticker.
            # `project_cohort_positions` already upper-cases, so this is belt and
            # braces — but the lookup is written to survive a future projection
            # that does not, because a miss here is indistinguishable from a
            # quiet market unless it is mapped back and reported.
            still: list[str] = []
            for sym in missing:
                row = rich.get(sym) or rich.get(sym.upper()) or {}
                px = row.get("price")
                if px:
                    prices[sym] = float(px)
                else:
                    still.append(sym)
            missing = still
        except Exception:
            pass          # bounded: the misses stay missing and are REPORTED

    return prices, missing


def run_projected_comparison(price_map: dict[str, float], *,
                             now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One forward tick over the projected cohort.

    Per (member × absorbed severity):
      1. `observe()` opens the span if absent, detects a params rewrite, drives
         BOTH rules at the same instant on the same positions and the same price
         snapshot, and records one of the four outcomes;
      2. any symbol the DARK rule fires on is written as a receipt + `alert_fires`
         row, marked `projected` and `dark`.

    ⛔ The params never change for a projected predicate — `{"severity": …}` is
    all of them — so the `params_change` path cannot fire here. That is stated
    rather than removed: `observe()` is shared with the harness, where params do
    change, and a projection that silently depended on its own params being
    constant would break the day somebody widened it.
    """
    now = time.time() if now is None else now
    day = market_date(now)
    by_user = project_cohort_positions()
    prices = dict(price_map or {})

    outcomes: dict[str, dict[str, int]] = {}
    fires = 0
    evaluated = 0

    for user_id in sorted(by_user):
        positions = by_user[user_id]
        for severity in _pr.ABSORBED_SEVERITIES:
            pid = projected_predicate_id(user_id, severity)
            params = {"severity": severity}
            evaluated += 1

            tally = _cmp.observe(pid, params, day, positions=positions,
                                 live_prices=prices, now=now, db_path=db_path)
            if any(tally.values()):
                outcomes[pid] = tally

            for sym in _pr.would_fire(params, positions=positions,
                                      live_prices=prices):
                _receipts.record_fire(
                    predicate_id=pid, trigger_type=_pr.TYPE_ID, user_id=user_id,
                    entity_ref=sym,
                    # ⛔ The fire key carries the SEVERITY as well as the symbol.
                    # The legacy dedup grain is `(symbol, kind)` — `stop_hit` and
                    # `stop_proximity` are separate keys there precisely so a
                    # proximity warning cannot suppress the breach that follows
                    # it. Dropping the severity here would re-create that bug in
                    # the dark store.
                    fire_key=f"proj:{user_id}:{sym}:{severity}:{int(now)}",
                    triggering_value=prices.get(sym),
                    detail={"symbol": sym, "severity": severity,
                            "projected": True, "dark": True},
                    source_data_class="quote", freshness_class="real_time",
                    as_of=now, db_path=db_path)
                fires += 1

    return {"members": len(by_user), "evaluated": evaluated,
            "outcomes": outcomes, "fires": fires, "at": now}


def run_dark_sweep(*, now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One forward tick of the DARK comparison over the `rollout:s7-dark` cohort.

    ⛔ THIS IS THE ONLY THING THAT MAKES CP3 MORE THAN A LIBRARY. `price-level`
    CP3 shipped for one commit with its evaluator called by nothing — built,
    tested, green and unreachable, this repo's most-repeated defect. A dark run
    that never runs produces five sessions of nothing and reads, next weekend,
    exactly like five sessions of agreement.

    ⛔ STILL DARK. No delivery import exists in this module or the two it drives.
    """
    at = time.time() if now is None else now
    symbols = projected_symbols()

    if not symbols:
        # ⛔⛔ BEAT ANYWAY. `observe()` carries the heartbeat, and `observe()` is
        # never reached when the cohort is empty or holds no open positions — so
        # without this line the liveness signal would stop exactly when the sweep
        # had nothing to say, which is indistinguishable from the sweep being
        # dead. **A heartbeat that only beats on success is a success detector.**
        _cmp.beat(market_date(at), now=at, db_path=db_path)
        return {"members": 0, "evaluated": 0, "outcomes": {}, "fires": 0,
                "priced": 0, "no_price": [], "at": at}

    prices, missing = _prices_for(symbols)
    out = run_projected_comparison(prices, now=now, db_path=db_path)
    out["priced"] = len(prices)
    out["no_price"] = missing
    return out
