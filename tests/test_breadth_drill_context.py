"""Scan-window badges: which other lists a drilled name is also on, and how often it
was already in this list over the previous sessions.

Synthetic snapshots only. The route is member-gated like the list it decorates.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import breadth_monitor as bm


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "breadth.db"))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    yield


def _seed(date_str, metrics):
    with sqlite3.connect(bm._db_path()) as c:
        c.execute("INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                  (date_str, json.dumps(metrics)))


def _l(*ts):
    return [{"t": t, "pct": 5.0} for t in ts]


DAY = "2026-09-10"


def _history():
    _seed("2026-09-03", {"up_4pct_today_list": _l("AAA")})
    _seed("2026-09-04", {"up_4pct_today_list": _l("AAA", "BBB")})
    _seed("2026-09-05", {"up_4pct_today_list": _l("AAA")})
    _seed("2026-09-08", {"up_4pct_today_list": _l("ZZZ")})
    _seed("2026-09-09", {"up_4pct_today_list": _l("AAA")})
    _seed("2026-09-02", {"up_4pct_today_list": _l("AAA")})   # 6th back — outside lookback 5
    _seed(DAY, {
        "up_4pct_today_list": _l("AAA", "BBB", "CCC"),
        "new_52w_highs_list": _l("AAA", "CCC"),
        "stage2_list": _l("AAA"),
        "universe_list": _l("AAA", "BBB", "CCC", "DDD"),
        "up_4pct_today": 3,
    })


def test_also_lists_the_other_lists_on_the_same_day_and_skips_universe():
    _history()
    ctx = bm.get_drill_context(DAY, "up_4pct_today_list", ["AAA", "BBB", "CCC"])
    assert ctx["also"] == {"AAA": ["new_52w_highs_list", "stage2_list"], "CCC": ["new_52w_highs_list"]}
    assert "BBB" not in ctx["also"]


def test_repeat_counts_only_the_previous_five_sessions():
    _history()
    ctx = bm.get_drill_context(DAY, "up_4pct_today_list", ["AAA", "BBB", "CCC"])
    # AAA: 09-09, 09-05, 09-04, 09-03 (09-08 lacks it, 09-02 is the 6th back)
    assert ctx["repeat"] == {"AAA": 4, "BBB": 1}
    assert ctx["lookback_found"] == 5


def test_a_short_history_reports_how_much_it_saw():
    _seed(DAY, {"up_4pct_today_list": _l("AAA")})
    ctx = bm.get_drill_context(DAY, "up_4pct_today_list", ["AAA"])
    assert ctx["lookback_found"] == 0
    assert ctx["repeat"] == {}


def test_case_of_the_ticker_does_not_matter():
    _history()
    assert bm.get_drill_context(DAY, "up_4pct_today_list", ["aaa"])["repeat"] == {"AAA": 4}


@pytest.mark.parametrize("bad", ["", "up_4pct_today", "x'); DROP TABLE breadth_snapshots;--_list", "Up_List", None])
def test_a_key_that_is_not_a_list_key_returns_empty_and_touches_nothing(bad):
    _history()
    assert bm.get_drill_context(DAY, bad, ["AAA"]) == {"also": {}, "repeat": {}, "lookback_found": 0}
    with sqlite3.connect(bm._db_path()) as c:
        assert c.execute("SELECT COUNT(*) FROM breadth_snapshots").fetchone()[0] == 7


def test_a_missing_day_still_answers_repeat_and_never_raises():
    _history()
    ctx = bm.get_drill_context("2026-09-11", "up_4pct_today_list", ["AAA"])
    assert ctx["also"] == {}
    assert ctx["repeat"]["AAA"] >= 1


# ── route ────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from api.routers import breadth_monitor as rt
    app = FastAPI()
    app.include_router(rt.router)
    app.dependency_overrides[rt.require_paid] = lambda: {"id": 1, "role": "member"}
    return TestClient(app)


def test_route_returns_context_for_the_listed_names(client):
    _history()
    r = client.get(f"/api/breadth-monitor/{DAY}/drill/up_4pct_today_list/context")
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == DAY and body["metric"] == "up_4pct_today_list"
    assert body["repeat"]["AAA"] == 4
    assert body["also"]["CCC"] == ["new_52w_highs_list"]


def test_route_404s_like_the_list_when_there_is_no_such_list(client):
    _history()
    assert client.get(f"/api/breadth-monitor/{DAY}/drill/nope_list/context").status_code == 404


def test_route_is_member_gated():
    from api.routers import breadth_monitor as rt
    app = FastAPI()
    app.include_router(rt.router)
    r = TestClient(app).get(f"/api/breadth-monitor/{DAY}/drill/up_4pct_today_list/context")
    assert r.status_code in (401, 403)
