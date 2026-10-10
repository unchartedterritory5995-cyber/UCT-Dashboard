"""RS rankings survive a restart on disk.

Measured 2026-10-09 on prod: /api/rs-rankings answered 503 "warming" for ~3 minutes after every
web deploy while the ~67 s universe recompute ran. The last ranking is now written beside the
data, and a cold process answers from it (if younger than 6 h) while it rebuilds.
"""
import json
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import rs_ranking as rs_router
from api.services import rs_ranking

ROWS = [{"ticker": "NVDA", "rs_score": 9.1, "rs_rank": 99, "returns": {"3m": 30.0}},
        {"ticker": "XYZ", "rs_score": -2.0, "rs_rank": 1, "returns": {"3m": -20.0}}]


def _point(monkeypatch, tmp_path):
    monkeypatch.setattr(rs_ranking, "_SNAPSHOT_PATH", str(tmp_path / "rs.json"))
    rs_ranking._rs_cache.invalidate(rs_ranking._CACHE_KEY)


def test_write_then_read_round_trips(monkeypatch, tmp_path):
    _point(monkeypatch, tmp_path)
    rs_ranking._write_snapshot(ROWS)
    assert rs_ranking.snapshot_rankings() == ROWS


def test_an_old_or_corrupt_snapshot_is_not_served(monkeypatch, tmp_path):
    _point(monkeypatch, tmp_path)
    rs_ranking._write_snapshot(ROWS)
    assert rs_ranking.snapshot_rankings(now=time.time() + rs_ranking._SNAPSHOT_MAX_AGE_S + 60) is None
    (tmp_path / "rs.json").write_text("{not json", encoding="utf-8")
    assert rs_ranking.snapshot_rankings() is None
    (tmp_path / "rs.json").write_text(json.dumps({"computed_at": time.time(), "rankings": []}), encoding="utf-8")
    assert rs_ranking.snapshot_rankings() is None


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(rs_router.router)
    app.dependency_overrides[rs_router.require_paid] = lambda: {"id": "u1"}
    kicks = {"n": 0}
    monkeypatch.setattr(rs_router, "kick_background_warm", lambda: kicks.__setitem__("n", kicks["n"] + 1) or True)
    return TestClient(app), kicks


def test_a_cold_process_answers_from_the_snapshot_and_still_rebuilds(monkeypatch, tmp_path):
    _point(monkeypatch, tmp_path)
    rs_ranking._write_snapshot(ROWS)
    client, kicks = _client(monkeypatch)
    r = client.get("/api/rs-rankings")
    assert r.status_code == 200
    assert r.json() == ROWS
    assert kicks["n"] == 1


def test_no_snapshot_still_answers_warming(monkeypatch, tmp_path):
    _point(monkeypatch, tmp_path)
    client, kicks = _client(monkeypatch)
    r = client.get("/api/rs-rankings")
    assert r.status_code == 503
    assert r.json()["status"] == "warming"
    assert kicks["n"] == 1


def test_a_warm_memory_cache_wins_over_the_snapshot(monkeypatch, tmp_path):
    _point(monkeypatch, tmp_path)
    rs_ranking._write_snapshot([{"ticker": "OLD", "rs_rank": 50}])
    rs_ranking._rs_cache.set(rs_ranking._CACHE_KEY, ROWS, ttl=60)
    try:
        client, kicks = _client(monkeypatch)
        assert client.get("/api/rs-rankings").json() == ROWS
        assert kicks["n"] == 0
    finally:
        rs_ranking._rs_cache.invalidate(rs_ranking._CACHE_KEY)
