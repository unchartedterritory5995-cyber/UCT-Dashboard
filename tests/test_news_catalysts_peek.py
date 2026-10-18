"""`generate=False` is a PEEK: what is already written, never a generation.

The screener's catalyst strip reads the feed for every stock a member steps
past with the arrow keys. A plain read starts a background LLM generation for
any name that needs one (one unbounded thread per symbol), so a strip on the
ordinary read would start one per row walked. The peek returns the same merged
events and says `none` where nothing is written yet; the deliberate doors
(the research page, the /charts widget) keep generating as before.
"""
from fastapi.testclient import TestClient


def _wire(monkeypatch, nc, *, needs, rows):
    started = []
    monkeypatch.setattr(nc, "needs_catalysts", lambda sym: needs)
    monkeypatch.setattr(nc, "_gen_async", lambda sym: started.append(sym))
    monkeypatch.setattr(nc, "_combined_has_rows", lambda sym: bool(rows))
    monkeypatch.setattr(nc, "_combined", lambda sym: list(rows))
    return started


def test_a_peek_never_starts_a_generation(monkeypatch):
    from api.services.news_catalysts import service as nc
    started = _wire(monkeypatch, nc, needs=True, rows=[])
    out = nc.feed("ABC", generate=False)
    assert started == []
    assert out["status"] == "none" and out["events"] == []


def test_a_peek_returns_what_is_already_written(monkeypatch):
    from api.services.news_catalysts import service as nc
    ev = [{"type": "catalyst", "date": "2026-10-01", "title": "Guidance raised", "direction": "up"}]
    started = _wire(monkeypatch, nc, needs=True, rows=ev)
    out = nc.feed("ABC", generate=False)
    assert started == [] and out["status"] == "ready" and out["events"] == ev


def test_the_ordinary_read_still_generates(monkeypatch):
    """Control: the peek is opt-in; without it the endpoint behaves exactly as before."""
    from api.services.news_catalysts import service as nc
    started = _wire(monkeypatch, nc, needs=True, rows=[])
    out = nc.feed("ABC")
    assert started == ["ABC"] and out["status"] == "generating"


def test_the_route_passes_generate_0_through(monkeypatch):
    from fastapi import FastAPI
    from api.routers import news_catalysts as r
    app = FastAPI()
    app.include_router(r.router)
    from api.services.news_catalysts import service as nc
    seen = []
    monkeypatch.setattr(nc, "feed", lambda sym, generate=True: seen.append((sym, generate)) or {"status": "ready", "events": []})
    app.dependency_overrides[r.require_paid] = lambda: {"id": "u1"}
    c = TestClient(app)
    assert c.get("/api/news-catalysts/ABC?generate=0").status_code == 200
    assert c.get("/api/news-catalysts/ABC").status_code == 200
    assert seen == [("ABC", False), ("ABC", True)]
