from unittest.mock import patch
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_ticker_meta_endpoint_returns_payload():
    with patch("api.routers.ticker_meta.get_ticker_meta",
               return_value={"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}):
        r = client.get("/api/ticker-meta/tsla")
    assert r.status_code == 200
    assert r.json() == {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}


def test_ticker_meta_endpoint_never_500s_on_service_error():
    with patch("api.routers.ticker_meta.get_ticker_meta", side_effect=Exception("boom")):
        r = client.get("/api/ticker-meta/ZZZZ")
    assert r.status_code == 200
    assert r.json() == {"name": None, "sector": None, "industry": None}


def test_ticker_meta_endpoint_uppercases_ticker_before_service_call():
    with patch("api.routers.ticker_meta.get_ticker_meta",
               return_value={"name": "Apple Inc", "sector": "Technology", "industry": "Consumer Electronics"}) as gm:
        r = client.get("/api/ticker-meta/aapl")
    assert r.status_code == 200
    gm.assert_called_once_with("AAPL")
