"""Phase 2 serving router (api/routers/barspack_router.py)."""
import gzip
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.services.data_sync as ds
from api.routers.barspack_router import router


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_manifest_absent_is_no_store(monkeypatch):
    monkeypatch.setattr(ds, "get_bytes", lambda k: None)
    r = _client().get("/api/barspack/manifest")
    assert r.status_code == 200
    assert r.json() == {"available": False}
    assert "no-store" in r.headers["cache-control"]


def test_manifest_present_short_cache(monkeypatch):
    monkeypatch.setattr(ds, "get_bytes",
                        lambda k: b'{"version":"2026-08-14","ticker_count":3000}')
    r = _client().get("/api/barspack/manifest")
    assert r.status_code == 200
    assert r.json()["version"] == "2026-08-14"
    assert "max-age=300" in r.headers["cache-control"]


def test_shard_served_gzipped_and_decodes(monkeypatch):
    payload = gzip.compress(json.dumps({"format": 1, "tickers": {"AAPL": {}}}).encode())
    seen = {}
    monkeypatch.setattr(ds, "get_bytes", lambda k: (seen.__setitem__("key", k), payload)[1])
    r = _client().get("/api/barspack/2026-08-14/3")
    assert r.status_code == 200
    # route reconstructs the zero-padded R2 key
    assert seen["key"] == "barspack/2026-08-14/003.json.gz"
    # httpx transparently decompresses the Content-Encoding: gzip body → JSON
    assert r.json()["format"] == 1
    assert "immutable" in r.headers["cache-control"]


def test_delta_served_and_decodes(monkeypatch):
    payload = gzip.compress(json.dumps({"format": 1, "tail": 7, "tickers": {}}).encode())
    seen = {}
    monkeypatch.setattr(ds, "get_bytes", lambda k: (seen.__setitem__("key", k), payload)[1])
    r = _client().get("/api/barspack/2026-08-14/delta")
    assert r.status_code == 200
    assert seen["key"] == "barspack/2026-08-14/delta.json.gz"
    assert r.json()["tail"] == 7
    assert "immutable" in r.headers["cache-control"]


def test_delta_route_wins_over_numeric_shard(monkeypatch):
    # 'delta' must not fall through to /{date}/{idx} (which requires digits).
    monkeypatch.setattr(ds, "get_bytes", lambda k: None)
    r = _client().get("/api/barspack/2026-08-14/delta")
    assert r.status_code == 404  # reached the delta handler (missing obj), not a 422


def test_hot_served_and_decodes(monkeypatch):
    payload = gzip.compress(json.dumps({"format": 1, "tickers": {"SPY": {}}}).encode())
    seen = {}
    monkeypatch.setattr(ds, "get_bytes", lambda k: (seen.__setitem__("key", k), payload)[1])
    r = _client().get("/api/barspack/2026-08-14/hot")
    assert r.status_code == 200
    assert seen["key"] == "barspack/2026-08-14/hot.json.gz"
    assert r.json()["tickers"] == {"SPY": {}}
    assert "immutable" in r.headers["cache-control"]


def test_hot_route_wins_over_numeric_shard(monkeypatch):
    # 'hot' must not fall through to /{date}/{idx} (which requires digits).
    monkeypatch.setattr(ds, "get_bytes", lambda k: None)
    r = _client().get("/api/barspack/2026-08-14/hot")
    assert r.status_code == 404  # reached the hot handler (missing obj), not a 422


def test_shard_rejects_path_traversal(monkeypatch):
    monkeypatch.setattr(ds, "get_bytes", lambda k: b"should-not-be-reached")
    c = _client()
    assert c.get("/api/barspack/not-a-date/3").status_code == 404
    assert c.get("/api/barspack/2026-08-14/abc").status_code == 404


def test_shard_missing_is_404(monkeypatch):
    monkeypatch.setattr(ds, "get_bytes", lambda k: None)
    assert _client().get("/api/barspack/2026-08-14/5").status_code == 404
