"""Dividend yield semantics: yfinance's `dividendYield` is now ALREADY a
percent (AAPL → 0.37 meaning 0.37%). The old ×100 path displayed "37%"
product-wide. `trailingAnnualDividendYield` remains a ratio (fallback path)."""
from __future__ import annotations

from unittest.mock import patch

import api.services.fundamentals as fund


def _info(**over):
    base = {"symbol": "AAPL", "longName": "Apple Inc."}
    base.update(over)
    return base


def _get(sym, info):
    fund._CACHE.set(f"fund::{sym}", None, 0)  # bust
    with patch.object(fund, "yf") as yf_mock, \
         patch("api.services.yf_util.bounded_call", lambda fn, default: fn()):
        yf_mock.Ticker.return_value.info = info
        return fund.get_fundamentals(sym)


def test_dividend_yield_not_multiplied():
    out = _get("AAPL", _info(dividendYield=0.37))
    assert out["dividend_yield_pct"] == 0.37          # NOT 37.0


def test_dividend_yield_ratio_fallback():
    out = _get("MSFT", _info(symbol="MSFT", dividendYield=None,
                             trailingAnnualDividendYield=0.0072))
    assert out["dividend_yield_pct"] == 0.7           # ratio ×100


def test_error_results_are_negative_cached():
    fund._CACHE.set("fund::DEADX", None, 0)
    with patch.object(fund, "yf") as yf_mock, \
         patch("api.services.yf_util.bounded_call", lambda fn, default: fn()):
        yf_mock.Ticker.return_value.info = {}
        out = fund.get_fundamentals("DEADX")
    assert "error" in out
    # second call served from the negative cache (no new yfinance hit)
    with patch.object(fund, "yf") as yf_mock2:
        out2 = fund.get_fundamentals("DEADX")
        assert "error" in out2
        yf_mock2.Ticker.assert_not_called()
