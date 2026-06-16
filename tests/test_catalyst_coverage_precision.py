# tests/test_catalyst_coverage_precision.py
from api.services.catalyst import ticker_metadata as tm


def test_fetch_via_yfinance_maps_float_and_shares(monkeypatch):
    class FakeTicker:
        def __init__(self, sym):
            self.info = {
                "sector": "Technology", "industry": "Semis",
                "marketCap": 5_000_000_000, "averageVolume10days": 1_200_000,
                "fiftyTwoWeekHigh": 99.0, "quoteType": "EQUITY",
                "floatShares": 40_000_000, "sharesOutstanding": 50_000_000,
            }

    import yfinance
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    out = tm._fetch_via_yfinance("FOO")
    assert out["float_shares"] == 40_000_000
    assert out["shares_outstanding"] == 50_000_000


def test_enrich_snapshot_includes_float(monkeypatch):
    from api.services.catalyst import sources
    monkeypatch.setattr(sources, "_get_client", lambda: None, raising=False)

    class _Client:
        def get_batch_rich_snapshots(self, tickers):
            return {"FOO": {"price": 10.0, "vol": 2_000_000, "prev_close": 9.0}}

    monkeypatch.setattr("api.services.massive._get_client", lambda: _Client())
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata_batch",
        lambda tickers: {"FOO": {"avg_volume_30d": 1_000_000, "market_cap": 1e9,
                                 "sector": "Tech", "float_shares": 3_000_000,
                                 "shares_outstanding": 4_000_000}},
    )
    out = sources._enrich_with_snapshot(["FOO"])
    assert out["FOO"]["float_shares"] == 3_000_000
    assert out["FOO"]["shares_outstanding"] == 4_000_000
