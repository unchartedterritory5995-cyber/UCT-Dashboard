from api.services import massive


def test_get_market_cap(monkeypatch):
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: {"market_cap": 1.5e9})
    assert massive.get_market_cap("AAA") == 1.5e9


def test_get_market_cap_missing(monkeypatch):
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: {})
    assert massive.get_market_cap("AAA") is None
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: {"market_cap": None})
    assert massive.get_market_cap("AAA") is None


def test_get_market_cap_shares_fallback(monkeypatch):
    # No market_cap field -> shares * price.
    monkeypatch.setattr(massive, "get_ticker_details",
                        lambda t: {"weighted_shares_outstanding": 1_000_000})
    assert massive.get_market_cap("AAA", price=50.0) == 50_000_000
    # no price -> can't compute fallback
    assert massive.get_market_cap("AAA") is None
