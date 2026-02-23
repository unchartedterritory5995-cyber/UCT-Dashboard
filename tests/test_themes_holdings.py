import pytest
from api.services.engine import _normalize_themes

RAW_THEMES = {
    "SIL": {
        "name": "Silver Miners",
        "ticker": "SIL",
        "etf_name": "Global X Silver Miners ETF",
        "1W": 11.47,
        "1M": 8.2,
        "3M": 15.3,
        "holdings": [
            {"sym": "CDE", "name": "Coeur Mining", "pct": 8.5},
            {"sym": "HL", "name": "Hecla Mining", "pct": 7.2},
            {"sym": "BVN", "name": "Buenaventura", "pct": 6.1},
        ],
        "intl_holdings": [
            {"sym": "FRES.L", "name": "Fresnillo", "pct": 5.5},
            {"sym": "MAG.TO", "name": "MAG Silver", "pct": 4.2},
        ],
    },
    "XLK": {
        "name": "Technology",
        "ticker": "XLK",
        "etf_name": "SPDR Technology Select Sector ETF",
        "1W": -2.3,
        "1M": 1.5,
        "3M": 8.0,
        "holdings": [
            {"sym": "AAPL", "name": "Apple", "pct": 22.0},
        ],
        "intl_holdings": [],
    },
}


def test_holdings_included_in_leaders():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert "holdings" in sil
    assert sil["holdings"] == ["CDE", "HL", "BVN"]


def test_intl_count_included():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert sil["intl_count"] == 2


def test_etf_name_included():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert sil["etf_name"] == "Global X Silver Miners ETF"


def test_holdings_included_in_laggards():
    result = _normalize_themes(RAW_THEMES, "1W")
    xlk = next(t for t in result["laggards"] if t["ticker"] == "XLK")
    assert xlk["holdings"] == ["AAPL"]
    assert xlk["intl_count"] == 0


def test_missing_holdings_returns_empty_list():
    raw = {"ETF": {"name": "Test", "ticker": "ETF", "1W": 1.0}}
    result = _normalize_themes(raw, "1W")
    assert result["leaders"][0]["holdings"] == []
    assert result["leaders"][0]["intl_count"] == 0
