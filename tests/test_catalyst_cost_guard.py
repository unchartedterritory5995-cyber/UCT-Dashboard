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
    """Opus 4.8 pricing: $5/M input, $25/M output (2026)."""
    cost = cost_guard.estimate_cost("claude-opus-4-8",
                                    input_tokens=1000, output_tokens=250)
    # 1000 * 5/1M + 250 * 25/1M = 0.005 + 0.00625 = 0.01125
    assert cost == pytest.approx(0.01125, rel=1e-3)


def test_unknown_model_falls_back_to_priciest_rate():
    """An unknown model must NOT cost $0 (that would disable the caps)."""
    cost = cost_guard.estimate_cost("claude-made-up-9", 1_000_000, 1_000_000)
    assert cost == pytest.approx(30.0, rel=1e-3)  # $5 + $25 (priciest known)


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


def test_sonnet_5_pricing_known():
    from api.services.catalyst import cost_guard
    assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 1_000_000) == 15.0


def test_opus_5_is_priced_BY_NAME_not_by_the_fallback(caplog):
    """⛔ THE FALLBACK RATE IS ALSO $5/$25 (the priciest known is Opus-class), so a
    price-only assertion is green with or WITHOUT the entry and measures nothing.
    Worse, the usual "a bogus id must not price the same as the real one" probe is
    VACUOUS here for the same reason: both come back $30.00. Two things do
    distinguish the paths — the table itself, and the guard's own warning."""
    import logging
    from api.services.catalyst import cost_guard

    # (1) structural: the id is a KEY of the table, asked OF the table.
    assert "claude-opus-5" in cost_guard._PRICING, (
        "claude-opus-5 has no _PRICING entry — the caps would run on the fallback")

    # (2) behavioural: the guard took the named path, and it says so.
    with caplog.at_level(logging.WARNING, logger="api.services.catalyst.cost_guard"):
        cost = cost_guard.estimate_cost("claude-opus-5", 1_000_000, 1_000_000)
    assert cost == pytest.approx(30.0, rel=1e-3)          # $5 in + $25 out
    assert not [r for r in caplog.records if "unknown model pricing" in r.getMessage()], (
        "claude-opus-5 was priced by the FALLBACK — add it to _PRICING")

    # (3) the control: the probe CAN fail. A bogus id prices to the same $30.00
    #     and is still distinguishable, which is the whole point of using the log.
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="api.services.catalyst.cost_guard"):
        bogus = cost_guard.estimate_cost("claude-made-up-9", 1_000_000, 1_000_000)
    assert bogus == pytest.approx(30.0, rel=1e-3), "the fallback rate moved — reread this test"
    assert [r for r in caplog.records if "unknown model pricing" in r.getMessage()]


def test_record_adds_web_search_fees(monkeypatch):
    from api.services.catalyst import cost_guard, store
    logged = {}
    monkeypatch.setattr(store, "log_cost", lambda **kw: logged.update(kw))
    cost = cost_guard.record("2026-07-02", "__hunter__", "claude-opus-4-8",
                             0, 0, search_requests=100)
    assert cost == 1.0  # 100 searches x $0.01
    assert logged["cost_usd"] == 1.0


def test_cache_tokens_are_priced_not_ignored():
    """hunter.py runs prompt-CACHED: its prefix bills under
    cache_read_input_tokens (0.1x) / cache_creation_input_tokens (1.25x)
    instead of input_tokens. Pricing only input_tokens under-counted the
    cached lane and silently loosened the $8/$15 daily caps (2026-08-28)."""
    from api.services.catalyst import cost_guard
    # sonnet-5 input = $3/MTok in this module's table
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
                                    cache_read_tokens=1_000_000) == 0.3
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
                                    cache_creation_tokens=1_000_000) == 3.75
    # and the old positional contract is unchanged
    assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0


def test_hunter_reports_cache_tokens_to_the_guard():
    """Mutation guard: the accumulator must actually reach cost_guard.record —
    a cached call whose cache fields are dropped bills as if it were free."""
    import inspect
    from api.services.catalyst import hunter
    src = inspect.getsource(hunter.run_hunt)
    assert "cache_read_input_tokens" in src
    assert "cache_read_tokens=cr_tok" in src
    assert "cache_creation_tokens=cc_tok" in src
