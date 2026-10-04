"""FT-064 EVTS: events staged against the nearest print, per-source honesty,
the room-spike rule over a temp buzz store, and the dark route. No network."""
from __future__ import annotations

import inspect
from datetime import date, datetime, timezone

import pytest

from api.services import events_timeline as ev


class TestOffset:
    def test_weekdays_either_side(self):
        tue = date(2026, 4, 28)
        assert ev.weekday_offset(tue, tue) == 0
        assert ev.weekday_offset(date(2026, 4, 27), tue) == -1      # Mon
        assert ev.weekday_offset(date(2026, 4, 24), tue) == -2      # Fri
        assert ev.weekday_offset(date(2026, 4, 25), tue) == -2      # Sat shares Friday's slot
        assert ev.weekday_offset(date(2026, 5, 1), tue) == 3        # Fri after
        assert ev.weekday_offset(date(2026, 5, 2), tue) == 3        # Sat after shares Friday's slot
        assert ev.weekday_offset(date(2026, 5, 4), tue) == 4        # Mon after


def _payload():
    return {"quarters": [
        {"label": "Q2", "report_date": "2026-04-28", "reported": True, "eps_actual": 1.1, "eps_estimate": 1.0},
        {"label": "Q1", "report_date": "2026-01-27", "reported": True, "eps_actual": 0.9, "eps_estimate": 1.0},
    ], "summary": {"next_report_date": "2026-07-28", "next_report_label": "Q3"}}


@pytest.fixture
def wired(monkeypatch):
    from api.services import earnings_reaction_panel as erp
    monkeypatch.setattr(erp, "_cached_earnings", lambda s: _payload())
    monkeypatch.setitem(ev.SOURCES, "uct_catalyst", lambda s: [
        {"date": "2026-04-24", "kind": "uct_catalyst", "title": "UCT catalyst engine: Earnings", "detail": None,
         "source": "UCT catalyst engine (catalysts.db)"}])
    monkeypatch.setitem(ev.SOURCES, "filing", lambda s: [])
    monkeypatch.setitem(ev.SOURCES, "room_spike", lambda s: [
        {"date": "2026-07-30", "kind": "room_spike", "title": "Room mentions spiked: 9", "detail": None,
         "source": "#main-chat mention store (buzz.db)"}])


class TestTimeline:
    def test_every_event_is_staged_against_its_nearest_print(self, wired):
        out = ev.timeline("aapl")
        assert out["state"] == "ok" and out["ticker"] == "AAPL"
        by = {(e["date"], e["kind"]): e for e in out["events"]}
        cat = by[("2026-04-24", "uct_catalyst")]
        assert (cat["print_date"], cat["stage"], cat["print_label"]) == ("2026-04-28", "T-2", "Q2")
        spike = by[("2026-07-30", "room_spike")]
        assert (spike["print_date"], spike["stage"], spike["print_state"]) == ("2026-07-28", "T+2", "scheduled")
        assert by[("2026-04-28", "earnings")]["stage"] == "T"
        assert all(e["source"] for e in out["events"])
        assert out["offset_unit"].startswith("weekdays") and "holidays are not removed" in out["offset_unit"]

    def test_an_empty_source_and_a_failed_source_are_different_facts(self, wired, monkeypatch):
        def boom(s):
            raise sqlite_error()
        monkeypatch.setitem(ev.SOURCES, "uct_catalyst", boom)
        out = ev.timeline("AAPL")
        assert out["sources"]["filing"] == {"state": "empty", "events": 0}
        assert out["sources"]["uct_catalyst"]["state"] == "error"
        assert out["sources"]["room_spike"]["state"] == "ok"

    def test_with_no_print_events_are_returned_unstaged_with_the_reason(self, wired, monkeypatch):
        from api.services import earnings_reaction_panel as erp
        monkeypatch.setattr(erp, "_cached_earnings", lambda s: None)
        out = ev.timeline("AAPL")
        assert out["state"] == "unstaged" and "being read" in out["reason"]
        assert out["events"] and all("stage" not in e for e in out["events"])
        assert out["sources"]["earnings"]["state"] == "pending"


def sqlite_error():
    import sqlite3
    return sqlite3.OperationalError("database is locked")


class TestRoomSpikes:
    def test_a_spike_needs_the_multiple_and_the_floor(self, tmp_path, monkeypatch):
        from api.services import buzz_store
        monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
        buzz_store._reset_for_tests()
        buzz_store.init_db()
        try:
            rows, mid = [], 0
            # 30 weekdays of 1 mention, then a day with 9 and a day with 4
            day = date(2026, 3, 2)
            days = []
            while len(days) < 32:
                if day.weekday() < 5:
                    days.append(day)
                day = date.fromordinal(day.toordinal() + 1)
            for i, d in enumerate(days):
                n = 9 if i == 30 else (4 if i == 31 else 1)
                ts = int(datetime(d.year, d.month, d.day, 15, tzinfo=timezone.utc).timestamp())
                for k in range(n):
                    mid += 1
                    rows.append((str(mid), "c1", f"a{k}", "AAPL", ts + k, "cashtag"))
            buzz_store.record_mentions(rows)
            out = ev._room_spike_events("AAPL", now=datetime(2026, 4, 20, tzinfo=timezone.utc))
            assert [e["date"] for e in out] == [days[30].isoformat()]      # 4 < SPIKE_MIN
            assert "9" in out[0]["title"] and "median 1" in out[0]["title"]
        finally:
            buzz_store._reset_for_tests()


class TestRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("EVENTS_TIMELINE_ENABLED", raising=False)
        assert c.get("/api/research/events/AAPL").status_code == 404

    def test_armed_serves_the_timeline(self, client, wired, monkeypatch):
        _, c = client
        monkeypatch.setenv("EVENTS_TIMELINE_ENABLED", "1")
        r = c.get("/api/research/events/aapl")
        assert r.status_code == 200 and r.json()["ticker"] == "AAPL" and r.json()["events"]

    def test_the_handler_is_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.events_route)
        monkeypatch.delenv("EVENTS_TIMELINE_ENABLED", raising=False)
        assert "events_timeline_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("EVENTS_TIMELINE_ENABLED", "1")
        assert auth._research_depth_flags()["events_timeline_enabled"] is True
