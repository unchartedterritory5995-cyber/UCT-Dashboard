import importlib
import api.services.institutional_holdings as ih_mod


def _mod(monkeypatch):
    importlib.reload(ih_mod)
    return ih_mod


def test_classify_change():
    ih = ih_mod
    assert ih._classify_change(100, 0) == "new"
    assert ih._classify_change(0, 100) == "sold_out"
    assert ih._classify_change(150, 100) == "added"
    assert ih._classify_change(80, 100) == "reduced"
    assert ih._classify_change(100, 100) == "flat"
    assert ih._classify_change(100, None) == "new"


def test_get_ownership_fmp_with_deltas_and_rankings(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [
        {"holder": "Vanguard", "shares": 1.31e9, "prior_shares": 1.29e9, "pct_out": 8.4, "value": 3.2e11, "date": "2026-03-31"},
        {"holder": "BlackRock", "shares": 1.10e9, "prior_shares": 1.20e9, "pct_out": 7.0, "value": 2.7e11, "date": "2026-03-31"},
        {"holder": "NewCo", "shares": 5.0e8, "prior_shares": 0, "pct_out": 3.0, "value": 1.2e11, "date": "2026-03-31"},
    ])
    out = ih.get_ownership("ZZAAPL")
    by = {h["holder"]: h for h in out["top_holders"]}
    assert by["Vanguard"]["change"] == "added" and by["Vanguard"]["change_shares"] == 2.0e7
    assert by["BlackRock"]["change"] == "reduced"
    assert by["NewCo"]["change"] == "new"
    assert out["biggest_buyers"][0]["holder"] == "NewCo"       # +5.0e8 largest add
    assert out["biggest_sellers"][0]["holder"] == "BlackRock"  # -1.0e8
    assert out["as_of"] == "2026-03-31"


def test_get_ownership_yfinance_fallback_no_deltas(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {
        "held_by_institutions_pct": 61.4,
        "top_holders": [{"holder": "Vanguard", "shares": 1.3e9, "pct_out": 8.4, "value_usd": 3.2e11, "date_reported": "2026-03-31"}],
    })
    out = ih.get_ownership("ZZFB")
    assert out["inst_pct"] == 61.4
    assert out["top_holders"][0]["change"] is None       # no deltas on fallback
    assert out["top_holders"][0]["value"] == 3.2e11      # value_usd → value
    assert out["biggest_buyers"] == [] and out["biggest_sellers"] == []


def test_empty_returns_shape(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {"error": "x"})
    out = ih.get_ownership("ZZNADA")
    assert out["top_holders"] == [] and out["inst_pct"] is None
