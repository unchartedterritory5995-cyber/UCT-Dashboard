import pytest
from unittest.mock import patch

from api.services import bars_fetch
from api.services import bar_quarantine


@pytest.fixture
def fresh_quarantine(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()


def test_fetch_retries_when_primary_returns_corrupt_bars(fresh_quarantine):
    """If Massive returns a payload that fails validation, retry FMP."""
    massive_corrupt = {
        "bars": [{"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}],
        "source": "massive",
    }
    fmp_clean = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
        "source": "fmp",
    }

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=massive_corrupt), \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=fmp_clean) as mock_fmp:
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=694.0)
        assert result is fmp_clean
        mock_fmp.assert_called_once()


def test_fetch_returns_primary_when_clean(fresh_quarantine):
    """If Massive returns a clean payload, FMP/yfinance should not be called."""
    massive_clean = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
        "source": "massive",
    }

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=massive_clean), \
         patch.object(bars_fetch, "_fetch_intraday_fmp") as mock_fmp, \
         patch.object(bars_fetch, "_fetch_intraday_yfinance") as mock_yf:
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=694.0)
        assert result is massive_clean
        mock_fmp.assert_not_called()
        mock_yf.assert_not_called()


def test_fetch_falls_through_to_yfinance(fresh_quarantine):
    """If both massive and FMP return corrupt bars, yfinance is the final fallback."""
    corrupt = {
        "bars": [{"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}],
        "source": "x",
    }
    yf_clean = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
        "source": "yfinance",
    }

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=corrupt), \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=corrupt), \
         patch.object(bars_fetch, "_fetch_intraday_yfinance", return_value=yf_clean):
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=694.0)
        assert result is yf_clean


def test_fetch_returns_none_when_all_sources_fail(fresh_quarantine):
    """If every source returns corrupt bars, return None."""
    corrupt = {
        "bars": [{"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}],
        "source": "x",
    }
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=corrupt), \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=corrupt), \
         patch.object(bars_fetch, "_fetch_intraday_yfinance", return_value=corrupt):
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=694.0)
        assert result is None
