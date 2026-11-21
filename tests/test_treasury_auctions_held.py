"""`treasury_auctions_held.held_auctions()`: the READ ONLY reader of the Treasury auctions answer the service holds.

No network: the publisher is the invented one `tests/test_treasury_auctions.py` stands in for, and every reader that
could start work is replaced by a counter that fails the test when reached. Every security, amount and rate is
invented. Pinned: nothing held is `not_held`, the answer the SERVICE holds comes back as its route serves it (in memory
and from its disk copy after a restart), a held answer's failed look rides along as `check`, and the reader never
builds and never starts a thread, while the service's own `get_auctions()` builds on the same cold hold (so the rail can
fail).
"""
from __future__ import annotations

import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import held_build
from api.services import treasury_auctions as svc
from api.services import treasury_auctions_held as held
from api.services import treasury_yields as ty
from api.services.econ import http as econ_http
from tests.test_treasury_auctions import Publisher

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=ZoneInfo("America/New_York"))


@pytest.fixture
def pub(monkeypatch, tmp_path):
    p = Publisher()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    monkeypatch.setattr(svc, "_client", lambda: econ_http.HttpClient(transport=p, max_retries=0, sleep=lambda s: None))
    svc.reset_for_tests()
    yield p
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
    for name in ("get_auctions", "build", "_client", "_read"):
        monkeypatch.setattr(svc, name, boom(name))
    for name in ("get", "_start", "_run"):
        monkeypatch.setattr(held_build.HeldBuild, name, boom(f"HeldBuild.{name}"))
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: hits.append(f"thread {self.name}") or real_start(self))
    return hits


def _built():
    out = svc.get_auctions(wait_s=10)
    svc._held.drain(10)
    return out


def test_nothing_held_is_not_held_and_nothing_is_built(pub, work):
    assert held.held_auctions() == (None, "not_held")
    assert work == [] and pub.calls == []


def test_the_answer_the_service_holds_comes_back_as_its_route_serves_it(pub):
    served = _built()
    assert served["status"] == "ok" and len(pub.calls) == 2
    got, how = held.held_auctions()
    assert how == "held" and got == served                            # the route's own answer: no `v`, `check` beside it
    assert "v" not in got and got["check"] is None and got["as_of"] == "2026-11-17"


def test_a_restart_reads_the_disk_copy_and_a_failed_look_rides_along(pub, monkeypatch):
    served = _built()
    svc.reset_for_tests()                                              # memory gone, the disk copy kept
    got, how = held.held_auctions()
    assert how == "held" and got["results"] == served["results"] and len(pub.calls) == 2
    pub.answer["treasury_securities_auctions_v2"] = (503, "text/plain", b"")
    with svc._held._lock:
        svc._held._state["checked"] = 0.0
    svc.get_auctions(wait_s=0)                                         # the service's own refresh, which fails
    svc._held.drain(10)
    got, how = held.held_auctions()
    assert how == "held" and got["results"] == served["results"] and got["check"]["reason"] == "source"


def test_an_answer_that_is_not_ok_is_not_held(pub, monkeypatch):
    monkeypatch.setattr(svc._held, "peek", lambda: {"status": "failed", "reason": "source"})
    assert held.held_auctions() == (None, "not_held")
    monkeypatch.setattr(svc._held, "peek", lambda: "x")
    assert held.held_auctions() == (None, "not_held")


def test_the_reader_says_read_only_and_the_services_own_reader_builds_on_the_same_cold_hold(pub):
    assert held.held_auctions.__doc__.startswith("READ ONLY")
    assert held.held_auctions()[1] == "not_held" and pub.calls == []   # the held read: no work
    _built()                                                           # the service's reader: the build, two requests
    assert len(pub.calls) == 2 and held.held_auctions()[1] == "held"
