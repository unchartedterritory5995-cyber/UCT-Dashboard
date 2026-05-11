"""Voice self-Q&A — wrappers over journal service for personal trading questions."""

from unittest.mock import patch
from api.services import voice_self_qa


def test_get_my_pnl_week():
    fake_stats = {"total_pnl_pct": 5.2, "total_pnl_dollar": 1250.50, "trade_count": 8,
                  "win_rate": 0.625, "best_trade": "NVDA", "worst_trade": "TSLA"}
    with patch("api.services.voice_self_qa._stats_for_period", return_value=fake_stats):
        out = voice_self_qa.get_my_pnl(user_id="u-1", period="week")
    text = out["narration"].lower()
    assert "week" in text or "5.2" in text or "1250" in text
    assert out["trade_count"] == 8


def test_get_my_pnl_empty():
    with patch("api.services.voice_self_qa._stats_for_period", return_value={"trade_count": 0}):
        out = voice_self_qa.get_my_pnl(user_id="u-1", period="week")
    assert "no" in out["narration"].lower() or "0" in out["narration"]


def test_get_my_setup_performance_aggregate():
    fake_setups = [
        {"setup": "VCP", "trade_count": 15, "win_rate": 0.73, "avg_pnl_pct": 4.2, "expectancy": 1.5},
        {"setup": "HTF", "trade_count": 8, "win_rate": 0.5, "avg_pnl_pct": 2.1, "expectancy": 0.4},
    ]
    with patch("api.services.voice_self_qa._setup_breakdown", return_value=fake_setups):
        out = voice_self_qa.get_my_setup_performance(user_id="u-1")
    assert "VCP" in out["narration"]
    assert out["count"] == 2


def test_get_my_recent_mistakes():
    fake_mistakes = [
        {"mistake_type": "overtrading", "count": 5},
        {"mistake_type": "fomo", "count": 3},
    ]
    with patch("api.services.voice_self_qa._recent_mistakes", return_value=fake_mistakes):
        out = voice_self_qa.get_my_recent_mistakes(user_id="u-1", days=30)
    assert "overtrading" in out["narration"].lower()


def test_find_my_trades_by_symbol():
    fake_trades = [
        {"sym": "NVDA", "entry_price": 200, "exit_price": 210, "pnl_pct": 5.0, "status": "closed"},
    ]
    with patch("api.services.voice_self_qa._find_trades", return_value=fake_trades):
        out = voice_self_qa.find_my_trades(user_id="u-1", symbol="NVDA")
    assert "NVDA" in out["narration"]
    assert out["count"] == 1
