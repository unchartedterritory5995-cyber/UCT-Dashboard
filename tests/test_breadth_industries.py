"""Tests for the breadth drill-down "group by industry" enrichment.

Covers the non-blocking industry lookup (cache-only read + bounded backfill)
and the POST /api/breadth/industries endpoint shape + 500-ticker cap.
"""
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.catalyst import ticker_metadata as tm


@pytest.fixture
def meta(monkeypatch):
    """Point ticker_metadata at a fresh temp DB."""
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tm, "_DB_PATH", os.path.join(d, "meta.db"))
        monkeypatch.setattr(tm, "_INIT_DONE", False)
        # Never hit the network in tests.
        monkeypatch.setattr(tm, "_fetch_via_yfinance",
                            lambda t: {"sector": None, "industry": None,
                                       "market_cap": None, "avg_volume_30d": None})
        tm._init_db()
        yield tm


def test_cached_industry_returned(meta):
    meta._put_cache("NVDA", "Technology", "Semiconductors", None, None)
    out = meta.get_industries_nonblocking(["NVDA"])
    assert out == {"NVDA": "Semiconductors"}


def test_miss_returns_none_and_enqueues(meta):
    enqueued = []
    # Spy on the backfill so we don't depend on pool timing.
    meta._enqueue_industry_backfill = lambda t: enqueued.append(t)  # type: ignore
    out = meta.get_industries_nonblocking(["ZZZZ"])
    assert out == {"ZZZZ": None}
    assert enqueued == ["ZZZZ"]


def test_uppercases_and_dedupes(meta):
    meta._put_cache("AMD", "Technology", "Semiconductors", None, None)
    out = meta.get_industries_nonblocking(["amd", "AMD", ""])
    assert out == {"AMD": "Semiconductors"}


def test_cache_only_does_not_block(meta):
    # A cold ticker must return immediately (None) without a synchronous
    # yfinance call on the request path. We assert the network stub is never
    # invoked by the lookup itself.
    calls = []
    meta._fetch_via_yfinance = lambda t: calls.append(t) or {  # type: ignore
        "sector": None, "industry": None, "market_cap": None, "avg_volume_30d": None}
    # Stub the pool so the background job doesn't run during the test.
    meta._enqueue_industry_backfill = lambda t: None  # type: ignore
    out = meta.get_industries_nonblocking(["COLD"])
    assert out == {"COLD": None}
    assert calls == []  # request path never fetched


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tm, "_DB_PATH", os.path.join(d, "meta.db"))
        monkeypatch.setattr(tm, "_INIT_DONE", False)
        monkeypatch.setattr(tm, "_enqueue_industry_backfill", lambda t: None)
        tm._init_db()
        from api.routers import breadth_monitor
        app = FastAPI()
        app.include_router(breadth_monitor.router)
        yield TestClient(app)


def test_endpoint_shape(client):
    tm._put_cache("MSFT", "Technology", "Software", None, None)
    r = client.post("/api/breadth/industries", json={"tickers": ["MSFT", "NOPE"]})
    assert r.status_code == 200
    body = r.json()
    assert body["industries"]["MSFT"] == "Software"
    assert body["industries"]["NOPE"] is None


def test_endpoint_caps_at_500(client):
    many = [f"T{i}" for i in range(900)]
    r = client.post("/api/breadth/industries", json={"tickers": many})
    assert r.status_code == 200
    assert len(r.json()["industries"]) == 500


def test_endpoint_bad_body(client):
    r = client.post("/api/breadth/industries", json={"tickers": "notalist"})
    assert r.status_code == 400
