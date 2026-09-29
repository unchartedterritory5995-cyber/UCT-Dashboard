"""TERM-049 — the per-ticker history join: four citable lanes, counts-only room, dark route."""
from __future__ import annotations

import contextlib
import json
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import ticker_history as th

ET = ZoneInfo("America/New_York")
TODAY = datetime.now(ET).date()
D1 = (TODAY - timedelta(days=3)).isoformat()
D2 = (TODAY - timedelta(days=2)).isoformat()


@pytest.fixture
def stores(tmp_path, monkeypatch):
    from api.services import buzz_store, uct20_nav, wire_archive
    from api.services.catalyst import store as cat_store

    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    with contextlib.suppress(Exception):
        buzz_store._reset_for_tests()
    buzz_store.init_db(str(tmp_path / "buzz.db"))
    ts = int(datetime.fromisoformat(D2 + "T11:00:00").replace(tzinfo=ET).timestamp())
    with contextlib.closing(sqlite3.connect(tmp_path / "buzz.db")) as c:
        c.executemany("INSERT INTO mentions VALUES (?,?,?,?,?,?)",
                      [("m1", "ch", "author-1", "NVDA", ts, "cashtag"),
                       ("m2", "ch", "author-2", "NVDA", ts + 60, "exact"),
                       ("m3", "ch", "author-3", "AMD", ts, "exact")])
        c.commit()

    monkeypatch.setattr(cat_store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    cat_store._init_db()
    with contextlib.closing(sqlite3.connect(tmp_path / "catalysts.db")) as c:
        c.execute("INSERT INTO catalysts (market_date, ticker, rank, tag, thesis_text) VALUES (?,?,?,?,?)",
                  (D1, "NVDA", 3, "Earnings", "Beat and raised."))
        c.commit()

    monkeypatch.setenv("WIRE_ARCHIVE_DIR", str(tmp_path / "wire"))
    wire_archive.record({"date": D1, "rundown_html": "<p>Watching $NVDA and NVDA into the print.</p>"})
    wire_archive.record({"date": D2, "rundown_html": "<p>Semis weak; SNVDA is not NVDAX.</p>"})

    comp = tmp_path / "uct20.json"
    comp.write_text(json.dumps([{"date": D1, "holdings": ["AMD"]},
                                {"date": D2, "holdings": ["AMD", "NVDA"]}]), encoding="utf-8")
    monkeypatch.setattr(uct20_nav, "_COMPOSITIONS_FILE", str(comp))
    return tmp_path


def test_all_four_lanes_join_with_source_and_date(stores):
    out = th.history("nvda", days=30)
    assert out["ticker"] == "NVDA"
    assert {k: v["status"] for k, v in out["lanes"].items()} == {l: "ok" for l in th.LANES}
    lanes = {r["lane"] for r in out["timeline"]}
    assert lanes == {"wire", "book", "catalysts", "room"}
    for r in out["timeline"]:
        assert r["source"] and r["as_of"] and r["ref"] and r["date"]


def test_wire_counts_whole_word_ticker_only(stores):
    wire = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "wire"]
    assert [(r["date"], r["mentions"]) for r in wire] == [(D1, 2)]  # SNVDA / NVDAX never match


def test_book_lane_derives_entry_from_consecutive_compositions(stores):
    book = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "book"]
    assert [(r["date"], r["event"]) for r in book] == [(D2, "entered")]


def test_room_lane_is_counts_only_never_text_or_authors(stores):
    room = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "room"]
    assert [(r["date"], r["mentions"]) for r in room] == [(D2, 2)]
    blob = json.dumps(room)
    assert "author" not in blob and "m1" not in blob and "message" not in blob


def test_a_failed_lane_is_unavailable_not_empty(stores, monkeypatch):
    def boom(sym, since):
        raise sqlite3.OperationalError("store unreadable")
    monkeypatch.setitem(th._LANE_FNS, "catalysts", boom)
    out = th.history("NVDA", days=30)
    assert out["lanes"]["catalysts"] == {"status": "unavailable", "count": None}
    assert out["lanes"]["wire"]["status"] == "ok"


def _client(user):
    from api.routers import ticker_history as router_mod
    from api.middleware.auth_middleware import get_current_user_with_plan

    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
FREE = {"id": "u2", "role": "member", "plan": "free", "subscription_status": None}


def test_route_is_404_while_dark(monkeypatch, stores):
    monkeypatch.delenv(th.ENABLED_ENV, raising=False)
    assert _client(PAID).get("/api/research/history/NVDA").status_code == 404


def test_route_serves_paid_and_refuses_free_when_armed(monkeypatch, stores):
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    from api.middleware import auth_middleware
    monkeypatch.setattr("api.routers.ticker_history.is_paid_user", lambda u: u.get("plan") == "pro")
    r = _client(PAID).get("/api/research/history/NVDA?days=30")
    assert r.status_code == 200 and r.json()["ticker"] == "NVDA"
    assert _client(FREE).get("/api/research/history/NVDA").status_code == 402


def test_the_auth_payload_carries_the_flag(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv(th.ENABLED_ENV, raising=False)
    assert auth._ticker_history_enabled() is False
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    assert auth._ticker_history_enabled() is True
