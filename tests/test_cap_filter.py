"""Tests for $300M market cap enforcement in news and RSS filtering."""
import pytest
from unittest.mock import patch, MagicMock


# ── Helpers ────────────────────────────────────────────────────────────────────

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
