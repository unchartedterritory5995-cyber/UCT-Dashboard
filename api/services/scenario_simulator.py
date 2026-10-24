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
#: Bounds for the request path (the voice simulate_sizing_change tool): a window of at most
#: MAX_DAYS and at most MAX_TRADES of the newest closed trades in it, read with a SQL LIMIT. The
#: result says when the cap cut it (`trades_capped`). One pass over the trades, no other loop.
MAX_DAYS = 730
MAX_TRADES = 5000


def _default_note(is_default: bool) -> str | None:
    from api.services.voice_position_sizing import default_size_sentence
    return default_size_sentence() if is_default else None


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
        # ⚰️ This imported `journal_two.accounts_service`, a module that does not exist, so every
        # call returned "journal modules unavailable" and simulated nothing (found routing the
        # size through the one authority, Round B).
        from api.services.journal_two.accounts import get_account_settings, account_size_of
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
        days = max(1, min(MAX_DAYS, int(days or 180)))
        start = end - timedelta(days=days)
        conn = get_connection()
        try:
            # datetimes, not ISO strings: `_trades_in_range` formats them itself, and handing it
            # strings raised here on every call (found with the import fix, Round B).
            trades = coach_data_assembler._trades_in_range(
                conn, user_id, account_id, start, end, limit=MAX_TRADES + 1,
            )
            trades_capped = len(trades) > MAX_TRADES
            if trades_capped:
                trades = trades[1:]   # newest MAX_TRADES; the extra row only proves the cap cut
            account_size_is_default = False
            if account_size is None:
                settings = get_account_settings(user_id, account_id, conn=conn) or {}
                account_size, account_size_is_default = account_size_of(settings)
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
        "trades_capped": trades_capped,
        "account_size": account_size,
        "account_size_is_default": account_size_is_default,
        "account_size_note": _default_note(account_size_is_default),
        "actual_pnl": round(actual_total, 2),
        "scenario_pnl": round(scenario_total, 2),
        "delta": round(scenario_total - actual_total, 2),
        "delta_pct": round((scenario_total - actual_total) / actual_total * 100, 1)
                     if actual_total else None,
        "by_setup": breakdown,
    }
