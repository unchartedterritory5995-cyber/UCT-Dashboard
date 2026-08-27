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

Scope: equity AND option fills. Option orders were v1-excluded because
the per-share vs per-contract price convention doesn't round-trip safely
blind — solved with a market-data referee: the fill price is sanity-checked
against the contract's live Massive mark, and a price ~multiplier× the mark
is normalized to per-share. Provisional option activities flow through the
SAME local reconstruction (reconstruct_account runs the option pipeline),
so a sold contract leaves Open Positions in minutes instead of T+1.
"""
from __future__ import annotations

import asyncio
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


# Shared per-account poll budget (contract: ≤1 poll / 5 min / account) —
# consulted by BOTH the scheduler sweep and the on-open instant check so the
# two paths can never double-spend. In-process; a redeploy costs at most one
# early poll per account.
_POLL_MIN_INTERVAL_SECONDS = 290.0
_last_poll: dict[str, float] = {}


def _reset_poll_budget_for_tests() -> None:
    _last_poll.clear()


def _budget_allows(account_id: str) -> bool:
    import time as _time
    return _time.monotonic() - _last_poll.get(account_id, -1e12) \
        >= _POLL_MIN_INTERVAL_SECONDS


def _budget_spend(account_id: str) -> None:
    import time as _time
    _last_poll[account_id] = _time.monotonic()


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


_OPT_ACTIONS = {
    "BUY_TO_OPEN": ("BUY", "BUY_TO_OPEN"), "BUY_OPEN": ("BUY", "BUY_TO_OPEN"),
    "BUY_TO_CLOSE": ("BUY", "BUY_TO_CLOSE"), "BUY_CLOSE": ("BUY", "BUY_TO_CLOSE"),
    "SELL_TO_OPEN": ("SELL", "SELL_TO_OPEN"), "SELL_OPEN": ("SELL", "SELL_TO_OPEN"),
    "SELL_TO_CLOSE": ("SELL", "SELL_TO_CLOSE"), "SELL_CLOSE": ("SELL", "SELL_TO_CLOSE"),
    # Plain BUY/SELL: FIFO infers open/close from the position state, same as
    # the real Robinhood activity feed (its option trades are bare BUY/SELL).
    "BUY": ("BUY", ""), "SELL": ("SELL", ""),
}

# A per-share option premium is never this many times the live mark; a price
# that is ~multiplier× the mark is the PER-CONTRACT convention leaking through.
_PRICE_REFEREE_RATIO = 25.0


def _reference_mark(underlying, strike, expiration, contract_type) -> float | None:
    """Best-effort live mark for the referee (snapshot → daily aggs). Never
    raises; None just means the referee abstains and the price passes as-is."""
    try:
        from datetime import datetime as _dt
        from api.services.journal_two.broker import option_marks as om
        from api.services.journal_two.broker.historical_equity import occ_symbol
        occ = occ_symbol(underlying, expiration, contract_type, strike)
        mark, _prev = om._mark_from_snapshot(om._snapshot_for(underlying, occ))
        if mark and mark > 0:
            return float(mark)
        bars = om._bars_for(occ, today_et=_dt.now(om._ET).date())
        if bars and bars[-1].get("c"):
            return float(bars[-1]["c"])
    except Exception:  # noqa: BLE001
        return None
    return None


def _option_contract_of(order: dict) -> dict | None:
    """underlying/strike/expiration/type/mini from an order's option_symbol,
    defensively (mirrors snaptrade_adapter._extract_option_contract)."""
    osym = order.get("option_symbol")
    if not isinstance(osym, dict):
        return None
    underlying = osym.get("underlying_symbol")
    if isinstance(underlying, dict):
        underlying = underlying.get("symbol") or underlying.get("raw_symbol")
    if not underlying:
        t = str(osym.get("ticker") or "")
        underlying = t.split(" ")[0] if " " in t else None
    try:
        strike = float(osym.get("strike_price") or osym.get("strike"))
    except (TypeError, ValueError):
        return None
    expiration = osym.get("expiration_date") or osym.get("expiration")
    cp = str(osym.get("option_type") or osym.get("type") or "").strip().lower()
    ctype = "CALL" if cp.startswith("c") else ("PUT" if cp.startswith("p") else None)
    if not underlying or not expiration or ctype is None or strike <= 0:
        return None
    return {
        "underlying": str(underlying).upper(),
        "strike": strike,
        "expiration": str(expiration).split("T")[0],
        "contractType": ctype,
        "isMini": bool(osym.get("is_mini_option")),
        "ticker": osym.get("ticker"),
    }


def order_to_provisional_option_activity(order: dict) -> dict | None:
    """Convert one EXECUTED option order into a provisional activity shaped
    like a real SnapTrade option transaction (type BUY/SELL + option_symbol
    + option_type), or None when it can't be done safely."""
    if str(order.get("status") or "").upper() != "EXECUTED":
        return None
    c = _option_contract_of(order)
    if c is None:
        return None
    action = str(order.get("action") or "").upper().replace(" ", "_")
    mapped = _OPT_ACTIONS.get(action)
    if mapped is None:
        return None
    act_type, option_type = mapped
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
    # Unit referee: the ledger convention is premium PER SHARE (a BA fill at
    # 11.50, not 1150). When the live mark is known and the price is
    # ~multiplier× it, normalize per-contract → per-share; when the referee
    # abstains the price passes as-is and the daily sync's real activity
    # replaces the row within a day.
    multiplier = 10.0 if c["isMini"] else 100.0
    ref = _reference_mark(c["underlying"], c["strike"], c["expiration"],
                          c["contractType"])
    if ref and ref > 0 and (price / ref) >= _PRICE_REFEREE_RATIO:
        price = round(price / multiplier, 6)
    occ_ish = c["ticker"] or f'{c["underlying"]} {c["expiration"]} {c["strike"]}{c["contractType"][0]}'
    fp = _fingerprint(order, str(occ_ish), act_type, units)
    return {
        "id": f"intraday:{fp}",
        "type": act_type,
        "option_type": option_type,
        "units": units,
        "price": price,
        "fee": 0,
        "symbol": {"symbol": c["underlying"]},
        "option_symbol": {
            "ticker": c["ticker"],
            "strike_price": c["strike"],
            "expiration_date": c["expiration"],
            "option_type": c["contractType"],
            "underlying_symbol": {"symbol": c["underlying"]},
            "is_mini_option": c["isMini"],
        },
        "trade_date": str(executed_at),
        "currency": "USD",
        "_provisional": True,
    }


