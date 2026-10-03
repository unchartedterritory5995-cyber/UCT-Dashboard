"""FT-027 standing alerts on a filter-list screen, and the AC-11 save fork.

The snapshotter is injected so each night's membership is stated in the test;
one test runs the REAL default snapshotter over a fixture screener.db so the
evaluator is proved to be the screen's own."""
from __future__ import annotations

import pytest

from api.services.screener import snapshot_db as db
from api.services.screener import spec_alerts as SA

SPEC = {"filters": [{"key": "price", "op": "gte", "min": 10}]}


@pytest.fixture
def armed(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(SA.FLAG, "1")
    SA._done.clear()
    db.init_db()
    return tmp_path


class Nights:
    """A scripted snapshotter: each call returns the next night's membership."""

    def __init__(self, *nights):
        self.nights = list(nights)
        self.i = 0

    def __call__(self, spec, user_id):
        as_of, syms, total = self.nights[min(self.i, len(self.nights) - 1)]
        return list(syms), total if total is not None else len(syms), as_of


def _sub(mode="both", user="u1"):
    return SA.subscribe({"id": user}, "Breakouts", SPEC, mode, validate=lambda s: None)


def _run(nights, sent, **kw):
    def deliver(**k):
        sent.append(k)
    return SA.run_nightly(deliver=deliver, snapshotter=nights, routing=lambda u: None, **kw)


def test_first_snapshot_says_nothing_then_the_diff_fires(armed):
    _sub()
    sent = []
    n = Nights(("2026-10-01", ["AAA", "BBB"], None), ("2026-10-02", ["BBB", "CCC"], None))
    r1 = _run(n, sent)
    assert r1["no_previous"] == 1 and sent == []
    n.i = 1
    r2 = _run(n, sent)
    assert r2["sent"] == 1
    assert sent[0]["extra_data"]["entered"] == ["CCC"]
    assert sent[0]["extra_data"]["exited"] == ["AAA"]
    assert sent[0]["source"] == "spec_screen_alert"
    assert "Overnight" in sent[0]["message"]


def test_same_session_twice_never_alerts_twice(armed):
    _sub()
    sent = []
    n = Nights(("2026-10-01", ["AAA"], None), ("2026-10-02", ["BBB"], None))
    _run(n, sent)
    n.i = 1
    _run(n, sent)
    r = _run(n, sent)                  # a retry against the same 03:00 build
    assert r["same_session"] == 1 and len(sent) == 1


def test_a_truncated_set_is_never_diffed(armed):
    _sub()
    sent = []
    many = [f"T{i:04d}" for i in range(SA.MAX_MEMBERS + 1)]
    n = Nights(("2026-10-01", ["AAA"], None), ("2026-10-02", many, None))
    _run(n, sent)
    n.i = 1
    r = _run(n, sent)
    assert r["too_wide"] == 1 and sent == []


def test_mode_entry_ignores_exits_and_quiet_is_silence(armed):
    _sub(mode="entry")
    sent = []
    n = Nights(("2026-10-01", ["AAA", "BBB"], None), ("2026-10-02", ["AAA"], None))
    _run(n, sent)
    n.i = 1
    r = _run(n, sent)
    assert r["quiet"] == 1 and sent == []


def test_suspended_routing_records_the_fire_and_sends_nothing(armed):
    _sub()
    sent = []

    class Rule:
        suspended = True

    n = Nights(("2026-10-01", ["AAA"], None), ("2026-10-02", ["BBB"], None))
    SA.run_nightly(deliver=lambda **k: sent.append(k), snapshotter=n, routing=lambda u: Rule())
    n.i = 1
    r = SA.run_nightly(deliver=lambda **k: sent.append(k), snapshotter=n, routing=lambda u: Rule())
    assert r["suspended_routing"] == 1 and sent == []
    with db.connect() as conn:
        assert conn.execute("SELECT routing FROM spec_alerts_fired").fetchone()[0] == "suspended"


def test_unsubscribe_suspends_and_never_deletes(armed):
    s = _sub()
    assert SA.set_suspended("u1", s["id"], True)
    assert not SA.set_suspended("u2", s["id"], True)          # not theirs
    rows = SA.list_subs("u1")
    assert len(rows) == 1 and rows[0]["suspended"] is True
    sent = []
    r = _run(Nights(("2026-10-01", ["AAA"], None)), sent)
    assert r["subscriptions"] == 0


def test_one_bad_subscription_never_stops_the_run(armed):
    _sub(user="u1")
    _sub(user="u2")
    calls = []

    def snap(spec, user_id):
        calls.append(user_id)
        if user_id == "u1":
            raise ValueError("boom")
        return ["AAA"], 1, "2026-10-01"

    r = SA.run_nightly(deliver=lambda **k: None, snapshotter=snap, routing=lambda u: None)
    assert r["errors"] == 1 and r["snapshots"] == 1 and calls == ["u1", "u2"]


def test_subscribe_refuses_an_empty_screen_and_caps_per_member(armed):
    with pytest.raises(ValueError, match="at least one criterion"):
        SA.subscribe({"id": "u1"}, "x", {"filters": []}, validate=lambda s: None)
    for _ in range(SA.MAX_SUBS_PER_USER):
        _sub()
    with pytest.raises(ValueError, match="standing screen alerts"):
        _sub()


def test_dark_run_does_nothing(armed, monkeypatch):
    monkeypatch.delenv(SA.FLAG)
    r = SA.run_nightly(deliver=lambda **k: 1 / 0, snapshotter=lambda *a: 1 / 0,
                       routing=lambda u: None)
    assert r["enabled"] is False and r["subscriptions"] == 0


def test_the_default_snapshotter_is_the_screens_own_evaluator(armed):
    db.upsert_rows([
        {"ticker": "AAA", "price": 50.0, "snapshot_date": "2026-10-01"},
        {"ticker": "BBB", "price": 5.0, "snapshot_date": "2026-10-01"},
        {"ticker": "CCC", "price": 15.0, "snapshot_date": "2026-10-01"}])
    s = _sub()
    out = SA.take_snapshot(s["id"], "u1", SPEC)
    assert out == {"as_of": "2026-10-01", "new": True, "truncated": False}
    with db.connect() as conn:
        assert conn.execute("SELECT symbols FROM spec_alert_snapshots").fetchone()[0] == '["AAA", "CCC"]'


# ── the routes ──────────────────────────────────────────────────────────────

def _client(monkeypatch, *flags):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import screen_promote as rp
    for f in (SA.FLAG, rp.SAVE_FORK_FLAG, rp.FLAG):
        monkeypatch.delenv(f, raising=False)
    for f in flags:
        monkeypatch.setenv(f, "1")
    monkeypatch.setattr(rp, "is_paid_user", lambda u: True)
    app = FastAPI()
    app.include_router(rp.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "plan": "pro"}
    return TestClient(app)


def test_routes_are_dark_by_default(armed, monkeypatch):
    c = _client(monkeypatch)
    assert c.get("/api/screener/spec-alerts").status_code == 404
    assert c.get("/api/screener/save-fork").status_code == 404
    assert c.post("/api/screener/save-fork", json={"spec": SPEC, "choice": "definition"}).status_code == 404


def test_save_fork_never_defaults(armed, monkeypatch):
    from api.routers import screen_promote as rp
    c = _client(monkeypatch, rp.SAVE_FORK_FLAG)
    offer = c.get("/api/screener/save-fork").json()["choices"]
    assert [o["id"] for o in offer] == ["frozen_list", "definition", "standing_alert"]
    assert offer[1]["available"] is True
    assert offer[0]["available"] is False and "reason" in offer[0]
    r = c.post("/api/screener/save-fork", json={"spec": SPEC, "name": "x"})
    assert r.status_code == 400 and "Choose" in r.json()["detail"]
    r = c.post("/api/screener/save-fork", json={"spec": SPEC, "choice": "standing_alert"})
    assert r.status_code == 409 and "not switched on" in r.json()["detail"]


def test_save_fork_standing_alert_saves_both(armed, tmp_path, monkeypatch):
    from api.routers import screen_promote as rp
    from api.services.screener import saved_screens
    created = {}
    monkeypatch.setattr(saved_screens, "init", lambda: None)
    monkeypatch.setattr(saved_screens, "create",
                        lambda uid, name, spec, pub: created.setdefault("rec", {"id": 7, "name": name}))
    monkeypatch.setattr(SA, "subscribe", lambda user, name, spec, mode, sid: {"id": 1, "saved_screen_id": sid})
    c = _client(monkeypatch, rp.SAVE_FORK_FLAG, SA.FLAG)
    r = c.post("/api/screener/save-fork", json={"spec": SPEC, "choice": "standing_alert", "name": "B"})
    assert r.status_code == 200, r.text
    assert r.json()["alert"]["saved_screen_id"] == 7 and created["rec"]["name"] == "B"
