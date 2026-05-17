"""Tests for ticker_meta service."""
from unittest.mock import patch, MagicMock
from api.services import ticker_meta


def _yf_info(longName="Tesla Inc", sector="Consumer Cyclical", industry="Auto Manufacturers"):
    return {"longName": longName, "shortName": "Tesla", "sector": sector, "industry": industry}


def test_yfinance_happy_path():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info()
        out = ticker_meta.get_ticker_meta("TSLA")
    assert out == {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}
    DP.assert_called_once_with("TSLA", {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"})


def test_memory_cache_hit_skips_fetch():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_TSLA", {"name": "Cached", "sector": None, "industry": None}, ttl=999)
    with patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("TSLA")
    YF.assert_not_called()
    assert out["name"] == "Cached"


def test_finnhub_fallback_when_yfinance_fails():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch.object(ticker_meta, "_fh_key", return_value="k"), \
         patch("api.services.ticker_meta.requests.get") as RG:
        RG.return_value.raise_for_status = lambda: None
        RG.return_value.json = lambda: {"name": "Rocket Lab USA", "finnhubIndustry": "Aerospace"}
        out = ticker_meta.get_ticker_meta("RKLB")
    assert out == {"name": "Rocket Lab USA", "sector": None, "industry": "Aerospace"}


def test_total_failure_returns_nulls_and_not_cached():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch("yfinance.Ticker", side_effect=Exception("x")), \
         patch.object(ticker_meta, "_fh_key", return_value=""):
        out = ticker_meta.get_ticker_meta("ZZZZ")
    assert out == {"name": None, "sector": None, "industry": None}
    DP.assert_not_called()
    assert ticker_meta._mem.get("tmeta_ZZZZ") is None


def test_disk_cache_hit_populates_mem_and_skips_fetch():
    ticker_meta._mem.clear()
    cached = {"name": "From Disk", "sector": "Tech", "industry": "Semis"}
    with patch.object(ticker_meta, "_disk_get", return_value=cached), \
         patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("NVDA")
    YF.assert_not_called()
    assert out == cached
    assert ticker_meta._mem.get("tmeta_NVDA") == cached


def test_yfinance_empty_info_falls_back_to_finnhub():
    """yfinance returns silent empty .info (ETF/delisted) → Finnhub fallback used."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch("yfinance.Ticker") as YF, \
         patch.object(ticker_meta, "_fh_key", return_value="k"), \
         patch("api.services.ticker_meta.requests.get") as RG:
        YF.return_value.info = {}
        RG.return_value.raise_for_status = lambda: None
        RG.return_value.json = lambda: {"name": "SPDR S&P 500 ETF", "finnhubIndustry": "ETF"}
        out = ticker_meta.get_ticker_meta("SPY")
    assert out == {"name": "SPDR S&P 500 ETF", "sector": None, "industry": "ETF"}
