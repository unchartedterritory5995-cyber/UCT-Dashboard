"""deliver(fire) -- a thin typed wrapper over the EXISTING multi-channel
delivery function (SPEC-S7 §4/§5.5: "owns nothing watchlist_alert_service
doesn't already own... no step requires deliver_alert_payload's signature
to change"). This module does not implement delivery itself.

Per-type/per-predicate channel ROUTING (SPEC §5.5's CHANNEL_REGISTRY /
alert_routing_prefs design) is explicitly NOT implemented this pass -- see
db.py's module docstring. `deliver_alert_payload`'s existing, unmodified
in-app+email+Discord fan-out is used as-is for every fire this slice
produces.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services import watchlist_alert_service
from api.services.alert_taxonomy import receipts as _receipts


def deliver(
    fire_id: int,
    user_id: str,
    sym: str,
    title: str,
    message: str,
    *,
    source: str,
    extra_data: Optional[dict[str, Any]] = None,
    severity: str = "info",
) -> dict[str, Any]:
    """Claim this fire's delivery lease, deliver via the existing multi-
    channel function, and record the outcome on the fire's own row.

    Fire-once is enforced HERE, before any channel runs -- a fire whose
    lease is already claimed (a scheduler retry racing a still-in-flight
    delivery, or a fire this process already delivered) is not
    re-delivered. This mirrors watchlist_alert_service.deliver_alert_payload
    's own fire-once gate for indicator alerts, applied to this table
    instead of that one.

    ⛔ DELIBERATELY NEVER AUTO-RETRIED ON PARTIAL/FULL CHANNEL FAILURE,
    matching watchlist_alert_service._deliver_alert's own established
    philosophy exactly ("an alert that fired must never re-fire because a
    channel was slow... a failed delivery is NOT retried, which is exactly
    why the report has to exist"). Releasing the lease here to retry a
    partial failure would re-run channels that already succeeded (e.g.
    double in-app write) for the SAME fire -- the duplicate-notification
    risk the pre-live checklist explicitly guards against. The lease is
    claimed exactly once; whatever happens is recorded and is permanent.
    `receipts.release_delivery`/MAX_DELIVERY_ATTEMPTS exist for a future
    trigger type that genuinely needs bounded retry, not wired in here.
    """
    if not _receipts.claim_delivery(fire_id):
        return {"claimed": False, "channels": {}, "channels_ok": 0, "channels_failed": 0, "errors": {}}

    report = watchlist_alert_service.deliver_alert_payload(
        user_id=user_id,
        sym=sym,
        title=title,
        message=message,
        source=source,
        extra_data=extra_data,
        severity=severity,
    )
    _receipts.record_delivery_channels(fire_id, report.get("channels", {}))
    return report
