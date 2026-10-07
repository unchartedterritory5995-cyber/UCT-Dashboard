"""FT-080 room attention: the per-day series over a temp buzz store, the
null-not-zero rules, the polarity refusal, and the dark route. No network."""
from __future__ import annotations

import inspect
from datetime import datetime, timezone

import pytest

from api.services import mention_series as ms


def _ts(y, m, d, h=15):
    return int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp())


@pytest.fixture
def buzz(tmp_path, monkeypatch):
    from api.services import buzz_store
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    mid = iter(range(1, 10_000))
    rows = []
    # store starts 2026-09-21 (Mon). AAPL: 3 mentions by 2 people on 09-22; room 10 that day.
    for k in range(3):
        rows.append((str(next(mid)), "c", f"u{k % 2}", "AAPL", _ts(2026, 9, 22) + k, "cashtag"))
    for k in range(7):
        rows.append((str(next(mid)), "c", "x", "NVDA", _ts(2026, 9, 22) + k, "cashtag"))
    rows.append((str(next(mid)), "c", "x", "NVDA", _ts(2026, 9, 21), "cashtag"))      # room active, AAPL 0
    # 09-23: nothing at all (room silent)
    rows.append((str(next(mid)), "c", "u0", "AAPL", _ts(2026, 9, 24, 3), "cashtag"))  # 23:00 ET on 09-23!
    rows.append((str(next(mid)), "c", "x", "TSLA", _ts(2026, 9, 25), "cashtag"))
    buzz_store.record_mentions(rows)
    yield buzz_store
    buzz_store._reset_for_tests()


def _by_date(out):
    return {p["date"]: p for p in out["points"]}


class TestSeries:
    def test_counts_people_and_share_per_et_day(self, buzz):
        out = ms.series("aapl", days=7, now=datetime(2026, 9, 25, 20, tzinfo=timezone.utc))
        p = _by_date(out)["2026-09-22"]
        assert (p["mentions"], p["people"], p["room_mentions"], p["share_pct"]) == (3, 2, 10, 30.0)
        assert out["window"]["store_from"] == "2026-09-21" and out["window"]["timezone"] == "America/New_York"

    def test_a_late_evening_utc_timestamp_lands_on_its_et_day(self, buzz):
        out = ms.series("AAPL", days=7, now=datetime(2026, 9, 25, 20, tzinfo=timezone.utc))
        assert _by_date(out)["2026-09-23"]["mentions"] == 1

    def test_an_active_room_with_no_mention_is_a_real_zero(self, buzz):
        out = ms.series("AAPL", days=7, now=datetime(2026, 9, 25, 20, tzinfo=timezone.utc))
        assert _by_date(out)["2026-09-21"] == {"date": "2026-09-21", "state": "ok", "mentions": 0, "people": 0,
                                               "room_mentions": 1, "share_pct": 0.0}

    def test_before_the_store_and_a_silent_room_are_null_not_zero(self, buzz):
        out = ms.series("AAPL", days=7, now=datetime(2026, 9, 27, 20, tzinfo=timezone.utc))
        by = _by_date(out)
        assert by["2026-09-21"]["state"] == "ok"
        assert by["2026-09-26"]["state"] == "room_silent" and by["2026-09-26"]["mentions"] is None
        early = ms.series("AAPL", days=14, now=datetime(2026, 9, 25, 20, tzinfo=timezone.utc))
        assert _by_date(early)["2026-09-15"]["state"] == "before_store"
        assert _by_date(early)["2026-09-15"]["mentions"] is None

    def test_polarity_is_refused_with_the_reason(self, buzz):
        out = ms.series("AAPL", now=datetime(2026, 9, 25, 20, tzinfo=timezone.utc))
        assert out["polarity"] == {"state": "unavailable", "reason": ms.POLARITY_REASON}

    def test_no_store_is_a_state(self, tmp_path, monkeypatch):
        from api.services import buzz_store
        monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "absent" / "buzz.db"))
        buzz_store._reset_for_tests()
        assert ms.series("AAPL")["state"] == "no_store"
        buzz_store._reset_for_tests()


class TestRoomCache:
    """S9 (2026-10-05): the room's finished days are read once per TTL; today stays live."""
    NOW = datetime(2026, 9, 25, 20, tzinfo=timezone.utc)

    def test_a_second_request_reuses_the_finished_days_and_still_sees_today(self, buzz, monkeypatch):
        ms._ROOM_CACHE.clear()
        calls = []
        real = ms._count_by_et_day
        monkeypatch.setattr(ms, "_count_by_et_day", lambda c, lo, hi: calls.append((lo, hi)) or real(c, lo, hi))
        ms.series("AAPL", days=7, now=self.NOW)
        assert len(calls) == 2                     # finished days + today
        calls.clear()
        buzz.record_mentions([("9001", "c", "x", "AMD", _ts(2026, 9, 25, 18), "cashtag")])
        out = ms.series("NVDA", days=7, now=self.NOW)
        assert len(calls) == 1                     # only today was read again
        assert _by_date(out)["2026-09-25"]["room_mentions"] == 2
        assert _by_date(out)["2026-09-22"]["room_mentions"] == 10

    def test_a_backfilled_past_day_appears_once_the_ttl_lapses(self, buzz, monkeypatch):
        ms._ROOM_CACHE.clear()
        ms.series("AAPL", days=7, now=self.NOW)
        buzz.record_mentions([("9002", "c", "x", "AMD", _ts(2026, 9, 22, 16), "cashtag")])
        assert _by_date(ms.series("AAPL", days=7, now=self.NOW))["2026-09-22"]["room_mentions"] == 10
        clock = ms.time.monotonic() + ms._ROOM_TTL_S + 1
        monkeypatch.setattr(ms.time, "monotonic", lambda: clock)
        assert _by_date(ms.series("AAPL", days=7, now=self.NOW))["2026-09-22"]["room_mentions"] == 11


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
        monkeypatch.delenv("MENTION_SERIES_ENABLED", raising=False)
        assert c.get("/api/research/mention-series/AAPL").status_code == 404

    def test_armed_serves_the_series_and_bounds_days(self, client, buzz, monkeypatch):
        _, c = client
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        assert c.get("/api/research/mention-series/aapl").status_code == 200
        assert c.get("/api/research/mention-series/aapl", params={"days": 3}).status_code == 422

    def test_the_handler_is_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.mention_series_route)
        monkeypatch.delenv("MENTION_SERIES_ENABLED", raising=False)
        assert "mention_series_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        assert auth._research_depth_flags()["mention_series_enabled"] is True
