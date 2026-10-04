"""S7 trigger type `rating-change` (FT-034): an analyst upgrade / downgrade on
a ticker the member named.

Built on document-arrival's exact shape -- the second S7 type that DELIVERS --
because it is the same problem: a per-ticker feed with no "have I seen this"
state, so this module is that watermark.

THE RULES (each one is a test in tests/test_alert_rating_change.py):
  * ⛔ THE DURABLE RECORD IS `alert_fires`, NEVER `user_alerts`. Every fire
    goes through `receipts.record_fire` (UNIQUE(predicate_id, fire_key) is
    the dedup), then `delivery.deliver` (lease, FT-036 routing, AC-4 caps).
  * ⛔ NO HISTORY REPLAY. A new predicate's baseline is the newest action that
    already existed at registration -- nothing published before the member
    asked is ever reported as new.
  * ONE SOURCE: `analyst_grades._recent_actions` (FMP `/stable/grades`), the
    same normalised feed the research page's Analyst Ratings tab shows, so an
    alert can never describe an action the member cannot find there.
  * Fetched once per DISTINCT ticker per sweep (SPEC §18 batching), never per
    predicate; one bad predicate never aborts the cycle.
  * Only `upgrade` / `downgrade` fire by default (`actions` param); a
    `maintain` / `initiate` is not a rating CHANGE.
  * A provider failure is COULD-NOT-EVALUATE (AC-7 receipt), never "no change".

DARK: `ALERT_RATING_CHANGE_ENABLED` (default off, read per call). Off: the
routes 404 and the sweep (registered unconditionally) does nothing. Suspend
is `suspended_at`, never a DELETE.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from api.services.alert_taxonomy import delivery as _delivery
from api.services.alert_taxonomy import ops_monitor as _ops
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import registry as _registry
from api.services.alert_taxonomy.predicates import PredicateRegistrationError

TYPE_ID = "rating-change"
FLAG = "ALERT_RATING_CHANGE_ENABLED"
SWEEP_EVERY_MINUTES = 30
DEFAULT_ACTIONS = ("upgrade", "downgrade")
ALLOWED_ACTIONS = ("upgrade", "downgrade", "initiate", "maintain")
PARAMS_SCHEMA = {
    "actions": "list[str] -- which analyst actions fire; default ['upgrade', 'downgrade']",
}


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def register() -> None:
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__)


def _default_fetch(ticker: str) -> dict:
    """{"items": [...]} newest-first, or {"error": str}. Never raises."""
    try:
        from api.services import analyst_grades
        out = analyst_grades._recent_actions(ticker)
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}
    meta = out.get("_meta") or {}
    items = out.get("items") or []
    if not items and (meta.get("error") or meta.get("outage")):
        return {"error": str(meta.get("error") or "provider outage")}
    return {"items": items}


def action_key(a: dict) -> str:
    """The ONE place an action's identity (and so its fire key) is built."""
    return "|".join(str(a.get(k) or "") for k in ("date", "company", "action", "from_grade", "to_grade"))


def _clean_actions(actions) -> list[str]:
    acts = [str(a).strip().lower() for a in (actions or DEFAULT_ACTIONS)]
    bad = [a for a in acts if a not in ALLOWED_ACTIONS]
    if bad or not acts:
        raise PredicateRegistrationError(
            f"rating-change: actions must be from {', '.join(ALLOWED_ACTIONS)}")
    return sorted(set(acts))


def register_predicate_for_user(user_id: str, ticker: str, *, actions=None,
                                fetch: Callable[[str], dict] | None = None) -> str:
    ticker = (ticker or "").upper().strip()
    if not ticker:
        raise PredicateRegistrationError("ticker is required")
    acts = _clean_actions(actions)
    fetch = fetch or _default_fetch
    baseline = fetch(ticker)
    if "error" in baseline:
        raise PredicateRegistrationError(
            f"rating-change: analyst actions for {ticker} could not be read ({baseline['error']})")
    entity_scope = _predicates.resolve_entity_scope(ticker)
    pid = _predicates.register_predicate(TYPE_ID, entity_scope, {"actions": acts}, user_id, None)
    items = baseline.get("items") or []
    _predicates.update_last_seen_state(pid, _watermark(items))
    return pid


def _watermark(items: list[dict]) -> dict:
    """The ONE place the watermark is built: the newest action's key AND its
    date. The date is the floor that keeps "no history replay" true when the
    keyed action has aged out of the provider's window."""
    if not items:
        return {"key": None, "date": None}
    return {"key": action_key(items[0]), "date": str(items[0].get("date") or "")[:10] or None}


