"""True Risk Engine — MAE/MFE excursions for closed trades, from OUR OWN bars.

The July teardown's #1 analytics weakness: broker-imported trades carry no
stop, so r_multiple is null and the edge analytics (expectancy, R
distribution) go thin for exactly the members the product is FOR. Competitors
can't fix this — they don't own a market-data stack. We do.

For every closed equity trade we replay the holding window against real bars:

  MAE  (max adverse excursion)  — the worst the trade went against the member
  MFE  (max favorable excursion) — the best it offered
  efficiency — realized P&L as a share of the MFE dollar (how much of the
               best available move was captured)
  True R     — P&L / |MAE$|: the R-multiple against the risk ACTUALLY taken,
               no stop required. A trade that never ticked against its entry
               has no defined True R (mae 0) and reports None.

Bars: daily aggregates for multi-day holds (interior days fully covered;
entry/exit-day highs/lows are the session's, a documented approximation),
5-minute bars clipped to the entry/exit timestamps for same-day trades.
Values are point-in-time (unadjusted) — matching the trade's own prices.

Storage: j2_trade_excursions (one row per trade, upsert — recompute-safe).
Backfill is batched per symbol (one daily-agg fetch spans all of a symbol's
trades) and runs best-effort in the background after syncs, plus on demand.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services import massive
from api.services.auth_db import get_connection

logger = logging.getLogger("j2_excursions")

_inflight_users: set[str] = set()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(v) -> datetime | None:
    if not v:
        return None
    try:
        s = str(v).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def compute_excursions(side: str, entry_price: float, shares: float,
                       pnl_dollar: float | None,
                       bars: list[dict]) -> dict[str, Any] | None:
    """Pure math over [{h, l}] bars for the holding window. Long/short aware;
    returns None when there is nothing to measure."""
    if not bars or not entry_price or entry_price <= 0 or not shares:
        return None
    highs = [float(b["h"]) for b in bars if b.get("h") is not None]
    lows = [float(b["l"]) for b in bars if b.get("l") is not None]
    if not highs or not lows:
        return None
    hi, lo = max(highs), min(lows)
    if side == "Short":
        adverse_px, favorable_px = hi, lo          # up hurts, down helps
        mae_per_share = min(0.0, entry_price - adverse_px)
        mfe_per_share = max(0.0, entry_price - favorable_px)
    else:
        adverse_px, favorable_px = lo, hi
        mae_per_share = min(0.0, adverse_px - entry_price)
        mfe_per_share = max(0.0, favorable_px - entry_price)
    mae_dollar = round(mae_per_share * abs(shares), 2)
    mfe_dollar = round(mfe_per_share * abs(shares), 2)
    mae_pct = round(mae_per_share / entry_price * 100, 4)
    mfe_pct = round(mfe_per_share / entry_price * 100, 4)
    efficiency = None
    true_r = None
    if pnl_dollar is not None:
        if mfe_dollar > 0:
            efficiency = round(float(pnl_dollar) / mfe_dollar * 100, 2)
        if mae_dollar < 0:
            true_r = round(float(pnl_dollar) / abs(mae_dollar), 3)
    return {
        "mae_dollar": mae_dollar, "mae_pct": mae_pct,
        "mfe_dollar": mfe_dollar, "mfe_pct": mfe_pct,
        "efficiency_pct": efficiency, "true_r": true_r,
    }


def _bars_for_trade(trade: dict, daily_by_symbol: dict[str, list[dict]]) -> tuple[list[dict], str]:
    """Bars covering the holding window: daily slice for multi-day holds,
    5-minute clipped to the entry/exit timestamps for same-day trades."""
    entry = _parse_ts(trade["entry_date"])
    exit_ = _parse_ts(trade["exit_date"])
    if entry is None or exit_ is None:
        return [], "D"
    e_day, x_day = entry.date(), exit_.date()
    if e_day == x_day:
        day = e_day.isoformat()
        bars = massive.get_minute_agg(trade["symbol"], day, day, multiplier=5)
        lo_ms = int(entry.timestamp() * 1000) - 5 * 60_000
        hi_ms = int(exit_.timestamp() * 1000) + 5 * 60_000
        clipped = [b for b in bars if lo_ms <= int(b.get("t") or 0) <= hi_ms]
        if clipped:
            return clipped, "5"
        # Timestamps may be date-only (midnight) — fall back to the whole day.
        if bars:
            return bars, "5"
    daily = daily_by_symbol.get(trade["symbol"]) or []
    lo_ms = int(datetime(e_day.year, e_day.month, e_day.day,
                         tzinfo=timezone.utc).timestamp() * 1000) - 12 * 3600_000
    hi_ms = int(datetime(x_day.year, x_day.month, x_day.day,
                         tzinfo=timezone.utc).timestamp() * 1000) + 36 * 3600_000
    return [b for b in daily if lo_ms <= int(b.get("t") or 0) <= hi_ms], "D"


def backfill_user(user_id: str, account_id: str | None = None,
                  limit: int = 200, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Compute excursions for closed equity trades that don't have them yet.
    Batched: one daily-agg fetch per symbol spans all its trades."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = ("SELECT t.id, t.symbol, t.side, t.shares, t.entry_price, "
               "t.entry_date, t.exit_date, t.pnl_dollar "
               "FROM j2_trades t LEFT JOIN j2_trade_excursions e ON e.trade_id = t.id "
               "WHERE t.user_id = ? AND t.exit_date IS NOT NULL AND e.trade_id IS NULL")
        params: list = [user_id]
        if account_id:
            sql += " AND t.account_id = ?"
            params.append(account_id)
        sql += " ORDER BY t.exit_date DESC LIMIT ?"
        params.append(int(limit))
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        if owned:
            conn.close()
    if not rows:
        return {"computed": 0, "pending": 0}

    # One daily fetch per symbol across its full trade span.
    spans: dict[str, tuple[str, str]] = {}
    for t in rows:
        e = str(t["entry_date"])[:10]
        x = str(t["exit_date"])[:10]
        if t["symbol"] in spans:
            lo, hi = spans[t["symbol"]]
            spans[t["symbol"]] = (min(lo, e), max(hi, x))
        else:
            spans[t["symbol"]] = (e, x)
    daily_by_symbol: dict[str, list[dict]] = {}
    for sym, (lo, hi) in spans.items():
        hi_pad = (datetime.fromisoformat(hi) + timedelta(days=1)).date().isoformat()
        daily_by_symbol[sym] = massive.get_daily_agg(sym, lo, hi_pad, adjusted=False)

    computed = 0
    conn = get_connection()
    try:
        for t in rows:
            try:
                bars, tf = _bars_for_trade(t, daily_by_symbol)
                out = compute_excursions(t["side"], float(t["entry_price"] or 0),
                                         float(t["shares"] or 0),
                                         t["pnl_dollar"], bars)
                if out is None:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO j2_trade_excursions "
                    "(trade_id, user_id, mae_dollar, mae_pct, mfe_dollar, mfe_pct, "
                    " efficiency_pct, true_r, bars_tf, computed_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (t["id"], user_id, out["mae_dollar"], out["mae_pct"],
                     out["mfe_dollar"], out["mfe_pct"], out["efficiency_pct"],
                     out["true_r"], tf, _now_iso()),
                )
                computed += 1
            except Exception:  # noqa: BLE001 — one bad trade never blocks the rest
                logger.warning("excursion compute failed for trade %s", t["id"],
                               exc_info=True)
        conn.commit()
    finally:
        conn.close()
    return {"computed": computed, "pending": max(0, len(rows) - computed)}


def maybe_backfill_after_sync(user_id: str, limit: int = 50) -> bool:
    """Fire a small background backfill after a sync (new closed trades get
    their excursions within the same sync cycle). Never blocks, never raises."""
    if user_id in _inflight_users:
        return False
    _inflight_users.add(user_id)

    def _work():
        try:
            backfill_user(user_id, limit=limit)
        except Exception:  # noqa: BLE001
            pass
        finally:
            _inflight_users.discard(user_id)

    threading.Thread(target=_work, daemon=True).start()
    return True


def excursions_map(user_id: str, account_id: str | None = None,
                   conn: sqlite3.Connection | None = None) -> dict[str, dict]:
    """{tradeId: {maeDollar, maePct, mfeDollar, mfePct, efficiencyPct, trueR}}
    for the trade log / drawer to merge client-side."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = ("SELECT e.trade_id, e.mae_dollar, e.mae_pct, e.mfe_dollar, "
               "e.mfe_pct, e.efficiency_pct, e.true_r "
               "FROM j2_trade_excursions e JOIN j2_trades t ON t.id = e.trade_id "
               "WHERE e.user_id = ?")
        params: list = [user_id]
        if account_id:
            sql += " AND t.account_id = ?"
            params.append(account_id)
        out: dict[str, dict] = {}
        for r in conn.execute(sql, params).fetchall():
            out[r["trade_id"]] = {
                "maeDollar": r["mae_dollar"], "maePct": r["mae_pct"],
                "mfeDollar": r["mfe_dollar"], "mfePct": r["mfe_pct"],
                "efficiencyPct": r["efficiency_pct"], "trueR": r["true_r"],
            }
        return out
    finally:
        if owned:
            conn.close()
