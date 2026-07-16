"""Broker connection notifications — member email + owner Discord.

Design guardrails (owner-approved 2026-07-15, after a beta member's broker
connection failed silently for two days and he gave up):

  • The member is emailed ONLY on the transition into status='broken' — the
    one failure they can fix themselves (re-authorize at the broker). Exactly
    one email per incident; nothing more until it's fixed and breaks anew.
  • Transient sync failures (locked DB, rate limits, 5xx) NEVER email the
    member. They ping the owner's Discord instead — only once the last 3
    sync attempts for the account have ALL failed, at most once per account
    per ET day.
  • Everything is best-effort and off-thread: a notification failure can
    never slow down or break a sync.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger("broker_notifications")

# Last-3-attempts-all-failed is the "repeatedly failing" signal (a sync that
# retried a transient lock and then SUCCEEDED never trips it).
_CONSECUTIVE_FAILURES_TO_PING = 3

# broker_account_id -> ET date last pinged. In-process on purpose: worst case
# after a redeploy is ONE extra owner ping, which beats a schema migration.
_failure_pinged: dict[str, str] = {}


def _reset_dedup_for_tests() -> None:
    _failure_pinged.clear()


def _spawn(fn, *args) -> None:
    """Run a notifier off-thread; never let it touch the sync path."""
    try:
        threading.Thread(target=fn, args=args, daemon=True).start()
    except Exception:
        logger.exception("notification spawn failed")


def _et_today() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _post_discord(title: str, description: str) -> None:
    url = os.environ.get("DISCORD_ALERT_WEBHOOK") or os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return
    import requests

    requests.post(
        url,
        json={"embeds": [{"title": title, "description": description, "color": 0xE74C3C,
                          "footer": {"text": "UCT broker sync"}}]},
        timeout=5,
    )


def _user_row(user_id: str):
    from api.services.auth_db import get_connection

    conn = get_connection()
    try:
        return conn.execute(
            "SELECT email, display_name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    finally:
        conn.close()


# ── Broken transition: one member email + one owner ping ────────────────────

def connection_broken(user_id: str, ba: dict[str, Any] | None, error: str,
                      *, prior_status: str | None) -> None:
    """Call right after set_status(..., 'broken'). No-op if it was ALREADY
    broken (one notification per incident — status flips back to 'active' on
    the next successful sync, re-arming this)."""
    if prior_status == "broken":
        return
    _spawn(_do_broken, user_id, dict(ba or {}), str(error or ""))


def _do_broken(user_id: str, ba: dict[str, Any], error: str) -> None:
    brokerage = ba.get("brokerageName") or "brokerage"
    masked = ba.get("accountNumberMasked") or ""
    emailed_to = None
    try:
        row = _user_row(user_id)
        if row and row["email"]:
            from api.services import email_service

            if email_service.send_broker_reconnect_email(
                row["email"], row["display_name"], brokerage
            ):
                emailed_to = row["email"]
    except Exception:
        logger.exception("member reconnect email failed")
    try:
        suffix = " — member emailed to reconnect" if emailed_to else ""
        _post_discord(
            f"Broker connection broken{suffix}",
            f"{brokerage} {masked} · user {user_id}"
            + (f" · {emailed_to}" if emailed_to else "")
            + f"\n{error[:300]}",
        )
    except Exception:
        logger.exception("owner discord ping (broken) failed")


# ── Repeated transient failures: owner-only, once per account per day ───────

def sync_failed(user_id: str, ba: dict[str, Any] | None, error: str) -> None:
    """Call after a sync fails for a non-auth reason (the failed sync_log row
    must already be written). Owner-only Discord; the member is never emailed
    for transient failures."""
    _spawn(_do_failed, user_id, dict(ba or {}), str(error or ""))


def _do_failed(user_id: str, ba: dict[str, Any], error: str) -> None:
    try:
        acct_id = ba.get("id")
        if not acct_id:
            return
        today = _et_today()
        if _failure_pinged.get(acct_id) == today:
            return
        if not _last_attempts_all_failed(user_id, acct_id):
            return
        _failure_pinged[acct_id] = today
        brokerage = ba.get("brokerageName") or "brokerage"
        masked = ba.get("accountNumberMasked") or ""
        _post_discord(
            "Broker sync failing repeatedly",
            f"{brokerage} {masked} · user {user_id}\n"
            f"Last {_CONSECUTIVE_FAILURES_TO_PING} sync attempts all failed. "
            f"Latest error: {error[:300]}\n"
            f"Triage: /api/j2/broker/admin/stats",
        )
    except Exception:
        logger.exception("owner discord ping (failures) errored")


def _last_attempts_all_failed(user_id: str, broker_account_id: str) -> bool:
    from api.services.auth_db import get_connection

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT status FROM j2_broker_sync_log "
            "WHERE user_id = ? AND broker_account_id = ? "
            "ORDER BY started_at DESC LIMIT ?",
            (user_id, broker_account_id, _CONSECUTIVE_FAILURES_TO_PING),
        ).fetchall()
    finally:
        conn.close()
    return (len(rows) == _CONSECUTIVE_FAILURES_TO_PING
            and all(r["status"] == "error" for r in rows))
