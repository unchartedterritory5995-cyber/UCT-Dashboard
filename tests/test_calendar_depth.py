"""Lane R calendar depth: D-1/D-2 date-status lifecycle, D-3 rule-derived index
rebalances, and the dark routes + auth keys. No network: the store is a temp SQLite
file and the index rows are pure computation."""
from __future__ import annotations

import contextlib
import importlib
import inspect
import sqlite3
from datetime import date

import pytest


@pytest.fixture
def cdi(tmp_path, monkeypatch):
    monkeypatch.setenv("CALENDAR_DATES_DB_PATH", str(tmp_path / "d.db"))
    import api.services.calendar_date_integrity as m
    importlib.reload(m)
    yield m
    monkeypatch.delenv("CALENDAR_DATES_DB_PATH", raising=False)
    importlib.reload(m)


# ── D-1: the status an entry supports, from fields it carries ───────────────

class TestClassify:
    def test_each_state_comes_from_a_named_field(self, cdi):
        assert cdi.classify_entry({"eps_act": 1.2}, "amc")[0] == "reported"
        assert cdi.classify_entry({"date_est": True}, "tbd")[0] == "estimated"
        assert cdi.classify_entry({"date_est": True}, "bmo")[0] == "estimated"
        assert cdi.classify_entry({}, "bmo")[0] == "confirmed"
        assert cdi.classify_entry({"date_est": False}, "tbd")[0] == "confirmed"
        assert cdi.classify_entry({}, "tbd")[0] == "unstated"

    def test_every_state_names_its_basis_and_company_signaled_is_not_guessed(self, cdi):
        for e, b in (({"eps_act": 1}, "amc"), ({"date_est": True}, "tbd"), ({}, "amc"), ({}, "tbd")):
            assert cdi.classify_entry(e, b)[1]
        assert cdi.COMPANY_SIGNALED["state"] == "unavailable" and cdi.COMPANY_SIGNALED["reason"]


# ── D-1/D-2: the lifecycle in the store ─────────────────────────────────────

class TestLifecycle:
    def test_estimate_then_confirmation_stamps_both_moments(self, cdi):
        cdi.observe_many([("NVDA", "2026-11-19", "estimated", "b1")])
        cdi.observe_many([("NVDA", "2026-11-19", "confirmed", "b2")])
        row = cdi.get_status(["nvda"])["NVDA"]
        assert row["status"] == "confirmed" and row["basis"] == "b2"
        assert row["first_estimated_at"] and row["first_confirmed_at"]
        assert row["first_estimated_at"] <= row["first_confirmed_at"]
        assert row["moved"] is None

    def test_a_status_never_falls_for_the_same_date(self, cdi):
        cdi.observe_many([("NVDA", "2026-11-19", "confirmed", "session=amc")])
        cdi.observe_many([("NVDA", "2026-11-19", "estimated", "fmp")])
        row = cdi.get_status(["NVDA"])["NVDA"]
        assert row["status"] == "confirmed" and row["basis"] == "session=amc"
        # ...but the estimate is still recorded as SEEN, in the order it was seen
        assert row["first_estimated_at"]

    def test_first_confirmed_is_written_once(self, cdi):
        cdi.observe_many([("NVDA", "2026-11-19", "confirmed", "x")])
        first = cdi.get_status(["NVDA"])["NVDA"]["first_confirmed_at"]
        cdi.observe_many([("NVDA", "2026-11-19", "reported", "y")])
        row = cdi.get_status(["NVDA"])["NVDA"]
        assert row["first_confirmed_at"] == first and row["status"] == "reported"

    def test_a_move_restarts_the_lifecycle_and_names_what_moved(self, cdi):
        cdi.observe_many([("AAA", "2026-11-05", "confirmed", "session=bmo")])
        cdi.observe_many([("AAA", "2026-11-12", "estimated", "fmp")])
        row = cdi.get_status(["AAA"])["AAA"]
        assert row["moved"]["kind"] == "confirmed_date_changed"
        assert (row["moved"]["from"], row["moved"]["to"]) == ("2026-11-05", "2026-11-12")
        assert row["status"] == "estimated" and row["first_confirmed_at"] is None
        cdi.observe_many([("BBB", "2026-11-05", "estimated", "fmp")])
        cdi.observe_many([("BBB", "2026-11-06", "estimated", "fmp")])
        assert cdi.get_status(["BBB"])["BBB"]["moved"]["kind"] == "estimate_revised"

    def test_the_two_tuple_path_is_unchanged_and_status_never_touches_updated_at(self, cdi):
        cdi.observe_many([("PEP", "2026-07-16")])
        with contextlib.closing(sqlite3.connect(cdi._DB_PATH)) as c:
            before = c.execute("SELECT updated_at FROM calendar_date_history WHERE sym='PEP'").fetchone()[0]
        cdi.observe_many([("PEP", "2026-07-16", "confirmed", "x")])
        with contextlib.closing(sqlite3.connect(cdi._DB_PATH)) as c:
            after = c.execute("SELECT updated_at FROM calendar_date_history WHERE sym='PEP'").fetchone()[0]
        assert before == after
        assert cdi.get_moves(["PEP"]) == {}

    def test_an_unplaced_symbol_is_absent_never_defaulted(self, cdi):
        cdi.observe_many([("AAA", "2026-11-05", "estimated", "x")])
        assert set(cdi.get_status(["AAA", "ZZZ"])) == {"AAA"}

    def test_an_old_store_gains_the_columns_in_place(self, tmp_path, monkeypatch):
        p = tmp_path / "old.db"
        with contextlib.closing(sqlite3.connect(p)) as c:
            c.execute("CREATE TABLE calendar_date_history (sym TEXT PRIMARY KEY, report_date TEXT NOT NULL, "
                      "prev_date TEXT, first_seen TIMESTAMP, updated_at TIMESTAMP)")
            c.execute("INSERT INTO calendar_date_history VALUES ('OLD','2026-11-01','2026-10-28','t','t')")
            c.commit()
        monkeypatch.setenv("CALENDAR_DATES_DB_PATH", str(p))
        import api.services.calendar_date_integrity as m
        importlib.reload(m)
        try:
            row = m.get_status(["OLD"])["OLD"]
            assert row["status"] == "not_recorded"
            assert row["moved"]["kind"] == "status_not_recorded"
        finally:
            monkeypatch.delenv("CALENDAR_DATES_DB_PATH", raising=False)
            importlib.reload(m)


