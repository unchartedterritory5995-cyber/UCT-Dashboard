"""Broker balances + holdings reconciliation (holdings-as-truth).

Two responsibilities, both driven by the broker's CURRENT state (not by
replaying activities):

  write_balances(): compute real cash / buying power / market value /
    net-liquidation equity for the account and stamp them on j2_accounts
    (balance_source='broker'). The balance_resolver then prefers these.

  reconcile_positions(): the broker's holdings endpoint is the source of
    truth for OPEN positions. We upsert a j2_positions row per holding,
    seeding entry from real FIFO fills when we have them, else from the
    broker's average cost basis (flagged entry_estimated=1 — a "carried-in"
    position whose true entry predates our activity history). Broker-sourced
    open positions that are no longer held are removed (their closing trade
    was already captured by FIFO).

User enrichments (stop, setup, notes added after import) are preserved
across syncs — we only update broker-owned facts (shares, and the estimated
entry while still estimated).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker.snaptrade_adapter import normalize_symbol


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Field extraction ─────────────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pos_symbol(p: dict) -> str | None:
    sym = p.get("symbol")
    if isinstance(sym, str):
        return normalize_symbol(sym)
    if isinstance(sym, dict):
        inner = sym.get("symbol")
        if isinstance(inner, dict):  # nested universal symbol
            inner = inner.get("symbol") or inner.get("raw_symbol")
        return normalize_symbol(inner or sym.get("raw_symbol"))
    return None


def usd_cash_buying_power(raw_balances: list[dict]) -> tuple[float | None, float | None]:
    """Sum USD cash + buying power across balance entries. Falls back to the
    first entry when no currency is labeled USD (single-currency accounts)."""
    usd = [b for b in raw_balances if _currency_code(b) in (None, "USD")]
    pool = usd or raw_balances
    cash = sum(_num(b.get("cash")) or 0.0 for b in pool) if pool else None
    bps = [_num(b.get("buying_power")) for b in pool if _num(b.get("buying_power")) is not None]
    buying_power = max(bps) if bps else None
    return (cash, buying_power)


def _currency_code(b: dict) -> str | None:
    c = b.get("currency")
    if isinstance(c, str):
        return c.upper()
    if isinstance(c, dict):
        return (c.get("code") or c.get("currency") or "").upper() or None
    return None


def market_value(raw_positions: list[dict]) -> float:
    """Signed mark-to-market of holdings: Σ(units × current price). Short
    positions (negative units) correctly reduce net liquidation value."""
    total = 0.0
    for p in raw_positions:
        units = _num(p.get("units"))
        price = _num(p.get("price"))
        if units is not None and price is not None:
            total += units * price
    return round(total, 2)


# ── Balances ─────────────────────────────────────────────────────────────────

def write_balances(
    user_id: str,
    broker_account: dict,
    raw_balances: list[dict],
    raw_positions: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Compute + persist real broker balances onto the mapped j2_account."""
    cash, buying_power = usd_cash_buying_power(raw_balances)
    mv = market_value(raw_positions)
    equity = round((cash or 0.0) + mv, 2)

    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute(
            """
            UPDATE j2_accounts
               SET balance_source = 'broker',
                   broker_total_equity = ?, broker_cash = ?,
                   broker_buying_power = ?, broker_market_value = ?,
                   broker_balance_synced_at = ?, updated_at = ?
             WHERE id = ? AND user_id = ?
            """,
            (equity, cash, buying_power, mv, _now_iso(), _now_iso(),
             broker_account["j2AccountId"], user_id),
        )
        conn.commit()
    finally:
        if owned:
            conn.close()
    return {"equity": equity, "cash": cash, "buyingPower": buying_power, "marketValue": mv}


# ── Holdings reconciliation (positions) ──────────────────────────────────────

