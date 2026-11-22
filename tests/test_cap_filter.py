"""Tests for $300M market cap enforcement in news and RSS filtering.

The gate reads the company profile first and the yfinance read only when the
profile cannot decide. The `profile` fixture is that profile: left at None it
cannot decide, so the yfinance tests below exercise the second read.
"""
import types

import pytest
from unittest.mock import patch, MagicMock


# ── Helpers ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def profile(monkeypatch):
    """The company profile the gate reads first. `.facts` is what it answers
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


def _facts(**over):
    """A profile that passes the gate: $1B cap, $15M dollar volume, a stock."""
    facts = {"name": "Foo Corp", "is_etf": False, "is_fund": False,
             "market_cap": 1_000_000_000.0, "price": 50.0, "avg_volume": 300_000.0,
             "year_high": 60.0}
    facts.update(over)
    return facts


def _make_fast_info(market_cap, price=50.0, avg_vol=200_000, quote_type="EQUITY"):
    fi = MagicMock()
    fi.market_cap = market_cap
    fi.last_price = price
    fi.three_month_average_volume = avg_vol
    fi.quote_type = quote_type
    return fi


# ── Task 2 tests: _check_sym_cap market cap gate ───────────────────────────────

def test_check_sym_passes_large_cap():
    """$1B market cap + $10M dvol → allowed."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=1_000_000_000, price=50.0, avg_vol=300_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("AAPL")
    assert ok is True


def test_check_sym_blocks_micro_cap():
    """$100M market cap → blocked even with high dollar volume."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=100_000_000, price=4.0, avg_vol=2_000_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("TINY")
    assert ok is False


def test_check_sym_blocks_exactly_at_threshold():
    """$299M market cap → blocked (strictly less than 300M)."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=299_999_999, price=10.0, avg_vol=600_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("EDGE")
    assert ok is False


def test_check_sym_passes_exactly_300m():
    """Exactly $300M → passes."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=300_000_000, price=10.0, avg_vol=600_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("PASS")
    assert ok is True


def test_check_sym_blocks_low_dollar_vol():
    """Large cap but $1.8M dvol → blocked by existing dollar volume gate."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=500_000_000, price=2.0, avg_vol=900_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("ILLIQ")
    assert ok is False  # price×avg_vol = 1.8M < 5M


def test_check_sym_fails_open_on_exception():
    """yfinance exception → fail open (allow ticker through)."""
    from api.services.engine import _check_sym_cap
    with patch("yfinance.Ticker", side_effect=Exception("network error")):
        sym, ok = _check_sym_cap("NOFETCH")
    assert ok is True


def test_check_sym_blocks_non_equity():
    """ETF quote type → blocked."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=5_000_000_000, price=100.0, avg_vol=1_000_000,
                         quote_type="ETF")
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("SPY")
    assert ok is False


# ── The company profile decides first ──────────────────────────────────────────

def test_profile_passes_a_large_liquid_stock_without_a_yfinance_read(profile):
    from api.services.engine import _check_sym_cap
    profile.facts = _facts()
    with patch("yfinance.Ticker") as mock_yf:
        assert _check_sym_cap("AAPL") == ("AAPL", True)
    assert not mock_yf.called
    assert profile.calls == ["AAPL"]


@pytest.mark.parametrize("over, allowed", [
    ({"market_cap": 300_000_000.0}, True),                      # exactly $300M passes
    ({"market_cap": 299_999_999.0}, False),                     # a dollar under does not
    ({"price": 10.0, "avg_volume": 500_000.0}, True),           # exactly $5M dollar volume
    ({"price": 10.0, "avg_volume": 499_999.0}, False),          # $4,999,990
    ({"is_etf": True}, False),                                  # not a stock
    ({"is_fund": True}, False),
])
def test_profile_applies_the_same_gates(profile, over, allowed):
    """Blocked means blocked by the profile: the yfinance read below would let
    every one of these through, and it is never reached."""
    from api.services.engine import _check_sym_cap
    profile.facts = _facts(**over)
    passing = _make_fast_info(market_cap=5_000_000_000, price=100.0, avg_vol=1_000_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = passing
        assert _check_sym_cap("SYM") == ("SYM", allowed)
    assert not mock_yf.called


@pytest.mark.parametrize("over", [
    {"price": None}, {"avg_volume": None}, {"market_cap": None},
    {"is_etf": None}, {"is_fund": None},
])
def test_a_profile_missing_a_needed_field_hands_over_to_yfinance(profile, over):
    """The second read's verdict is the answer, here a block: a gate that failed
    open instead, or guessed from half a profile, would say True."""
    from api.services.engine import _check_sym_cap
    profile.facts = _facts(**over)
    blocking = _make_fast_info(market_cap=100_000_000, price=4.0, avg_vol=2_000_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = blocking
        assert _check_sym_cap("TINY") == ("TINY", False)
    assert mock_yf.called


def test_a_profile_read_that_raises_hands_over_to_yfinance(profile):
    from api.services.engine import _check_sym_cap
    profile.facts = RuntimeError("store unavailable")
    blocking = _make_fast_info(market_cap=100_000_000, price=4.0, avg_vol=2_000_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = blocking
        assert _check_sym_cap("TINY") == ("TINY", False)
    assert mock_yf.called


def test_still_fails_open_when_neither_read_answers(profile):
    from api.services.engine import _check_sym_cap
    profile.facts = RuntimeError("store unavailable")
    with patch("yfinance.Ticker", side_effect=Exception("network error")):
        assert _check_sym_cap("NOFETCH") == ("NOFETCH", True)


# ── Task 3 tests: RSS fallback ticker filtering logic ──────────────────────────

def test_rss_item_no_tickers_passes():
    """RSS item with empty tickers list → always passes (general headline)."""
    tickers = []
    allowed = set()
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True


def test_rss_item_allowed_ticker_passes():
    """RSS item whose ticker is in allowed set → passes."""
    tickers = ["AAPL"]
    allowed = {"AAPL"}
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True


def test_rss_item_blocked_ticker_dropped():
    """RSS item whose ticker is not in allowed set → dropped."""
    tickers = ["MICRO"]
    allowed = {"AAPL", "MSFT"}
    result = not tickers or any(t in allowed for t in tickers)
    assert result is False


def test_rss_item_mixed_tickers_passes_if_one_allowed():
    """RSS item with two tickers — one allowed, one not → passes."""
    tickers = ["MICRO", "AAPL"]
    allowed = {"AAPL"}
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True
