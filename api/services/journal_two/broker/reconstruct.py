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
import logging
import os
import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import trades as trades_service
from api.services.journal_two.broker import snaptrade_adapter as adapter
from api.services.journal_two import fifo

logger = logging.getLogger(__name__)


def _dust_max_notional() -> float:
    """Round-trips below this $ notional are treated as dust (default $10).
    Set BROKER_DUST_MAX_NOTIONAL=0 to disable the filter entirely."""
    try:
        return float(os.environ.get("BROKER_DUST_MAX_NOTIONAL", "10"))
    except (TypeError, ValueError):
        return 10.0


def _filter_dust(trades: list[dict]) -> tuple[list[dict], list[dict]]:
    """Drop phantom micro-SHORT round-trips — the DRIP/fractional + pre-history-gap
    artifacts (e.g. SPY 0.0133sh) that holdings-as-truth already suppresses from
    open positions but that otherwise litter the closed-trade log. Scoped to
    Shorts because long round-trips fold their fractional DRIP shares into the
    parent sell; an intentional sub-$10 short doesn't occur in practice. Real
    shorts of meaningful size and ALL longs are kept. Returns (kept, dust)."""
    thresh = _dust_max_notional()
    if thresh <= 0:
        return trades, []
    kept: list[dict] = []
    dust: list[dict] = []
    for t in trades:
        notional = abs((t.get("shares") or 0.0) * (t.get("entryPrice") or 0.0))
        if t.get("side") == "Short" and notional < thresh:
            dust.append(t)
        else:
            kept.append(t)
    return kept, dust


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
    # Drop phantom micro-short dust BEFORE assigning external_ids + computing the
    # desired set, so dust never imports AND any dust already in j2_trades from a
    # pre-filter sync is pruned below (it's no longer in desired_trade_exts).
    trades, dust = _filter_dust(trades)
    if dust:
        logger.info(
            "[broker] dropped %d dust short round-trip(s): %s",
            len(dust), ", ".join(sorted({d["symbol"] for d in dust})),
        )
    assign_external_ids(broker_account_id, trades)

    ins = trades_service.bulk_insert_trades(
        user_id, trades, settings, conn=conn,
        account_id=j2_account_id, source="broker",
    )

    # Single-leg option strategies (incl. expiration/assignment/exercise).
    from api.services.journal_two.broker import option_reconstruct
    opt_res = option_reconstruct.reconstruct_options(
        user_id, broker_account_id, j2_account_id, part["option_events"], conn=conn
    )

    # Corrections heal: because reconstruction runs over the FULL (already
    # ledger-healed) activity history every sync, the trade/strategy sets above
    # are the COMPLETE desired state. Prune any broker-sourced rows for this
    # account that are no longer desired — i.e. their source activity was
    # voided/amended at the broker. Manual rows (source != 'broker') are never
    # touched. Unchanged rows keep their id (and any linked Compass reviews).
    desired_trade_exts = {t["externalId"] for t in trades}
    pruned_trades = _prune_broker_trades(user_id, j2_account_id, desired_trade_exts, conn=conn)
    pruned_options = _prune_broker_option_strategies(
        user_id, j2_account_id, opt_res.get("desiredExternalIds", set()), conn=conn
    )

    return {
        "imported": ins["imported"],
        "skipped": ins["skipped"],
        "tradesReconstructed": len(trades),
        "dustDropped": len(dust),
        "prunedTrades": pruned_trades,
        "prunedOptions": pruned_options,
        "openPositions": fifo_out["open_positions"],
        "optionEvents": part["option_events"],
        "optionsImported": opt_res["imported"],
        "optionsSkipped": opt_res["skipped"],
        "cashCount": len(part["cash"]),
        "transferCount": len(part["transfers"]),
        "fifoErrors": fifo_out["errors"],
        "skippedActivities": part["skipped"],
    }


def _prune_broker_trades(user_id, j2_account_id, desired_exts, conn=None) -> int:
    """Delete broker-sourced trades for the account whose external_id is no
    longer in the desired set (voided/amended source activities)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, external_id FROM j2_trades "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND external_id IS NOT NULL",
            (user_id, j2_account_id),
        ).fetchall()
        stale = [r["id"] for r in rows if r["external_id"] not in desired_exts]
        if stale:
            conn.executemany("DELETE FROM j2_trades WHERE id = ?", [(i,) for i in stale])
            conn.commit()
        return len(stale)
    finally:
        if owned:
            conn.close()


def _prune_broker_option_strategies(user_id, j2_account_id, desired_exts, conn=None) -> int:
    """Delete broker-sourced option strategies (legs cascade) no longer desired."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, external_id FROM j2_option_strategies "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND external_id IS NOT NULL",
            (user_id, j2_account_id),
        ).fetchall()
        stale = [r["id"] for r in rows if r["external_id"] not in desired_exts]
        if stale:
            conn.executemany("DELETE FROM j2_option_strategies WHERE id = ?", [(i,) for i in stale])
            conn.commit()
        return len(stale)
    finally:
        if owned:
            conn.close()