async def _fetch_orders(user_id: str, ba: dict) -> list[dict] | None:
    """Network phase only — safe to run concurrently across accounts."""
    bu = connections.get_broker_user(user_id)
    if bu is None:
        return None
    return await snap.get_recent_orders(
        bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"])


def _apply_orders(user_id: str, ba: dict, orders: list[dict]) -> dict[str, Any]:
    """DB phase — serialized by the caller (auth.db single-writer)."""
    provisional = []
    for o in orders or []:
        if not isinstance(o, dict):
            continue
        act = order_to_provisional_activity(o)
        if act is None:
            act = order_to_provisional_option_activity(o)
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
        from api.services.journal_two.broker import balances
        all_acts = activities_store.get_activities(user_id, ba["id"])
        settings = accounts_service.get_account_settings(user_id, ba["j2AccountId"])
        recon = reconstruct.reconstruct_account(
            user_id, ba["id"], ba["j2AccountId"], all_acts, settings)
        # Optimistic Open-Positions update — NO broker holdings call (stays
        # inside the polling cap). Shrink/close only the rows whose real FIFO
        # basis now shows fewer/zero shares, so an intraday exit leaves Open
        # Positions immediately instead of lingering with a stale share count
        # until the next full sync.
        balances.apply_intraday_fifo_to_open_positions(
            user_id, ba, recon.get("openPositions") or [],
            fifo_errors=recon.get("fifoErrors") or [])
        # Growth counterpart: post-balance-sync equity fills materialize as
        # served (provisional) rows in minutes — the 2026-08-26 gap where
        # the ledger + cash knew about a $10,990 fill all day while the
        # book couldn't show it. The work list is the LEDGER WINDOW since
        # the balance write (live_cash.window_fill_starts), not just this
        # poll's fills — a fill that landed while this pass was down (or
        # before it deployed) still materializes on the next poll. The
        # growth gates (FIFO origin at the fill, ledger-complete rows only)
        # bound what may appear.
        try:
            from api.services.journal_two.broker import live_cash as _live_cash
            acct_row = accounts_service.get_account(user_id, ba["j2AccountId"])
            traded = _live_cash.window_fill_starts(
                user_id, ba["id"],
                (acct_row or {}).get("brokerBalanceSyncedAt"))
        except Exception:  # noqa: BLE001 — fall back to this poll's fills
            traded = {}
            for act in provisional:
                if act.get("option_symbol"):
                    continue
                sym = (act.get("symbol") or {}).get("symbol")
                ts = str(act.get("trade_date") or "")
                if sym and ts and (sym not in traded or ts < traded[sym]):
                    traded[sym] = ts
        if traded:
            balances.apply_intraday_growth(
                user_id, ba, recon.get("openPositions") or [],
                traded_symbols=traded,
                fifo_errors=recon.get("fifoErrors") or [])
        historical_equity.invalidate_cache(user_id)
    except Exception:  # noqa: BLE001 — provisional rows are already stored;
        logger.exception("local reconstruction after intraday fill failed")
    logger.info("intraday fills: %s new for account %s", stored["new"], ba["id"])
    return {"orders": len(orders), "new": stored["new"]}


async def poll_account(user_id: str, ba: dict) -> dict[str, Any]:
    """One poll for one account: fetch recent orders, inject any new
    executed equity fills, and re-reconstruct from the LOCAL ledger."""
    orders = await _fetch_orders(user_id, ba)
    if orders is None:
        return {"skipped": "no identity"}
    return _apply_orders(user_id, ba, orders)


_FETCH_CONCURRENCY = 8


async def poll_all_accounts() -> dict[str, Any]:
    """Scheduler entry (every 5 min). Network fetches run CONCURRENTLY
    (semaphore 8) so the sweep finishes within its tick even at hundreds of
    accounts; DB writes stay strictly serial (auth.db single-writer).
    Never raises."""
    if not (_enabled() and snap.is_configured() and _in_market_window()):
        return {"skipped": True}
    from api.services.journal_two.broker.sync import _user_is_paid
    polled = new_total = errors = 0
    paid_cache: dict[str, bool] = {}
    try:
        due = []
        for ba in connections.list_all_sync_enabled_accounts():
            if ba.get("status") != "active":
                continue
            if not _budget_allows(ba["id"]):
                continue  # on-open check already covered this window
            if not _user_is_paid(ba["userId"], paid_cache):
                continue
            _budget_spend(ba["id"])
            due.append(ba)

        sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

        async def _fetch_one(acct: dict):
            async with sem:
                try:
                    return await _fetch_orders(acct["userId"], acct)
                except Exception:  # noqa: BLE001
                    logger.warning("recent-orders fetch failed for %s",
                                   acct["id"], exc_info=True)
                    return "error"

        fetched = await asyncio.gather(*(_fetch_one(a) for a in due)) if due else []

        # Apply phase: serial, one account at a time.
        for ba, orders in zip(due, fetched):
            if orders == "error":
                errors += 1
                continue
            if orders is None:
                continue
            try:
                out = _apply_orders(ba["userId"], ba, orders)
                polled += 1
                new_total += int(out.get("new") or 0)
            except Exception:  # noqa: BLE001 — one account never blocks the rest
                errors += 1
                logger.warning("recent-orders apply failed for %s", ba["id"],
                               exc_info=True)
    except Exception:  # noqa: BLE001
        logger.exception("recent-orders sweep failed")
    return {"polled": polled, "newFills": new_total, "errors": errors}


async def check_user_now(user_id: str) -> dict[str, Any]:
    """Instant on-open check: the member just opened their journal — poll
    their accounts' recent orders NOW (within the shared 5-min per-account
    budget) so a fill they just made appears in seconds, not minutes.
    User-action-driven, so it's the same compliance class as on-login
    refresh. Never raises."""
    if not (_enabled() and snap.is_configured() and _in_market_window()):
        return {"checked": 0, "newFills": 0, "skipped": True}
    checked = new_total = 0
    try:
        for ba in connections.list_broker_accounts(user_id):
            if not ba.get("syncEnabled") or ba.get("status") != "active":
                continue
            if not _budget_allows(ba["id"]):
                continue
            try:
                _budget_spend(ba["id"])
                out = await poll_account(user_id, ba)
                checked += 1
                new_total += int(out.get("new") or 0)
            except Exception:  # noqa: BLE001
                logger.warning("on-open fills check failed for %s", ba["id"],
                               exc_info=True)
    except Exception:  # noqa: BLE001
        logger.exception("on-open fills check failed")
    return {"checked": checked, "newFills": new_total}


def run_poll_blocking() -> None:
    """APScheduler entry. Never raises into the scheduler."""
    import asyncio
    try:
        asyncio.run(poll_all_accounts())
    except Exception as e:  # noqa: BLE001
        logger.warning("recent-orders poll run failed: %s", e)
