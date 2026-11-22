"""A CUSTOM timeframe is refused in words (400 + the reason), never answered `{"bars": []}` (2026-11-22).

/api/bars/SPX?tf=240 answered an empty series with no note, which every caller read as "this symbol has no data"
(Fred RS's legend vanished on a 4h chart; a Compare symbol drew nothing). The chart builds custom timeframes from
their native base; the route refuses the custom code by name. Every spelling served today still passes through.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import bars as bars_router


@pytest.fixture
def client(monkeypatch):
    from api.bars_auth import require_bars_access
    served = []

    def _http(ticker, tf, bars=200, since="", to="", warm=0, session=""):
        served.append(tf)
        return bars_router.JSONResponse(content={"ticker": ticker, "tf": tf, "bars": [{"t": 1, "c": 1.0}]})
    monkeypatch.setattr(bars_router, "serve_bars_http", _http)
    monkeypatch.delenv("BARS_ORIGIN_URL", raising=False)
    app = FastAPI()
    app.include_router(bars_router.router)
    app.dependency_overrides[require_bars_access] = lambda: {"id": 1, "plan": "pro"}
    c = TestClient(app)
    c.served = served
    return c


@pytest.mark.parametrize("tf", ["240", "120", "45", "2", "3", "10", "65", "195", "4h", "4H", "2h", "2D", "3D", "5D", "2W", "3M", "6M", "12M"])
def test_a_custom_timeframe_is_a_400_in_words_and_never_served(client, tf):
    r = client.get(f"/api/bars/SPX?tf={tf}&bars=500")
    assert r.status_code == 400
    body = r.json()
    assert body["error"] == "unsupported_timeframe" and body["tf"] == tf and body["ticker"] == "SPX"
    assert f"tf={tf} is not a timeframe this route serves" in body["detail"]
    assert client.served == [], "the serve is never reached"


@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60", "D", "W", "M", "d", "w", "m", "1h", "1H", "1D", "1W", "1M"])
def test_every_spelling_served_today_still_passes_through(client, tf):
    r = client.get(f"/api/bars/SPX?tf={tf}&bars=500")
    assert r.status_code == 200 and r.json()["bars"]
    assert client.served == [tf]


def test_the_refusal_is_one_function_the_route_calls_before_the_proxy(monkeypatch):
    calls = []
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://tier")

    async def _proxy(*a, **k):
        calls.append(a)
        return bars_router.JSONResponse(content={"bars": []})
    monkeypatch.setattr(bars_router, "_proxy_bars_to_tier", _proxy)
    monkeypatch.setattr(bars_router, "_bars_proxy_should_route", lambda t, w: True)
    from api.bars_auth import require_bars_access
    app = FastAPI()
    app.include_router(bars_router.router)
    app.dependency_overrides[require_bars_access] = lambda: {"id": 1, "plan": "pro"}
    r = TestClient(app).get("/api/bars/SPY?tf=240")
    assert r.status_code == 400 and calls == [], "a custom code never reaches the tier"
    assert bars_router.custom_tf_refusal("SPY", "60") is None
