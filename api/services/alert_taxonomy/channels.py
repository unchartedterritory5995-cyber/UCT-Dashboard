"""One delivery-channel registry (Alerts PRD AC-2, SPEC-S7 §5.5).

The PRD's complaint: alert delivery was addressed by per-alert webhook
VARIABLE NAMES (`M4`, seventeen-plus) instead of by channel KIND. This module
is the one place a channel kind is defined -- in-app bell, email, Discord,
web push, browser notification, sound, member webhook -- with who owns its
transport, how "configured" is decided, and (for Discord) which existing
variable each purpose resolves to.

THE MIGRATION KEEPS EVERY EXISTING HOOK WORKING.
  * No new webhook variable is introduced (PRD §19 non-goal). Every Discord
    webhook name the estate already reads is listed in `LEGACY_WEBHOOKS`,
    bound to the `discord` kind and a PURPOSE, and `resolve_webhook(purpose)`
    returns exactly what `os.environ.get(<that name>)` returned before -- a
    rail checks every row, and a census rail fails when a new
    `"DISCORD_*WEBHOOK*"` literal appears in `api/` without a row here.
  * `alerts.discord_webhook()` (the alert channel's single owner) reads
    through `resolve_webhook("alert")` when the registry is armed; dark, it
    reads its variable directly, exactly as before. Same value either way.
  * Read at CALL time, never captured at import (alerts.py's own lesson).
  * The ops/business split (TERM-011, `alert_routing` / `alert_destination`)
    is a DIFFERENT axis -- class, not channel -- and stays where it is; its
    two variables are listed here only so the census is whole.

DARK: `ALERT_CHANNEL_REGISTRY_ENABLED` (default off, read per call). Off:
nothing reads through the registry; the admin channel-health view (AC-7)
still describes it, since describing changes nothing.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

FLAG = "ALERT_CHANNEL_REGISTRY_ENABLED"


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


@dataclass(frozen=True)
class Channel:
    kind: str
    label: str
    owner: str                       # the module that owns the transport
    configured_by: tuple[str, ...] = field(default_factory=tuple)  # env names, ALL needed
    client_side: bool = False        # rendered by the browser from the in-app record
    routable: bool = True            # FT-036 may turn it off


#: ONE ENTRY PER CHANNEL KIND -- never one per alert type.
REGISTRY: dict[str, Channel] = {c.kind: c for c in (
    Channel("in_app", "In-app bell", "api.services.alerts.add_alert", routable=False),
    Channel("email", "Email", "api.services.email_service.send_email", ("RESEND_API_KEY",)),
    Channel("discord", "Discord (broadcast alerts only)", "api.services.alerts.add_alert",
            ("DISCORD_ALERT_WEBHOOK",), routable=False),
    Channel("push", "Web push", "api.services.web_push.dispatch",
            ("WEB_PUSH_ENABLED", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY")),
    Channel("browser", "Browser notification", "app AlertBell (Notification API)",
            client_side=True, routable=False),
    Channel("sound", "Alert sound", "app alertSound.js", client_side=True, routable=False),
    Channel("webhook", "Member webhook", "api.services.alert_taxonomy.outbound_webhooks",
            ("ALERT_WEBHOOKS_ENABLED",)),
)}

#: Every Discord webhook variable the estate reads -> (purpose, owner). The
#: purpose is what a caller asks for; the variable is how it is resolved
#: today. Kind is always `discord`.
LEGACY_WEBHOOKS: dict[str, tuple[str, str]] = {
    "DISCORD_ALERT_WEBHOOK": ("alert", "api/services/alerts.py"),
    "DISCORD_WEBHOOK_URL": ("general", "api/services/discord_notify.py + alert_destination fallback"),
    "DISCORD_OPS_WEBHOOK_URL": ("ops", "api/services/alert_routing.py (TERM-011)"),
    "DISCORD_BUSINESS_WEBHOOK_URL": ("business", "api/services/alert_routing.py (TERM-011)"),
    "DISCORD_LIVE_FLOW_WEBHOOK_URL": ("live_flow", "api/liveflow_worker.py et al."),
    "DISCORD_MASSIVE_WEBHOOK_URL": ("massive_flow", "api/live_massive_router.py et al."),
    "DISCORD_FLOW_WEBHOOK_URL": ("flow_watchlist", "api/discord_watchlist.py"),
    "DISCORD_NOTABLE_WEBHOOK_URL": ("notable_flow", "api/notable_flow.py"),
    "DISCORD_TSDR_WEBHOOK_URL": ("desk", "api/services/desk_session_announce.py"),
    "DISCORD_RECAP_WEBHOOK_URL": ("desk_recap", "api/services/desk_session_recap.py"),
    "DISCORD_EVENT_CALENDAR_WEBHOOK_URL": ("event_calendar", "api/services/calendar_week_poster.py"),
    "DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL": ("event_calendar_test", "api/services/calendar_week_poster.py"),
    "DISCORD_RENDER_ALERT_WEBHOOK": ("render_ops", "api/services/discord_render/observe.py"),
}

_BY_PURPOSE = {purpose: name for name, (purpose, _owner) in LEGACY_WEBHOOKS.items()}


def webhook_name(purpose: str) -> Optional[str]:
    return _BY_PURPOSE.get(purpose)


def resolve_webhook(purpose: str) -> str:
    """The webhook URL for a purpose, read NOW -- identical to reading the
    legacy variable directly. Unknown purpose -> "" (nothing configured),
    never a guess at another room."""
    name = _BY_PURPOSE.get(purpose)
    if not name:
        return ""
    return os.environ.get(name, "") or ""


def is_configured(kind: str) -> Optional[bool]:
    """True/False for a server-side channel; None for a client-side one
    (the server cannot know whether a browser granted notifications)."""
    ch = REGISTRY.get(kind)
    if ch is None:
        return False
    if ch.client_side:
        return None
    return all((os.environ.get(n) or "").strip() for n in ch.configured_by)


def describe() -> list[dict]:
    """The registry as data, NAMES only -- never a value (no secret leaks)."""
    return [{"kind": c.kind, "label": c.label, "owner": c.owner,
             "configured": is_configured(c.kind), "client_side": c.client_side,
             "routable": c.routable, "configured_by": list(c.configured_by)}
            for c in REGISTRY.values()]
