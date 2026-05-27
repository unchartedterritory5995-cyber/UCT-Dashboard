"""Scenario sizing simulator — re-run the user's closed trades with a
different sizing rule to see what would have happened.

Reads j2_trades for the user/account, applies a sizing rule, returns
{actual_pnl, scenario_pnl, delta, by_setup_breakdown}.

Supported rules (v1):
  - "flat_pct"   : risk a flat % per trade (rule_value = pct, e.g. 1.5)
  - "flat_dollar": risk a flat $ per trade (rule_value = dollars)
  - "multiplier" : multiply each trade's actual size by N (rule_value = N)
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

_SUPPORTED_RULES = ("flat_pct", "flat_dollar", "multiplier")


def _trade_actual_risk(trade: dict) -> float:
    """Best estimate of the actual dollar risk on a trade."""
    shares = trade.get("shares") or 0
    entry = trade.get("entry_price") or 0
    stop = trade.get("original_stop") or trade.get("stop_price") or 0
    try:
        return abs(float(shares) * (float(entry) - float(stop)))
    except (TypeError, ValueError):
        return 0.0


def _trade_actual_pnl(trade: dict) -> float:
    try:
        return float(trade.get("pnl_dollar") or 0)
    except (TypeError, ValueError):
        return 0.0


def _trade_r_multiple(trade: dict) -> float | None:
    try:
        r = trade.get("r_multiple")
        if r is None:
            risk = _trade_actual_risk(trade)
            pnl = _trade_actual_pnl(trade)
            if risk > 0:
                return pnl / risk
            return None
        return float(r)
    except (TypeError, ValueError):
        return None


def simulate(
    *, user_id: str, rule: str, rule_value: float,
    account_size: float | None = None,
    days: int = 180,
    account_id: str | None = None,
) -> dict[str, Any]:
    """Simulate alternative sizing. Returns aggregate + per-setup breakdown."""
    if rule not in _SUPPORTED_RULES:
        return {"error": f"unsupported rule '{rule}'; must be one of {_SUPPORTED_RULES}"}

    # Lazy-resolve account + trades
    try:
        from api.services.journal_two import coach_data_assembler
        from api.services.auth_db import get_connection
        from api.services.journal_two.accounts_service import get_account_settings
    except Exception as e:
        return {"error": f"journal modules unavailable: {e}"}

    # Resolve account via same pattern as voice_session_context
    if account_id is None:
        try:
            from api.services.voice_session_context import _resolve_account_id
            conn = get_connection()
            try:
                account_id = _resolve_account_id(conn, user_id)
            finally:
                conn.close()
        except Exception:
            pass
    if not account_id:
        return {"error": "no account_id available"}

    # Pull trades in range
    try:
        from datetime import datetime, timedelta, timezone
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=max(1, min(730, int(days or 180))))
        start_iso, end_iso = start.isoformat(), end.isoformat()
        conn = get_connection()
        try:
            trades = coach_data_assembler._trades_in_range(
                conn, user_id, account_id, start_iso, end_iso,
            )
            if account_size is None:
                settings = get_account_settings(user_id, account_id, conn=conn) or {}
                account_size = float(settings.get("accountSize") or 0)
        finally:
            conn.close()
    except Exception as e:
        _log.warning("scenario_simulator data pull failed: %s", e)
        return {"error": f"data pull failed: {e}"}

    if not trades:
        return {"trade_count": 0, "actual_pnl": 0, "scenario_pnl": 0, "delta": 0}

    # Compute actual aggregates + scenario aggregates per trade
    actual_total = 0.0
    scenario_total = 0.0
    by_setup_actual: dict[str, float] = {}
    by_setup_scenario: dict[str, float] = {}

    for t in trades:
        actual_pnl = _trade_actual_pnl(t)
        actual_risk = _trade_actual_risk(t)
        r = _trade_r_multiple(t)
        setup = t.get("setup") or "Unknown"

        # Determine the scenario dollar risk
        if rule == "flat_pct":
            if not account_size or account_size <= 0:
                continue
            scenario_risk = account_size * (float(rule_value) / 100.0)
        elif rule == "flat_dollar":
            scenario_risk = float(rule_value)
        elif rule == "multiplier":
            scenario_risk = actual_risk * float(rule_value)
        else:
            continue

        # Scenario P&L = R multiple × scenario_risk (if R known) else proportional
        if r is not None:
            scenario_pnl = r * scenario_risk
        elif actual_risk > 0:
            scenario_pnl = actual_pnl * (scenario_risk / actual_risk)
        else:
            scenario_pnl = 0.0

        actual_total += actual_pnl
        scenario_total += scenario_pnl
        by_setup_actual[setup] = by_setup_actual.get(setup, 0) + actual_pnl
        by_setup_scenario[setup] = by_setup_scenario.get(setup, 0) + scenario_pnl

    # Per-setup deltas
    breakdown = []
    for setup in sorted(by_setup_actual.keys()):
        a = by_setup_actual[setup]
        s = by_setup_scenario[setup]
        breakdown.append({
            "setup": setup,
            "actual_pnl": round(a, 2),
            "scenario_pnl": round(s, 2),
            "delta": round(s - a, 2),
        })

    return {
        "rule": rule,
        "rule_value": rule_value,
        "days": days,
        "trade_count": len(trades),
        "account_size": account_size,
        "actual_pnl": round(actual_total, 2),
        "scenario_pnl": round(scenario_total, 2),
        "delta": round(scenario_total - actual_total, 2),
        "delta_pct": round((scenario_total - actual_total) / actual_total * 100, 1)
                     if actual_total else None,
        "by_setup": breakdown,
    }
