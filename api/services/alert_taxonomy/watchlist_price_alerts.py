"""TERM-048 (FB-A12-01) -- watchlist price alerts onto S7's receipt and lease.

DARK BY DEFAULT. `WATCHLIST_ALERTS_S7_ENABLED` unset (or anything but "1")
means `watchlist_alert_service.check_alerts_against_prices` delivers exactly as
it did before this module existed: it asks `enabled()` once per cycle and never
touches the receipt store (rail: `tests/test_term048_watchlist_alerts_s7.py`).

What turning it ON changes, and ONLY this
──────────────────────────────────────────
A crossing the LEGACY checker already decided to fire (same predicate, same
15 s poll, same `_trigger_alert` deactivate-first ordering) is routed through
S7's receipt store before any channel runs:

  1. `receipts.record_fire` writes ONE `alert_fires` row -- the durable member
     alert record (never `user_alerts`) -- under a DETERMINISTIC key per
     legacy row. `UNIQUE(predicate_id, fire_key)` is therefore a fire-once
     guarantee that holds ACROSS PROCESSES, which the legacy lane never had:
     `_trigger_alert`'s UPDATE is not a compare-and-set, so two checkers that
     both selected the row before either deactivated it both delivered.
  2. `receipts.claim_delivery` takes the lease -- the same compare-and-set
     every other S7 fire is delivered under.
  3. The member is told by the UNCHANGED `_deliver_alert` -- same bell entry,
     same email, same (retired) Discord leg -- so browser notification and
     sound, which the bell derives from one new feed id, fire once as today.
  4. `receipts.record_delivery_channels` stamps the per-channel outcome onto
     the fire's own row, so "triggered" and "delivered" are one queryable fact
     instead of one log line.

What it deliberately does NOT change
────────────────────────────────────
  * THE PREDICATE. This is the legacy LEVEL test, one-shot -- not S7
    price-level's CROSS evaluator (`price_level._crossed`). Which of the two
    rules members get is the owner's CP4/FLIP ruling (CARD 9's predicate is
    owner-held); `detail.rule` records which one produced every fire so the
    dark comparison's fires and these can never be confused.
  * THE STORE OF ARMED ALERTS. `watchlist_alerts` stays the one authority.
    Following the CP3 ruling "PROJECTION, NOT MIRROR", no `alert_predicates`
    row is created: a predicate id is DERIVED from the legacy row id
    (`watchlist:<id>`), exactly as the dark projection derives `legacy:<id>`.
    A second table of member alerts would be a second authority, and
    `alert_predicates`' one-active-per-(user, type, entity) index could not
    hold a member's "above 100" and "below 90" on the same symbol anyway.
  * THE FEED. `alerts._s7_durable_alerts` has no price-level branch, so these
    receipts never produce a second bell row (rail:
    `tests/test_term048_watchlist_alerts_s7.py`).

⛔ FIRE-ONCE DEPENDS ON ROWS BEING ONE-SHOT. The fire key carries no arm
generation because nothing re-arms a `watchlist_alerts` row (no UPDATE sets
`is_active = 1`). A re-arm path would make its second crossing collide with
the first receipt and be SWALLOWED; the rail
`test_nothing_re_arms_a_watchlist_alert_row` fails by name the day one lands,
and the fix is to put the arm generation into `fire_key_for`.
"""
from __future__ import annotations

import os
from typing import Any, Optional

from api.services.alert_taxonomy import receipts as _receipts

FLAG = "WATCHLIST_ALERTS_S7_ENABLED"

#: Namespaces a live watchlist fire apart from the dark projection's
#: `legacy:<id>` comparison fires, so the dark verdict never counts a live one.
PREDICATE_PREFIX = "watchlist:"

#: `price_level.TYPE_ID` and `price_level.FIXED`, restated ON PURPOSE and pinned
#: equal by `tests/test_term048_watchlist_alerts_s7.py`. Importing `price_level`
#: here would pull it (and the predicate / entity-resolution stack behind it)
#: into flow-worker's import closure through `watchlist_alert_service`, which
#: `tests/test_flow_worker_watch_coverage.py` forbids under the CP3 ruling.
TRIGGER_TYPE = "price-level"
DEFAULT_LEVEL_KIND = "price"

#: Written into every receipt's `detail.rule`. The S7 price-level evaluator's
#: own fires carry no such key; these name the rule that actually decided.
LEGACY_RULE = "legacy_level_one_shot"


def enabled() -> bool:
    """Read PER CALL, never captured at import: a rollback is an env change,
    not a redeploy. Strictly "1" -- a typo must fall to the current behaviour."""
    return os.environ.get(FLAG, "0") == "1"


def predicate_id_for(legacy_id: Any) -> str:
    return f"{PREDICATE_PREFIX}{legacy_id}"


def fire_key_for(legacy_id: Any) -> str:
    """DETERMINISTIC per legacy row -- no timestamp, no price. Two checkers that
    both saw the row armed must produce the SAME key, or the unique constraint
    stops being the duplicate guard it is here to be."""
    return f"fire:{legacy_id}"


def open_fire(alert: dict[str, Any], price: float, level: Optional[float], now: float,
              *, db_path: str | None = None) -> Optional[int]:
    """Record the fire and claim its delivery lease.

    Returns the fire id iff THIS call owns the delivery. Returns None when the
    fire is already recorded or already claimed -- a duplicate; the caller must
    deliver NOTHING. Raises if the store itself fails, so the caller can tell
    "somebody else owns it" apart from "the receipt could not be written"."""
    legacy_id = alert["id"]
    fire_id = _receipts.record_fire(
        predicate_id=predicate_id_for(legacy_id),
        trigger_type=TRIGGER_TYPE,
        user_id=alert.get("user_id"),
        entity_ref=alert.get("sym"),
        fire_key=fire_key_for(legacy_id),
        triggering_value=float(price),
        detail={
            "symbol": alert.get("sym"),
            "legacy_alert_id": legacy_id,
            "level": level,
            "target_price": alert.get("target_price"),
            "direction": alert.get("direction"),
            "level_kind": alert.get("alert_type") or DEFAULT_LEVEL_KIND,
            "drawing_id": alert.get("drawing_id"),
            "rule": LEGACY_RULE,
            "source": "watchlist_alert",
        },
        source_data_class="quote",
        # ⛔ Honest None (D1's "not established"): the poll's price can be a
        # vendor snapshot or a breadth pseudo-quote, and this lane never learned
        # which. Stamping "real_time" would be a guess recorded as a fact.
        freshness_class=None,
        as_of=float(now),
        db_path=db_path,
    )
    if fire_id is None:
        return None
    if not _receipts.claim_delivery(fire_id, db_path=db_path):
        return None
    return fire_id


def close_fire(fire_id: int, report: dict[str, Any], *, db_path: str | None = None) -> None:
    """Stamp the per-channel outcome on the fire's own row. Never releases the
    lease: this lane does not retry, exactly as `_deliver_alert` never did."""
    _receipts.record_delivery_channels(fire_id, dict(report.get("channels") or {}),
                                       db_path=db_path)
