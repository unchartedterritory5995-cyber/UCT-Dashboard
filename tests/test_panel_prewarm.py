"""The Company Panel prewarm: bounded, resumable, and never a second code path.

Measured on production 8 Sep 2026 (/api/earnings-intel, end to end):
    AMKR cold 4.46s -> warm 0.12s | VSAT 4.72 -> 0.15 | CALX 7.47 -> 0.13
Only the FIRST view of a symbol is slow, which is what this removes.
"""
import json

import pytest

from api.services import panel_prewarm as pp


@pytest.fixture()
def state(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    monkeypatch.setattr(pp, "STATE_PATH", str(path))
    return path


def _spy(calls, fail=()):
    def make(name):
        def fn(sym):
            calls.append((name, sym))
            if name in fail:
                raise RuntimeError(f"{name} down")
            return {"sym": sym}
        return fn
    return [(n, make(n)) for n in ("fundamentals", "statements", "earnings_table",
                                   "earnings_intel", "ownership")]


class TestWarmSymbol:
    def test_touches_every_panel_surface(self):
        calls = []
        r = pp.warm_symbol("MU", surfaces=_spy(calls))
        assert [n for n, _ in calls] == ["fundamentals", "statements",
                                         "earnings_table", "earnings_intel",
                                         "ownership"]
        assert r["ok"] == 5 and r["failed"] == 0

    def test_one_dead_provider_does_not_cost_the_others(self):
        calls = []
        r = pp.warm_symbol("MU", surfaces=_spy(calls, fail={"ownership"}))
        assert r["ok"] == 4 and r["failed"] == 1
        assert "ownership" in r["errors"]

    def test_never_raises(self):
        def boom(sym):
            raise RuntimeError("x")
        r = pp.warm_symbol("MU", surfaces=[("a", boom)])
        assert r["failed"] == 1

    def test_ignores_an_empty_symbol(self):
        calls = []
        assert pp.warm_symbol("", surfaces=_spy(calls))["ok"] == 0
        assert calls == []


class TestRotation:
    def test_a_pass_is_bounded(self, state, monkeypatch):
        calls = []
        monkeypatch.setattr(pp, "_universe", lambda: [f"S{i:03d}" for i in range(100)])
        monkeypatch.setattr(pp, "_surfaces", lambda: _spy(calls))
        res = pp.run_prewarm(limit=5)
        assert res["symbols"] == 5
        assert len({s for _, s in calls}) == 5

    def test_the_next_pass_continues_where_the_last_stopped(self, state, monkeypatch):
        calls = []
        monkeypatch.setattr(pp, "_universe", lambda: [f"S{i:03d}" for i in range(10)])
        monkeypatch.setattr(pp, "_surfaces", lambda: _spy(calls))
        pp.run_prewarm(limit=4)
        first = {s for _, s in calls}
        calls.clear()
        pp.run_prewarm(limit=4)
        second = {s for _, s in calls}
        assert not (first & second), "a cycle must not re-warm what it just warmed"

    def test_the_cursor_WRAPS_so_the_sweep_keeps_going(self, state, monkeypatch):
        """Fundamentals expire on their own TTL, so this is a treadmill that
        keeps the universe warm, not a backfill that finishes."""
        calls = []
        monkeypatch.setattr(pp, "_universe", lambda: ["A", "B", "C"])
        monkeypatch.setattr(pp, "_surfaces", lambda: _spy(calls))
        pp.run_prewarm(limit=2)          # A B
        calls.clear()
        res = pp.run_prewarm(limit=2)    # C A
        assert res["wrapped"] is True
        assert {s for _, s in calls} == {"C", "A"}

    def test_the_cursor_survives_a_restart(self, state, monkeypatch):
        monkeypatch.setattr(pp, "_universe", lambda: [f"S{i:03d}" for i in range(10)])
        monkeypatch.setattr(pp, "_surfaces", lambda: _spy([]))
        pp.run_prewarm(limit=3)
        assert json.loads(state.read_text())["cursor"] == 3

    def test_a_corrupt_cursor_restarts_rather_than_crashing(self, state, monkeypatch):
        state.write_text("not json")
        calls = []
        monkeypatch.setattr(pp, "_universe", lambda: ["A", "B"])
        monkeypatch.setattr(pp, "_surfaces", lambda: _spy(calls))
        assert pp.run_prewarm(limit=1)["symbols"] == 1

    def test_an_empty_universe_is_survivable(self, monkeypatch):
        monkeypatch.setattr(pp, "_universe", lambda: [])
        assert pp.run_prewarm()["symbols"] == 0


class TestItIsNotASecondCodePath:
    def test_it_warms_through_the_public_service_functions(self):
        """A prewarmed entry must be identical to a lazily built one. Warming
        via a private builder would create a second path nobody tests."""
        import inspect
        src = inspect.getsource(pp._surfaces)
        for fn in ("get_fundamentals", "get_statements", "get_earnings_table",
                   "get_earnings", "get_ownership"):
            assert fn in src, f"{fn} is the endpoint's own entry point"
        assert "_build" not in src, "must not call a private builder"
