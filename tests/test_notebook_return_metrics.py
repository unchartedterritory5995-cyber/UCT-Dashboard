"""Audit 2026-11-05, S20 -- the Notebook's return metrics, read from the telemetry rows.

Every row is written with an explicit UTC timestamp and the read is given an explicit `now`, so no test depends on
the hour it runs (lesson_a_test_that_reads_the_wall_clock_is_a_function_of_the_hour).
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

# Wednesday 2026-11-04 18:00 UTC = 13:00 ET.
NOW = datetime(2026, 11, 4, 18, 0, tzinfo=timezone.utc)


@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in ("a", "b", "c", "old"):
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, f"{uid}@x.test", "x", "member"))
    conn.commit()
    conn.close()
    # Re-review R4: the boot never builds the first-visit index; the post-boot one-shot does. Most rails read the
    # "index present" state, so it is built here; `bare_db` below is the state before it lands.
    from api.services.journal_two import notebook_return_metrics as m
    assert m.build_activity_index() is True
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def bare_db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _log(uid, event, at, details=None):
    from api.services import auth_db
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)",
        (uid, f"j2:{event}", json.dumps(details or {}), at),
    )
    conn.commit()
    conn.close()


def _compute(days=30):
    from api.services.journal_two import notebook_return_metrics as m
    return m.compute(days, now=NOW)


def test_day1_counts_the_next_et_day_not_the_next_utc_day(db):
    # a: first visit Mon 10/26 21:00 ET (= Tue 01:00 UTC), back Tue 10/27 10:00 ET -> returned on ET day 2.
    _log("a", "notebook_tab_visit", "2026-10-27 01:00:00")
    _log("a", "notebook_tab_visit", "2026-10-27 14:00:00")
    # b: first visit Mon 10/26 10:00 ET and again the same ET day only -> not returned.
    _log("b", "notebook_tab_visit", "2026-10-26 14:00:00")
    _log("b", "notebook_tab_visit", "2026-10-26 23:30:00")   # 19:30 ET, still Monday
    out = _compute()
    assert out["day1"] == {"returned": 1, "of": 2, "rate": 0.5}


def test_day1_leaves_out_a_member_whose_next_day_has_not_come(db):
    _log("c", "notebook_tab_visit", "2026-11-04 15:00:00")   # first visit today ET
    assert _compute()["day1"]["of"] == 0


def test_day7_needs_3_of_the_first_7_trading_days_and_a_whole_window(db):
    # a: first visit Mon 10/12; opens Tue 10/13 and Thu 10/15 -> 3 trading days of 7 (12,13,14,15,16,19,20).
    for at in ("2026-10-12 14:00:00", "2026-10-13 14:00:00", "2026-10-15 14:00:00"):
        _log("a", "notebook_tab_visit", at)
    # b: first visit Mon 10/12; only a Saturday visit after -> 1 trading day.
    for at in ("2026-10-12 14:00:00", "2026-10-17 14:00:00"):
        _log("b", "notebook_tab_visit", at)
    # c: first visit Mon 11/02 -> its 7 trading days are not over by Wed 11/04: not in the denominator.
    _log("c", "notebook_tab_visit", "2026-11-02 14:00:00")
    out = _compute()
    assert out["day7"] == {"returned": 1, "of": 2, "rate": 0.5}


def test_a_member_first_seen_before_the_window_is_not_new(db):
    _log("old", "notebook_tab_visit", "2026-08-01 14:00:00")
    _log("old", "notebook_tab_visit", "2026-10-20 14:00:00")
    out = _compute()
    assert out["newMembers"] == 0 and out["day1"]["of"] == 0
    assert out["activeMembers"] == 1


def test_aha_is_time_from_the_first_visit_to_the_first_live_widget(db):
    _log("a", "notebook_tab_visit", "2026-10-20 14:00:00")
    _log("a", "first_live_widget", "2026-10-20 14:01:00", {"source": "first_run", "names": 3})
    _log("a", "first_live_widget", "2026-10-21 14:00:00", {"source": "watchlist", "names": 3})  # a second browser
    _log("b", "notebook_tab_visit", "2026-10-20 14:00:00")
    aha = _compute()["aha"]
    assert aha["reached"] == 1 and aha["of"] == 2 and aha["rate"] == 0.5
    assert aha["medianS"] == 60.0


def test_morning_and_recap_rates_are_over_member_trading_days_with_an_open(db):
    _log("a", "notebook_tab_visit", "2026-10-28 13:00:00")   # Wed 09:00 ET -> morning
    _log("a", "notebook_tab_visit", "2026-10-29 15:00:00")   # Thu 11:00 ET
    _log("a", "notebook_tab_visit", "2026-10-31 13:00:00")   # Saturday: not a trading day
    _log("a", "recap_written", "2026-10-29 21:00:00", {"created": False})   # Thu 17:00 ET
    out = _compute()
    assert out["morning"] == {"days": 1, "of": 2, "rate": 0.5}
    assert out["recap"] == {"days": 1, "of": 2, "rate": 0.5}


def test_morning_cutoff_is_0930_et_exactly(db):
    _log("a", "notebook_tab_visit", "2026-10-28 13:29:00")   # 09:29 ET (EDT) -> morning
    _log("b", "notebook_tab_visit", "2026-10-28 13:30:00")   # 09:30 ET -> not
    assert _compute()["morning"] == {"days": 1, "of": 2, "rate": 0.5}


def test_trust_incidents_count_by_kind_and_never_read_other_details(db):
    _log("a", "notebook_tab_visit", "2026-10-28 14:00:00")
    _log("a", "trust_incident", "2026-10-28 14:05:00", {"kind": "publish_undone", "ms": 120000})
    _log("a", "trust_incident", "2026-10-28 14:06:00", {"kind": "widget_restored"})
    _log("a", "trust_incident", "2026-10-28 14:07:00", {"kind": "my private words"})
    t = _compute()["trust"]
    assert t["publishUndone"] == 1 and t["widgetRestored"] == 1 and t["total"] == 3
    assert t["per100Active"] == 300.0


def test_the_window_bounds_the_rates(db):
    _log("a", "notebook_tab_visit", "2026-10-20 14:00:00")   # 15 days before NOW: in 30, not in 7
    assert _compute(30)["activeMembers"] == 1
    assert _compute(7)["activeMembers"] == 0


def test_an_unknown_window_is_refused(db):
    from api.services.journal_two import notebook_return_metrics as m
    with pytest.raises(ValueError):
        m.compute(14, now=NOW)


def test_the_admin_door_is_admin_only_and_refuses_an_odd_window(db):
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    client = TestClient(fa)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "a", "role": "member"}
    assert client.get("/api/admin/notebook-return-metrics").status_code == 403
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "a", "role": "admin"}
    assert client.get("/api/admin/notebook-return-metrics?days=14").status_code == 400
    body = client.get("/api/admin/notebook-return-metrics?days=7").json()
    assert body["days"] == 7
    assert set(body) >= {"day1", "day7", "aha", "morning", "recap", "trust", "definitions", "capped"}


# ── Fix round 1 ─────────────────────────────────────────────────────────────────────────────

def test_minor10_day1_waits_until_the_next_et_day_is_over(db):
    _log("a", "notebook_tab_visit", "2026-11-03 15:00:00")   # first visit YESTERDAY ET; today (its "next day") runs on
    assert _compute()["day1"]["of"] == 0
    _log("b", "notebook_tab_visit", "2026-11-02 15:00:00")   # two days ago: its next day is over
    assert _compute()["day1"]["of"] == 1


def test_I5_the_first_visit_is_an_index_seek_never_a_scan_of_every_row_ever(db):
    from api.services import auth_db
    conn = auth_db.get_connection()
    plan = " ".join(str(tuple(r)) for r in conn.execute(
        "EXPLAIN QUERY PLAN SELECT MIN(created_at) FROM activity_log WHERE action = ? AND user_id = ?",
        ("j2:notebook_tab_visit", "a")).fetchall())
    assert "idx_activity_action_user_created" in plan, plan
    conn.close()


def test_I5_only_members_active_in_the_window_are_read_and_nothing_groups_the_whole_history(db):
    from api.services import auth_db
    from api.services.journal_two import notebook_return_metrics as m
    _log("old", "notebook_tab_visit", "2025-01-02 14:00:00")  # active only long before the window
    _log("a", "notebook_tab_visit", "2026-10-20 14:00:00")
    conn = auth_db.get_connection()
    seen = []
    conn.set_trace_callback(seen.append)
    out = m.compute(30, now=NOW, conn=conn)
    conn.close()
    assert out["newMembers"] == 1
    assert not any("GROUP BY" in s.upper() for s in seen), seen
    firsts = [s for s in seen if "MIN(created_at)" in s]
    assert firsts and all("'old'" not in s for s in firsts)       # the inactive member is never asked about
    assert all("created_at >=" in s for s in seen if "FROM activity_log WHERE action" in s and "MIN" not in s)


def test_I5_the_admin_read_is_cached_per_window():
    from api.services.journal_two import notebook_return_metrics as m
    calls = []
    real = m.compute
    m._CACHE.clear()
    try:
        m.compute = lambda days=30, **k: calls.append(days) or {"days": days}
        t = [0.0]
        assert m.compute_cached(30, clock=lambda: t[0]) == {"days": 30}
        t[0] = m.CACHE_S - 1
        m.compute_cached(30, clock=lambda: t[0])
        assert calls == [30]
        t[0] = m.CACHE_S + 1
        m.compute_cached(30, clock=lambda: t[0])
        assert calls == [30, 30]
    finally:
        m.compute = real
        m._CACHE.clear()


# ── Fix round 2 (re-review R4): the index is built after boot; until then the read reads nothing ───────────────

def test_R4_the_boot_schema_never_builds_the_first_visit_index(bare_db):
    from api.services import auth_db
    from api.services.journal_two import notebook_return_metrics as m
    conn = auth_db.get_connection()
    assert m.index_ready(conn) is False
    conn.close()


def test_R4_without_the_index_the_read_answers_warming_and_reads_no_activity_rows(bare_db):
    from api.services import auth_db
    from api.services.journal_two import notebook_return_metrics as m
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES ('a','a@x.test','x','member')")
    conn.execute("INSERT INTO activity_log (id, user_id, action, details, created_at)"
                 " VALUES ('r1','a','j2:notebook_tab_visit','{}','2026-10-20 14:00:00')")
    conn.commit()
    seen = []
    conn.set_trace_callback(seen.append)
    out = m.compute(30, now=NOW, conn=conn)
    conn.close()
    assert out["warming"] is True and out["message"] == m.WARMING_SENTENCE
    assert not any("FROM activity_log" in q for q in seen), seen
    assert "day1" not in out


def test_R4_a_warming_answer_is_never_cached(bare_db):
    from api.services.journal_two import notebook_return_metrics as m
    m._CACHE.clear()
    assert m.compute_cached(30, clock=lambda: 0.0)["warming"] is True
    assert 30 not in m._CACHE
    assert m.build_activity_index() is True
    assert "warming" not in m.compute_cached(30, clock=lambda: 1.0)       # ready at once, not 10 minutes later
    m._CACHE.clear()


def test_R4_the_build_is_isolated_and_retried_a_failure_logs_and_never_raises(bare_db):
    from api.services import auth_db
    from api.services.journal_two import notebook_return_metrics as m
    tries, naps = [], []

    def flaky():
        tries.append(1)
        if len(tries) < 3:
            raise RuntimeError("database is locked")
        return auth_db.get_connection()
    assert m.build_activity_index(connect=lambda: (_ for _ in ()).throw(RuntimeError("locked"))) is False
    assert m.run_activity_index_build(attempts=5, wait_s=7, sleep=naps.append, connect=flaky) is True
    assert len(tries) == 3 and naps == [7, 7]                              # retried, then stopped once built
    conn = auth_db.get_connection()
    assert m.index_ready(conn) is True
    conn.close()


def test_R4_the_admin_door_says_warming_until_the_index_exists(bare_db):
    from api.routers import client_errors as router_mod
    from api.services.journal_two import notebook_return_metrics as m
    m._CACHE.clear()
    fa = FastAPI()
    fa.include_router(router_mod.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "a", "role": "admin"}
    body = TestClient(fa).get("/api/admin/notebook-return-metrics?days=30").json()
    assert body["warming"] is True and body["message"] == "Metrics are warming up; try again in a few minutes."
    m._CACHE.clear()


def test_R4_main_schedules_the_build_after_the_auth_schema_never_inside_it():
    import pathlib
    main = pathlib.Path("api/main.py").read_text(encoding="utf-8")
    schema = pathlib.Path("api/services/auth_db.py").read_text(encoding="utf-8")
    assert "start_activity_index_build()" in main
    assert main.index("start_activity_index_build()") > main.index("_init_auth_db()")
    assert "CREATE INDEX IF NOT EXISTS idx_activity_action_user_created" not in schema
