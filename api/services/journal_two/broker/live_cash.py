"""Effective broker cash between balance syncs — derived, never restated.

`j2_accounts.broker_cash` is written only when a sync runs (daily pre-market
for most accounts), while the fills rail moves the served BOOK within minutes
of a trade. The account hero computes net-liq as cash + live market value, so
every intraday BUY double-counted its cost (position visible, cash never
debited) and every SELL vanished its proceeds — the 2026-08-26 incident: a
$10,990 SNAP buy showed a $21,763 hero on a $10,772 account.

This module derives the cash the broker actually has NOW: the stored cash
plus the signed cash effect of every BUY/SELL activity that OCCURRED after
the balance write. The activity ledger is the one authority — the same rows
that made the position visible are the rows that move the cash, so the two
sides of net-liq can never be of different vintages again.

Scope discipline:
- Only BUY/SELL rows adjust. Deposits/dividends/interest/fees are delivered
  T+1 by a sync that also rewrites the balance (and its synced-at watermark),
  so they are never double-counted — and never modeled here.
- The broker's cash at sync time is real-time: a fill that occurred BEFORE
  the balance write is already inside the stored figure even when its ledger
  row arrives later, so the window filters on occurred_at, not created_at.
  (MEASURED for Robinhood, 2026-08-21 + 2026-08-26: the balance payload's
  cash component tracks fills live — the 8/26 SNAP buy moved the fetched
  cash by exactly its cost. A broker whose balance CACHE lags would leave a
  gap between its snapshot and our write; the alternative watermark,
  sync_status.holdings.last_successful_sync, would instead double-count on
  the measured-live brokers, so the write time stays the watermark.)
- Date-only brokers (Schwab-family activities stamped at midnight) are
  under-covered by construction: a midnight occurred_at sorts before a
  pre-market balance write, so same-day fills don't adjust. That degrades to
  exactly the pre-derivation behavior (stale cash until sync), never worse.
- A balance write older than _MAX_SYNC_AGE_DAYS disables the derivation:
  that gap legitimately carries non-trade cash flows, and the honest answer
  is the stored figure, unadjusted.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
# Module import, not from-import: `balances` is the ONE authority on the
# contract-size rule (mini option = 10), same pattern as option_reconstruct.
from api.services.journal_two.broker import balances as _balances

_TRADE_TYPES = ("BUY", "SELL")
_MAX_SYNC_AGE_DAYS = 7


def _num(v: Any) -> float | None:
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and x not in (float("inf"), float("-inf")) else None


def _ts(v: Any) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def fill_cash_effect(act: dict) -> float | None:
    """Signed cash effect of one BUY/SELL activity (raw ledger dict), or None
    when the row isn't a computable trade. Option prices are PER-SHARE premium
    (the ledger convention — real SnapTrade rows and referee-normalized
    provisionals alike), scaled by the contract multiplier.

    Unit sign is UNTRUSTED (brokers report sells with negative units; every
    adapter lane abs()'s units and takes direction from the type) — the sign
    here comes from BUY/SELL alone. A row classified option-shaped by
    `option_type` but carrying no `option_symbol` is excluded outright: the
    reconstruction lane skips those too, and cash must only move where the
    BOOK moved (same-vintage discipline)."""
    if not isinstance(act, dict):
        return None
    typ = str(act.get("type") or "").upper()
    if typ not in _TRADE_TYPES:
        return None
    if act.get("option_type") and not act.get("option_symbol"):
        return None
    units = _num(act.get("units"))
    price = _num(act.get("price"))
    if units is None or price is None or abs(units) <= 1e-9 or price <= 0:
        return None
    fee = _num(act.get("fee")) or 0.0
    mult = 1.0
    if act.get("option_symbol"):
        mult = float(_balances._opt_contract_multiplier(
            {"symbol": {"option_symbol": act.get("option_symbol")}}))
    gross = abs(units) * price * mult
    return (gross if typ == "SELL" else -gross) - abs(fee)


def effective_cash(
    user_id: str,
    broker_account_id: str,
    stored_cash: float | None,
    balance_synced_at: str | None,
    conn: sqlite3.Connection | None = None,
    *,
    now_iso: str | None = None,
) -> dict[str, Any]:
    """{"cash": float|None, "adjustment": float, "fills": int} — the stored
    cash carried forward over post-balance-sync fills. Passthrough (adjustment
    0) whenever the derivation can't be done honestly."""
    base = _num(stored_cash)
    out = {"cash": base, "adjustment": 0.0, "fills": 0,
           "buyCost": 0.0, "sellProceeds": 0.0}
    synced = _ts(balance_synced_at)
    if base is None or synced is None:
        return out
    now = _ts(now_iso) or datetime.now(timezone.utc)
    if now - synced > timedelta(days=_MAX_SYNC_AGE_DAYS):
        return out

    owned = conn is None
    conn = conn or get_connection()
    try:
        # Day-granular SQL prefilter (a bare date prefix-compares correctly
        # against both "…Z" and "…+00:00" ISO forms); the precise, parsed
        # comparison happens below.
        floor = (synced - timedelta(days=1)).date().isoformat()
        # UPPER(): activity_type is stored VERBATIM from the broker payload
        # (activities_store never normalizes), and every adapter read
        # upper()s defensively — the SQL prefilter must match that posture.
        rows = conn.execute(
            "SELECT raw_json, occurred_at FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ? "
            "  AND UPPER(activity_type) IN (?, ?) AND occurred_at >= ?",
            (user_id, broker_account_id, *_TRADE_TYPES, floor),
        ).fetchall()
    finally:
        if owned:
            conn.close()

    adjustment = 0.0
    fills = 0
    buy_cost = sell_proceeds = 0.0
    for row in rows:
        occurred = _ts(row["occurred_at"])
        if occurred is None or occurred <= synced:
            continue
        try:
            act = json.loads(row["raw_json"])
        except (TypeError, ValueError):
            continue
        effect = fill_cash_effect(act)
        if effect is None:
            continue
        adjustment += effect
        fills += 1
        if effect < 0:
            buy_cost += -effect
        else:
            sell_proceeds += effect

    out["cash"] = round(base + adjustment, 2)
    out["adjustment"] = round(adjustment, 2)
    out["fills"] = fills
    out["buyCost"] = round(buy_cost, 2)
    out["sellProceeds"] = round(sell_proceeds, 2)
    return out


def coverage(user_id: str, broker_account_id: str, conn=None) -> str:
    """'full' | 'date_only' | 'unknown' — whether this broker's trade
    activities carry real timestamps. Date-only brokers (Schwab family stamps
    every activity at midnight) are under-covered by the derivation BY
    DESIGN: a midnight occurred_at sorts before a pre-market balance write,
    so same-day fills never adjust — behavior degrades to the stored cash,
    never worse. Surfaced so the trust center and tuning decisions can see
    which accounts the live-cash rail actually protects."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT occurred_at FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ? "
            "  AND UPPER(activity_type) IN (?, ?) "
            "ORDER BY occurred_at DESC LIMIT 25",
            (user_id, broker_account_id, *_TRADE_TYPES),
        ).fetchall()
    finally:
        if owned:
            conn.close()
    if not rows:
        return "unknown"
    midnight = sum(1 for r in rows
                   if "T00:00:00" in str(r["occurred_at"] or ""))
    return "date_only" if midnight / len(rows) >= 0.8 else "full"


def annotate_accounts(
    user_id: str,
    accounts: list[dict],
    conn: sqlite3.Connection | None = None,
) -> list[dict]:
    """Stamp `brokerCashLive` / `brokerCashLiveFills` on every broker-linked
    account dict (as served by accounts_service). Non-broker accounts and any
    failure leave the dicts untouched — the FE falls back to `brokerCash`."""
    broker_accounts = [
        a for a in accounts
        if isinstance(a, dict) and a.get("balanceSource") == "broker"
    ]
    if not broker_accounts:
        return accounts
    owned = conn is None
    conn = conn or get_connection()
    try:
        mapping = {
            row["j2_account_id"]: row["id"]
            for row in conn.execute(
                "SELECT id, j2_account_id FROM j2_broker_accounts WHERE user_id = ?",
                (user_id,),
            )
        }
        for a in broker_accounts:
            broker_account_id = mapping.get(a.get("id"))
            if not broker_account_id:
                continue
            try:
                out = effective_cash(
                    user_id, broker_account_id, a.get("brokerCash"),
                    a.get("brokerBalanceSyncedAt"), conn=conn,
                )
            except Exception:  # noqa: BLE001 — annotation must never break the list
                continue
            a["brokerCashLive"] = out["cash"]
            a["brokerCashLiveFills"] = out["fills"]
    finally:
        if owned:
            conn.close()
    return accounts
