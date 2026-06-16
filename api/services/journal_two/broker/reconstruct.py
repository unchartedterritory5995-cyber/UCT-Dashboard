"""Reconstruct broker trades from a stream of SnapTrade activities.

Pipeline:
  activities → adapter.partition → fifo.reconstruct_trades(allow_shorts=True)
            → deterministic external_id per round-trip → bulk_insert (skip dups)

Idempotency: each reconstructed round-trip gets a STABLE fingerprint derived
from (broker account, symbol, side, dates, shares, prices) plus an ordinal
that disambiguates genuinely-identical round-trips. Because FIFO walks the
same sorted fills every run, the ordinals are stable, so re-running over the
same activity history imports zero duplicate trades.

Open positions (FIFO leftovers) and option events are returned for the
holdings reconciliation (Phase 3) and option reconstruction (Phase 4); this
module only writes equity/short round-trip trades.
"""

from __future__ import annotations

import hashlib
import sqlite3
from typing import Any

from api.services.journal_two import trades as trades_service
from api.services.journal_two.broker import snaptrade_adapter as adapter
from api.services.journal_two import fifo


def _fingerprint(broker_account_id: str, t: dict, ordinal: int) -> str:
    base = "|".join(str(x) for x in (
        broker_account_id, t["symbol"], t["side"], t["entryDate"], t["exitDate"],
        t["shares"], t["entryPrice"], t["exitPrice"], ordinal,
    ))
    return "bk:" + hashlib.sha1(base.encode("utf-8")).hexdigest()


def assign_external_ids(broker_account_id: str, trades: list[dict]) -> None:
    """Stamp a stable externalId on each reconstructed trade in place.
    Identical round-trips are disambiguated by a deterministic ordinal."""
    seen: dict[str, int] = {}
    for t in trades:
        key = "|".join(str(x) for x in (
            t["symbol"], t["side"], t["entryDate"], t["exitDate"],
            t["shares"], t["entryPrice"], t["exitPrice"],
        ))
        n = seen.get(key, 0)
        seen[key] = n + 1
        t["externalId"] = _fingerprint(broker_account_id, t, n)


def reconstruct_account(
    user_id: str,
    broker_account_id: str,
    j2_account_id: str,
    activities: list[dict],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Reconstruct + persist equity/short round-trip trades from this
    account's activities. Returns a summary including the leftover open
    positions and the option events (for later phases)."""
    part = adapter.partition(activities)
    fifo_out = fifo.reconstruct_trades(part["equity_fills"], allow_shorts=True)
    trades = fifo_out["trades"]
    assign_external_ids(broker_account_id, trades)

    ins = trades_service.bulk_insert_trades(
        user_id, trades, settings, conn=conn,
        account_id=j2_account_id, source="broker",
    )

    return {
        "imported": ins["imported"],
        "skipped": ins["skipped"],
        "tradesReconstructed": len(trades),
        "openPositions": fifo_out["open_positions"],
        "optionEvents": part["option_events"],
        "cashCount": len(part["cash"]),
        "transferCount": len(part["transfers"]),
        "fifoErrors": fifo_out["errors"],
        "skippedActivities": part["skipped"],
    }
