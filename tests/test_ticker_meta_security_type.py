"""RS Rating L3 -- ``ticker_meta`` carries the instrument class the chart's ``syminfo.industry`` fold keys on.

The class is read from the ONE authority the screener already stamps on its rows
(``screener_universe.types()``), present only when known: an unknown class is absent, never guessed.
"""
from unittest.mock import patch

import pytest

from api.services import ticker_meta
from api.services.screener import screener_universe

BASE = {"name": "SPDR S&P 500 ETF", "sector": None, "industry": None, "exchange": "NYSE Arca"}


@pytest.fixture(autouse=True)
def _fresh_types_cache():
    ticker_meta._security_types_at = 0.0
    ticker_meta._security_types_map = {}
    yield
    ticker_meta._security_types_at = 0.0
    ticker_meta._security_types_map = {}


def _meta(sym, types):
    with patch.object(ticker_meta, "_base_meta", return_value=dict(BASE)), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(screener_universe, "types", return_value=types) as T:
        return ticker_meta.get_ticker_meta(sym), T


def test_a_typed_ticker_carries_its_class():
    out, _ = _meta("SPY", {"SPY": "ETF", "NVDA": "Stock"})
    assert out == {**BASE, "theme": None, "security_type": "ETF"}


def test_an_untyped_ticker_carries_no_class_key_at_all():
    out, _ = _meta("ZZZZ", {"SPY": "ETF"})
    assert "security_type" not in out
    assert out == {**BASE, "theme": None}  # control: the rest of the shape is unchanged


def test_a_failing_types_read_is_unknown_not_an_error():
    with patch.object(ticker_meta, "_base_meta", return_value=dict(BASE)), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(screener_universe, "types", side_effect=OSError("boom")):
        out = ticker_meta.get_ticker_meta("SPY")
    assert "security_type" not in out


def test_the_types_file_is_read_once_per_ttl_not_per_request():
    with patch.object(ticker_meta, "_base_meta", return_value=dict(BASE)), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(screener_universe, "types", return_value={"SPY": "ETF"}) as T:
        for _ in range(3):
            assert ticker_meta.get_ticker_meta("SPY")["security_type"] == "ETF"
    assert T.call_count == 1


def test_peek_carries_it_too():
    with patch.object(ticker_meta, "_peek_base", return_value=dict(BASE)), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(screener_universe, "types", return_value={"SPY": "ETF"}):
        assert ticker_meta.peek_ticker_meta("spy")["security_type"] == "ETF"
