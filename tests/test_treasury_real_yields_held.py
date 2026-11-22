"""`treasury_real_yields_held.held_real()`: the READ ONLY reader of the real yield block the service holds.

No network: the Treasury's feed is the invented one `tests/test_treasury_real_yields.py` stands in for, and every
reader that could start work is replaced by a counter that fails the test when reached. Every figure is invented.
Pinned: nothing held is `not_held`, the block comes back exactly as the RATES route's `real` carries it (the service's
own arithmetic for the breakevens, over the nominal days `treasury_yields` holds), a failed look rides along as
`check`, and the reader never builds and never starts a thread, while the service's own `get_real()` builds on the
same cold hold (so the rail can fail).
"""
from __future__ import annotations

import threading

import pytest

from api.services import held_build
from api.services import treasury_real_yields as svc
from api.services import treasury_real_yields_held as held
from api.services import treasury_yields as ty
from tests.test_treasury_real_yields import NOMINAL, NOW, Site


@pytest.fixture
def site(monkeypatch, tmp_path):
    s = Site()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ty, "_http_get", s.get)
    monkeypatch.setattr(ty, "_pause", s.pauses.append)
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    monkeypatch.setattr(ty, "held_rows", lambda days=None: {d: dict(v) for d, v in NOMINAL.items() if days is None or d in days})
    svc.reset_for_tests()
    yield s
    svc._held.drain(10)
    svc.reset_for_tests()


@pytest.fixture
def work(monkeypatch):
    """Counts the work the held reader must never cause: a build, a request, a thread."""
    hits = []

    def boom(name):
        def f(*a, **kw):
            hits.append(name)
            raise AssertionError(f"{name} was reached by a held read")
        return f
    for name in ("get_real", "build"):
        monkeypatch.setattr(svc, name, boom(name))
    for name in ("fetch_period", "_http_get", "get_yields", "_start_job"):
        monkeypatch.setattr(ty, name, boom(f"treasury_yields.{name}"))
    for name in ("get", "_start", "_run"):
        monkeypatch.setattr(held_build.HeldBuild, name, boom(f"HeldBuild.{name}"))
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: hits.append(f"thread {self.name}") or real_start(self))
    return hits


def _built():
    out = svc.get_real(wait_s=10)
    svc._held.drain(10)
    return out


def test_nothing_held_is_not_held_and_nothing_is_built(site, work):
    assert held.held_real() == (None, "not_held")
    assert work == [] and site.calls == []


def test_the_block_comes_back_exactly_as_the_route_carries_it(site):
    served = _built()
    assert served["status"] == "ok" and len(site.calls) == 2
    got, how = held.held_real()
    assert how == "held" and got == served                            # the service's own `assemble`, breakevens included
    be = {r["key"]: r for r in got["breakevens"]["rows"]}
    assert got["breakevens"]["as_of"] == "2026-11-17" and be["10y"]["value"] == 2.48 and be["20y"]["value"] is None


def test_a_restart_reads_the_disk_copy_and_a_failed_look_rides_along(site):
    served = _built()
    svc.reset_for_tests()
    got, how = held.held_real()
    assert how == "held" and got["maturities"] == served["maturities"] and len(site.calls) == 2
    site.answer = (503, "text/plain", b"")
    with svc._held._lock:
        svc._held._state["checked"] = 0.0
    svc.get_real(wait_s=0)                                             # the service's own refresh, which fails
    svc._held.drain(10)
    got, how = held.held_real()
    assert how == "held" and got["maturities"] == served["maturities"] and got["check"]["http_status"] == 503


def test_an_answer_that_is_not_the_real_curve_is_not_held(site, monkeypatch):
    for junk in ({"status": "failed"}, {"status": "ok", "days": {}}, {"status": "ok", "days": None}, "x"):
        monkeypatch.setattr(svc._held, "peek", lambda _j=junk: _j)
        assert held.held_real() == (None, "not_held"), junk


def test_the_reader_says_read_only_and_the_services_own_reader_builds_on_the_same_cold_hold(site):
    assert held.held_real.__doc__.startswith("READ ONLY")
    assert held.held_real()[1] == "not_held" and site.calls == []
    _built()
    assert len(site.calls) == 2 and held.held_real()[1] == "held"
