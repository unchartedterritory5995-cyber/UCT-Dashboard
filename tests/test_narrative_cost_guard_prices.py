"""The shared LLM price table must match published rates (2026-08-30).

Found while wiring AI-Search synthesis into the guard: `claude-sonnet-5` was
priced at (3.0, 15.0) — Sonnet 4.6's rate. Sonnet 5 is $2/$10. Every lane using
Sonnet 5 was over-reporting spend by 50%, which fires daily caps early and makes
`/admin/stats.spend_today_usd` wrong in the direction nobody investigates.

`claude-opus-5` was absent entirely and only priced correctly by ACCIDENT: an
unknown model falls back to the priciest known rate, which happened to equal
Opus rates. That is a coincidence, not a decision — the COT narrative lane
defaults to opus-5.
"""
import pytest

from api.services import narrative_cost_guard as guard


@pytest.mark.parametrize("model,expected", [
    ("claude-sonnet-5", (2.0, 10.0)),
    ("claude-opus-5", (5.0, 25.0)),
    ("claude-opus-4-8", (5.0, 25.0)),
    ("claude-sonnet-4-6", (3.0, 15.0)),
    ("claude-haiku-4-5", (1.0, 5.0)),
])
def test_published_rates(model, expected):
    assert guard._PRICES[model] == expected, (
        f"{model} priced at {guard._PRICES.get(model)}, published rate is {expected}")


def test_an_unknown_model_still_prices_conservatively():
    """CONTROL — the fallback must over-report, never under-report: a guard that
    prices an unknown model at zero silently uncaps the route."""
    cost = guard.estimate_cost("some-model-we-have-never-seen", 1_000_000, 0)
    assert cost >= 5.0, cost


def test_a_dated_alias_still_resolves():
    """CONTROL — the prefix-match tolerance for dated snapshots must survive."""
    assert guard.estimate_cost("claude-sonnet-5-20260101", 1_000_000, 0) == pytest.approx(2.0)


def test_a_cached_call_costs_less_than_an_uncached_one():
    """CONTROL — the cache-aware maths the whole ledger depends on: a cached
    prefix bills 0.1x as cache_read, never as input_tokens."""
    uncached = guard.estimate_cost("claude-sonnet-5", 1_000_000, 0)
    cached = guard.estimate_cost("claude-sonnet-5", 0, 0, cache_read_tokens=1_000_000)
    assert cached < uncached, (cached, uncached)