def test_the_calendar_build_records_status_without_changing_its_payload(cdi, monkeypatch):
    from api.routers import calendar as cal
    monkeypatch.setattr(cal, "_today_et", lambda: date(2026, 11, 2))
    days = {"2026-11-03": {"bmo": [{"sym": "AAA"}], "amc": [],
                           "tbd": [{"sym": "BBB", "date_est": True}, {"sym": "CCC"}]},
            "2026-10-30": {"bmo": [{"sym": "OLDP"}], "amc": [], "tbd": []}}
    import copy
    before = copy.deepcopy(days)
    cal._attach_date_moves(days)
    assert days == before
    got = cdi.get_status(["AAA", "BBB", "CCC", "OLDP"])
    assert {k: v["status"] for k, v in got.items()} == {"AAA": "confirmed", "BBB": "estimated", "CCC": "unstated"}


# ── D-3: rule-derived index rebalances ──────────────────────────────────────

class TestIndexEvents:
    def test_third_friday(self):
        from api.services import index_rebalance_calendar as ir
        assert ir.third_friday(2026, 3) == date(2026, 3, 20)
        assert ir.third_friday(2026, 12) == date(2026, 12, 18)
        assert ir.third_friday(2027, 1) == date(2027, 1, 15)

    def test_every_row_is_labelled_rule_derived_with_its_rule_and_citation(self):
        from api.services import index_rebalance_calendar as ir
        out = ir.events(date(2026, 1, 1), date(2026, 12, 31))
        assert [e["date"] for e in out["events"]] == ["2026-03-20", "2026-06-19", "2026-09-18", "2026-12-18"]
        for e in out["events"]:
            assert e["status"] == "rule_derived" and e["announced"] is False
            assert e["rule"] and "domain-events-intelligence.md" in e["citation"]
        assert {n["index"] for n in out["not_covered"]} == {"Russell US indexes", "Nasdaq-100"}

    def test_a_holiday_rule_date_is_flagged_not_moved(self, monkeypatch):
        from api.services import index_rebalance_calendar as ir
        from api.services import session_calendar as sc
        monkeypatch.setattr(sc, "covers", lambda d, *a: True)
        monkeypatch.setattr(sc, "holiday_name", lambda d, *a: "Good Friday" if d == date(2026, 3, 20) else None)
        e = ir.events(date(2026, 3, 1), date(2026, 3, 31))["events"][0]
        assert e["date"] == "2026-03-20" and e["calendar_check"] == "holiday" and "differ" in e["calendar_note"]

    def test_past_the_horizon_the_check_says_it_could_not_be_made(self, monkeypatch):
        from api.services import index_rebalance_calendar as ir
        from api.services import session_calendar as sc
        monkeypatch.setattr(sc, "covers", lambda d, *a: False)
        assert ir.events(date(2030, 3, 1), date(2030, 3, 31))["events"][0]["calendar_check"] == "unchecked"

    def test_window_limits(self):
        from api.services import index_rebalance_calendar as ir
        with pytest.raises(ValueError):
            ir.events(date(2026, 1, 1), date(2027, 6, 1))
        with pytest.raises(ValueError):
            ir.events(date(2026, 2, 1), date(2026, 1, 1))


