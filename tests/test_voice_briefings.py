"""Voice briefings — agentic flow orchestrations."""

from unittest.mock import patch
from api.services import voice_briefings


def test_morning_briefing_returns_narration():
    fake_breadth = {
        "breadth_score": 75, "advancing": 320, "declining": 180,
        "market_phase": "uptrend",
    }
    fake_themes = {"leaders": [
        {"name": "Semis", "pct": "+2.5%"},
        {"name": "AI", "pct": "+1.8%"},
    ]}
    fake_earnings = {"bmo": [{"sym": "AAPL"}, {"sym": "MSFT"}], "amc": []}

    with patch("api.services.voice_briefings._get_breadth", return_value=fake_breadth), \
         patch("api.services.voice_briefings._get_themes", return_value=fake_themes), \
         patch("api.services.voice_briefings._get_earnings", return_value=fake_earnings):
        out = voice_briefings.morning_briefing(user_id="u-1")

    assert "narration" in out
    assert len(out["narration"]) > 0
    text = out["narration"].lower()
    assert any(s in text for s in ["semis", "ai", "uptrend", "aapl", "earnings"])


def test_morning_briefing_handles_empty_data():
    with patch("api.services.voice_briefings._get_breadth", return_value={}), \
         patch("api.services.voice_briefings._get_themes", return_value={}), \
         patch("api.services.voice_briefings._get_earnings", return_value={}):
        out = voice_briefings.morning_briefing(user_id="u-1")
    assert "narration" in out
    assert len(out["narration"]) > 0
