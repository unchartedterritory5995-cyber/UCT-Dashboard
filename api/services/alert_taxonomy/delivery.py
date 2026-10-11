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

    # AC-4: per-trigger-type queue caps with a reserve (dark: always admits).
    from api.services.alert_taxonomy import queue_caps as _caps
    if _caps.is_enabled():
        ttype = _caps.trigger_type_of(fire_id) or source.replace("_", "-")
        if not _caps.admit(user_id, ttype, fire_id=fire_id):
            # ⛔ Capped: RECORDED (alert_fires), lease held, outcome says why.
            channels = dict(_caps.CAPPED)
            _receipts.record_delivery_channels(fire_id, channels)
            return {"claimed": True, "channels": channels, "channels_ok": 0,
                    "channels_failed": 0, "errors": {}, "capped": True}

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


def deliver_insight(
    fire_id: int,
    user_id: str,
    *,
    trigger_type: str,
    kind: str,
    headline: str,
    body: Optional[str],
    importance: int,
    symbol: Optional[str] = None,
) -> dict[str, Any]:
    """Deliver a fire whose type's channel set is FIXED to `in_app` as a Compass
    insight (`voice_proactive_service.add_insight`), the surface that type's
    legacy emitter used. `regime-change` is the one caller
    (`regime_change.CHANNELS_FIXED == ("in_app",)`): routing it through
    `deliver()` would add email, Discord and webhooks to every position holder
    on every regime flip, the widening that schema pins against.

    Same contract as `deliver()`: the lease is claimed exactly once before
    anything runs, a suspended FT-036 routing rule or an AC-4 queue cap
    records the fire and sends nothing, and the outcome is written onto the
    fire's own row. `in_app` is not routable (channels.REGISTRY), so a live
    routing rule never turns it off. `add_insight` returning None (its own
    8-per-day cap) is recorded as `suppressed`, exactly what the legacy path
    did with that answer: nothing.
    """
    if not _receipts.claim_delivery(fire_id):
        return {"claimed": False, "channels": {}, "insight_id": None}

    from api.services.alert_taxonomy import routing_rule as _routing
    rule = _routing.effective(user_id)
    if rule is not None and rule.suspended:
        channels = {"routing": "suspended"}
        _receipts.record_delivery_channels(fire_id, channels)
        return {"claimed": True, "channels": channels, "insight_id": None, "suspended": True}

    from api.services.alert_taxonomy import queue_caps as _caps
    if _caps.is_enabled():
        ttype = _caps.trigger_type_of(fire_id) or trigger_type
        if not _caps.admit(user_id, ttype, fire_id=fire_id):
            channels = dict(_caps.CAPPED)
            _receipts.record_delivery_channels(fire_id, channels)
            return {"claimed": True, "channels": channels, "insight_id": None, "capped": True}

    from api.services.voice_proactive_service import add_insight
    channels: dict[str, str] = {}
    insight_id = None
    try:
        insight_id = add_insight(user_id, kind=kind, headline=headline, symbol=symbol,
                                 body=body, importance=importance)
        channels["in_app"] = "ok" if insight_id else "suppressed"
    except Exception as e:  # noqa: BLE001
        # ONE channel and nothing was written, so a retry cannot double a
        # delivery (the hazard that makes deliver() never retry). The legacy
        # emitters retried on their next cycle; releasing the lease (bounded
        # by MAX_DELIVERY_ATTEMPTS) lets the caller do the same.
        channels["in_app"] = "failed"
        _receipts.record_delivery_channels(fire_id, channels)
        _receipts.release_delivery(fire_id, error=f"{type(e).__name__}: {e}")
        return {"claimed": True, "channels": channels, "insight_id": None, "released": True}
    _receipts.record_delivery_channels(fire_id, channels)
    return {"claimed": True, "channels": channels, "insight_id": insight_id}
