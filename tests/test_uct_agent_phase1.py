"""UCT Agent Phase 1 (docs/agent/PHASE1-INTELLIGENCE.md) — the server half.

  * /api/agent/session-stats: the LATEST COMPLETED SESSION's close / volume / dollar volume
    (one bar, one clock, the day named), admin-only like every Agent route, read-only.
  * /api/screener/fields?options=1: each list field's real values + how much of the universe
    it classifies (so "software" can be matched to real industries and coverage said).
  * the prompt's clarification policy: act on clear intent with defaults; whole requests in one plan.
"""
from __future__ import annotations

import datetime as dt
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.uct_agent import session_stats, turn

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}
MEMBER = {"id": "38c023cf-0e81-4187-aa43-ac51a751a002", "plan": "pro", "role": "user"}

FRAME = {
    "AAA": {"o": 10, "h": 12, "l": 9, "c": 11.5, "v": 2_000_000},
    "BBB": {"o": 5, "h": 6, "l": 4, "c": 4.0, "v": 9_000_000},
    "ZER": {"o": 1, "h": 1, "l": 1, "c": 0.0, "v": 10},         # a non-positive close is not data
}


def _session(d="2026-10-09"):
    return lambda: dt.date.fromisoformat(d)


def test_SESSION_close_volume_and_dollar_volume_come_from_ONE_bar_of_the_named_session():
    out = session_stats.latest_session(["aaa", "BBB", "ZER", "NOPE", "AAA"], frame=lambda d: FRAME, session=_session())
    assert out["session"] == "2026-10-09"
    assert out["rows"]["AAA"] == {"close": 11.5, "volume": 2_000_000.0, "dollar_volume": 23_000_000.0}
    assert out["rows"]["BBB"]["dollar_volume"] == 36_000_000.0
    assert out["missing"] == ["ZER", "NOPE"]                      # never a guessed or zero value


def test_SESSION_not_yet_published_steps_back_one_session_and_says_which_day():
    asked = []

    def frame(d):
        asked.append(d)
        return FRAME if d == "2026-10-08" else {}
    out = session_stats.latest_session(["AAA"], frame=frame, session=_session("2026-10-09"),
                                       previous=lambda day: day - dt.timedelta(days=1))
    assert asked == ["2026-10-09", "2026-10-08"]
    assert out["session"] == "2026-10-08" and "AAA" in out["rows"]


def test_SESSION_no_data_is_an_honest_error_never_an_empty_success():
    out = session_stats.latest_session(["AAA"], frame=lambda d: {}, session=_session(),
                                       previous=lambda day: day - dt.timedelta(days=1))
    assert out["session"] is None and out["rows"] == {} and "isn't available" in out["error"]


def test_SESSION_completed_means_the_close_has_passed():
    from api.services import flow_card_ops
    # Friday 2026-10-09: before 16:00 ET the completed session is Thursday; after, Friday.
    before = dt.datetime(2026, 10, 9, 14, 0, tzinfo=dt.timezone(dt.timedelta(hours=-4))).timestamp()
    after = dt.datetime(2026, 10, 9, 16, 30, tzinfo=dt.timezone(dt.timedelta(hours=-4))).timestamp()
    assert flow_card_ops.last_closed_session(before) == dt.date(2026, 10, 8)
    assert flow_card_ops.last_closed_session(after) == dt.date(2026, 10, 9)


@pytest.fixture
def make_client(monkeypatch):
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)

    def build(user):
        from api.middleware.auth_middleware import get_current_user_with_plan
        app = FastAPI()
        app.include_router(rx.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return TestClient(app)
    return build


def test_SESSION_route_is_admin_only_like_every_agent_route(make_client, monkeypatch):
    monkeypatch.setattr(session_stats, "_default_frame", lambda d: FRAME)
    monkeypatch.setattr(session_stats, "_default_session", _session())
    assert make_client(MEMBER).post("/api/agent/session-stats", json={"symbols": ["AAA"]}).status_code == 403
    r = make_client(ADMIN).post("/api/agent/session-stats", json={"symbols": ["AAA"]})
    assert r.status_code == 200 and r.json()["rows"]["AAA"]["dollar_volume"] == 23_000_000.0
    over = make_client(ADMIN).post("/api/agent/session-stats", json={"symbols": ["X"] * (session_stats.MAX_SYMBOLS + 1)})
    assert over.status_code == 400


def test_FIELD_OPTIONS_are_the_artifacts_values_with_coverage(monkeypatch):
    from api.services.screener import filters, snapshot_db
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE screener_rows (ticker TEXT, industry TEXT, sector TEXT, exchange TEXT)")
    conn.executemany("INSERT INTO screener_rows VALUES (?,?,?,?)", [
        ("A", "Software - Application", "Technology", "NASDAQ"), ("B", "Software - Infrastructure", "Technology", "NYSE"),
        ("C", "Banks - Regional", "Financial Services", "NYSE"), ("D", None, None, "NYSE"), ("E", "", None, "NASDAQ"),
    ])

    class _Ctx:
        def __enter__(self):
            return conn

        def __exit__(self, *a):
            return False
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: _Ctx())
    out = filters.field_options()
    assert out["industry"] == {"values": ["Banks - Regional", "Software - Application", "Software - Infrastructure"],
                               "with_value": 3, "total": 5}
    assert out["sector"]["with_value"] == 3 and out["exchange"]["with_value"] == 5
    assert "price" not in out                                     # range fields have no options


def test_FIELD_OPTIONS_without_a_snapshot_is_empty_never_a_500(monkeypatch):
    from api.services.screener import filters, snapshot_db
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("no db")))
    assert filters.field_options() == {}


def test_PROMPT_acts_on_clear_intent_and_plans_whole_requests():
    p = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert "ACT ON CLEAR INTENT" in p and "do not ask" in p
    assert "ALL of a screen's results unless they give a number" in p
    assert "Never ask for something UCT can look up" in p
    assert "WHOLE REQUESTS" in p and "Never plan only the first step" in p
    # necessary questions survive: which existing thing to change, missing essentials, no alternative
    assert "it is unclear WHICH existing thing to change, delete or overwrite among several" in p
    assert "essential information is missing and has no safe default" in p
    # follow-up references resolve from what UCT just did
    assert "the watchlist you just made" in p
