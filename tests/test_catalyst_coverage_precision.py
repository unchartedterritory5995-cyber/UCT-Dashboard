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
