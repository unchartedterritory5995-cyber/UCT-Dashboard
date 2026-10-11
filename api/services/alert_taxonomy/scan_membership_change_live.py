"""S7 FLIP for `scan-membership-change` (TERM-025, owner approval 2026-10-10):
the taxonomy rule DELIVERS and the legacy screen-alerts loop stands down.

ENABLEMENT GATE: `ALERT_TAXONOMY_SCAN_MEMBERSHIP_LIVE_ENABLED`, default OFF,
read per call. Off: nothing here runs and `screener/screen_alerts.run_nightly`
is unchanged (`tests/test_alert_flip_scan_membership.py` pins it).

THE SHAPE: `run_nightly` (job `screener_screen_alerts`, 05:10 ET, behind
`scan_evaluator.enabled()` and `SCREEN_ALERTS_ENABLED`) stays the DRIVER. It
still reads every subscription, still drops a dangling definition and still
resolves the live definition name. Then, per subscription, it hands the
decision and the delivery to `deliver_one` instead of its own block:

  * DECISION: `scan_membership_change.would_fire` with
    `scan_membership_change_projection.params_for(sub)`, over sessions keyed
    from `scan_coverage` (Finding B) via `projection.sessions_and_hits`, the
    inputs the shadow comparison measured;
  * DEDUP: `screen_alerts_fired`, the legacy's own table, read as
    `already_fired` and written after delivery by the legacy's own writer
    (`screen_alerts._record_fired`). The dedup grain is the legacy PK
    `(user_id, def_hash, as_of)`: one alert per member per definition per
    session, however many names moved;
  * the legacy per-run cap `MAX_PER_USER` is still applied, in the legacy's
    order (quiet, then quota, then dedup), so a member's nightly count is
    what it was;
  * RECORD: `alert_fires` (`receipts.record_fire`, one receipt per alert,
    never per symbol), DELIVERY: `delivery.deliver` (lease, FT-036 routing,
    AC-4 caps) calling `deliver_alert_payload` with the legacy's title,
    message, sym, source, extra_data and severity ("warning", that function's
    default), so the member's in-app row is the same row.

ONE ALERT PER EVENT: `run_nightly` `continue`s past its own delivery for
every subscription this module handled, the fire key is the dedup grain
(`UNIQUE(predicate_id, fire_key)`), and `screen_alerts_fired` is written by
both paths, so a flag toggle between two runs of one night cannot alert the
same session twice.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

FLAG = "ALERT_TAXONOMY_SCAN_MEMBERSHIP_LIVE_ENABLED"

logger = logging.getLogger(__name__)
LIVE_PREFIX = "live:"


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def live_predicate_id(user_id: str, def_hash: str) -> str:
    return f"{LIVE_PREFIX}{user_id}:{def_hash}"


def live_fire_key(user_id: str, def_hash: str, as_of: int) -> str:
    return f"live:{user_id}:{def_hash}:{int(as_of)}"


def _inputs(def_hash: str, tf: str, cache: dict) -> tuple[list[int], dict]:
    """Sessions + hit sets for one definition, read once per run."""
    from api.services.alert_taxonomy import scan_membership_change_projection as _proj
    key = (def_hash, tf)
    if key not in cache:
        cache[key] = _proj.sessions_and_hits(def_hash, tf)
    return cache[key]


def deliver_one(*, user_id: str, def_hash: str, name: str, mode: str, tf: str,
                sent_so_far: int, inputs: dict) -> str:
    """Decide and deliver one subscription's alert. Returns the name of the
    `run_nightly` receipt counter this outcome belongs to. Never raises."""
    from api.services.alert_taxonomy import delivery as _delivery
    from api.services.alert_taxonomy import receipts as _receipts
    from api.services.alert_taxonomy import scan_membership_change as _smc
    from api.services.alert_taxonomy import scan_membership_change_projection as _proj
    from api.services.screener import screen_alerts as _legacy

    try:
        sessions, hits = _inputs(def_hash, tf, inputs)
        params = _proj.params_for({"def_hash": def_hash, "mode": mode})
        fired = _proj.already_fired_before(user_id, def_hash, None)
        d = _smc.would_fire(params, covered_sessions=sessions, hits_by_as_of=hits,
                            already_fired=fired)
    except Exception:  # noqa: BLE001 -- one subscription never stops the run
        logger.warning("[scan-membership live] evaluation failed for %s / %s",
                       user_id, def_hash, exc_info=True)
        return "errors"

    if d["reason"] in _smc.NOT_COMPARABLE_REASONS:
        # `run_nightly` reached this subscription only because `diff_for` found
        # two covered sessions, so this is a disagreement, never a quiet night.
        logger.warning("[scan-membership live] %s / %s not comparable (%s)",
                       user_id, def_hash, d["reason"])
        return "errors"
    if d["reason"] == _smc.REASON_QUIET:
        return "skipped_quiet"
    if sent_so_far >= _legacy.MAX_PER_USER:
        return "skipped_quota"
    if d["reason"] == _smc.REASON_DEDUPED:
        return "skipped_dedup"

    as_of = int(d["as_of"])
    entered, exited = list(d["entered"]), list(d["exited"])
    pid = live_predicate_id(user_id, def_hash)
    fire_key = live_fire_key(user_id, def_hash, as_of)
    try:
        title, message, sym = _legacy._compose(name, entered, exited)
        fire_id = _receipts.record_fire(
            predicate_id=pid, trigger_type=_smc.TYPE_ID, user_id=str(user_id),
            entity_ref=def_hash, fire_key=fire_key,
            detail={"definition_id": def_hash, "name": name, "as_of": as_of,
                    "entered": entered, "exited": exited,
                    "direction": params["direction"]},
            source_data_class="scan_snapshot", freshness_class="end_of_day",
            as_of=time.time())
        if fire_id is None:
            # Recorded on an earlier run whose delivery failed (the dedup row
            # was never written): retry exactly that fire, as the legacy did.
            fire_id = _receipts.released_fire_id(pid, fire_key)
            if fire_id is None:
                return "skipped_dedup"
        extra: dict[str, Any] = {"def_hash": def_hash, "as_of": as_of,
                                 "entered": entered, "exited": exited}
        try:
            report = _delivery.deliver(fire_id, str(user_id), sym, title, message,
                                       source="screen_alert", extra_data=extra,
                                       severity="warning")
        except Exception as e:  # noqa: BLE001
            _receipts.release_delivery(fire_id, error=f"{type(e).__name__}: {e}")
            raise
        if report.get("claimed") is False:
            # deliver()'s only early "claimed: False" answer: the lease was
            # already held, so this fire was delivered by another run.
            return "skipped_dedup"
        _legacy._record_fired(user_id, def_hash, as_of, len(entered), len(exited))
        return "sent"
    except Exception:  # noqa: BLE001
        logger.warning("[scan-membership live] delivery failed for %s / %s",
                       user_id, def_hash, exc_info=True)
        return "errors"
