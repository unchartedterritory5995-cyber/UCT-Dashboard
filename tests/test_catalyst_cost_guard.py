import os
import tempfile

import pytest

from api.services.catalyst import cost_guard, store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        # Reset module-level state
        cost_guard._HARD_CAP_TRIPPED = False
        cost_guard._SOFT_CAP_LOGGED_FOR_DATE = None
        yield


def test_under_soft_cap_allows(s):
    assert cost_guard.may_synthesize("2026-05-26") is True


def test_estimate_call_cost():
    """Opus 4.7 pricing: $15/M input, $75/M output (2026)."""
    cost = cost_guard.estimate_cost("claude-opus-4-7",
                                    input_tokens=1000, output_tokens=250)
    # 1000 * 15/1M + 250 * 75/1M = 0.015 + 0.01875 = 0.03375
    assert cost == pytest.approx(0.03375, rel=1e-3)


def test_haiku_pricing_is_cheaper():
    opus = cost_guard.estimate_cost("claude-opus-4-7", 1000, 250)
    haiku = cost_guard.estimate_cost("claude-haiku-4-5", 1000, 250)
    assert haiku < opus


def test_hard_cap_blocks_further_synthesis(s, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "0.10")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    assert cost_guard.may_synthesize("2026-05-26") is False


def test_soft_cap_logs_warning_but_allows(s, monkeypatch, caplog):
    monkeypatch.setenv("CATALYST_COST_CAP_DAILY", "0.10")
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "999.99")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    import logging
    with caplog.at_level(logging.WARNING):
        assert cost_guard.may_synthesize("2026-05-26") is True
    assert any("soft cap" in r.message.lower() for r in caplog.records)
