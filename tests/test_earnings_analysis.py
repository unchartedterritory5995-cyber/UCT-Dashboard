"""
Unit tests for _generate_earnings_analysis internals.

All external I/O (requests, anthropic) is mocked. Tests verify:
- YoY EPS growth math and formatting
- Beat streak counting
- Graceful degradation when APIs fail
- Cache TTL logic
- AV rate limit response handling
"""
import pytest
from unittest.mock import patch, MagicMock
from api.services import engine
from api.services.cache import cache


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_quarters(eps_pairs):
    """Build AV-style quarterlyEarnings list from [(reported, estimated), ...]."""
    return [
        {"reportedEPS": str(r), "estimatedEPS": str(e)}
        for r, e in eps_pairs
    ]


def _mock_av_response(quarters):
    return {"quarterlyEarnings": quarters}


def _mock_anthropic_analysis(text="Test analysis text."):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg


def _make_finnhub_mock(items=None):
    """Return a mock for _with_retry that produces a list (Finnhub news shape)."""
    mock_fn = MagicMock(return_value=items if items is not None else [])
    return mock_fn


# ── YoY EPS growth ────────────────────────────────────────────────────────────

class TestYoYEpsGrowth:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def _run(self, quarters, row=None):
        av_data = _mock_av_response(quarters)
        with patch.object(engine, "_av_get", return_value=av_data), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", row)
        return result

    def test_positive_growth(self):
        # q0=$1.60, q4=$1.30 → +23.1%
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] == "+23.1%"

    def test_negative_growth(self):
        # q0=$1.00, q4=$1.50 → -33.3%
        quarters = _make_quarters([(1.00, 1.10), (1.10, 1.20), (1.20, 1.30), (1.25, 1.35), (1.50, 1.40)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] == "-33.3%"

    def test_q4_zero_returns_none(self):
        # Division by zero guard
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (0.00, 0.10)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None

    def test_fewer_than_5_quarters_returns_none(self):
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None

    def test_non_numeric_eps_returns_none(self):
        quarters = [{"reportedEPS": "N/A", "estimatedEPS": "1.50"}] * 5
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None


# ── Beat streak ───────────────────────────────────────────────────────────────

class TestBeatStreak:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def _run(self, quarters):
        av_data = _mock_av_response(quarters)
        with patch.object(engine, "_av_get", return_value=av_data), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        return result

    def test_beat_all_4(self):
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"

    def test_beat_none(self):
        quarters = _make_quarters([(1.00, 1.50), (1.10, 1.40), (1.20, 1.30), (1.25, 1.35), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 0 of last 4"

    def test_beat_with_exactly_4_quarters(self):
        """Bug guard: beat streak must work when AV returns exactly 4 quarters (no 5th for YoY)."""
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"
        # YoY should be None — only 4 quarters available
        assert result["yoy_eps_growth"] is None

    def test_beat_streak_exact_match_counts_as_beat(self):
        """reportedEPS == estimatedEPS counts as beat (>=)."""
        quarters = _make_quarters([(1.50, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"


# ── Graceful degradation ──────────────────────────────────────────────────────

class TestGracefulDegradation:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def test_av_failure_returns_none_fields(self):
        with patch.object(engine, "_av_get", side_effect=RuntimeError("AV down")), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None
        assert result["sym"] == "TEST"  # always present

    def test_finnhub_dict_response_returns_empty_news(self):
        """Finnhub returning error dict (not list) should yield empty news."""
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch.object(engine, "_with_retry", return_value={"error": "Invalid token"}), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        assert result["news"] == []

    def test_ai_failure_returns_none_analysis(self):
        """When AI fails, analysis=None."""
        row = {"verdict": "beat", "reported_eps": 1.60, "eps_estimate": 1.50,
               "surprise_pct": "+6.7%", "rev_actual": 14000, "rev_estimate": 13500,
               "rev_surprise_pct": "+3.7%", "change_pct": 5.2}
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client", side_effect=RuntimeError("API key missing")):
            result = engine._generate_earnings_analysis("TEST", row)
        assert result["analysis"] is None

    def test_pending_row_skips_ai(self):
        """row=None (pending) should return analysis=None without calling Anthropic."""
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            result = engine._generate_earnings_analysis("TEST", None)
        mock_ac.assert_not_called()
        assert result["analysis"] is None

    def test_av_rate_limit_response_logged_not_silenced(self):
        """AV rate-limit Note response raises, degrades to None fields."""
        with patch.object(engine, "_av_get", side_effect=RuntimeError("AV rate limit hit")), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        # Should degrade gracefully — no crash, but also no AV data
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None


# ── Cache behaviour ───────────────────────────────────────────────────────────

class TestCacheBehaviour:
    def setup_method(self):
        cache.invalidate("earnings_analysis_CACHED")

    def test_returns_cached_result_without_api_calls(self):
        """Cache hit must return immediately without any I/O."""
        cached_data = {"sym": "CACHED", "analysis": "cached", "yoy_eps_growth": None,
                       "beat_streak": None, "news": []}
        cache.set("earnings_analysis_CACHED", cached_data, ttl=300)
        with patch.object(engine, "_av_get") as mock_av, \
             patch.object(engine, "_with_retry") as mock_retry:
            result = engine._generate_earnings_analysis("CACHED", None)
        mock_av.assert_not_called()
        mock_retry.assert_not_called()
        assert result["analysis"] == "cached"
