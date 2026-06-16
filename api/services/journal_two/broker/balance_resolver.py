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

from typing import Any


def resolve_equity(account: dict[str, Any], realized_pnl: float = 0.0) -> dict[str, Any]:
    """Return the account's equity snapshot.

    Broker-linked accounts (balanceSource == 'broker' with a synced equity)
    report the broker's real net-liquidation value, cash, buying power, and
    open-position market value. Manual accounts report
    startingBalance + realized_pnl (the legacy closed-equity rule) and leave
    the broker-only fields null.

    `realized_pnl` is the caller's already-computed sum of closed-trade P&L;
    keeping it a parameter makes this function pure + trivially testable.
    """
    is_broker = (
        account.get("balanceSource") == "broker"
        and account.get("brokerTotalEquity") is not None
    )
    if is_broker:
        return {
            "equity": float(account["brokerTotalEquity"]),
            "cash": _f(account.get("brokerCash")),
            "buyingPower": _f(account.get("brokerBuyingPower")),
            "marketValue": _f(account.get("brokerMarketValue")),
            "source": "broker",
            "syncedAt": account.get("brokerBalanceSyncedAt"),
        }
    starting = _f(account.get("startingBalance")) or 0.0
    return {
        "equity": round(starting + (realized_pnl or 0.0), 2),
        "cash": None,
        "buyingPower": None,
        "marketValue": None,
        "source": "manual",
        "syncedAt": None,
    }


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
