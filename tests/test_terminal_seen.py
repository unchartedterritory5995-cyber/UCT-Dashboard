"""Wave 3 lane 13 (product #7) -- "new since your last visit" for CN / FEED / CF / CATS.

Rails, each failing for its own reason:
  * a first visit marks nothing and says so; the next visit marks EXACTLY the items not shown before;
  * the visit write is THROTTLED: inside the window there is no database read or write at all, and
    the NEW marks stay put (the 524-outage keystone: no unthrottled per-request write);
  * rows are per (member, code, ticker) and never collide with a MOVE row for the same ticker;
  * the seen set is bounded (per-call key cap, stored cap) and refuses unknown codes / bad tickers;
  * the route is behind the same dark flag + cohort + paid gates as every terminal route.
NO NETWORK.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import terminal_grammar as router_mod  # noqa: E402
from api.services import rollout_gate as rg  # noqa: E402
from api.services import terminal_grammar as tg  # noqa: E402

A = {"id": "t13-member-a", "email": "a@example.test", "role": "admin"}
B = {"id": "t13-member-b", "email": "b@example.test", "role": "admin"}
FREE = {"id": "t13-free", "email": "f@example.test", "role": "member"}
T0 = 1_791_000_000.0   # 2026-10-03 (a fixed instant; the keys below are dated after it)


@pytest.fixture(autouse=True)
def _clean():
    conn = tg._conn()
    try:
        conn.execute("DELETE FROM terminal_visits WHERE user_id LIKE 't13-%'")
        conn.commit()
    finally:
        conn.close()
    tg._SEEN_SNAPSHOTS.clear()
    yield
    tg._SEEN_SNAPSHOTS.clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("TERMINAL_GRAMMAR_ENABLED", "1")
    app = FastAPI()
    app.include_router(router_mod.router)
    state = {"user": A}
    app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    app.dependency_overrides[rg.require_terminal_next] = lambda: state["user"]
    return TestClient(app), state


def test_first_visit_marks_nothing_then_exactly_the_injected_story_is_new():
    first = tg.seen_since_last_visit(A["id"], "CN", "NVDA", ["2026-10-07|a", "2026-10-07|b"], now=T0)
    assert first["first_visit"] is True and first["new"] == [] and first["recorded"] is True
    later = tg.seen_since_last_visit(A["id"], "CN", "NVDA", ["2026-10-08|c", "2026-10-07|a", "2026-10-07|b"],
                                     now=T0 + 3600)
    assert later["first_visit"] is False
    assert later["new"] == ["2026-10-08|c"]
    assert later["last_visit_at"] == T0


def test_the_write_is_throttled_and_the_marks_hold_inside_the_window(monkeypatch):
    tg.seen_since_last_visit(A["id"], "FEED", "NVDA", ["2026-10-07|a"], now=T0)
    visit = tg.seen_since_last_visit(A["id"], "FEED", "NVDA", ["2026-10-08|b", "2026-10-07|a"], now=T0 + 3600)
    assert visit["new"] == ["2026-10-08|b"] and visit["recorded"] is True

    def _no_db():
        raise AssertionError("the throttled path touched the database")
    monkeypatch.setattr(tg, "_conn", _no_db)
    again = tg.seen_since_last_visit(A["id"], "FEED", "NVDA", ["2026-10-08|b", "2026-10-07|a"],
                                     now=T0 + 3600 + tg.SEEN_MIN_INTERVAL - 1)
    assert again["recorded"] is False
    assert again["new"] == ["2026-10-08|b"]          # still NEW: the remount did not wipe it
    assert again["last_visit_at"] == T0


def test_after_the_window_the_baseline_moves():
    tg.seen_since_last_visit(A["id"], "CF", "NVDA", ["2026-10-07|a"], now=T0)
    tg.seen_since_last_visit(A["id"], "CF", "NVDA", ["2026-10-08|b", "2026-10-07|a"], now=T0 + 3600)
    after = tg.seen_since_last_visit(A["id"], "CF", "NVDA", ["2026-10-08|b", "2026-10-07|a"],
                                     now=T0 + 3600 + tg.SEEN_MIN_INTERVAL + 1)
    assert after["new"] == [] and after["last_visit_at"] == T0 + 3600 and after["recorded"] is True


def test_rows_are_per_member_code_and_ticker_and_never_touch_move():
    tg.seen_since_last_visit(A["id"], "CN", "NVDA", ["2026-10-07|a"], now=T0)
    assert tg.seen_since_last_visit(B["id"], "CN", "NVDA", ["2026-10-07|a"], now=T0 + 10)["first_visit"] is True
    assert tg.seen_since_last_visit(A["id"], "CATS", "NVDA", ["2026-10-07|a"], now=T0 + 10)["first_visit"] is True
    assert tg.seen_since_last_visit(A["id"], "CN", "AMD", ["2026-10-07|a"], now=T0 + 10)["first_visit"] is True
    conn = tg._conn()
    try:
        syms = {r["sym"] for r in conn.execute("SELECT sym FROM terminal_visits WHERE user_id=?", (A["id"],))}
    finally:
        conn.close()
    assert syms == {"CN:NVDA", "CATS:NVDA", "CN:AMD"}   # a MOVE row would be the bare "NVDA"


def test_bounded_and_refusing():
    with pytest.raises(ValueError):
        tg.seen_since_last_visit(A["id"], "GP", "NVDA", [], now=T0)
    with pytest.raises(ValueError):
        tg.seen_since_last_visit(A["id"], "CN", "not a ticker", [], now=T0)
    keys = [f"2026-10-0{1 + i % 9}|k{i}" for i in range(tg.MAX_SEEN_STORED + 300)]
    for start in range(0, len(keys), tg.MAX_SEEN_KEYS_PER_CALL):
        tg._SEEN_SNAPSHOTS.clear()
        tg.seen_since_last_visit(A["id"], "CN", "NVDA", keys[start:start + tg.MAX_SEEN_KEYS_PER_CALL], now=T0 + start)
    conn = tg._conn()
    try:
        row = conn.execute("SELECT seen_json FROM terminal_visits WHERE user_id=? AND sym='CN:NVDA'", (A["id"],)).fetchone()
    finally:
        conn.close()
    import json
    assert len(json.loads(row["seen_json"])) == tg.MAX_SEEN_STORED
    # a key longer than the cap is ignored, never stored
    out = tg.seen_since_last_visit(A["id"], "CN", "MSFT", ["x" * (tg.MAX_SEEN_KEY_LEN + 1)], now=T0)
    assert out["first_visit"] is True


def test_route_answers_and_is_gated(client, monkeypatch):
    c, state = client
    r = c.post("/api/terminal/seen/cn", json={"sym": "nvda", "keys": ["2026-10-07|a"]})
    assert r.status_code == 200 and r.json()["first_visit"] is True and r.json()["code"] == "CN"
    assert c.post("/api/terminal/seen/GP", json={"sym": "NVDA", "keys": []}).status_code == 400
    assert c.post("/api/terminal/seen/CN", json={"sym": "NVDA", "keys": ["k"] * 201}).status_code == 422
    state["user"] = FREE
    assert c.post("/api/terminal/seen/CN", json={"sym": "NVDA", "keys": []}).status_code == 402
    monkeypatch.delenv("TERMINAL_GRAMMAR_ENABLED", raising=False)
    state["user"] = A
    assert c.post("/api/terminal/seen/CN", json={"sym": "NVDA", "keys": []}).status_code == 404
