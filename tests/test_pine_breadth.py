"""Track 4, unit B1: `api/services/pine_breadth.py` and `GET /api/pine/breadth/{spelling}`.

Each must hold, with a test that goes red when it breaks:
  * a request never walks the breadth database: a cold spelling answers `pending` and queues ONE refresh;
  * every answer is labelled UCT breadth with its definition (never TradingView's series);
  * aliases stay `witness: pending`, volume spellings are refused as not held, anything else is refused;
  * ADD is advancing minus declining of the same session;
  * a failed refresh keeps the copy we have; the snapshot is written atomically;
  * the stage: admins only by default; members refused by the licence while uct_breadth is not servable.
"""
from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import pine_breadth as route
from api.services import pine_breadth as pb

ADV = {"2026-01-05": {"o": 900, "h": 1900, "l": 800, "c": 1800}, "2026-01-06": {"o": 1000, "h": 1200, "l": 700, "c": 900}}
DEC = {"2026-01-05": {"o": 1500, "h": 1600, "l": 300, "c": 400}, "2026-01-06": {"o": 1400, "h": 1800, "l": 1000, "c": 1500}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_BREADTH_DIR", str(tmp_path / "pine_breadth"))
    monkeypatch.delenv("PINE_BREADTH_SUPPLY_ENABLED", raising=False)
    pb._MEM.clear()
    with pb._INFLIGHT_LOCK:
        pb._INFLIGHT.clear()
    yield
    pb._MEM.clear()


@pytest.fixture
def history(monkeypatch):
    calls = []

    def fake(universe, metric):
        calls.append((universe, metric))
        return {"advancing": ADV, "declining": DEC, "unchanged": {}}[metric]
    monkeypatch.setattr(pb, "_history", fake)
    return calls


def test_a_cold_spelling_is_pending_and_never_walks_the_database_on_the_request(history, monkeypatch):
    queued = []
    monkeypatch.setattr(pb._POOL, "submit", lambda fn: queued.append(fn))
    assert pb.read("USI:ADVN.NY")["state"] == "pending"
    assert pb.read("usi:advn.ny")["state"] == "pending"
    assert len(queued) == 1 and history == []
    queued[0]()
    r = pb.read("USI:ADVN.NY")
    assert r["state"] == "ready" and [x["c"] for x in r["rows"]] == [1800, 900] and r["knownFrom"] == "2026-01-05"


def test_every_answer_is_labelled_uct_breadth(history):
    pb.refresh("nyse", "advancing")
    r = pb.read("USI:ADVN.NY")
    assert r["label"] == "UCT breadth" and "Not the exchange's official count" in r["definition"]
    assert "NYSE" in r["definition"]


def test_add_is_advancing_minus_declining_of_the_same_session(history):
    rows = pb.fetch_rows("nyse", "add")
    assert [(x["d"], x["c"]) for x in rows] == [("2026-01-05", 1400), ("2026-01-06", -600)]
    assert all(x["o"] == x["h"] == x["l"] == x["c"] for x in rows)


@pytest.mark.parametrize("spelling,want", [
    ("USI:ADVN.NY", ("nyse", "advancing", None)), ("USI:DECL.NQ", ("nasdaq", "declining", None)),
    ("USI:ADV", ("nyse", "advancing", "USI:ADVN.NY")), ("DECN", ("nyse", "declining", "USI:DECL.NY")),
    ("USI:ADDQ", ("nasdaq", "add", None))])
def test_the_spellings(spelling, want):
    r = pb.resolve(spelling)
    assert (r["universe"], r["metric"], r["aliasOf"]) == want and r["witness"].startswith("pending")


def test_volume_and_unknown_spellings_are_refused_by_name():
    assert "no up or down volume" in pb.resolve("USI:UVOL")["refusal"]
    assert "not a breadth spelling" in pb.resolve("USI:TICK")["refusal"]
    assert pb.read("USI:TICK")["state"] == "refused"


def test_a_failed_refresh_keeps_the_copy(history, monkeypatch):
    pb.refresh("nyse", "advancing", now=1_000)
    monkeypatch.setattr(pb, "_history", lambda u, m: (_ for _ in ()).throw(RuntimeError("authority off")))
    doc = pb.refresh("nyse", "advancing", now=2_000)
    assert doc["state"] == "unavailable" and doc["staleSince"] == 1_000 and doc["rows"]


def test_the_snapshot_is_written_atomically(history, monkeypatch):
    pb.refresh("nyse", "advancing", now=1_000)
    path = pb._path("nyse", "advancing")
    before = open(path, "rb").read()
    monkeypatch.setattr(pb.json, "dump", lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        pb.refresh("nyse", "advancing", now=2_000)
    assert open(path, "rb").read() == before
    assert [n for n in os.listdir(os.path.dirname(path)) if n.endswith(".tmp")] == []


def test_the_live_catalog_refuses_uct_breadth_today():
    """ESC-03 is open: (massive, derived_analytics) reads R, so members are refused by name."""
    r = pb.licence_refusal()
    assert r and r["guard"] == "pine-data:licence"


# ── the route ───────────────────────────────────────────────────────────────────────────────────────────────────
def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: user
    return TestClient(app)


MEMBER = {"id": "m", "role": "member", "plan": "pro"}
ADMIN = {"id": "a", "role": "admin", "plan": "pro"}


def test_dark_by_default_member_404_admin_reads(history):
    pb.refresh("nyse", "advancing")
    assert _client(MEMBER).get("/api/pine/breadth/USI:ADVN.NY").status_code == 404
    r = _client(ADMIN).get("/api/pine/breadth/USI:ADVN.NY")
    assert r.status_code == 200 and r.json()["rows"][0]["c"] == 1800


def test_at_all_a_member_is_refused_by_the_licence_not_served(history, monkeypatch):
    pb.refresh("nyse", "advancing")
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", "all")
    r = _client(MEMBER).get("/api/pine/breadth/USI:ADVN.NY")
    assert r.status_code == 200 and r.json()["state"] == "refused" and "rows" not in r.json()
    monkeypatch.setattr(pb, "licence_refusal", lambda: None)
    assert _client(MEMBER).get("/api/pine/breadth/USI:ADVN.NY").json()["state"] == "ready"


def test_off_and_a_typo_are_404_for_everyone(history, monkeypatch):
    for v in ("off", "admin"):
        monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", v)
        assert _client(ADMIN).get("/api/pine/breadth/USI:ADVN.NY").status_code == 404


def test_pending_is_202(history, monkeypatch):
    monkeypatch.setattr(pb._POOL, "submit", lambda fn: None)
    r = _client(ADMIN).get("/api/pine/breadth/USI:DECL.NY")
    assert r.status_code == 202 and r.headers["retry-after"] == "5"
