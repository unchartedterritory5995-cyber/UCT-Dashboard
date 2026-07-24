"""
P5-D — analyze_setup_in_period (backtest-on-demand) tests.
"""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_backtest import analyze_setup_in_period


def _user():
    init_db()
    return create_user(f"bt_{uuid.uuid4()}@x.com", "p")["id"]


def _trade(
    *, symbol="NVDA", setup="Bull Flag", exit_date="2026-05-01",
    result="win", r=1.5, pnl_d=300, context_regime=None,
):
    t = {
        "id": str(uuid.uuid4())[:8], "symbol": symbol, "side": "long",
        "shares": 100, "entry_price": 200, "exit_price": 205,
        "entry_date": exit_date, "exit_date": exit_date,
        "original_stop": 198, "setup": setup, "notes": "",
        "pnl_dollar": pnl_d, "pnl_percent": 2.5, "r_multiple": r,
        "hold_days": 1, "result": result, "context_at_entry": "",
        "account_id": "acc1", "fees": 0, "created_at": exit_date,
        "mistake_tags": [], "emotion_tags": [],
    }
    if context_regime:
        import json
        t["context_at_entry"] = json.dumps({"regime": context_regime})
    return t


# ── Empty / no-trades paths ───────────────────────────────────────────────

def test_no_trades_returns_friendly_message():
    uid = _user()
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=[]):
        out = analyze_setup_in_period(uid, days=90)
    assert out["ok"] is True
    assert out["trade_count"] == 0
    assert "No closed" in out["narration"]


def test_no_matching_setup_returns_zero():
    uid = _user()
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=[_trade(setup="Bull Flag")]):
        out = analyze_setup_in_period(uid, setup="Pullback", days=90)
    assert out["trade_count"] == 0


# ── Stats math ────────────────────────────────────────────────────────────

def test_win_rate_and_avg_r():
    uid = _user()
    trades = [
        _trade(setup="Bull Flag", result="win",  r=2.0, pnl_d=400),
        _trade(setup="Bull Flag", result="loss", r=-1.0, pnl_d=-200),
        _trade(setup="Bull Flag", result="win",  r=1.5, pnl_d=300),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(uid, setup="Bull Flag", days=90)
    assert out["trade_count"] == 3
    assert out["wins"] == 2
    assert out["losses"] == 1
    # 2/3 = 66.67%
    assert out["win_rate_pct"] == 66.7
    # avg R = (2.0 - 1.0 + 1.5) / 3 = 0.83
    assert out["avg_r"] == 0.83
    # Profit factor = gain/loss = 700/200 = 3.5
    assert out["profit_factor"] == 3.5
    assert out["total_pnl_dollar"] == 500


def test_profit_factor_undefined_when_no_losses():
    uid = _user()
    trades = [_trade(result="win", r=2.0, pnl_d=400)]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(uid, days=90)
    assert out["profit_factor"] is None


def test_breakeven_trades_dont_count_as_win_or_loss():
    uid = _user()
    trades = [
        _trade(result="win", r=1.0),
        _trade(result="breakeven", r=0.0, pnl_d=0),
        _trade(result="loss", r=-1.0, pnl_d=-100),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(uid, days=90)
    assert out["wins"] == 1
    assert out["losses"] == 1
    assert out["breakeven"] == 1
    # Win rate is over decided (wins+losses) → 1/2 = 50%
    assert out["win_rate_pct"] == 50.0


# ── Filters ───────────────────────────────────────────────────────────────

def test_date_range_filter():
    uid = _user()
    trades = [
        _trade(exit_date="2026-01-15"),
        _trade(exit_date="2026-03-01"),
        _trade(exit_date="2026-05-01"),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(
            uid, start_date="2026-02-01", end_date="2026-04-30",
        )
    assert out["trade_count"] == 1  # only the March trade


def test_regime_filter():
    uid = _user()
    trades = [
        _trade(result="win",  r=1.5, context_regime="GREEN"),
        _trade(result="loss", r=-1.0, context_regime="AMBER"),
        _trade(result="win",  r=2.0, context_regime="AMBER"),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(uid, days=90, regime="AMBER")
    assert out["trade_count"] == 2
    assert out["wins"] == 1
    assert out["losses"] == 1


def test_only_closed_trades_count():
    """Trades without exit_date (open) are excluded."""
    uid = _user()
    open_trade = _trade(result="open")
    open_trade["exit_date"] = None
    trades = [open_trade, _trade(result="win", r=1.5)]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(uid, days=90)
    assert out["trade_count"] == 1


# ── By-month breakdown ────────────────────────────────────────────────────

def test_by_month_breakdown():
    uid = _user()
    trades = [
        _trade(exit_date="2026-03-10", result="win",  r=2.0, pnl_d=400),
        _trade(exit_date="2026-03-25", result="loss", r=-1.0, pnl_d=-200),
        _trade(exit_date="2026-04-05", result="win",  r=1.5, pnl_d=300),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=trades):
        out = analyze_setup_in_period(
            uid, start_date="2026-03-01", end_date="2026-04-30",
        )
    by_month = {m["month"]: m for m in out["by_month"]}
    assert "2026-03" in by_month
    assert "2026-04" in by_month
    assert by_month["2026-03"]["trades"] == 2
    assert by_month["2026-03"]["wins"] == 1
    assert by_month["2026-04"]["trades"] == 1


# ── Wiring ────────────────────────────────────────────────────────────────

def test_tool_is_wired_into_compass():
    """The tool must be registered AND reachable by Compass.

    Asserts the UNION rather than the live allowlist: COMPASS_LEAN_TOOLS
    (default on) intersects the runtime set down to _COMPASS_CORE_TOOLS for
    latency, so a non-core tool is absent from tool_allowlist by design.
    """
    import api.services.voice_tool_impls  # noqa: F401  populate registry
    from api.services.voice_tools import _REGISTRY
    from api.services.voice_agents import get_agent, _compass_tool_union
    assert "analyze_setup_in_period" in _REGISTRY
    assert get_agent("compass") is not None
    assert "analyze_setup_in_period" in _compass_tool_union()
