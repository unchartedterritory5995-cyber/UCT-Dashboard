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


# ── _generate_earnings_preview ────────────────────────────────────────────────

def _mock_preview_response(preview="Solid setup heading into tonight.", bullets=None):
    """Mock Anthropic response returning valid JSON for preview."""
    import json
    if bullets is None:
        bullets = ["Beat 3 of last 4 quarters; YoY EPS +12%.", "Watch revenue guide vs $78M est.", "Stock up +5.6% — bar is elevated."]
    payload = json.dumps({"preview": preview, "bullets": bullets})
    msg = MagicMock()
    msg.content = [MagicMock(text=payload)]
    return msg


class TestGenerateEarningsPreview:
    PENDING_ROW = {
        "sym": "PL",
        "verdict": "Pending",
        "eps_estimate": -0.04,
        "rev_estimate": 78.0,
        "change_pct": 5.64,
    }

    def setup_method(self):
        cache.invalidate("earnings_preview_PL")

    def _run(self, av_quarters=None, fh_news=None, ai_response=None, row=None):
        if av_quarters is None:
            av_quarters = _make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
            ])
        av_data = _mock_av_response(av_quarters)
        ai_msg = ai_response if ai_response is not None else _mock_preview_response()
        fh_items = fh_news if fh_news is not None else []
        if row is None:
            row = self.PENDING_ROW

        with patch.object(engine, "_av_get", return_value=av_data), \
             patch.object(engine, "_with_retry", return_value=fh_items), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = ai_msg
            result = engine._generate_earnings_preview("PL", row)
        return result

    def test_preview_returns_expected_shape(self):
        """Success path: all keys present, exactly 3 bullets."""
        result = self._run()
        assert result["sym"] == "PL"
        assert isinstance(result["preview_text"], str)
        assert len(result["preview_text"]) > 0
        assert isinstance(result["preview_bullets"], list)
        assert len(result["preview_bullets"]) == 3
        assert isinstance(result["beat_history"], list)
        assert result["yoy_eps_growth"] == "+150.0%"
        assert result["beat_streak"] == "Beat 1 of last 4"
        assert isinstance(result["news"], list)

    def test_preview_graceful_av_failure(self):
        """AV timeout: beat fields are empty strings/lists; AI call still runs."""
        with patch.object(engine, "_av_get", side_effect=Exception("timeout")), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_preview_response()
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["beat_history"] == []
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None
        # AI still ran — verify client was called and text was returned
        mock_ac.return_value.messages.create.assert_called_once()
        assert len(result["preview_text"]) > 0

    def test_preview_graceful_finnhub_failure(self):
        """Finnhub failure: news is empty list; preview still generated."""
        with patch.object(engine, "_av_get", return_value=_mock_av_response(_make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
             ]))), \
             patch.object(engine, "_with_retry", side_effect=Exception("finnhub down")), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_preview_response()
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["news"] == []
        assert len(result["preview_text"]) > 0
        assert result["yoy_eps_growth"] == "+150.0%"
        assert result["beat_streak"] == "Beat 1 of last 4"
        assert len(result["beat_history"]) == 4

    def test_preview_graceful_ai_failure(self):
        """Claude failure: preview_text and bullets are empty; data fields still populated."""
        with patch.object(engine, "_av_get", return_value=_mock_av_response(_make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
             ]))), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.side_effect = Exception("api error")
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["preview_text"] == ""
        assert result["preview_bullets"] == []
        # Data fields still populated — AV succeeded so yoy_eps_growth is a real value, not "N/A"
        assert result["yoy_eps_growth"] == "+150.0%"
        assert result["beat_streak"] == "Beat 1 of last 4"
        assert len(result["beat_history"]) == 4

    def test_preview_uses_separate_cache_key(self):
        """Cache must be written to earnings_preview_SYM, not earnings_analysis_SYM."""
        self._run()
        assert cache.get("earnings_preview_PL") is not None
        assert cache.get("earnings_analysis_PL") is None
