import importlib


def _mod(monkeypatch):
    import api.services.fmp_bulk as fb
    importlib.reload(fb)
    return fb


def test_maps_bulk_rows_to_fundamentals_keys(monkeypatch):
    fb = _mod(monkeypatch)
    monkeypatch.setattr(fb, "_fmp_bulk_rows", lambda: [
        {"symbol": "AAPL", "returnOnEquity": 1.47, "operatingProfitMargin": 0.30,
         "growthRevenue": 0.08, "growthNetIncome": 0.11, "priceEarningsToGrowthRatio": 2.1,
         "forwardPE": 28.0, "sector": "Technology"},
    ])
    out = fb.fetch_fundamentals_bulk()
    a = out["AAPL"]
    assert a["roe_pct"] == 147.0
    assert a["operating_margin_pct"] == 30.0
    assert a["revenue_growth_pct"] == 8.0
    assert a["earnings_growth_pct"] == 11.0
    assert a["pe_forward"] == 28.0
    assert a["sector"] == "Technology"


def test_empty_on_failure(monkeypatch):
    fb = _mod(monkeypatch)
    monkeypatch.setattr(fb, "_fmp_bulk_rows", lambda: [])
    assert fb.fetch_fundamentals_bulk(force=True) == {}
