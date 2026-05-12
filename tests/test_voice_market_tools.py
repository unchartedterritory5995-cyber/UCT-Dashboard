"""Voice market read tools — period control, holdings, scanner, COT, etc."""

from unittest.mock import patch
from api.services import voice_market_tools as vmt


# ── Period normalization ───────────────────────────────────────────────────

def test_norm_period_passes_canonical():
    assert vmt._norm_period("1W") == "1W"
    assert vmt._norm_period("1M") == "1M"


def test_norm_period_recognizes_aliases():
    assert vmt._norm_period("today") == "Today"
    assert vmt._norm_period("week") == "1W"
    assert vmt._norm_period("one month") == "1M"
    assert vmt._norm_period("quarter") == "3M"


def test_norm_period_unknown_falls_back_to_default():
    assert vmt._norm_period("yesterday", default="1W") == "1W"
    assert vmt._norm_period(None, default="1M") == "1M"


# ── get_theme_status ───────────────────────────────────────────────────────

def test_get_theme_status_passes_period_through():
    fake = {"leaders": [{"name": "AI", "pct": "+2.5%", "ticker": "BOTZ"}]}
    with patch("api.services.engine.get_themes", return_value=fake) as m:
        out = vmt.get_theme_status(period="1M", count=2)
    m.assert_called_with("1M")
    assert out["ok"] is True
    assert out["period"] == "1M"
    assert out["themes"][0]["pct"] == 2.5
    assert "AI" in out["narration"]


def test_get_theme_status_default_period_is_1w():
    fake = {"leaders": [{"name": "Crypto", "pct": "+1.0%"}]}
    with patch("api.services.engine.get_themes", return_value=fake):
        out = vmt.get_theme_status()
    assert out["period"] == "1W"


def test_get_theme_status_empty():
    with patch("api.services.engine.get_themes", return_value={"leaders": []}):
        out = vmt.get_theme_status(period="Today")
    assert out["ok"] is True
    assert out["themes"] == []


# ── theme holdings / history ──────────────────────────────────────────────

def test_get_theme_holdings_finds_by_name():
    fake = {
        "leaders": [
            {"name": "Semis", "ticker": "SOXX", "pct": "+3%",
             "holdings": ["NVDA", "AMD", "AVGO", "TSM"]},
        ],
        "laggards": [],
    }
    with patch("api.services.engine.get_themes", return_value=fake):
        out = vmt.get_theme_holdings(theme="semis", count=3)
    assert out["ok"] is True
    assert out["theme"] == "Semis"
    assert out["holdings"] == ["NVDA", "AMD", "AVGO"]


def test_get_theme_holdings_unknown_theme():
    with patch("api.services.engine.get_themes",
               return_value={"leaders": [], "laggards": []}):
        out = vmt.get_theme_holdings(theme="DoesNotExist")
    assert out["ok"] is False


def test_get_theme_history_returns_pct():
    fake = {"leaders": [{"name": "AI", "pct": "+4.2%"}], "laggards": []}
    with patch("api.services.engine.get_themes", return_value=fake):
        out = vmt.get_theme_history(theme="AI", period="1M")
    assert out["pct"] == 4.2
    assert "up" in out["narration"]


# ── scanner ────────────────────────────────────────────────────────────────

def test_scanner_pullback_default():
    fake = {"candidates": {"pullback_ma": [
        {"sym": "NVDA", "candle_score": 80, "alert_state": "READY", "pattern_type": "flag"},
    ]}}
    with patch("api.services.engine.get_candidates", return_value=fake):
        out = vmt.get_scanner_candidates(type="pullback", count=5)
    assert out["ok"] is True
    assert out["candidates"][0]["sym"] == "NVDA"
    assert out["type"] == "pullback_ma"


def test_scanner_normalizes_synonyms():
    fake = {"candidates": {"gapper_news": [{"sym": "XYZ"}]}}
    with patch("api.services.engine.get_candidates", return_value=fake):
        out = vmt.get_scanner_candidates(type="gappers")
    assert out["type"] == "gapper_news"


