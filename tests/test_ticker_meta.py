"""Tests for ticker_meta service."""
from unittest.mock import patch, MagicMock
from api.services import ticker_meta


def _yf_info(longName="Tesla Inc", sector="Consumer Cyclical", industry="Auto Manufacturers"):
    return {"longName": longName, "shortName": "Tesla", "sector": sector, "industry": industry}


def test_yfinance_happy_path():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info()
        out = ticker_meta.get_ticker_meta("TSLA")
    assert out == {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers", "theme": None}
    # disk/mem cache the base meta only (no theme — theme is looked up fresh per call)
    DP.assert_called_once_with("TSLA", {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"})


def test_memory_cache_hit_skips_fetch():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_TSLA", {"name": "Cached", "sector": None, "industry": None}, ttl=999)
    with patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("TSLA")
    YF.assert_not_called()
    assert out["name"] == "Cached"


def test_finnhub_fallback_when_yfinance_fails():
    # Finnhub calls now route through the shared finnhub_client.fh_get
    # (2026-08-05) — patch the name ticker_meta._from_finnhub actually calls,
    # rather than the old raw requests.get/_fh_key seam.
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "Rocket Lab USA", "finnhubIndustry": "Aerospace"}):
        out = ticker_meta.get_ticker_meta("RKLB")
    assert out == {"name": "Rocket Lab USA", "sector": None, "industry": "Aerospace", "theme": None}


def test_total_failure_returns_nulls_and_not_cached():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker", side_effect=Exception("x")), \
         patch.object(ticker_meta, "fh_get", return_value=None):
        out = ticker_meta.get_ticker_meta("ZZZZ")
    assert out == {"name": None, "sector": None, "industry": None, "theme": None}
    DP.assert_not_called()
    assert ticker_meta._mem.get("tmeta_ZZZZ") is None


def test_disk_cache_hit_populates_mem_and_skips_fetch():
    ticker_meta._mem.clear()
    cached = {"name": "From Disk", "sector": "Tech", "industry": "Semis"}
    with patch.object(ticker_meta, "_disk_get", return_value=cached), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("NVDA")
    YF.assert_not_called()
    assert out == {**cached, "theme": None}
    # mem caches the base meta only — not the per-call theme
    assert ticker_meta._mem.get("tmeta_NVDA") == cached


def test_yfinance_empty_info_falls_back_to_finnhub():
    """yfinance returns silent empty .info (ETF/delisted) → Finnhub fallback used."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF, \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "SPDR S&P 500 ETF", "finnhubIndustry": "ETF"}):
        YF.return_value.info = {}
        out = ticker_meta.get_ticker_meta("SPY")
    assert out == {"name": "SPDR S&P 500 ETF", "sector": None, "industry": "ETF", "theme": None}


def test_partial_yfinance_missing_name_backfills_name_from_finnhub():
    """THE BUG: yfinance returns a PARTIAL .info — GICS sector/industry present but
    no longName/shortName. The old `not any(data.values())` gate skipped the
    Finnhub fallback (sector/industry made it truthy), caching name=None. Now the
    fallback fires whenever the NAME is missing, and merges field-by-field so
    yfinance's accurate GICS sector/industry are KEPT and only the name is filled
    from Finnhub (whose coarser 'Technology' industry must NOT overwrite 'Semiconductors')."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF, \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "Micron Technology Inc", "finnhubIndustry": "Technology"}):
        # yfinance: sector/industry but NO name (the flaky partial payload)
        YF.return_value.info = {"sector": "Technology", "industry": "Semiconductors"}
        out = ticker_meta.get_ticker_meta("MU")
    assert out == {"name": "Micron Technology Inc", "sector": "Technology", "industry": "Semiconductors", "theme": None}
    # Cached WITH the name now (not the poisoned name=None), GICS industry preserved.
    DP.assert_called_once_with("MU", {"name": "Micron Technology Inc", "sector": "Technology", "industry": "Semiconductors"})


def test_primary_theme_attached_to_result():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_SEDG", {"name": "SolarEdge Technologies, Inc.", "sector": "Technology", "industry": "Solar"}, ttl=999)
    with patch.object(ticker_meta, "_primary_theme", return_value="Solar"):
        out = ticker_meta.get_ticker_meta("SEDG")
    assert out == {"name": "SolarEdge Technologies, Inc.", "sector": "Technology", "industry": "Solar", "theme": "Solar"}


def test_primary_theme_prefers_core_then_relevant_then_peripheral():
    rows = [
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "a"},
        {"theme_name": "Core One", "tier": "core", "theme_id": "z"},
        {"theme_name": "Relevant One", "tier": "relevant", "theme_id": "b"},
    ]
    with patch("api.services.theme_db.get_themes_for_ticker", return_value=rows):
        assert ticker_meta._primary_theme("AAPL") == "Core One"


def test_primary_theme_none_when_no_membership_or_error():
    with patch("api.services.theme_db.get_themes_for_ticker", return_value=[]):
        assert ticker_meta._primary_theme("ZZZZ") is None
    with patch("api.services.theme_db.get_themes_for_ticker", side_effect=Exception("db down")):
        assert ticker_meta._primary_theme("AAPL") is None
    assert ticker_meta._primary_theme("") is None
