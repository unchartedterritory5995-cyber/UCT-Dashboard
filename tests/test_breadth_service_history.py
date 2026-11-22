"""GET /api/breadth-monitor/service-history: the Monitor's history for the PUSH_SECRET bearer.

2026-11-13: the NAAIM settle job (uct-intelligence/scripts/naaim_backfill.py) read the members-only
GET /api/breadth-monitor anonymously, 401'd every run, and wrote nothing (303 crashes) after buying tweets.
"""
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from api.routers import breadth_monitor as router


def _client(monkeypatch, seen):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")

    def fake_history(days=90, end="", anchor="le", _user=None):
        seen.append((days, end, anchor))
        return Response(content=b'{"rows":[{"date":"2026-11-12","naaim":null}]}', media_type="application/json")

    monkeypatch.setattr(router, "get_breadth_history", fake_history)
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app)


def test_the_service_read_needs_the_push_secret(monkeypatch):
    seen = []
    c = _client(monkeypatch, seen)
    assert c.get("/api/breadth-monitor/service-history?days=5").status_code == 401
    assert c.get("/api/breadth-monitor/service-history?days=5",
                 headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert seen == []                                          # refused before any work
    r = c.get("/api/breadth-monitor/service-history?days=5", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["rows"][0]["date"] == "2026-11-12"
    assert seen == [(5, "", "le")]                             # the members' own handler answered


def test_an_unset_secret_refuses_everybody(monkeypatch):
    seen = []
    c = _client(monkeypatch, seen)
    monkeypatch.setenv("PUSH_SECRET", "")
    assert c.get("/api/breadth-monitor/service-history", headers={"Authorization": "Bearer "}).status_code == 401
    assert seen == []


def test_the_members_route_is_not_loosened(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(router.router)
    r = TestClient(app).get("/api/breadth-monitor?days=5", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 401                                # the bearer is not a member session