def test_scanner_empty():
    with patch("api.services.engine.get_candidates",
               return_value={"candidates": {"pullback_ma": []}}):
        out = vmt.get_scanner_candidates(type="pullback")
    assert out["ok"] is True
    assert out["candidates"] == []


# ── UCT 20 ────────────────────────────────────────────────────────────────

def test_uct20_picks():
    fake = [
        {"sym": "NVDA", "company": "NVIDIA", "uct_rating": 95, "setup": "VCP"},
        {"sym": "AMD", "company": "AMD", "uct_rating": 88, "setup": "Flag"},
    ]
    with patch("api.services.engine.get_leadership", return_value=fake):
        out = vmt.get_uct20_picks(count=2)
    assert out["count"] == 2
    assert out["picks"][0]["sym"] == "NVDA"


def test_uct20_portfolio_stats():
    fake = {"stats": {"nav": 12345.67, "total_return_pct": 8.2},
            "open_positions": [{}, {}, {}]}
    with patch("api.services.engine.get_uct20_portfolio_data", return_value=fake):
        out = vmt.get_uct20_portfolio_stats()
    assert out["stats"]["open_count"] == 3
    assert "8.2" in out["narration"] or "8.20" in out["narration"]


# ── COT ────────────────────────────────────────────────────────────────────

def test_cot_data_summary():
    fake = [
        {"date": "2026-04-25", "large_spec_net": 100_000,
         "commercial_net": -120_000, "small_spec_net": 20_000,
         "open_interest": 500_000},
        {"date": "2026-05-02", "large_spec_net": 150_000,
         "commercial_net": -160_000, "small_spec_net": 10_000,
         "open_interest": 520_000},
    ]
    with patch("api.services.cot_service.get_cot_data", return_value=fake):
        out = vmt.get_cot_data(symbol="CL", weeks=4)
    assert out["ok"] is True
    assert out["large_spec_net"] == 150_000
    assert "long" in out["narration"]


def test_cot_data_no_symbol():
    out = vmt.get_cot_data(symbol="")
    assert out["ok"] is False


def test_cot_data_no_records():
    with patch("api.services.cot_service.get_cot_data", return_value=[]):
        out = vmt.get_cot_data(symbol="UNKNOWN")
    assert out["ok"] is False


# ── Insider ────────────────────────────────────────────────────────────────

def test_insider_counts_buys_and_sells():
    fake = [
        {"transaction_type": "buy"}, {"transaction_type": "buy"},
        {"transaction_type": "sell"},
    ]
    with patch("api.services.insider.get_insider_activity", return_value=fake):
        out = vmt.get_insider_activity(symbol="NVDA", count=5)
    assert out["buys"] == 2
    assert out["sells"] == 1


# ── Earnings intel ─────────────────────────────────────────────────────────

def test_earnings_intel_summary():
    fake = {
        "consensus": {"buy": 5, "strongBuy": 8, "hold": 3, "sell": 1, "strongSell": 0},
        "price_target": {"targetMean": 215.50},
        "beat_history": [],
    }
    with patch("api.services.earnings_estimates.get_earnings_intel",
               return_value=fake):
        out = vmt.get_earnings_intel(symbol="NVDA")
    assert out["ok"] is True
    assert "13" in out["narration"]  # 8+5 buys
    assert "215" in out["narration"]


def test_earnings_intel_no_data():
    with patch("api.services.earnings_estimates.get_earnings_intel",
               return_value=None):
        out = vmt.get_earnings_intel(symbol="ZZZ")
    assert out["ok"] is False


# ── Earnings this week ─────────────────────────────────────────────────────

def test_earnings_this_week():
    fake = {"bmo": [{"sym": "NVDA"}, {"sym": "MSFT"}],
            "amc": [{"sym": "AAPL"}]}
    with patch("api.services.engine.get_earnings", return_value=fake):
        out = vmt.get_earnings_this_week()
    assert "NVDA" in out["bmo"]
    assert "AAPL" in out["amc"]
    assert out["count"] == 3