# ── the dark routes and the auth keys ───────────────────────────────────────

class TestRoutes:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import calendar_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_both_routes_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("EARNINGS_DATE_STATUS_ENABLED", raising=False)
        monkeypatch.delenv("INDEX_REBALANCE_EVENTS_ENABLED", raising=False)
        assert c.get("/api/calendar/date-status?syms=AAPL").status_code == 404
        assert c.get("/api/calendar/index-events?start=2026-01-01&end=2026-12-31").status_code == 404

    def test_armed_date_status_serves_the_lifecycle(self, client, cdi, monkeypatch):
        _, c = client
        monkeypatch.setenv("EARNINGS_DATE_STATUS_ENABLED", "1")
        cdi.observe_many([("AAPL", "2026-10-29", "confirmed", "session=amc")])
        r = c.get("/api/calendar/date-status?syms=aapl,msft")
        assert r.status_code == 200
        j = r.json()
        assert j["symbols"]["AAPL"]["status"] == "confirmed" and j["unknown"] == ["MSFT"]
        assert "not the company" in j["timestamps_are"] and j["company_signaled"]["state"] == "unavailable"
        assert c.get("/api/calendar/date-status?syms=A$B").status_code == 400

    def test_an_unreadable_store_is_503_never_empty(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("EARNINGS_DATE_STATUS_ENABLED", "1")
        from api.services import calendar_date_integrity as m

        def boom(syms):
            raise sqlite3.OperationalError("database is locked")
        monkeypatch.setattr(m, "get_status", boom)
        r = c.get("/api/calendar/date-status?syms=AAPL")
        assert r.status_code == 503 and "could not be read" in r.json()["detail"]

    def test_armed_index_events(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("INDEX_REBALANCE_EVENTS_ENABLED", "1")
        r = c.get("/api/calendar/index-events?start=2026-12-01&end=2026-12-31")
        assert r.status_code == 200 and r.json()["events"][0]["date"] == "2026-12-18"
        assert c.get("/api/calendar/index-events?start=2026-12-01&end=2028-12-31").status_code == 400
        assert c.get("/api/calendar/index-events?start=2026-13-01&end=2026-12-31").status_code == 400

    def test_handlers_are_sync_and_keys_ride_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.date_status_route)
        assert not inspect.iscoroutinefunction(route.index_events_route)
        for env in ("EARNINGS_DATE_STATUS_ENABLED", "INDEX_REBALANCE_EVENTS_ENABLED",
                    "CALENDAR_ORDER_EXPLAIN_ENABLED"):
            monkeypatch.delenv(env, raising=False)
        assert auth._calendar_depth_flags() == {}
        monkeypatch.setenv("CALENDAR_ORDER_EXPLAIN_ENABLED", "1")
        assert auth._calendar_depth_flags() == {"calendar_order_explain_enabled": True}
        monkeypatch.setenv("EARNINGS_DATE_STATUS_ENABLED", "1")
        monkeypatch.setenv("INDEX_REBALANCE_EVENTS_ENABLED", "1")
        assert set(auth._calendar_depth_flags()) == {"earnings_date_status_enabled",
                                                     "index_rebalance_events_enabled",
                                                     "calendar_order_explain_enabled"}
