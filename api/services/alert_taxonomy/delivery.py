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

    # FT-036: the member's one routing rule (None while dark -> unchanged path).
    from api.services.alert_taxonomy import routing_rule as _routing
    rule = _routing.effective(user_id)
    if rule is not None and rule.suspended:
        # ⛔ Suspended: the fire is already RECORDED (alert_fires), the lease is
        # held so nothing re-sends it, and its outcome says why nothing went out.
        channels = {"routing": "suspended"}
        _receipts.record_delivery_channels(fire_id, channels)
        return {"claimed": True, "channels": channels, "channels_ok": 0,
                "channels_failed": 0, "errors": {}, "suspended": True}

    report = watchlist_alert_service.deliver_alert_payload(
        user_id=user_id,
        sym=sym,
        title=title,
        message=message,
        source=source,
        extra_data=extra_data,
        severity=severity,
        **({"channels_allowed": rule.channels_allowed()} if rule is not None else {}),
    )
    # FT-033: queue (never send) the member's webhooks. Sending is the drain
    # job's, off this sweep's path; enqueue never raises.
    if rule is None or rule.webhook:
        from api.services.alert_taxonomy import outbound_webhooks as _webhooks
        queued = _webhooks.enqueue_fire(user_id, {
            "fire_id": fire_id, "trigger_type": source, "entity": sym,
            "title": title, "message": message,
            "research_url": (extra_data or {}).get("research_url"),
        })
        if queued:
            report = {**report, "channels": {**report.get("channels", {}), "webhook": "queued"}}
    _receipts.record_delivery_channels(fire_id, report.get("channels", {}))
    return report