def reconcile_positions(
    user_id: str,
    broker_account: dict,
    raw_positions: list[dict],
    fifo_open_positions: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Make j2_positions match the broker's current holdings. Returns
    {upserted, closed, discrepancies}."""
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]

    # Index FIFO-reconstructed open lots by (symbol, side) for entry seeding.
    fifo_by_key = {(p["symbol"], p["side"]): p for p in fifo_open_positions}

    owned = conn is None
    conn = conn or get_connection()
    upserted = 0
    discrepancies: list[dict] = []
    seen_ext: set[str] = set()
    try:
        conn.execute("BEGIN")
        for p in raw_positions:
            symbol = _pos_symbol(p)
            units = _num(p.get("units"))
            if not symbol or units is None or abs(units) < 1e-9:
                continue
            side = "Long" if units > 0 else "Short"
            shares = round(abs(units) * 10000) / 10000
            avg_cost = _num(p.get("average_purchase_price"))

            fifo_match = fifo_by_key.get((symbol, side))
            if fifo_match is not None:
                entry_price = fifo_match["entryPrice"]
                entry_date = fifo_match["entryDate"]
                entry_estimated = 0
                # Surface a divergence the user/ops may want to know about.
                if abs(fifo_match["shares"] - shares) > 1e-6:
                    discrepancies.append({
                        "symbol": symbol, "side": side,
                        "brokerShares": shares, "fifoShares": fifo_match["shares"],
                    })
            else:
                # Carried-in: no activity history for this holding. Seed entry
                # from the broker's cost basis and flag it as estimated.
                entry_price = avg_cost if avg_cost and avg_cost > 0 else (_num(p.get("price")) or 0.0)
                entry_date = _now_iso()
                entry_estimated = 1

            ext = f"bkpos:{broker_account_id}:{symbol}:{side}"
            seen_ext.add(ext)
            existing = conn.execute(
                "SELECT id, entry_estimated FROM j2_positions "
                "WHERE user_id = ? AND external_id = ?",
                (user_id, ext),
            ).fetchone()

            now = _now_iso()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO j2_positions (
                        id, user_id, symbol, side, entry_date, shares,
                        original_shares, entry_price, stop_price, breakeven_stop,
                        raise_to_breakeven, setup, notes, context_at_entry,
                        created_at, updated_at, closed_at, account_id,
                        source, external_id, entry_estimated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, '{}',
                              ?, ?, NULL, ?, 'broker', ?, ?)
                    """,
                    (str(uuid.uuid4()), user_id, symbol, side, entry_date, shares,
                     shares, entry_price, entry_price, now, now, j2_account_id,
                     ext, entry_estimated),
                )
            else:
                # Update broker-owned facts only. Preserve user enrichments
                # (stop/setup/notes). Refresh estimated entry while still
                # estimated; once we have real fills (entry_estimated=0) keep them.
                if existing["entry_estimated"] == 1 and entry_estimated == 0:
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, original_shares = ?, "
                        "entry_price = ?, entry_date = ?, entry_estimated = 0, updated_at = ? "
                        "WHERE id = ?",
                        (shares, shares, entry_price, entry_date, now, existing["id"]),
                    )
                elif existing["entry_estimated"] == 1:
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, original_shares = ?, "
                        "entry_price = ?, updated_at = ? WHERE id = ?",
                        (shares, shares, entry_price, now, existing["id"]),
                    )
                else:
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, updated_at = ? WHERE id = ?",
                        (shares, now, existing["id"]),
                    )
            upserted += 1

        # Remove broker-sourced open positions no longer held at the broker.
        stale = conn.execute(
            "SELECT id, external_id FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND closed_at IS NULL AND external_id LIKE 'bkpos:%'",
            (user_id, j2_account_id),
        ).fetchall()
        closed = 0
        for row in stale:
            if row["external_id"] not in seen_ext:
                conn.execute("DELETE FROM j2_positions WHERE id = ?", (row["id"],))
                closed += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"upserted": upserted, "closed": closed, "discrepancies": discrepancies}
