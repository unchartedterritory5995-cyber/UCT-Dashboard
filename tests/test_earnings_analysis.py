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

# The AI cache keys are versioned, and the version has now drifted twice. DERIVE
# it from its owner (`earnings_ai_store._SHAPE`, which also names the on-disk
# payload) instead of retyping "v2"/"v3" in a dozen assertions — a test that
# hardcodes the value it is checking goes red on every legitimate bump and
# teaches the next reader to edit the number rather than the behaviour.
def _pkey(sym: str) -> str:
    from api.services import earnings_ai_store as _s
    return f"earnings_preview_{_s._SHAPE}_{sym}"


def _akey(sym: str) -> str:
    from api.services import earnings_ai_store as _s
    return f"earnings_analysis_{_s._SHAPE}_{sym}"




@pytest.fixture(autouse=True)
def _isolate_earnings_ai_store(tmp_path, monkeypatch):
    """Give every test its own on-disk AI store, and a clean in-memory cache.

    _generate_earnings_preview/_analysis are skip-if-stable: they read a
    PERSISTED result (earnings_ai_store, DATA_DIR/earnings_ai_cache) and return
    it verbatim when its signals_hash matches the current row. Every test here
    uses sym="PL" with the same row, so without isolation the first test's
    output is replayed to all the others — they never reach the mocked Claude
    (an order-dependent pass) — and the suite writes into the real DATA_DIR.
    """
    from api.services import earnings_ai_store
    monkeypatch.setattr(earnings_ai_store, "_DIR", str(tmp_path / "earnings_ai_cache"))
    cache.clear()
    yield
    cache.clear()


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
    msg.content = [MagicMock(type="text", text=text)]
    return msg


def _make_finnhub_mock(items=None):
    """Return a mock for _with_retry that produces a list (Finnhub news shape)."""
    mock_fn = MagicMock(return_value=items if items is not None else [])
    return mock_fn


# ── YoY EPS growth ────────────────────────────────────────────────────────────

