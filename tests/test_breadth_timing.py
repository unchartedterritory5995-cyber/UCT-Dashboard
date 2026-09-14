"""Rails for the breadth-history request timing probe (Session 2 §2b).

The probe exists to settle a 30x that local measurement cannot reach. Everything
here is about the two ways a probe of that kind lies: by reporting a number it
never measured, and by breaking the route it is watching.
"""
from __future__ import annotations

import logging
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import breadth_timing, single_flight


def _app():
    app = FastAPI()

    @app.get("/api/breadth-monitor")
    def route():
        breadth_timing.begin(span=8000)
        t0 = time.perf_counter()
        time.sleep(0.05)                       # stands in for the reader
        breadth_timing.note(reader_ms=(time.perf_counter() - t0) * 1000.0, rows=4703,
                            cache="miss", coalesced=False)
        return {"rows": []}

    @app.get("/api/breadth-monitor/ohlc/status")
    def sibling():
        return {"ok": True}

    app.add_middleware(breadth_timing.BreadthTimingMiddleware)
    return app


# ── what it must report ───────────────────────────────────────────────────────

def test_the_response_carries_a_server_timing_breakdown():
    r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200
    st = r.headers.get("server-timing", "")
    assert "reader;dur=" in st and "post;dur=" in st and "total;dur=" in st, st


def test_reader_and_post_reader_partition_the_total():
    """post_reader_ms is DERIVED, so it can never disagree with what was measured."""
    r = TestClient(_app()).get("/api/breadth-monitor")
    st = dict(p.strip().split(";dur=") for p in r.headers["server-timing"].split(","))
    reader, post, total = float(st["reader"]), float(st["post"]), float(st["total"])
    assert reader > 40, f"the stand-in reader sleeps 50ms; got {reader}"
    assert abs((reader + post) - total) < 0.5, (reader, post, total)


def test_a_sibling_admin_route_is_not_instrumented():
    """⛔ NON-VACUITY IN BOTH DIRECTIONS. Scoping is only a fact if the probe can be
    shown to fire somewhere — a middleware that is broken everywhere also passes
    'it did not fire on the sibling'."""
    c = TestClient(_app())
    assert "server-timing" in c.get("/api/breadth-monitor").headers
    assert "server-timing" not in c.get("/api/breadth-monitor/ohlc/status").headers


def test_the_log_line_carries_no_member_identifier(caplog):
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        TestClient(_app()).get("/api/breadth-monitor?days=8000",
                               headers={"Cookie": "session=super-secret-token",
                                        "X-Forwarded-For": "203.0.113.9"})
    text = chr(10).join(r.getMessage() for r in caplog.records)
    assert "[breadth-timing]" in text, "the probe logged nothing at all"
    for forbidden in ("super-secret-token", "203.0.113.9", "session", "@"):
        assert forbidden not in text, f"{forbidden!r} reached the timing log: {text}"


def test_rss_reports_none_rather_than_zero_when_unreadable(monkeypatch):
    """⛔ 0.0 MB and 'cannot read it' are different facts. The local harness for
    this programme got 0.0 from an unchecked ctypes call and nearly published it."""
    monkeypatch.setattr(breadth_timing, "_PAGE", 4096)
    monkeypatch.setattr("builtins.open", lambda *a, **k: (_ for _ in ()).throw(OSError))
    assert breadth_timing.rss_mb() is None


# ── what it must never do ─────────────────────────────────────────────────────

def test_a_probe_that_raises_cannot_break_the_route(monkeypatch):
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("probe exploded"))
    monkeypatch.setattr(breadth_timing, "rss_mb", boom)
    monkeypatch.setattr(breadth_timing, "server_timing", boom)
    r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200, "a timing probe failed a paid route"


def test_the_kill_switch_silences_the_line_without_touching_the_response(monkeypatch, caplog):
    monkeypatch.setenv("BREADTH_TIMING_LOG", "0")
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200
    assert not [x for x in caplog.records if "[breadth-timing]" in x.getMessage()]
    monkeypatch.setenv("BREADTH_TIMING_LOG", "1")
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        TestClient(_app()).get("/api/breadth-monitor")
    assert [x for x in caplog.records if "[breadth-timing]" in x.getMessage()],         "the switch silences it in BOTH positions, so it proves nothing"


# ── the single-flight role signal, which is the whole reason it is a callback ──

def test_the_role_is_exact_under_real_concurrency():
    """⛔ THE REASON THIS IS NOT A COUNTER DIFF. Diffing `collapsed` around the call
    misattributes when two arrivals land on one key — the exact case it exists to
    observe. The callback fires under the lock that decides the role."""
    single_flight.reset_for_tests()
    gate = threading.Event()
    roles: list[str] = []
    lock = threading.Lock()

    def record(role):
        with lock:
            roles.append(role)

    def call():
        return single_flight.run("k", lambda: (gate.wait(timeout=5), "v")[1], on_role=record)

    barrier = threading.Barrier(4)

    def _one():
        barrier.wait(timeout=5)
        call()

    threads = [threading.Thread(target=_one) for _ in range(4)]
    for t in threads:
        t.start()
    time.sleep(0.2)                  # let followers queue behind the leader
    gate.set()                       # ⛔ release BEFORE joining, never after
    for t in threads:
        t.join(timeout=5)

    assert roles.count("leader") == 1, roles
    assert roles.count("follower") == 3, roles


def test_an_observer_that_raises_cannot_break_the_flight():
    single_flight.reset_for_tests()
    out = single_flight.run("k2", lambda: "value",
                            on_role=lambda role: (_ for _ in ()).throw(RuntimeError("nope")))
    assert out == "value"


def test_run_without_an_observer_is_unchanged():
    single_flight.reset_for_tests()
    assert single_flight.run("k3", lambda: 7) == 7
