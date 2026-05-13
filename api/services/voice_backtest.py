"""
Compass P5-D: backtest-on-demand.

Reads closed trades from j2_trades and aggregates by setup + date range
+ optional regime, returning stats Compass can speak. Used by the
`analyze_setup_in_period` voice tool.

No new data — pure read against the existing journal. Answers questions
like:

  - "How did Bull Flag do over the last 90 days?"
  - "What's my pullback win rate this quarter?"
  - "How did flag setups perform in AMBER regime YTD?"

Returns a rich payload with by-month breakdown for trend visibility.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

_log = logging.getLogger(__name__)


def _parse_date(s: str | None) -> str | None:
    """Normalize a YYYY-MM-DD or ISO date string. Returns None on garbage."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Try strict YYYY-MM-DD first
    try:
        datetime.strptime(s[:10], "%Y-%m-%d")
        return s[:10]
    except ValueError:
        return None


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _regime_for_trade(trade: dict) -> str | None:
    """Best-effort: extract a regime label from context_at_entry JSON
    if present. Falls back to None when unknown."""
    ctx = trade.get("context_at_entry")
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx) if ctx.strip().startswith("{") else None
        except (TypeError, ValueError):
            ctx = None
    if isinstance(ctx, dict):
        return (ctx.get("regime") or ctx.get("phase") or "").upper() or None
    return None


def analyze_setup_in_period(
    user_id: str,
    *,
    setup: str | None = None,
    days: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    regime: str | None = None,
    account_id: str | None = None,
) -> dict:
    """Aggregate closed trades over a date range. Returns stats + by-month.

    Either `days` (relative lookback) or `start_date`/`end_date`. If both
    are missing, defaults to last 90 days.

    Filters:
      - setup: case-insensitive exact match against trade.setup
      - regime: matches the regime label in context_at_entry
    """
    if account_id is None:
        try:
            from api.services.trader_memory import get_default_account_id
            account_id = get_default_account_id(user_id)
        except Exception:
            account_id = None

    # Date range
    end_iso = _parse_date(end_date) or datetime.now(timezone.utc).date().isoformat()
    if start_date:
        start_iso = _parse_date(start_date) or end_iso
    elif days:
        n = max(1, min(3650, int(days)))
        start_iso = (
            datetime.fromisoformat(end_iso) - timedelta(days=n)
        ).date().isoformat()
    else:
        start_iso = (
            datetime.fromisoformat(end_iso) - timedelta(days=90)
        ).date().isoformat()

    # Pull trades
    try:
        from api.services.journal_two.trades import list_trades_for_user
        trades = list_trades_for_user(user_id, account_id=account_id) or []
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_backtest] list_trades_for_user failed: %s", e)
        return {
            "ok": False,
            "narration": "Couldn't load your trade history.",
            "error": "trade_fetch_failed",
        }

    # Filter
    setup_norm = (setup or "").strip().lower() or None
    regime_norm = (regime or "").strip().upper() or None

    filtered: list[dict] = []
    for t in trades:
        # Date filter
        exit_date = t.get("exit_date")
        if not exit_date:
            continue  # only closed trades
        d = (exit_date or "")[:10]
        if d < start_iso or d > end_iso:
            continue
        # Setup filter
        if setup_norm:
            t_setup = (t.get("setup") or "").strip().lower()
            if t_setup != setup_norm:
                continue
        # Regime filter
        if regime_norm:
            t_regime = _regime_for_trade(t)
            if (t_regime or "") != regime_norm:
                continue
        filtered.append(t)

    n = len(filtered)
    if n == 0:
        what = f"setup={setup}" if setup else "trades"
        regime_clause = f" in {regime} regime" if regime else ""
        return {
            "ok": True,
            "narration": (
                f"No closed {what}{regime_clause} between {start_iso} and {end_iso}."
            ),
            "trade_count": 0, "start_date": start_iso, "end_date": end_iso,
            "setup": setup, "regime": regime,
        }

    # Aggregate
    wins = 0
    losses = 0
    breakeven = 0
    total_r = 0.0
    total_pnl_d = 0.0
    sum_gain_d = 0.0
    sum_loss_d = 0.0
    r_count = 0
    by_month: dict[str, dict] = {}

    for t in filtered:
        result = (t.get("result") or "").lower()
        r = _to_float(t.get("r_multiple"))
        pnl_d = _to_float(t.get("pnl_dollar")) or 0.0

        if result == "win":
            wins += 1
        elif result == "loss":
            losses += 1
        else:
            breakeven += 1

        if r is not None:
            total_r += r
            r_count += 1

        total_pnl_d += pnl_d
        if pnl_d > 0:
            sum_gain_d += pnl_d
        elif pnl_d < 0:
            sum_loss_d += abs(pnl_d)

        # Monthly bucket — by exit-date month
        ed = (t.get("exit_date") or "")[:7]  # YYYY-MM
        bucket = by_month.setdefault(ed, {
            "trades": 0, "wins": 0, "losses": 0, "total_r": 0.0,
            "pnl_dollar": 0.0,
        })
        bucket["trades"] += 1
        if result == "win":
            bucket["wins"] += 1
        elif result == "loss":
            bucket["losses"] += 1
        if r is not None:
            bucket["total_r"] += r
        bucket["pnl_dollar"] += pnl_d

    decided = wins + losses
    win_rate = (wins / decided * 100.0) if decided else 0.0
    avg_r = (total_r / r_count) if r_count else None
    profit_factor = (sum_gain_d / sum_loss_d) if sum_loss_d > 0 else None

    by_month_list = []
    for k in sorted(by_month.keys()):
        b = by_month[k]
        b_decided = b["wins"] + b["losses"]
        b_wr = (b["wins"] / b_decided * 100.0) if b_decided else 0.0
        by_month_list.append({
            "month": k,
            "trades": b["trades"],
            "wins": b["wins"],
            "losses": b["losses"],
            "win_rate_pct": round(b_wr, 1),
            "total_r": round(b["total_r"], 2),
            "pnl_dollar": round(b["pnl_dollar"], 2),
        })

    setup_label = setup or "all setups"
    regime_clause = f" in {regime} regime" if regime else ""
    narration = (
        f"{setup_label}{regime_clause} from {start_iso} to {end_iso}: "
        f"{n} trades, win rate {win_rate:.1f}%, "
        f"avg R {avg_r:+.2f}, " if avg_r is not None else
        f"{setup_label}{regime_clause} from {start_iso} to {end_iso}: "
        f"{n} trades, win rate {win_rate:.1f}%, "
    )
    pf_str = (f"profit factor {profit_factor:.2f}." if profit_factor is not None
              else "profit factor unavailable.")
    narration = narration + pf_str

    return {
        "ok": True,
        "narration": narration,
        "trade_count": n,
        "wins": wins,
        "losses": losses,
        "breakeven": breakeven,
        "win_rate_pct": round(win_rate, 1),
        "avg_r": round(avg_r, 2) if avg_r is not None else None,
        "total_r": round(total_r, 2),
        "total_pnl_dollar": round(total_pnl_d, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor is not None else None,
        "start_date": start_iso,
        "end_date": end_iso,
        "setup": setup,
        "regime": regime,
        "by_month": by_month_list,
    }
