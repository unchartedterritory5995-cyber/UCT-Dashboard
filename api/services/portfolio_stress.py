"""Portfolio stress test — apply scenario shocks to current open positions
and report expected P&L per scenario.

Scenarios (v1, hardcoded):
  - "regime_red"      : -8% to all longs, +5% to shorts (regime flip)
  - "vol_expansion"   : 2x current beta-weighted move; assume -5% SPY
  - "factor_rotation" : tech -10%, defensives +3%
  - "rate_shock_up"   : long-duration -7%, financials +4%
  - "fed_dovish"      : risk-on, tech +6%, gold -3%

Each scenario applies sector/style-aware deltas. For tickers without
sector info, defaults to the regime delta.

Returns per-position expected P&L + portfolio totals.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

# Simple scenario definitions: (sector_or_default, delta_pct)
# 'default' applies to anything not matched
_SCENARIOS: dict[str, dict[str, dict[str, float]]] = {
    "regime_red": {
        "long":  {"default": -0.08, "Technology": -0.10, "Consumer Cyclical": -0.09,
                  "Communication Services": -0.08, "Industrials": -0.06,
                  "Energy": -0.04, "Healthcare": -0.04, "Utilities": -0.02,
                  "Consumer Defensive": -0.02},
        "short": {"default": 0.05},
    },
    "vol_expansion": {
        "long":  {"default": -0.05, "Technology": -0.07, "Communication Services": -0.06},
        "short": {"default": 0.05, "Technology": 0.07},
    },
    "factor_rotation": {
        "long":  {"default": 0.0, "Technology": -0.10, "Communication Services": -0.08,
                  "Consumer Cyclical": -0.06, "Consumer Defensive": 0.03,
                  "Utilities": 0.03, "Healthcare": 0.02},
        "short": {"default": 0.0, "Technology": 0.10},
    },
    "rate_shock_up": {
        "long":  {"default": -0.03, "Technology": -0.07, "Real Estate": -0.08,
                  "Utilities": -0.06, "Financial Services": 0.04},
        "short": {"default": 0.03, "Technology": 0.07},
    },
    "fed_dovish": {
        "long":  {"default": 0.03, "Technology": 0.06, "Communication Services": 0.05,
                  "Real Estate": 0.05, "Consumer Cyclical": 0.04,
                  "Financial Services": 0.02},
        "short": {"default": -0.03, "Technology": -0.06},
    },
}

SCENARIO_IDS = tuple(_SCENARIOS.keys())


def _get_sector_for(ticker: str) -> str | None:
    """Best-effort sector lookup via yfinance fundamentals (already cached)."""
    try:
        from api.services.fundamentals import get_fundamentals
        f = get_fundamentals(ticker)
        if isinstance(f, dict):
            return f.get("sector")
    except Exception:
        return None
    return None


def _delta_for_position(scenario: str, side: str, sector: str | None) -> float:
    side_key = "short" if (side or "long").lower() == "short" else "long"
    s = _SCENARIOS.get(scenario)
    if not s:
        return 0.0
    side_map = s.get(side_key) or {}
    if sector and sector in side_map:
        return side_map[sector]
    return side_map.get("default", 0.0)


def stress_test(user_id: str, scenario: str) -> dict[str, Any]:
    """Apply a named scenario to the user's current open positions."""
    if scenario not in _SCENARIOS:
        return {"error": f"unknown scenario; choose from {SCENARIO_IDS}"}

    try:
        from api.services.auth_db import get_connection
        from api.services.voice_session_context import _resolve_account_id, _load_positions
        conn = get_connection()
        try:
            account_id = _resolve_account_id(conn, user_id)
            if not account_id:
                return {"error": "no account"}
            positions = _load_positions(conn, user_id, account_id)
        finally:
            conn.close()
    except Exception as e:
        _log.warning("stress_test data pull failed: %s", e)
        return {"error": f"data pull failed: {e}"}

    if not positions:
        return {"scenario": scenario, "position_count": 0,
                "total_expected_pnl": 0, "positions": []}

    rows = []
    total_pnl = 0.0
    total_exposure = 0.0
    for p in positions:
        sym = (p.get("symbol") or "").upper()
        side = p.get("side") or "LONG"
        shares = float(p.get("shares") or 0)
        entry = float(p.get("entry_price") or 0)
        sector = _get_sector_for(sym)
        delta_pct = _delta_for_position(scenario, side, sector)
        exposure = shares * entry
        expected_pnl = exposure * delta_pct
        total_pnl += expected_pnl
        total_exposure += abs(exposure)
        rows.append({
            "symbol": sym,
            "side": side,
            "sector": sector,
            "exposure_usd": round(exposure, 2),
            "delta_pct": round(delta_pct * 100, 2),
            "expected_pnl": round(expected_pnl, 2),
        })

    rows.sort(key=lambda r: r["expected_pnl"])  # worst first

    return {
        "scenario": scenario,
        "position_count": len(positions),
        "total_exposure": round(total_exposure, 2),
        "total_expected_pnl": round(total_pnl, 2),
        "portfolio_impact_pct": round(total_pnl / total_exposure * 100, 2)
                                 if total_exposure else 0.0,
        "positions": rows,
        "available_scenarios": list(SCENARIO_IDS),
    }
