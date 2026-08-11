"""Rails for the ETF holdings service behind the chart's 'View Holdings' panel."""
from api.services import etf_holdings as eh
from api.services import index_constituents as ic


def test_get_holdings_extracts_asset_weight_filters_and_sorts(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "k")
    rows = [
        {"asset": "AAPL", "name": "Apple", "weightPercentage": 6.89},
        {"asset": "NVDA", "name": "Nvidia", "weightPercentage": 8.13},
        {"asset": "BIPC.TO", "name": "Foreign", "weightPercentage": 1.0},   # foreign → dropped
        {"asset": "", "name": "blank", "weightPercentage": 0.5},            # blank → dropped
        {"asset": "AAPL", "name": "dup", "weightPercentage": 6.89},         # dup → dropped
    ]
    monkeypatch.setattr(ic, "_get", lambda url: rows)
    out = eh.get_holdings("ZZTESTETF1")          # unique sym → not a warm-cache hit
    assert [h["sym"] for h in out] == ["NVDA", "AAPL"]   # weight-desc; foreign/blank/dup gone
    assert out[0]["weight"] == 8.13 and out[0]["name"] == "Nvidia"


def test_get_holdings_empty_for_non_etf(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "k")
    monkeypatch.setattr(ic, "_get", lambda url: [])
    assert eh.get_holdings("ZZTESTSTOCK1") == []


def test_get_holdings_no_key_returns_empty(monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    assert eh.get_holdings("ZZTESTETF2") == []


def test_is_basket_etf_keeps_real_baskets_drops_leveraged_inverse_single_stock():
    # Real baskets — incl. "Short-Term"/"Short Treasury" bond ETFs (bare SHORT is NOT a token).
    for real in ("iShares Semiconductor ETF", "SPDR S&P 500 ETF Trust",
                 "Vanguard Short-Term Bond ETF", "iShares Short Treasury Bond ETF",
                 "Global X NASDAQ 100 Covered Call ETF"):
        assert eh._is_basket_etf(real), real
    for lev in ("ProShares UltraPro Short QQQ", "Direxion Daily Semiconductor Bull 3X Shares",
                "GraniteShares 2x Long NVDA Daily ETF", "Defiance Daily Target 2X Long MSTR ETF",
                "ProShares UltraShort Gold", "YieldMax NVDA Option Income Strategy ETF"):
        assert not eh._is_basket_etf(lev), lev


def test_etf_symbol_set_uppercases_drops_blanks_and_leveraged(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "k")
    monkeypatch.setattr(eh, "_paginate_massive", lambda url, key, cap=400: [
        {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust"},
        {"ticker": "xlk", "name": "Technology Select Sector SPDR Fund"},
        {"ticker": "", "name": ""},
        {"ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ"},   # leveraged → dropped
    ])
    eh._universe_cache["set"] = None   # bypass any warm cache
    try:
        s = eh.etf_symbol_set()
        assert "SPY" in s and "XLK" in s
        assert "" not in s and "SQQQ" not in s
    finally:
        eh._universe_cache.update({"ts": 0.0, "set": None})
