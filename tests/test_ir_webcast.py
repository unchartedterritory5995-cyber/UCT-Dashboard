"""Resolving the IR / events page where the live call is webcast."""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def ir(monkeypatch):
    import api.services.ir_webcast as m
    importlib.reload(m)

    class _Cache:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def set(self, k, v, ttl=None): self.d[k] = v

    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    m._test_cache = cache
    return m


class TestCandidateOrdering:
    def test_events_pages_come_FIRST(self, ir):
        # /events is the page with the live player and the replay. Landing on
        # the IR homepage instead costs the reader a click at the exact moment
        # they are trying to join a call.
        c = ir.candidates("https://www.cvshealth.com")
        assert c[0].endswith("/events")
        assert c.index("https://investors.cvshealth.com/events") < \
               c.index("https://investors.cvshealth.com")

    def test_strips_scheme_and_www(self, ir):
        for site in ("https://www.adm.com", "http://adm.com", "https://adm.com/"):
            assert "https://investors.adm.com" in ir.candidates(site)

    def test_no_website_means_no_candidates(self, ir):
        assert ir.candidates("") == [] and ir.candidates(None) == []


class TestResolve:
    def test_returns_the_FIRST_candidate_that_answers_not_the_fastest(self, ir):
        # Ordering encodes "closest to the webcast", so resolving must respect
        # list order. Taking whichever probe returned first would hand back a
        # worse page whenever the homepage happened to answer quicker.
        reachable = {"https://investors.x.com", "https://investors.x.com/events"}
        out = ir.resolve("X", website="https://www.x.com",
                         alive=lambda u: u in reachable)
        assert out == "https://investors.x.com/events"

    def test_falls_through_to_the_bare_IR_host(self, ir):
        out = ir.resolve("X", website="https://www.x.com",
                         alive=lambda u: u == "https://ir.x.com")
        assert out == "https://ir.x.com"

    def test_nothing_reachable_resolves_to_None(self, ir):
        assert ir.resolve("X", website="https://www.x.com",
                          alive=lambda u: False) is None

    def test_a_probe_that_RAISES_does_not_escape(self, ir):
        def boom(_u):
            raise RuntimeError("dns exploded")
        assert ir.resolve("X", website="https://www.x.com", alive=boom) is None

    def test_the_answer_is_cached_so_probes_run_once(self, ir):
        calls = []

        def alive(u):
            calls.append(u)
            return u == "https://investors.x.com"

        first = ir.resolve("X", website="https://www.x.com", alive=alive)
        n = len(calls)
        second = ir.resolve("X", website="https://www.x.com", alive=alive)
        assert first == second == "https://investors.x.com"
        assert len(calls) == n, "re-probed a symbol it had already resolved"

    def test_a_MISS_is_cached_too(self, ir):
        calls = []
        ir.resolve("X", website="https://www.x.com",
                   alive=lambda u: calls.append(u) or False)
        n = len(calls)
        ir.resolve("X", website="https://www.x.com",
                   alive=lambda u: calls.append(u) or False)
        assert len(calls) == n, "a known-unresolvable symbol was probed twice"

    def test_an_empty_symbol_is_not_a_lookup(self, ir):
        assert ir.resolve("") is None
