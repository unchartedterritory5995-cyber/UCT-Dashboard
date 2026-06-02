"""Tests for the universe industry map behind the breadth "group by industry"
drill view, plus the POST /api/breadth/industries endpoint.

The Finviz bulk fetch is stubbed — no network. Verifies the map seeds from a
bulk source, classifies the whole list, returns None + warms a fallback for
stragglers, and never blocks on the request path.
"""
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import industry_map as im


FAKE_FINVIZ = [
    {"Ticker": "NVDA", "Company": "NVIDIA Corp", "Sector": "Technology", "Industry": "Semiconductors"},
    {"Ticker": "AMD", "Company": "Advanced Micro Devices", "Sector": "Technology", "Industry": "Semiconductors"},
    {"Ticker": "XOM", "Company": "Exxon Mobil", "Sector": "Energy", "Industry": "Oil & Gas Integrated"},
    {"Ticker": "", "Company": "junk row", "Sector": "X", "Industry": "Y"},  # skipped
]


@pytest.fixture
def imap(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(im, "_DB_PATH", os.path.join(d, "industry_map.db"))
        monkeypatch.setattr(im, "_INIT_DONE", False)
        monkeypatch.setattr(im, "_LAST_REFRESH_AT", 0.0)
        # Stub the bulk source + fallback so nothing hits the network.
        monkeypatch.setattr(im, "_fetch_finviz_universe", lambda: list(FAKE_FINVIZ))
        monkeypatch.setattr(im, "_maybe_self_heal", lambda: None)
        im._init_db()
        yield im


def test_bulk_refresh_seeds_map(imap):
    n = imap.bulk_refresh_from_finviz()
    assert n == 3  # junk empty-ticker row skipped
    assert imap._count() == 3


def test_get_industries_classifies_from_map(imap):
    imap.bulk_refresh_from_finviz()
    out = imap.get_industries(["NVDA", "AMD", "XOM"])
    assert out == {
        "NVDA": "Semiconductors",
        "AMD": "Semiconductors",
        "XOM": "Oil & Gas Integrated",
    }


def test_miss_returns_none_and_enqueues_fallback(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    enq = []
    monkeypatch.setattr(imap, "_enqueue_fallback", lambda t: enq.append(t))
    out = imap.get_industries(["NVDA", "ZZZZ"])
    assert out["NVDA"] == "Semiconductors"
    assert out["ZZZZ"] is None
    assert enq == ["ZZZZ"]


def test_request_path_does_not_block(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    calls = []
    monkeypatch.setattr(imap, "_fetch_fallback",
                        lambda t: calls.append(t) or (None, None, None))
    monkeypatch.setattr(imap, "_enqueue_fallback", lambda t: None)  # don't spawn pool
    imap.get_industries(["COLD"])
    assert calls == []  # no synchronous fetch on the request path


def test_uppercases_and_dedupes(imap):
    imap.bulk_refresh_from_finviz()
    out = imap.get_industries(["nvda", "NVDA", ""])
    assert out == {"NVDA": "Semiconductors"}


def test_prewarm_bulk_loads_when_empty(imap):
    assert imap._count() == 0
    imap.prewarm()
    assert imap._count() == 3


def test_fallback_persists_industry(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    monkeypatch.setattr(imap, "_fetch_fallback",
                        lambda t: ("Healthcare", "Biotechnology", "yfinance"))
    # Run the fallback job inline rather than via the pool.
    monkeypatch.setattr(imap._FALLBACK_POOL, "submit", lambda fn: fn())
    imap._enqueue_fallback("NEWCO")
    assert imap.get_industries(["NEWCO"])["NEWCO"] == "Biotechnology"


def test_status_shape(imap):
    imap.bulk_refresh_from_finviz()
    s = imap.status()
    assert s["rows"] == 3
    assert s["stale"] is False


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(im, "_DB_PATH", os.path.join(d, "industry_map.db"))
        monkeypatch.setattr(im, "_INIT_DONE", False)
        monkeypatch.setattr(im, "_maybe_self_heal", lambda: None)
        monkeypatch.setattr(im, "_enqueue_fallback", lambda t: None)
        im._init_db()
        from api.routers import breadth_monitor
        app = FastAPI()
        app.include_router(breadth_monitor.router)
        yield TestClient(app)


def test_endpoint_shape(client):
    im._upsert_many([("MSFT", "Technology", "Software - Infrastructure", "finviz", 1)])
    r = client.post("/api/breadth/industries", json={"tickers": ["MSFT", "NOPE"]})
    assert r.status_code == 200
    body = r.json()
    assert body["industries"]["MSFT"] == "Software - Infrastructure"
    assert body["industries"]["NOPE"] is None


def test_endpoint_caps_at_500(client):
    r = client.post("/api/breadth/industries", json={"tickers": [f"T{i}" for i in range(900)]})
    assert r.status_code == 200
    assert len(r.json()["industries"]) == 500


def test_endpoint_bad_body(client):
    r = client.post("/api/breadth/industries", json={"tickers": "notalist"})
    assert r.status_code == 400


def test_status_endpoint(client):
    im._upsert_many([("AAPL", "Technology", "Consumer Electronics", "finviz", 1)])
    r = client.get("/api/breadth/industries/status")
    assert r.status_code == 200
    assert r.json()["rows"] == 1