class TestYoYEpsGrowth:
    def setup_method(self):
        cache.invalidate(_akey("TEST"))

    def _run(self, quarters, row=None):
        av_data = _mock_av_response(quarters)
        with patch.object(engine, "_fetch_quarterly_history", return_value=quarters), \
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
        cache.invalidate(_akey("TEST"))

    def _run(self, quarters):
        with patch.object(engine, "_fetch_quarterly_history", return_value=quarters), \
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
        cache.invalidate(_akey("TEST"))

    def test_av_failure_returns_none_fields(self):
        """Empty quarterly history → degrade gracefully with None EPS/streak fields."""
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None
        assert result["sym"] == "TEST"  # always present

    def test_finnhub_dict_response_returns_empty_news(self):
        """Finnhub returning error dict (not list) should yield empty news."""
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
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
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client", side_effect=RuntimeError("API key missing")):
            result = engine._generate_earnings_analysis("TEST", row)
        assert result["analysis"] is None

    def test_pending_row_skips_ai(self):
        """row=None (pending) should return analysis=None without calling Anthropic."""
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            result = engine._generate_earnings_analysis("TEST", None)
        mock_ac.assert_not_called()
        assert result["analysis"] is None

    def test_av_rate_limit_response_logged_not_silenced(self):
        """AV rate-limit / fetch failure: empty quarters returned, degrade gracefully."""
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        # Should degrade gracefully — no crash, but also no quarterly data
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
        # _generate_earnings_analysis uses cache key f"earnings_analysis_{_SHAPE}_{sym}"
        cache.set(_akey("CACHED"), cached_data, ttl=300)
        with patch.object(engine, "_fetch_quarterly_history") as mock_fetch, \
             patch.object(engine, "_with_retry") as mock_retry:
            result = engine._generate_earnings_analysis("CACHED", None)
        mock_fetch.assert_not_called()
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
    msg.content = [MagicMock(type="text", text=payload)]
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
        cache.invalidate(_pkey("PL"))

    def _run(self, av_quarters=None, fh_news=None, ai_response=None, row=None):
        if av_quarters is None:
            av_quarters = _make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
            ])
        ai_msg = ai_response if ai_response is not None else _mock_preview_response()
        fh_items = fh_news if fh_news is not None else []
        if row is None:
            row = self.PENDING_ROW

        with patch.object(engine, "_fetch_quarterly_history", return_value=av_quarters), \
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
        """Empty quarterly history: beat fields are empty/None; AI call still runs."""
        with patch.object(engine, "_fetch_quarterly_history", return_value=[]), \
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
        quarters = _make_quarters([
            (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
        ])
        with patch.object(engine, "_fetch_quarterly_history", return_value=quarters), \
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
        quarters = _make_quarters([
            (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
        ])
        with patch.object(engine, "_fetch_quarterly_history", return_value=quarters), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.side_effect = Exception("api error")
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["preview_text"] == ""
        assert result["preview_bullets"] == []
        # Data fields still populated — quarterly data succeeded so yoy_eps_growth is real
        assert result["yoy_eps_growth"] == "+150.0%"
        assert result["beat_streak"] == "Beat 1 of last 4"
        assert len(result["beat_history"]) == 4

    def test_preview_uses_separate_cache_key(self):
        """Cache must be written to the PREVIEW key, not the ANALYSIS key."""
        self._run()
        assert cache.get(_pkey("PL")) is not None
        assert cache.get(_akey("PL")) is None


# ── Enrichment completeness gate (data-dependability C17) ────────────────────
#
# TTL/persist used to be decided on the AI leg alone (`analysis is not None`
# / `preview_text` truthy). A total or shed enrichment fan-out failure
# (pre_earnings/hist_moves/revisions/beat_surprises/implied_move/key_quotes)
# could still earn the full 12h TTL and a PERMANENT disk write as long as
# Claude produced text -- and because `signals_hash` is derived only from
# `row` (not enrichment), the disk-persisted partial would satisfy
# skip-if-stable forever and never retry the missing legs.

def _ttl_remaining(key: str) -> float:
    import time
    _, expires_at = cache._store[key]
    return expires_at - time.time()


def _mock_structured_analysis(headline="Solid beat", summary="Beat on EPS and revenue.",
                               bullets=None):
    """A valid JSON analysis response (`_parse_json_block` expects headline/
    summary/bullets) -- `_mock_anthropic_analysis()` above returns plain text,
    which `_generate_earnings_analysis` treats as a failed AI call (`analysis`
    stays None), so it can't exercise the "AI succeeded but enrichment
    didn't" case these tests need."""
    import json
    if bullets is None:
        bullets = ["Revenue beat guide.", "Margins expanded.", "Guidance raised."]
    payload = json.dumps({"headline": headline, "summary": summary, "bullets": bullets})
    msg = MagicMock()
    msg.content = [MagicMock(type="text", text=payload)]
    return msg


class TestEnrichmentCompletenessGateAnalysis:
    ROW = {"verdict": "beat", "reported_eps": 1.60, "eps_estimate": 1.50,
           "surprise_pct": "+6.7%", "rev_actual": 14000, "rev_estimate": 13500,
           "rev_surprise_pct": "+3.7%", "change_pct": 5.2}
    QUARTERS = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])

    def setup_method(self):
        cache.invalidate(_akey("ENR"))

    def _run(self, enrichment):
        with patch.object(engine, "_fetch_quarterly_history", return_value=self.QUARTERS), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch("api.services.earnings_enrichment.enrich_earnings_response",
                   return_value=enrichment), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_structured_analysis()
            return engine._generate_earnings_analysis("ENR", self.ROW)

    def test_complete_enrichment_gets_full_ttl_and_persists(self):
        """All 6 legs present (values, or legitimately None per-leg) -> 12h TTL, persisted."""
        enrichment = {"pre_earnings": None, "hist_moves": None, "revisions": None,
                      "beat_surprises": None, "implied_move": None, "key_quotes": None}
        result = self._run(enrichment)
        assert result["analysis"] is not None
        assert _ttl_remaining(_akey("ENR")) > 40_000  # ~12h (43,200s)
        from api.services import earnings_ai_store
        assert earnings_ai_store.get("analysis", "ENR") is not None

    def test_shed_partial_enrichment_gets_short_ttl_and_is_not_persisted(self):
        """Fewer than 6 keys (the 25s fan-out deadline cut it off) -> short retry TTL, NOT persisted."""
        enrichment = {"pre_earnings": None, "hist_moves": {"avg_abs_move": 4.2}, "revisions": None}
        result = self._run(enrichment)
        assert result["analysis"] is not None  # the AI leg itself still succeeded
        assert _ttl_remaining(_akey("ENR")) <= 400  # ~5 min (300s)
        from api.services import earnings_ai_store
        assert earnings_ai_store.get("analysis", "ENR") is None

    def test_total_enrichment_failure_gets_short_ttl_and_is_not_persisted(self):
        """Empty dict (the outer try/except caught a raise) -> short TTL, NOT persisted."""
        result = self._run({})
        assert result["analysis"] is not None
        assert _ttl_remaining(_akey("ENR")) <= 400
        from api.services import earnings_ai_store
        assert earnings_ai_store.get("analysis", "ENR") is None


class TestEnrichmentCompletenessGatePreview:
    PENDING_ROW = {"sym": "ENR2", "verdict": "Pending", "eps_estimate": -0.04,
                   "rev_estimate": 78.0, "change_pct": 5.64}
    QUARTERS = _make_quarters([
        (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)])

    def setup_method(self):
        cache.invalidate(_pkey("ENR2"))

    def _run(self, enrichment):
        with patch.object(engine, "_fetch_quarterly_history", return_value=self.QUARTERS), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch("api.services.earnings_enrichment.enrich_earnings_response",
                   return_value=enrichment), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_preview_response()
            return engine._generate_earnings_preview("ENR2", self.PENDING_ROW)

    def test_complete_enrichment_gets_full_ttl_and_persists(self):
        enrichment = {"pre_earnings": None, "hist_moves": None, "revisions": None,
                      "beat_surprises": None, "implied_move": None, "key_quotes": None}
        result = self._run(enrichment)
        assert len(result["preview_text"]) > 0
        assert _ttl_remaining(_pkey("ENR2")) > 40_000
        from api.services import earnings_ai_store
        assert earnings_ai_store.get("preview", "ENR2") is not None

    def test_shed_partial_enrichment_gets_short_ttl_and_is_not_persisted(self):
        enrichment = {"pre_earnings": None}  # only 1/6 legs — deadline-shed
        result = self._run(enrichment)
        assert len(result["preview_text"]) > 0
        assert _ttl_remaining(_pkey("ENR2")) <= 400
        from api.services import earnings_ai_store
        assert earnings_ai_store.get("preview", "ENR2") is None
