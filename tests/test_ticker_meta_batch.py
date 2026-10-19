"""POST /api/ticker-meta/batch: the stock details the server ALREADY holds, many in one request.

A screen's list warm asks for ~25 stocks' details on a member's first visit, one request
each. The batch answers every name the server has cached (memory or the 24h disk cache) in
one round-trip and NAMES the rest as missing; it never calls a provider, because a cold name
costs a provider round-trip and a batch of cold names would serialise all of them behind one
request. The client sends the missing ones down the per-symbol path it always used.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import ticker_meta as r
from api.services import ticker_meta as svc


def _client():
    app = FastAPI()
    app.include_router(r.router)
    return TestClient(app)


def test_cached_names_answer_and_cold_names_are_named_missing_with_no_provider_call(monkeypatch):
    cached = {"AAPL": {"name": "Apple Inc", "sector": "Technology", "industry": "Consumer Electronics", "exchange": "NASDAQ"}}
    monkeypatch.setattr(svc, "_peek_base", lambda t: cached.get(t))
    monkeypatch.setattr(svc, "_primary_theme", lambda t: "Hardware")
    called = []
    for prov in ("_from_yfinance", "_from_fmp", "_from_finnhub"):
        monkeypatch.setattr(svc, prov, lambda t, _p=prov: called.append(_p))
    out = _client().post("/api/ticker-meta/batch", json={"tickers": ["aapl", "ZZZZ", "AAPL"]}).json()
    assert out["results"] == {"AAPL": {**cached["AAPL"], "theme": "Hardware"}}
    assert out["missing"] == ["ZZZZ"]
    assert called == []


def test_the_batch_is_bounded(monkeypatch):
    monkeypatch.setattr(svc, "_peek_base", lambda t: None)
    out = _client().post("/api/ticker-meta/batch", json={"tickers": [f"T{i}" for i in range(500)]}).json()
    assert len(out["missing"]) == r.BATCH_MAX


def test_the_peek_reads_memory_then_disk_and_never_a_provider(monkeypatch, tmp_path):
    monkeypatch.setattr(svc, "_CACHE_DIR", str(tmp_path))
    svc._mem.clear() if hasattr(svc._mem, "clear") else None
    monkeypatch.setattr(svc, "_from_yfinance", lambda t: (_ for _ in ()).throw(AssertionError("provider called")))
    assert svc._peek_base("QQQQ") is None
    svc._disk_put("QQQQ", {"name": "Q Co", "sector": None, "industry": None, "exchange": "NYSE"})
    assert svc._peek_base("QQQQ")["name"] == "Q Co"
    # A pre-`exchange` disk entry is stale to _base_meta, so the peek does not serve it either.
    svc._disk_put("OLDD", {"name": "Old Co", "sector": None, "industry": None})
    assert svc._peek_base("OLDD") is None
