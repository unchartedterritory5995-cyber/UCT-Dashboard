"""S7 FLIP for `catalyst-match` (TERM-025, owner approval 2026-10-10): the
taxonomy rule DELIVERS and the legacy catalyst-engine loops stand down.

ENABLEMENT GATE: `ALERT_TAXONOMY_CATALYST_MATCH_LIVE_ENABLED`, default OFF, read
per call. Off: nothing in this module runs, and `catalyst/engine.py` behaves
byte-for-byte as before (`tests/test_alert_flip_catalyst_match.py` pins it).

THE SHAPE OF THE FLIP, AND WHY IT IS THIS SHAPE
  The legacy emitters are `catalyst/engine.py::_fire_catalyst_alerts` (rule A,
  watchlist) and `_fire_mustknow_alerts` (rule B, must-know, admins only). Each
  is called from the engine's refresh, AFTER its own legacy gate
  (`CATALYST_ALERTS_ENABLED` / `CATALYST_MUSTKNOW_ALERTS_ENABLED`). With this
  flag on, each hands its `displayed` rows here at that same point and returns
  this module's count. So:

  * the DRIVER, the CADENCE and the legacy GATES are unchanged: the taxonomy
    rule is asked exactly when the legacy rule was, about exactly the same rows,
    and it can never fire when the legacy gate is off (new_only stays 0);
  * the DECISION is `catalyst_match.would_fire` with the projection's legacy
    params (`catalyst_match_projection._params`), the same evaluator the shadow
    comparison measured;
  * the DEDUP is the legacy's own atomic claim, `store.try_record_alert`, keyed
    exactly as the legacy keys it (bare ticker for rule A,
    `store.mustknow_dedup_key(ticker)` for rule B, F-S7-5). The fire table the
    compare/projection modules read (`catalyst_alerts_fired`) keeps being
    written, so a mid-day flag toggle in either direction can never send the
    same (user, rule, ticker, day) twice, and the shadow comparison keeps
    reading the dedup state the rule actually decided against;
  * the RECORD is `alert_fires` (`receipts.record_fire`), and DELIVERY is
    `delivery.deliver` (lease, FT-036 routing rule, AC-4 queue caps), which
    calls the same `deliver_alert_payload` with the same title, message,
    source, extra_data and severity ("warning", that function's default, which
    the legacy calls relied on). The member's in-app row is therefore the same
    row, and the legacy durable store (`alert_durability`) keeps it exactly as
    before, so the feed needs no S7 reconstruction branch (a branch would show
    the alert twice).

ONE ALERT PER EVENT: the legacy loop does not run when this does (the engine
returns this module's count before reaching its own loop), and the dedup claim
is shared, so the legacy and the taxonomy path can never both deliver one
(user, rule, ticker, market_date).

KNOWN, NAMED: `would_fire` normalises a grade with `_norm_grade` (first letter)
where the legacy compares `(grade or "").upper()` against the env set. They
differ only for a grade string that is not one of A/B/C/blank, and every stored
grade is written through `synthesize._normalize_grade`, which emits only A/B/C
or None. `test_the_grade_rule_agrees_with_the_legacy_on_every_stored_grade`
pins the agreement on that whole domain.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Iterable

FLAG = "ALERT_TAXONOMY_CATALYST_MATCH_LIVE_ENABLED"

logger = logging.getLogger(__name__)

#: `predicate_id` namespace for live fires. Distinct from the projection's
#: `legacy:` prefix, so a live fire and a dark projected receipt of the same
#: event are never confused in `alert_fires`.
LIVE_PREFIX = "live:"


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def live_predicate_id(user_id: str, match_rule: str) -> str:
    return f"{LIVE_PREFIX}{user_id}:{match_rule}"


def live_fire_key(user_id: str, match_rule: str, ticker: str, market_date: str) -> str:
    """One fire per (user, rule, ticker, market date): the legacy dedup grain,
    with the rule in it (F-S7-5: the two rules must not share a key)."""
    return f"live:{user_id}:{match_rule}:{ticker}:{market_date}"


def _deliver_one(*, user_id: str, rule: str, ticker: str, market_date: str,
                 title: str, message: str, source: str,
                 extra_data: dict[str, Any]) -> bool:
    """Record the fire in `alert_fires` and deliver it through the taxonomy
    delivery path. True when a delivery was attempted for a NEW fire."""
    from api.services.alert_taxonomy import catalyst_match as _cm
    from api.services.alert_taxonomy import delivery as _delivery
    from api.services.alert_taxonomy import receipts as _receipts

    fire_id = _receipts.record_fire(
        predicate_id=live_predicate_id(user_id, rule), trigger_type=_cm.TYPE_ID,
        user_id=user_id, entity_ref=ticker,
        fire_key=live_fire_key(user_id, rule, ticker, market_date),
        detail={"ticker": ticker, "match_rule": rule, "market_date": market_date,
                "source": source},
        source_data_class="catalyst_row", freshness_class="end_of_day",
        as_of=time.time())
    if fire_id is None:
        # Already recorded: the same event cannot be delivered twice.
        return False
    _delivery.deliver(fire_id, user_id, ticker, title, message, source=source,
                      extra_data=extra_data, severity="warning")
    return True


def _rows_by_ticker(displayed: Iterable[dict], *, last_wins: bool) -> dict[str, dict]:
    """Which row's words a ticker listed twice gets. ⛔ The two legacy loops
    DIFFER and each is reproduced: rule A builds a dict comprehension
    (`top_by_ticker`, the LAST row wins), rule B walks the rows and the dedup
    claim skips the repeat (the FIRST row wins)."""
    out: dict[str, dict] = {}
    for c in displayed:
        t = (c.get("ticker") or "").upper()
        if t and (last_wins or t not in out):
            out[t] = c
    return out


def fire_watchlist(displayed: list[dict], market_date: str) -> int:
    """Rule A, delivered by the taxonomy. Called by
    `engine._fire_catalyst_alerts` after its legacy gate; returns the count
    delivered, the same quantity the legacy returned."""
    from api.services.alert_taxonomy import catalyst_match as _cm
    from api.services.alert_taxonomy import catalyst_match_projection as _proj
    from api.services.catalyst import engine as _eng
    from api.services.catalyst import store as _store

    rows = list(displayed or [])
    user_tickers = _eng._collect_user_watchlist_tickers()
    if not rows or not user_tickers:
        return 0
    by_ticker = _rows_by_ticker(rows, last_wins=True)
    params = _proj._params(_cm.RULE_WATCHLIST)
    fired = 0
    for user_id, watched in user_tickers.items():
        for ticker in _cm.would_fire(params, displayed=rows, member_tickers=watched):
            # The legacy's own atomic dedup claim, keyed exactly as it keys it.
            if not _store.try_record_alert(user_id, ticker, market_date):
                continue
            title, message, extra = _eng._watchlist_alert_payload(
                ticker, by_ticker[ticker], market_date)
            try:
                if _deliver_one(user_id=user_id, rule=_cm.RULE_WATCHLIST, ticker=ticker,
                                market_date=market_date, title=title, message=message,
                                source="catalyst_alert", extra_data=extra):
                    fired += 1
            except Exception:  # noqa: BLE001 -- one member never stops the rest
                logger.exception("[catalyst-match live] delivery for %s/%s failed",
                                 user_id, ticker)
    if fired:
        logger.info("[catalyst-match live] fired %d catalyst alerts", fired)
    return fired


def fire_mustknow(displayed: list[dict], market_date: str) -> int:
    """Rule B (admins only), delivered by the taxonomy. Called by
    `engine._fire_mustknow_alerts` after its legacy gate."""
    from api.services.alert_taxonomy import catalyst_match as _cm
    from api.services.alert_taxonomy import catalyst_match_projection as _proj
    from api.services.catalyst import engine as _eng
    from api.services.catalyst import store as _store

    rows = list(displayed or [])
    if not rows:
        return 0
    params = _proj._params(_cm.RULE_GRADE)
    # Cheap first: no admin query when nothing qualifies (the legacy's order).
    if not _cm.would_fire(params, displayed=rows, is_admin=True):
        return 0
    admins = _eng._collect_admin_user_ids()
    if not admins:
        return 0
    # The first QUALIFYING row (the legacy filters by grade, then walks).
    grades = _cm.mustknow_grades()
    by_ticker = _rows_by_ticker([c for c in rows if _cm._norm_grade(c.get("grade")) in grades],
                                last_wins=False)
    fired = 0
    for user_id in admins:
        for ticker in _cm.would_fire(params, displayed=rows, is_admin=True):
            if not _store.try_record_alert(user_id, _store.mustknow_dedup_key(ticker),
                                           market_date):
                continue
            title, message, extra = _eng._mustknow_alert_payload(
                ticker, by_ticker[ticker], market_date)
            try:
                if _deliver_one(user_id=user_id, rule=_cm.RULE_GRADE, ticker=ticker,
                                market_date=market_date, title=title, message=message,
                                source="catalyst_mustknow", extra_data=extra):
                    fired += 1
            except Exception:  # noqa: BLE001
                logger.exception("[catalyst-match live] must-know delivery for %s/%s failed",
                                 user_id, ticker)
    if fired:
        logger.info("[catalyst-match live] fired %d must-know alerts", fired)
    return fired
