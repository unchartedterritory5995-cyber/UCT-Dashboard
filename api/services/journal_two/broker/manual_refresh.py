"""Budgeted on-demand SnapTrade holdings refresh.

SnapTrade's scheduled brokerage pull is only ~nightly, so a member who
day-trades sees yesterday's positions until the overnight refresh. When a
member actually opens the Journal during trading hours and their holdings
snapshot is stale, we ask SnapTrade to re-pull that authorization now.
Completion arrives asynchronously as an ACCOUNT_HOLDINGS_UPDATED /
ACCOUNT_TRANSACTIONS_UPDATED webhook, which triggers our normal sync.

Budget guardrails (refreshes may be billed per call on some SnapTrade
plans): only inside the weekday trading window, only when the snapshot is
older than BROKER_HOLDINGS_STALE_HOURS, and at most one request per account
per BROKER_MANUAL_REFRESH_MIN_HOURS. Kill switch:
BROKER_MANUAL_REFRESH_ENABLED=0.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.journal_two.broker import connections
from api.services.journal_two.broker import snaptrade_client as snap

logger = logging.getLogger("broker_refresh")

_WINDOW_START_ET = 8   # pre-market prep
_WINDOW_END_ET = 20    # after-hours review


def _enabled() -> bool:
    return (os.getenv("BROKER_MANUAL_REFRESH_ENABLED") or "1") == "1"


def _stale_hours() -> float:
    return float(os.getenv("BROKER_HOLDINGS_STALE_HOURS") or 6)


def _min_interval_hours() -> float:
    return float(os.getenv("BROKER_MANUAL_REFRESH_MIN_HOURS") or 6)


def _in_trading_window(now_et: datetime | None = None) -> bool:
    now_et = now_et or datetime.now(ZoneInfo("America/New_York"))
    return now_et.weekday() < 5 and _WINDOW_START_ET <= now_et.hour < _WINDOW_END_ET


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _account_needs_refresh(ba: dict, now: datetime) -> bool:
    if not ba.get("syncEnabled") or ba.get("status") != "active":
        return False
    if not ba.get("brokerageAuthorizationId"):
        return False  # populated by the next scheduled sync; nothing to call yet
    hs = _parse_ts(ba.get("holdingsSyncedAt"))
    if hs is None:
        return False  # unknown age — don't spend budget on a guess
    if now - hs <= timedelta(hours=_stale_hours()):
        return False
    last = _parse_ts(ba.get("lastManualRefreshAt"))
    if last is not None and now - last <= timedelta(hours=_min_interval_hours()):
        return False
    return True


async def maybe_refresh_user(user_id: str) -> dict[str, Any]:
    """Request a SnapTrade re-pull for each of the user's accounts whose
    holdings snapshot is stale, within budget. Never raises. Returns
    {requested: [broker_account_ids]} for observability/tests."""
    requested: list[str] = []
    if not (_enabled() and snap.is_configured() and _in_trading_window()):
        return {"requested": requested}
    try:
        bu = connections.get_broker_user(user_id)
        if bu is None:
            return {"requested": requested}
        now = datetime.now(timezone.utc)
        # One refresh call per distinct authorization (an authorization can
        # carry several accounts; stamp every account it covers).
        by_auth: dict[str, list[dict]] = {}
        for ba in connections.list_broker_accounts(user_id):
            if _account_needs_refresh(ba, now):
                by_auth.setdefault(ba["brokerageAuthorizationId"], []).append(ba)
        for auth_id, bas in by_auth.items():
            try:
                await snap.refresh_authorization(
                    bu["snaptradeUserId"], bu["userSecret"], auth_id)
            except Exception as e:  # noqa: BLE001 — refresh is opportunistic
                logger.warning("manual refresh failed for auth %s: %s", auth_id, e)
                continue
            for ba in bas:
                connections.record_manual_refresh(user_id, ba["id"])
                requested.append(ba["id"])
        if requested:
            logger.info("requested SnapTrade refresh for %s account(s) of user %s",
                        len(requested), user_id)
    except Exception:  # noqa: BLE001 — must never break the caller
        logger.exception("maybe_refresh_user failed")
    return {"requested": requested}


# The status endpoint is polled; don't spawn a checker thread more than once
# per user per window (in-process; redeploy = one extra check, harmless).
_TRIGGER_COOLDOWN_SECONDS = 600.0
_last_trigger: dict[str, float] = {}


def _reset_trigger_dedup_for_tests() -> None:
    _last_trigger.clear()


def maybe_refresh_user_background(user_id: str) -> None:
    """Fire-and-forget from sync (threadpool) request handlers."""
    if not (_enabled() and snap.is_configured() and _in_trading_window()):
        return
    import asyncio
    import threading
    import time as _time

    now = _time.monotonic()
    if now - _last_trigger.get(user_id, -1e12) < _TRIGGER_COOLDOWN_SECONDS:
        return
    _last_trigger[user_id] = now

    def _run():
        try:
            asyncio.run(maybe_refresh_user(user_id))
        except Exception:  # noqa: BLE001
            logger.exception("background manual refresh failed")

    threading.Thread(target=_run, daemon=True,
                     name=f"broker-refresh-{user_id[:8]}").start()
