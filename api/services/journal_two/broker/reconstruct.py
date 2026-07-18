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

from api.services.auth_db import get_connection
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


def _daily_close_near(symbol: str, date_iso: str) -> float | None:
    """Best-effort split-adjusted daily close on/just before `date_iso` —
    the basis estimate for a share transfer-in whose activity carries no
    price (the true basis lives in the sending account's history). Never
    raises; returns None when bars are unavailable (offline/tests)."""
    try:
        from datetime import date as _date, timedelta
        from api.services import massive
        d = _date.fromisoformat(date_iso[:10])
        bars = massive.get_daily_agg(
            symbol, (d - timedelta(days=7)).isoformat(), d.isoformat(),
            adjusted=True, map_symbol=True,
        )
        closes = [b.get("c") for b in (bars or []) if b.get("c")]
        return float(closes[-1]) if closes else None
    except Exception:
        return None


def _resolve_transfer_basis(adjustments: list[dict], price_fn) -> None:
    """Fill in a per-share price for transfer adjustments that lack one.
    Transfers-IN need it as the FIFO lot basis; transfers-OUT need it so the
    cash-flow ledger can value the outgoing shares as an external flow."""
    for a in adjustments:
        if a["kind"] == "transfer" and not a.get("price"):
            p = price_fn(a["symbol"], a["date"])
            if p and p > 0:
                a["price"] = p


def reconstruct_account(
    user_id: str,
    broker_account_id: str,
    j2_account_id: str,
    activities: list[dict],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    transfer_price_fn=None,
) -> dict[str, Any]:
    """Reconstruct + persist equity/short round-trip trades from this
    account's activities. Returns a summary including the leftover open
    positions and the option events (for later phases)."""
    part = adapter.partition(activities)
    adjustments = part["share_adjustments"]
    if adjustments:
        _resolve_transfer_basis(adjustments, transfer_price_fn or _daily_close_near)
    fifo_out = fifo.reconstruct_trades(
        part["equity_fills"], allow_shorts=True, adjustments=adjustments
    )
    trades = fifo_out["trades"]
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
        "prunedTrades": pruned_trades,
        "prunedOptions": pruned_options,
        "openPositions": fifo_out["open_positions"],
        "optionEvents": part["option_events"],
        "optionsImported": opt_res["imported"],
        "optionsSkipped": opt_res["skipped"],
        "cashCount": len(part["cash"]),
        "transferCount": len(part["transfers"]),
        "shareAdjustments": len(adjustments),
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
