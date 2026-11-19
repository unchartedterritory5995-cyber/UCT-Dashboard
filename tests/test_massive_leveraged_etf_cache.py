"""Regression test for data-dependability C14: `_is_leveraged_etf`'s
`except -> result = False` used to cache the unverified `False` for the same
24h TTL as a real answer -- meaning a transient yfinance blip renders
TQQQ/SQQQ/SOXL etc. as ordinary stocks in Top Movers for a day.

The filter tests the company profile's name first and reads the yfinance name
only when the profile cannot decide. The `profile` fixture is that profile:
left at None it has no name, so the tests of the yfinance read still reach it.
"""
import time
import types
from unittest import mock

import pytest

from api.services import massive
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


@pytest.fixture(autouse=True)
def profile(monkeypatch):
    """The company profile the filter reads first. `.facts` is what it answers
    (None = no row or a failed read; an exception is raised); `.calls` counts."""
    from api.services.catalyst import ticker_metadata
    state = types.SimpleNamespace(facts=None, calls=[])

    def _facts(sym):
        state.calls.append(sym)
        if isinstance(state.facts, Exception):
            raise state.facts
        return state.facts

    monkeypatch.setattr(ticker_metadata, "profile_facts", _facts)
    return state


class TestLeveragedEtfCacheGate:
    def setup_method(self):
        cache.invalidate("is_lev_TQQQ")

    def test_empty_info_gets_short_ttl(self):
        """`.info` empty/None (yfinance blip) -> could not verify -> short TTL."""
        with mock.patch.object(massive, "_bounded_yf", return_value=None):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is False  # safe default this one call
        assert _ttl_remaining("is_lev_TQQQ") <= 300 + 5
        assert _ttl_remaining("is_lev_TQQQ") < 86400

    def test_exception_gets_short_ttl(self):
        with mock.patch.object(massive, "_bounded_yf", side_effect=RuntimeError("yfinance down")):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is False
        assert _ttl_remaining("is_lev_TQQQ") <= 300 + 5

    def test_verified_leveraged_gets_full_24h_ttl(self):
        """Control: a real, successful lookup (even a boring True/False
        answer) earns the long TTL -- this predicate must not block it."""
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "ProShares UltraPro QQQ", "shortName": "TQQQ"},
        ):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is True
        assert _ttl_remaining("is_lev_TQQQ") > 86400 - 5

    def test_verified_not_leveraged_also_gets_full_24h_ttl(self):
        """Control: a real, successful lookup that correctly says False (a
        genuinely-not-leveraged ticker) must ALSO get the long TTL -- the
        fix distinguishes verified-vs-unverified, not True-vs-False."""
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "Apple Inc.", "shortName": "AAPL"},
        ):
            cache.invalidate("is_lev_AAPL2")
            result = massive._is_leveraged_etf("AAPL2")

        assert result is False
        assert _ttl_remaining("is_lev_AAPL2") > 86400 - 5


class TestProfileNameDecidesFirst:
    """A profile with a name is a real answer: no yfinance read, the long TTL."""

    def setup_method(self):
        for sym in ("SOXL", "NVDA", "ZZZZ"):
            cache.invalidate(f"is_lev_{sym}")

    def test_a_leveraged_name_is_filtered_without_a_yfinance_read(self, profile):
        profile.facts = {"name": "Direxion Daily Semiconductor Bull 3X Shares", "is_etf": True}
        with mock.patch.object(massive, "_bounded_yf") as yf_read:
            assert massive._is_leveraged_etf("SOXL") is True
        assert not yf_read.called
        assert profile.calls == ["SOXL"]
        assert _ttl_remaining("is_lev_SOXL") > 86400 - 5

    def test_a_plain_name_is_kept_without_a_yfinance_read(self, profile):
        """The yfinance read below would call it leveraged: it must not be reached."""
        profile.facts = {"name": "NVIDIA Corporation", "is_etf": False, "is_fund": False}
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "ProShares UltraPro QQQ", "shortName": "TQQQ"},
        ) as yf_read:
            assert massive._is_leveraged_etf("NVDA") is False
        assert not yf_read.called
        assert _ttl_remaining("is_lev_NVDA") > 86400 - 5

    def test_the_second_call_is_answered_from_the_cache(self, profile):
        profile.facts = {"name": "NVIDIA Corporation", "is_etf": False, "is_fund": False}
        assert massive._is_leveraged_etf("NVDA") is False
        assert massive._is_leveraged_etf("NVDA") is False
        assert profile.calls == ["NVDA"]

    @pytest.mark.parametrize("facts", [
        None,                                       # no row, or a failed read
        {"name": None, "is_etf": True},             # a row with no name
        {"name": "Plain Growth Fund", "is_etf": True, "is_fund": False},   # a fund whose name does not say
        {"name": "Plain Growth Fund", "is_etf": False, "is_fund": True},
        {"name": "NVIDIA Corporation"},             # a row that does not say what it is
        {"name": "NVIDIA Corporation", "is_etf": False},
        RuntimeError("store unavailable"),          # the profile read raised
    ])
    def test_no_name_to_test_hands_over_to_yfinance(self, profile, facts):
        profile.facts = facts
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "ProShares UltraPro QQQ", "shortName": "TQQQ"},
        ) as yf_read:
            assert massive._is_leveraged_etf("ZZZZ") is True
        assert yf_read.called
        assert _ttl_remaining("is_lev_ZZZZ") > 86400 - 5

    def test_neither_read_answering_is_not_cached_as_an_answer(self, profile):
        profile.facts = None
        with mock.patch.object(massive, "_bounded_yf", return_value=None):
            assert massive._is_leveraged_etf("ZZZZ") is False
        assert _ttl_remaining("is_lev_ZZZZ") <= 300 + 5
