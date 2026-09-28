"""
Discord webhook notifications for admin events.
Sends real-time alerts to a Discord channel when users sign up, cancel, etc.
"""

import os
import threading
import requests
from datetime import datetime, timezone

DISCORD_ADMIN_WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "")

def _send_webhook(embed: dict, url: str | None = None):
    """Fire-and-forget Discord webhook in a background thread.

    ⭐ TERM-011 / RM-N09 step 6 — `url` lets ONE caller supply its own destination
    while every other caller keeps door C's `DISCORD_ADMIN_WEBHOOK` verbatim. It
    exists so the three step-6 rows that reach Discord THROUGH this sender
    (`catalyst/digest.py` row 10, `desk_daily_session.py` rows 11 and 12) can resolve
    the OPS class through `alert_destination.ops_webhook()` without door C itself
    being reclassified — door C is the shared sink for the BUSINESS notifiers below
    and a later step's decision, pinned as such in `tests/test_alert_destination.py`.

    ⛔ IT IS A DESTINATION, NOT A TRANSPORT CHANGE. The thread, the payload shape,
    the timeout and the swallow-everything contract are untouched, so a converted
    caller sends the same bytes to the same place while the new variables are unset.

    ⛔⛔ `url=None` MEANS DOOR C; `url=""` MEANS NOTHING IS CONFIGURED AND THIS POSTS
    NOTHING. The two are deliberately NOT collapsed with `url or DISCORD_ADMIN_WEBHOOK`,
    which is the tempting one-liner and is wrong: `DISCORD_ADMIN_WEBHOOK` is captured
    at IMPORT (`:11`), so falling back to it would let a stale value answer for a
    converted producer whose live resolution said "nowhere" — a SECOND AUTHORITY over
    one destination, with the stale one winning exactly when the live one is blank.
    A converted caller resolving to "" is inert, which is precisely what the literal
    read it replaced did when the variable was blank.
    """
    webhook = DISCORD_ADMIN_WEBHOOK if url is None else url
    if not webhook:
        return

    def _post():
        try:
            requests.post(
                webhook,
                json={"embeds": [embed]},
                timeout=5,
            )
        except Exception:
            pass  # Never crash the app for a notification failure

    threading.Thread(target=_post, daemon=True).start()


def notify_signup(email: str, display_name: str = ""):
    """New user signed up."""
    _send_webhook({
        "title": "🆕 New Signup",
        "description": f"**{display_name or 'Unknown'}** just signed up",
        "fields": [
            {"name": "Email", "value": email, "inline": True},
        ],
        "color": 0x3CB868,  # Green
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def notify_waitlist_signup(email: str, total: int | None = None, referrer: str = ""):
    """Someone joined the pre-launch waitlist from the COMING SOON page.

    Gold rather than the green of `notify_signup` so a launch-list join is
    never mistaken for a real account (accounts are closed pre-launch).

    `total` is the running list size and is deliberately in every message: if a
    burst of signups trips Discord's webhook rate limit and some pings are
    dropped, the next one that lands still carries the true count.
    """
    fields = [{"name": "Email", "value": email, "inline": True}]
    if total is not None:
        fields.append({"name": "List size", "value": str(total), "inline": True})
    if referrer:
        fields.append({"name": "Came from", "value": referrer[:180], "inline": False})

    _send_webhook({
        "title": "📋 Waitlist Signup",
        "description": f"**#{total}** on the launch list" if total else "New launch-list signup",
        "fields": fields,
        "color": 0xC9A84C,  # UCT gold
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def notify_subscription(email: str, event: str):
    """Subscription event: checkout_completed, canceled, payment_failed."""
    titles = {
        "checkout_completed": "💰 New Subscriber",
        "canceled": "🚪 Subscription Canceled",
        "payment_failed": "⚠️ Payment Failed",
    }
    colors = {
        "checkout_completed": 0xC9A84C,  # Gold
        "canceled": 0xE74C3C,  # Red
        "payment_failed": 0xFB923C,  # Orange
    }
    _send_webhook({
        "title": titles.get(event, f"📋 Subscription: {event}"),
        "description": f"**{email}**",
        "fields": [
            {"name": "Event", "value": event, "inline": True},
        ],
        "color": colors.get(event, 0x706B5E),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def notify_churn_risk(email: str, days_inactive: int):
    """User hasn't logged in for N days but has active subscription."""
    _send_webhook({
        "title": "🔴 Churn Risk",
        "description": f"**{email}** hasn't logged in for **{days_inactive} days** but has an active subscription",
        "color": 0xE74C3C,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def notify_admin_action(admin_email: str, action: str, target_email: str):
    """Admin performed an action on a user."""
    _send_webhook({
        "title": f"🔒 Admin: {action}",
        "description": f"**{admin_email}** → {action} → **{target_email}**",
        "color": 0x706B5E,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
