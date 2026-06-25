"""Tests for the 2026-06-25 perf-cleanups:
  - theme-id pseudo-tickers must NOT be treated as warmable symbols
  - yfinance daily fetch must back off per-ticker after failures
"""
import pytest

from api.services.theme_performance import looks_like_ticker


@pytest.mark.parametrize("sym", ["SMH", "XLK", "ITA", "ARKK", "A", "BRK.B", "BRK-B"])
def test_looks_like_ticker_accepts_real_symbols(sym):
    assert looks_like_ticker(sym) is True


@pytest.mark.parametrize("sym", [
    "MANAGED_CARE", "MEME_RETAIL", "DIGITAL_HEALTH_AESTHETICS",
    "ECOMMERCE", "AEROSPACE", "GLP1", "LUXURY", "TRAVEL", "", None,
])
def test_looks_like_ticker_rejects_theme_ids(sym):
    assert looks_like_ticker(sym) is False


def test_yf_daily_backoff_lifecycle():
    from api.services import bars_fetch as bf
    t = "ZZTESTBACKOFF"
    bf._YF_DAILY_FAIL.pop(t, None)
    # fresh ticker: not in backoff
    assert bf._yf_daily_in_backoff(t) is False
    # after a failure: in backoff
    bf._yf_daily_record_fail(t)
    assert bf._yf_daily_in_backoff(t) is True
    # a success clears it
    bf._yf_daily_record_ok(t)
    assert bf._yf_daily_in_backoff(t) is False


def test_yf_daily_backoff_grows_with_consecutive_failures():
    from api.services import bars_fetch as bf
    t = "ZZTESTGROW"
    bf._YF_DAILY_FAIL.pop(t, None)
    bf._yf_daily_record_fail(t)
    _, n1 = bf._YF_DAILY_FAIL[t]
    bf._yf_daily_record_fail(t)
    _, n2 = bf._YF_DAILY_FAIL[t]
    assert n2 == n1 + 1  # consecutive-failure counter increments (longer window)
    bf._YF_DAILY_FAIL.pop(t, None)
