"""Recent Orders poll — free near-real-time trade capture.

SnapTrade's transactions feed is never intraday (daily sync, delayed a
day), but the Recent Orders endpoint is ALWAYS real-time, covers the last
~24h, and its calls are included free on pay-as-you-go plans. The docs'
own recommended pattern: poll it at most once per 5 minutes per account
during market hours and diff against a local copy.

Each newly-seen EXECUTED equity order becomes a provisional ledger
activity (external_id 'intraday:<fingerprint>') and the account is
re-reconstructed FROM THE LOCAL LEDGER ONLY — no holdings/activities API
calls, so this stays outside SnapTrade's background polling caps. The
provisional row is excluded from the ledger heal and pruned when the real
transaction lands in the next daily sync (activities_store.prune_provisional).

v1 scope: equity fills only. Option orders are skipped — their
order-object shape (per-leg records, per-contract vs per-share price
conventions) doesn't round-trip safely into a provisional activity; they
appear via holdings-as-truth after a refresh and in full on the daily sync.
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from api.services.journal_two.broker import activities_store, connections
from api.services.journal_two.broker import snaptrade_client as snap

logger = logging.getLogger("broker_recent_orders")

# Equity actions only; BUY_COVER/SELL_SHORT collapse onto BUY/SELL for the
# FIFO reconstruction (allow_shorts=True handles direction from sign).
_ACTION_TO_TYPE = {
    "BUY": "BUY", "SELL": "SELL", "BUY_COVER": "BUY", "SELL_SHORT": "SELL",
}


def _enabled() -> bool:
    return (os.getenv("BROKER_RECENT_ORDERS_ENABLED") or "1") == "1"


def _in_market_window(now_et: datetime | None = None) -> bool:
    """Weekday 9:25–16:15 ET — regular session with a small buffer for
    opening/closing fills; the paid TRADE_DETECTION scheduler runs a similar
    window, and Recent Orders only covers executed orders anyway."""
    now_et = now_et or datetime.now(ZoneInfo("America/New_York"))
    if now_et.weekday() >= 5:
        return False
    minutes = now_et.hour * 60 + now_et.minute
    return (9 * 60 + 25) <= minutes <= (16 * 60 + 15)


def _fingerprint(order: dict, ticker: str, action: str, units: float) -> str:
    raw = "|".join([
        str(order.get("brokerage_order_id") or ""),
        ticker, action, f"{units:.4f}",
        str(order.get("time_executed") or order.get("time_updated") or ""),
    ])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _order_ticker(order: dict) -> str | None:
    """Equity ticker for an order, or None when it isn't a plain equity
    order (options carry option_symbol; skip those)."""
    if order.get("option_symbol"):
        return None
    us = order.get("universal_symbol")
    if isinstance(us, dict):
        sym = us.get("raw_symbol") or us.get("symbol")
        if isinstance(sym, dict):
            sym = sym.get("symbol")
        if sym:
            return str(sym).upper()
    sym = order.get("symbol")
    if isinstance(sym, dict):
        inner = sym.get("symbol")
        if isinstance(inner, dict):
            inner = inner.get("symbol") or inner.get("raw_symbol")
        if inner:
            return str(inner).upper()
    if isinstance(sym, str) and sym and not order.get("option_symbol"):
        # Bare string symbols from some brokers; UUID-looking ids are the
        # deprecated legacy field — skip those.
        if len(sym) <= 6 and sym.isalpha():
            return sym.upper()
    return None


def order_to_provisional_activity(order: dict) -> dict | None:
    """Convert one EXECUTED equity order into a provisional activity dict
    shaped like a SnapTrade transaction, or None when it can't be done
    safely (non-equity, missing fill data, not executed)."""
    if str(order.get("status") or "").upper() != "EXECUTED":
        return None
    action = str(order.get("action") or "").upper()
    act_type = _ACTION_TO_TYPE.get(action)
    if act_type is None:
        return None
    ticker = _order_ticker(order)
    if not ticker:
        return None
    try:
        units = float(order.get("filled_quantity")
                      or order.get("total_quantity") or 0)
        price = float(order.get("execution_price") or order.get("price") or 0)
    except (TypeError, ValueError):
        return None
    if units <= 0 or price <= 0:
        return None
    executed_at = (order.get("time_executed") or order.get("time_updated")
                   or order.get("time_placed"))
    if not executed_at:
        return None
    fp = _fingerprint(order, ticker, act_type, units)
    return {
        "id": f"intraday:{fp}",
        "type": act_type,
        "units": units,
        "price": price,
        "fee": 0,
        "symbol": {"symbol": ticker},
        "trade_date": str(executed_at),
        "currency": "USD",
        "_provisional": True,  # visible in raw ledger views/debugging
    }


async def poll_account(user_id: str, ba: dict) -> dict[str, Any]:
    """One poll for one account: fetch recent orders, inject any new
    executed equity fills, and re-reconstruct from the LOCAL ledger."""
    bu = connections.get_broker_user(user_id)
    if bu is None:
        return {"skipped": "no identity"}
    orders = await snap.get_recent_orders(
        bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"])
    provisional = []
    for o in orders or []:
        if not isinstance(o, dict):
            continue
        act = order_to_provisional_activity(o)
        if act is not None:
            provisional.append(act)
    if not provisional:
        return {"orders": len(orders or []), "new": 0}
    stored = activities_store.store_activities(user_id, ba["id"], provisional)
    if stored["new"] == 0:
        return {"orders": len(orders), "new": 0}

    # Local-only rebuild: ledger → FIFO trades/positions. No SnapTrade
    # holdings/activities calls (polling-cap compliance); balances/marks
    # refresh on the next webhook-driven or daily sync.
    try:
        from api.services.journal_two import accounts as accounts_service
        from api.services.journal_two.broker import reconstruct
        from api.services.journal_two.broker import historical_equity
        all_acts = activities_store.get_activities(user_id, ba["id"])
        settings = accounts_service.get_account_settings(user_id, ba["j2AccountId"])
        reconstruct.reconstruct_account(
            user_id, ba["id"], ba["j2AccountId"], all_acts, settings)
        historical_equity.invalidate_cache(user_id)
    except Exception:  # noqa: BLE001 — provisional rows are already stored;
        logger.exception("local reconstruction after intraday fill failed")
    logger.info("intraday fills: %s new for account %s", stored["new"], ba["id"])
    return {"orders": len(orders), "new": stored["new"]}


async def poll_all_accounts() -> dict[str, Any]:
    """Scheduler entry (every 5 min): poll each sync-enabled ACTIVE account
    of each paid user, serially (auth.db single-writer + trivial rate load).
    Never raises."""
    if not (_enabled() and snap.is_configured() and _in_market_window()):
        return {"skipped": True}
    from api.services.journal_two.broker.sync import _user_is_paid
    polled = new_total = errors = 0
    paid_cache: dict[str, bool] = {}
    try:
        for ba in connections.list_all_sync_enabled_accounts():
            if ba.get("status") != "active":
                continue
            if not _user_is_paid(ba["userId"], paid_cache):
                continue
            try:
                out = await poll_account(ba["userId"], ba)
                polled += 1
                new_total += int(out.get("new") or 0)
            except Exception:  # noqa: BLE001 — one account never blocks the rest
                errors += 1
                logger.warning("recent-orders poll failed for %s", ba["id"],
                               exc_info=True)
    except Exception:  # noqa: BLE001
        logger.exception("recent-orders sweep failed")
    return {"polled": polled, "newFills": new_total, "errors": errors}


def run_poll_blocking() -> None:
    """APScheduler entry. Never raises into the scheduler."""
    import asyncio
    try:
        asyncio.run(poll_all_accounts())
    except Exception as e:  # noqa: BLE001
        logger.warning("recent-orders poll run failed: %s", e)
