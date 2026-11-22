"""A Pine seed through every bars door (`api/routers/bars.py::_is_pine_seed`).

The four doors must agree: `/api/bars`, `/api/bars-history`, the bars proxy and the
history proxy. bars.db has no seed rows, so any door that forgot the seed would serve
a valid, cacheable empty 200. These rails make every door read the seed store and
never bars.db.
"""
import datetime as dt
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import bars as bars_router
from api.services import bars_fetch
from api.services import pine_seed_store as store
from tests.authclients import sign_in_bars_caller

SEED = "SEED_FRED6725_RS_RATING:RSRATING"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    sign_in_bars_caller(monkeypatch)
    monkeypatch.setenv("PINE_SEEDS_DB", str(tmp_path / "seeds.db"))
    store._reset_for_tests()
    lines = []
    y = dt.date(2026, 11, 10)
    for k, v in enumerate([12.5] * 5 + [42.44] * 5):
        lines.append(f"{y - dt.timedelta(days=k):%Y%m%d}T,0,1000,0,{v},0")
    store.ingest_upload(SEED, "bbb", "2026-11-11T03:04:36Z", "\n".join(reversed(lines)))
    yield
    store._reset_for_tests()


def _client():
    app = FastAPI()
    app.include_router(bars_router.router)
    return TestClient(app)


def _no_bars_db():
    def boom(*a, **k):
        raise AssertionError("a seed must never read bars.db")
    return patch.object(bars_fetch._sqlite, "get_bars", side_effect=boom)


def test_api_bars_serves_the_seed_store_and_echoes_the_ticker():
    with _no_bars_db():
        r = _client().get(f"/api/bars/{SEED}", params={"tf": "D", "bars": 50})
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == SEED
    closes = [b["c"] for b in body["bars"]]
    assert len(closes) == 10 and closes[-1] == 12.5 and closes[0] == 42.44
    assert body["bars"][-1]["t"] == "2026-11-10"


def test_api_bars_lower_case_spelling_is_the_same_seed():
    with _no_bars_db():
        r = _client().get(f"/api/bars/{SEED.lower()}", params={"tf": "D", "bars": 50})
    assert r.status_code == 200 and len(r.json()["bars"]) == 10


def test_api_bars_weekly_is_empty_with_a_reason():
    r = _client().get(f"/api/bars/{SEED}", params={"tf": "W", "bars": 50})
    assert r.status_code == 200 and r.json()["bars"] == []


def test_bars_history_serves_the_seed_store():
    with _no_bars_db():
        r = _client().get(f"/api/bars-history/{SEED}", params={"tf": "D", "bars": 50})
    assert r.status_code == 200
    assert [b["c"] for b in r.json()["bars"]][-1] == 12.5


def test_the_bars_proxy_never_routes_a_seed(monkeypatch):
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars_router._bars_proxy_should_route(SEED, 0) is False
    # control: the same settings DO route an ordinary symbol, so the check can fail
    assert bars_router._bars_proxy_should_route("AAPL", 0) is True


def test_an_unregistered_seed_is_not_a_seed():
    assert bars_router._is_pine_seed("SEED_SOMEONE_ELSE:X") is False
    assert bars_router._is_pine_seed(SEED) is True