def _as_of(date: str) -> float:
    try:
        return datetime.strptime(date[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return time.time()


def _new_actions(items: list[dict], last_key: Optional[str],
                 last_date: Optional[str] = None) -> list[dict]:
    """Actions newer than the watermark (items are newest-first).

    Stops at the keyed action, OR at the first action dated BEFORE the
    watermark's date -- without the date floor, a watermark whose action has
    aged out of the feed would make every item "new" and replay history."""
    out = []
    for a in items:
        if last_key is not None and action_key(a) == last_key:
            break
        if last_date and str(a.get("date") or "")[:10] < last_date:
            break
        out.append(a)
    return out


def _evaluate_one(p: dict, cache: dict, fetch) -> dict:
    ticker = p["entity_scope"].get("symbol") or p["entity_scope"].get("id")
    if ticker not in cache:
        cache[ticker] = fetch(ticker)
    res = cache[ticker]
    if "error" in res:
        return {"predicate_id": p["id"], "outcome": "error", "error": res["error"]}
    items = res.get("items") or []
    seen = p.get("last_seen_state") or {}
    fresh = _new_actions(items, seen.get("key"), seen.get("date"))
    if not items or not fresh:
        return {"predicate_id": p["id"], "outcome": "no_change"}
    _predicates.update_last_seen_state(p["id"], _watermark(items))
    wanted = set((p.get("params") or {}).get("actions") or DEFAULT_ACTIONS)
    hits = [a for a in fresh if (a.get("action") or "") in wanted]
    if not hits:
        return {"predicate_id": p["id"], "outcome": "no_change"}
    a = hits[0]                      # newest matching action -- one fire per sweep
    fire_key = f"grade:{action_key(a)}"
    fire_id = _receipts.record_fire(
        predicate_id=p["id"], trigger_type=TYPE_ID, user_id=p["user_id"],
        entity_ref=p["entity_scope"].get("id"), fire_key=fire_key,
        detail={"ticker": ticker, **{k: a.get(k) for k in
                                     ("date", "company", "action", "from_grade", "to_grade")},
                "also_new": len(hits) - 1},
        source_data_class="analyst_grades", freshness_class="end_of_day",
        as_of=_as_of(a.get("date") or ""))
    if fire_id is None:
        return {"predicate_id": p["id"], "outcome": "dedup_collision"}
    title, message = _texts(ticker, a)
    report = _delivery.deliver(fire_id, p["user_id"], ticker, title, message,
                               source="rating_change",
                               extra_data={"sym": ticker, "research_url": f"/research/{ticker}",
                                           "action": a.get("action"), "company": a.get("company"),
                                           # the feed's cross-store dedup + read-parity key
                                           "s7_fire_key": fire_key},
                               severity="info")
    return {"predicate_id": p["id"], "outcome": "fired", "fire_id": fire_id, "delivery": report}


def _texts(ticker: str, d: dict) -> tuple[str, str]:
    """The ONE place a rating-change alert's words are built (live + reconstructed)."""
    verb = {"upgrade": "upgraded", "downgrade": "downgraded"}.get(d.get("action"), d.get("action"))
    grades = " to ".join(g for g in (d.get("from_grade"), d.get("to_grade")) if g)
    title = f"{ticker} {verb} by {d.get('company') or 'an analyst'}"
    message = (f"{d.get('company') or 'An analyst'} {verb} {ticker}"
               + (f" ({grades})" if grades else "")
               + f" on {d.get('date') or 'an unknown date'}.")
    return title, message


def alert_shape_for_fire(fire: dict[str, Any]) -> dict[str, Any]:
    """The feed's durable reconstruction (the S7 in-app bridge), from the fire's
    OWN frozen `detail` -- never a fresh provider lookup, so a historical alert
    describes the action that fired."""
    from zoneinfo import ZoneInfo
    d = fire.get("detail") or {}
    ticker = d.get("ticker") or fire.get("entity_ref") or ""
    title, message = _texts(ticker, d)
    fired_at = fire.get("fired_at")
    ts = (datetime.fromtimestamp(fired_at, tz=ZoneInfo("America/New_York")).isoformat()
          if fired_at else "")
    return {
        "id": f"s7fire_{fire['id']}",
        "type": TYPE_ID.replace("-", "_"),
        "severity": "info",
        "title": title,
        "message": message,
        "timestamp": ts,
        "read": fire.get("read_at") is not None,
        "user_id": fire.get("user_id"),
        "data": {"symbol": ticker, "sym": ticker, "source": "rating_change",
                 "research_url": f"/research/{ticker}", "action": d.get("action"),
                 "company": d.get("company"), "s7_fire_key": fire.get("fire_key")},
    }


def run_sweep(*, fetch: Callable[[str], dict] | None = None) -> dict[str, Any]:
    if not is_enabled():
        return {"enabled": False, "checked": 0, "fired": 0, "errors": []}
    fetch = fetch or _default_fetch
    active = _predicates.list_predicates(type_id=TYPE_ID, active_only=True)
    cache: dict[str, dict] = {}
    results = []
    for p in active:
        try:
            results.append(_evaluate_one(p, cache, fetch))
        except Exception as e:  # noqa: BLE001 -- one bad predicate never aborts the cycle
            results.append({"predicate_id": p.get("id"), "outcome": "error", "error": str(e)})
    fired = sum(1 for r in results if r["outcome"] == "fired")
    errors = [r for r in results if r["outcome"] == "error"]
    _ops.record_sweep(TYPE_ID, evaluated=len(active) - len(errors), fired=fired,
                      could_not_evaluate=len(errors))
    return {"enabled": True, "checked": len(active), "distinct_fetches": len(cache),
            "fired": fired, "errors": errors, "results": results}
