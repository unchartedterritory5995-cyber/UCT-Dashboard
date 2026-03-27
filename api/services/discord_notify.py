"""
Discord webhook notifications for admin events.
Sends real-time alerts to a Discord channel when users sign up, cancel, etc.
"""

import os
import threading
import requests
from datetime import datetime, timezone

DISCORD_ADMIN_WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "")

def _send_webhook(embed: dict):
    """Fire-and-forget Discord webhook in a background thread."""
    if not DISCORD_ADMIN_WEBHOOK:
        return

    def _post():
        try:
            requests.post(
                DISCORD_ADMIN_WEBHOOK,
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
