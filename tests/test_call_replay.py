"""D-5 call replay: alignment only through real timestamps, honest tape states,
caching, and the dark route. Recorded-shape fixtures (earningscall level-3 and
Massive aggregate rows); no network -- both vendor readers are patched."""
from __future__ import annotations

import importlib
import inspect
from datetime import datetime, timezone

import pytest

from api.services import call_replay as cr


class _Cache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = (v)


TIMED = {"symbol": "AAPL", "year": 2026, "quarter": 3, "company_name": "Apple Inc.",
         "segments": [
             {"speaker": 1, "name": "Tim Cook", "title": "CEO", "words": ["Good", "afternoon"], "starts": [0.0, 0.4]},
             {"speaker": 2, "name": "", "title": "", "words": ["Thanks", "Tim"], "starts": [600.0, 600.5]},
         ]}
# 2026-07-30 17:00 ET (EDT, -04:00) = 21:00 UTC
START = "2026-07-30T17:00:00.000-04:00"
T0 = int(datetime(2026, 7, 30, 21, 0, tzinfo=timezone.utc).timestamp())


def _agg(ts, c):
    return {"t": ts * 1000, "o": c, "h": c, "l": c, "c": c, "v": 100}


AGGS = [_agg(T0 - 3600, 200.0), _agg(T0 - 60, 210.0), _agg(T0 + 60, 212.0), _agg(T0 + 600, 215.0),
        _agg(T0 + 86400, 220.0)]


@pytest.fixture
def env(monkeypatch):
    from api.services import earningscall_timed as ec
    from api.services import massive
    cache = _Cache()
    monkeypatch.setattr(cr, "_cache", lambda: cache)
    state = {"timed": TIMED, "event": {"exchange": "NASDAQ", "year": 2026, "quarter": 3, "conference_date": START},
             "aggs": AGGS, "agg_calls": 0}
    monkeypatch.setattr(ec, "get_timed_transcript", lambda s, year=None, quarter=None: state["timed"])
    monkeypatch.setattr(ec, "event_meta", lambda s, y=None, q=None: state["event"])

    def aggs(sym, mult, f, t):
        state["agg_calls"] += 1
        assert mult == 1
        return state["aggs"]
    monkeypatch.setattr(massive, "get_agg_bars_minute", aggs)
    return state


NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)


class TestAlignment:
    def test_turns_are_placed_at_the_listed_start_plus_their_offset(self, env):
        out = cr.replay("aapl", now=NOW)
        assert out["state"] == "aligned"
        assert [t["at"] for t in out["turns"]] == [T0, T0 + 600]
        assert out["alignment"]["basis"] == "listed_start"
        assert "shifts every turn by the same amount" in out["alignment"]["note"]

    def test_the_tape_is_cut_to_the_call_window(self, env):
        out = cr.replay("AAPL", now=NOW)
        # window = start-15m .. start+600.5s+30m: the -60m and +1d bars are outside
        assert [b["c"] for b in out["bars"]] == [210.0, 212.0, 215.0]
        assert out["tape_state"] == "ok"

    @pytest.mark.parametrize("bad", [None, "2026-07-30", "2026-07-30T17:00:00", "garbage"])
    def test_no_usable_start_is_unaligned_with_no_tape(self, env, bad):
        env["event"] = {**env["event"], "conference_date": bad}
        out = cr.replay("AAPL", now=NOW)
        assert out["state"] == "unaligned"
        assert out["bars"] == [] and out["tape_state"] == "not_read"
        assert all("at" not in t for t in out["turns"])
        assert "cannot be placed on the tape" in out["reason"]
        assert env["agg_calls"] == 0

    def test_no_event_is_unaligned(self, env):
        env["event"] = None
        assert cr.replay("AAPL", now=NOW)["state"] == "unaligned"

    def test_no_timed_transcript_says_so_and_reads_nothing(self, env):
        env["timed"] = None
        out = cr.replay("AAPL", now=NOW)
        assert out["state"] == "no_timed_transcript" and out["turns"] == []
        assert env["agg_calls"] == 0


class TestTape:
    def test_an_empty_tape_is_its_own_state(self, env):
        env["aggs"] = []
        out = cr.replay("AAPL", now=NOW)
        assert out["state"] == "aligned" and out["tape_state"] == "empty" and out["bars"] == []

    def test_a_closed_window_is_read_once(self, env):
        cr.replay("AAPL", now=NOW)
        cr.replay("AAPL", now=NOW)
        assert env["agg_calls"] == 1

    def test_unnamed_speaker_is_named_by_label(self, env):
        assert cr.replay("AAPL", now=NOW)["turns"][1]["speaker"] == "Speaker 2"


class TestEventMeta:
    def test_reads_the_event_list_and_caches_it(self, monkeypatch):
        monkeypatch.setenv("EARNINGS_TIMED_TRANSCRIPT", "1")
        import api.services.earningscall_timed as ec
        importlib.reload(ec)
        cache = _Cache()
        monkeypatch.setattr(ec, "_cache", lambda: cache)
        events = {"events": [{"year": 2026, "quarter": 3, "is_published": True, "conference_date": START},
                             {"year": 2026, "quarter": 2, "is_published": True, "conference_date": "x"}]}
        calls = []
        monkeypatch.setattr(ec, "_get", lambda p, params, raw=False: calls.append(p) or events)
        assert ec.event_meta("AAPL", 2026, 3)["conference_date"] == START
        assert ec.event_meta("AAPL", 2026, 3)["conference_date"] == START
        assert ec.event_meta("AAPL")["quarter"] == 3
        # one exchange probe + one events read for (2026,3), then one for latest
        assert calls.count("/events") == 3


@pytest.fixture
def client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import research_calls_depth as route
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
    return route, TestClient(app)


class TestRoute:
    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        monkeypatch.delenv(cr.ENABLED_ENV, raising=False)
        _, c = client
        assert c.get("/api/research/call-replay/AAPL").status_code == 404

    def test_armed_serves_and_validates(self, client, env, monkeypatch):
        monkeypatch.setenv(cr.ENABLED_ENV, "1")
        _, c = client
        assert c.get("/api/research/call-replay/AAPL").json()["state"] == "aligned"
        assert c.get("/api/research/call-replay/AAPL?year=2026").status_code == 400
        assert c.get("/api/research/call-replay/$$$").status_code == 400

    def test_handler_is_a_plain_def(self, client):
        route, _ = client
        assert not inspect.iscoroutinefunction(route.call_replay_route)

    def test_auth_flag_present_only_when_on(self, monkeypatch):
        from api.routers import auth
        monkeypatch.delenv(cr.ENABLED_ENV, raising=False)
        assert "call_replay_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv(cr.ENABLED_ENV, "1")
        assert auth._research_depth_flags().get("call_replay_enabled") is True
