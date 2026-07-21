"""Account-equity resolver — the SINGLE chokepoint for "how much is this
account worth" across J2.

The broker-sync feature adopts real broker balances + mark-to-market, but
ONLY for broker-linked accounts. Manual accounts keep the long-standing
invariant (equity = startingBalance + realized closed-trade P&L) so users
who never connect a broker see no behavior change.

Every site that previously computed account equity from closed trades should
route through `resolve_equity` so the broker-vs-manual decision lives in one
place.
"""

from __future__ import annotations

import math
from typing import Any


def resolve_equity(account: dict[str, Any], realized_pnl: float = 0.0) -> dict[str, Any]:
    """Return the account's equity snapshot.

    Broker-linked accounts report the broker's real net-liquidation value, cash,
    buying power, and open-position market value — never a reconstructed figure.
    Manual accounts report startingBalance + realized_pnl (the legacy
    closed-equity rule) and leave the broker-only fields null.

    INV-1 (no reconstructed current-state): a broker account whose broker equity
    hasn't synced yet (or is non-finite) reports `equity: None` with
    `pending: True` — an explicit "syncing" state (the UI renders "—"), NEVER
    `startingBalance + realized_pnl`. Presenting a reconstructed number as a
    broker account's balance is exactly the class of bug that let a −$17,774
    fabrication reach a screen; a broker account must only ever show broker truth.

    `realized_pnl` is the caller's already-computed sum of closed-trade P&L;
    keeping it a parameter makes this function pure + trivially testable.
    """
    if account.get("balanceSource") == "broker":
        equity = _f(account.get("brokerTotalEquity"))
        pending = equity is None or not math.isfinite(equity)
        return {
            "equity": None if pending else equity,
            "cash": _f(account.get("brokerCash")),
            "buyingPower": _f(account.get("brokerBuyingPower")),
            "marketValue": _f(account.get("brokerMarketValue")),
            "source": "broker",
            "syncedAt": account.get("brokerBalanceSyncedAt"),
            "pending": pending,
        }
    starting = _f(account.get("startingBalance")) or 0.0
    return {
        "equity": round(starting + (realized_pnl or 0.0), 2),
        "cash": None,
        "buyingPower": None,
        "marketValue": None,
        "source": "manual",
        "syncedAt": None,
        "pending": False,
    }


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
