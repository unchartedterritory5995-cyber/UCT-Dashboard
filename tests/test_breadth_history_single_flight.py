"""Heavy breadth history reads do not pile up on each other.

⛔ THE COST THIS CONTAINS IS MEASURED, NOT FEARED: `GET /api/breadth-monitor?days=8000`
took **54,923 ms** cold on the single web process (D-042). The web pod is one uvicorn
process — one event loop, one anyio threadpool of 64 — so N concurrent reads of the same
window are N workers each paying that, contending on one SQLite file, to store one value.

This file rails the containment in two places, because they fail differently:

  • `api/services/single_flight.py` — the primitive. Does it actually collapse? Does it
    collapse only what shares a key? Does a failure reach the followers? Does a timeout
    RAISE rather than quietly recompute?
  • `api/services/breadth_monitor.py` — the WIRE. A perfect primitive nobody calls is the
    defect this repo names most often, and a component test cannot see a severed wire.

⛔ Scoped runs only on this box — name the file:

    python -m pytest tests/test_breadth_history_single_flight.py -q
"""
from __future__ import annotations

import ast
import pathlib
import threading
import time

import pytest

from api.services import breadth_monitor as svc
from api.services import single_flight
from api.services.cache import cache

REPO = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def clean_state():
    single_flight.reset_for_tests()
    cache.delete_prefix("breadth_history_")
    yield
    single_flight.reset_for_tests()
    cache.delete_prefix("breadth_history_")


def _run_concurrently(fns, release=None):
    """Start every callable at once, then `release()` before joining.

    ⛔ `release` is load-bearing, not decoration. A leader held open by an
    `Event.wait(timeout=...)` finishes when that TIMEOUT expires whether or not the
    test ever sets it — so a harness that joins first and releases afterwards passes
    on the timeout and proves nothing about the collapse. Release, THEN join.
    """
    out = [None] * len(fns)
    start = threading.Barrier(len(fns))

    def _one(i, fn):
        start.wait(timeout=5)
        try:
            out[i] = ("ok", fn())
        except BaseException as e:          # noqa: BLE001 — the test inspects it
            out[i] = ("raised", e)

    threads = [threading.Thread(target=_one, args=(i, f)) for i, f in enumerate(fns)]
    for t in threads:
        t.start()
    if release is not None:
        time.sleep(0.1)                     # let the followers queue behind the leader
        release()
    for t in threads:
        t.join(timeout=10)
    assert not any(t.is_alive() for t in threads), "a thread never finished — likely a deadlock"
    return out


# ── the primitive ─────────────────────────────────────────────────────────────

def test_concurrent_callers_on_one_key_run_the_work_once():
    calls = []
    gate = threading.Event()

    def slow():
        calls.append(1)
        gate.wait(timeout=5)               # hold the leader while followers arrive
        return "answer"

    results = _run_concurrently([lambda: single_flight.run("k", slow)] * 4, release=gate.set)

    assert len(calls) == 1, f"the work ran {len(calls)} times — nothing collapsed"
    assert [r for r, _ in results] == ["ok"] * 4
    assert {v for _, v in results} == {"answer"}, "a follower got a different answer"
    assert single_flight.stats()["collapsed"] == 3


def test_different_keys_do_not_collapse():
    """⛔ THE DISCRIMINATOR. Without it, a `run` that simply serialised everything —
    or one key-blind enough to answer every caller from one computation — would pass
    the test above and be catastrophically wrong."""
    calls = []

    def work(tag):
        calls.append(tag)
        time.sleep(0.02)
        return tag

    results = _run_concurrently([
        lambda: single_flight.run("a", lambda: work("a")),
        lambda: single_flight.run("b", lambda: work("b")),
    ])
    assert sorted(calls) == ["a", "b"], "two distinct windows were collapsed into one"
    assert sorted(v for _, v in results) == ["a", "b"]
    assert single_flight.stats()["collapsed"] == 0


def test_the_leaders_failure_reaches_every_follower_and_does_not_poison_the_key():
    """A failure must be SHARED (not retried by each follower in turn — that is the
    pile-up wearing a different hat) and must not wedge the key forever."""
    boom = RuntimeError("reader exploded")
    gate = threading.Event()
    attempts = []

    def failing():
        attempts.append(1)
        gate.wait(timeout=5)
        raise boom

    results = _run_concurrently([lambda: single_flight.run("k", failing)] * 3, release=gate.set)

    assert len(attempts) == 1, "followers retried a computation that was already failing"
    assert [r for r, _ in results] == ["raised"] * 3
    assert all(e is boom for _, e in results), "the leader's error was replaced or swallowed"

    # …and the NEXT caller is a fresh leader, not a follower of a finished call.
    assert single_flight.inflight_keys() == []
    assert single_flight.run("k", lambda: "recovered") == "recovered"


def test_a_follower_that_times_out_raises_and_does_not_compute_it_itself(monkeypatch):
    """⛔ THE TEMPTING WRONG FIX, railed: 'on timeout, do the work yourself' restarts the
    stampede at the exact moment the leader is already struggling."""
    monkeypatch.setenv("BREADTH_SINGLE_FLIGHT_WAIT_SECONDS", "0.05")
    calls = []
    release = threading.Event()

    def slow():
        calls.append(1)
        release.wait(timeout=5)
        return "late"

    leader = threading.Thread(target=lambda: single_flight.run("k", slow))
    leader.start()
    time.sleep(0.05)
    with pytest.raises(single_flight.SingleFlightTimeout):
        single_flight.run("k", lambda: calls.append("follower-computed"))

    release.set()
    leader.join(timeout=5)
    assert calls == [1], f"a follower computed anyway: {calls}"
    assert single_flight.stats()["timeouts"] == 1


def test_the_wait_bound_is_read_at_call_time(monkeypatch):
    """An import-time capture cannot be changed without a rebuild — and cannot be
    driven by the test above, which would then be asserting against a constant."""
    assert single_flight.wait_seconds() == single_flight._DEFAULT_WAIT_SECONDS
    monkeypatch.setenv("BREADTH_SINGLE_FLIGHT_WAIT_SECONDS", "7")
    assert single_flight.wait_seconds() == 7.0
    monkeypatch.setenv("BREADTH_SINGLE_FLIGHT_WAIT_SECONDS", "not-a-number")
    assert single_flight.wait_seconds() == single_flight._DEFAULT_WAIT_SECONDS


# ── the wire ──────────────────────────────────────────────────────────────────

def test_concurrent_deep_reads_of_one_window_compute_it_once(monkeypatch):
    """The READER is stubbed; the MECHANISM under test is real — `get_history_deep`'s
    own cache key, its own `single_flight.run`, its own delegation."""
    monkeypatch.setattr(svc, "_DEEP_ENABLED", True, raising=False)
    calls = []
    gate = threading.Event()

    def fake_uncached(days, end, anchor, ck):
        calls.append(ck)
        gate.wait(timeout=5)
        return [{"date": "2026-09-11"}]

    monkeypatch.setattr(svc, "_history_deep_uncached", fake_uncached)
    results = _run_concurrently([lambda: svc.get_history_deep(8000)] * 3, release=gate.set)

    assert len(calls) == 1, f"the deep reader ran {len(calls)} times for one window"
    assert [r for r, _ in results] == ["ok"] * 3
    assert all(v == [{"date": "2026-09-11"}] for _, v in results)


def test_two_different_windows_still_read_independently(monkeypatch):
    """Control for the wire: the collapse is keyed by WINDOW, so the Time Navigator
    asking for a different span is never made to wait for an unrelated read."""
    monkeypatch.setattr(svc, "_DEEP_ENABLED", True, raising=False)
    calls = []

    def fake_uncached(days, end, anchor, ck):
        calls.append(ck)
        time.sleep(0.02)
        return []

    monkeypatch.setattr(svc, "_history_deep_uncached", fake_uncached)
    _run_concurrently([
        lambda: svc.get_history_deep(90),
        lambda: svc.get_history_deep(8000),
    ])
    assert len(set(calls)) == 2, f"two windows shared one computation: {calls}"


def test_a_cache_hit_never_enters_single_flight(monkeypatch):
    """The common read is UNCHANGED. A warm key must not acquire a lock, register a
    leader, or otherwise pay for a mechanism that exists for the cold case."""
    monkeypatch.setattr(svc, "_DEEP_ENABLED", True, raising=False)
    cache.set("breadth_history_deep_90_latest_le", [{"date": "warm"}], ttl=60)

    def explode(*a, **k):                                   # pragma: no cover
        raise AssertionError("a cache hit reached the reader")

    monkeypatch.setattr(svc, "_history_deep_uncached", explode)
    assert svc.get_history_deep(90) == [{"date": "warm"}]
    assert single_flight.stats() == {"leaders": 0, "collapsed": 0, "timeouts": 0, "inflight": 0}


def test_the_plain_reader_is_wired_too(monkeypatch):
    """`get_history_deep` DELEGATES to `get_history` whenever the window lies inside the
    collector range — which is the default Monitor view, i.e. most reads. Wiring only
    the deep path would leave the common one uncontained."""
    calls = []
    gate = threading.Event()

    def fake_uncached(days, end, anchor, ck):
        calls.append(ck)
        gate.wait(timeout=5)
        return []

    monkeypatch.setattr(svc, "_history_uncached", fake_uncached)
    _run_concurrently([lambda: svc.get_history(90)] * 3, release=gate.set)
    assert len(calls) == 1, f"the plain reader ran {len(calls)} times for one window"


# ── the threadpool, which is the other half of the containment ────────────────

def _route_defs() -> dict:
    """Every top-level function in the breadth-monitor router, by name, as AST."""
    src = (REPO / "api" / "routers" / "breadth_monitor.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    return {
        n.name: n for n in tree.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


@pytest.mark.parametrize("name", ["get_breadth_history", "get_breadth_series"])
def test_the_history_routes_stay_SYNC_so_the_read_runs_in_the_threadpool(name):
    """⛔ A `def` route handler runs in the anyio threadpool; an `async def` one runs ON
    THE EVENT LOOP. `svc.get_history_deep` is blocking SQLite work measured at ~55 s, so
    converting either handler to `async def` would stall EVERY request on the pod —
    every member, every endpoint — for the length of one member's deep read.

    ⭐ This rail reads the runtime declaration, not a comment about it: `async` is not
    a shape a validator can check and not something a functional test would notice
    (both forms return the same JSON under load-free conditions).
    """
    fn = _route_defs()[name]
    assert isinstance(fn, ast.FunctionDef), (
        f"{name} is `async def`. A blocking 55 s read on the event loop stalls the whole "
        f"pod; keep it `def` so FastAPI runs it in the threadpool."
    )


def test_the_route_really_executes_OFF_the_event_loop(monkeypatch):
    """⭐ The AST rail above reads the DECLARATION; this reads the RUNTIME. Both, because
    they fail differently — a declaration can be right while a future middleware or a
    framework upgrade changes where the call lands, and a runtime probe alone would not
    say which line to fix.

    Measured, not assumed: the handler records the thread it ran on, and it is one of
    anyio's worker threads — the pool FastAPI hands `def` endpoints to — never the thread
    the event loop is running on.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import breadth_monitor as rt

    seen = {}

    def _record(*a, **k):
        seen["thread"] = threading.current_thread()
        return []

    monkeypatch.setattr(rt.svc, "get_history_deep", _record)
    monkeypatch.setattr(rt.svc, "date_bounds", lambda: {"min": None, "max": None})

    app = FastAPI()
    app.include_router(rt.router)
    app.dependency_overrides[rt.require_paid] = lambda: {"id": "t", "plan": "pro"}

    loop_thread = {}

    @app.get("/__loop_thread")
    async def _loop_thread():                                   # the control
        loop_thread["thread"] = threading.current_thread()
        return {}

    client = TestClient(app)
    assert client.get("/__loop_thread").status_code == 200
    assert client.get("/api/breadth-monitor?days=90").status_code == 200

    reader = seen.get("thread")
    assert reader is not None, "the reader never ran — the probe measured nothing"
    assert reader is not loop_thread["thread"], (
        "the history read ran on the SAME thread as an async handler, i.e. on the event "
        "loop. A ~55 s blocking read there stalls every request on the pod."
    )
    assert "anyio" in reader.name.lower() or "worker" in reader.name.lower(), (
        f"the read ran on {reader.name!r}, which is not an anyio worker — FastAPI is no "
        f"longer offloading this handler and the threadpool assumption is void"
    )


def test_the_async_probe_can_actually_see_an_async_def():
    """⛔ NON-VACUITY. If the AST walk silently returned nothing — a renamed file, a
    parse that skipped decorated functions — every assertion above would pass over an
    empty set. This router really does contain one `async def`."""
    defs = _route_defs()
    assert len(defs) > 20, "the router's functions were not enumerated at all"
    assert any(isinstance(n, ast.AsyncFunctionDef) for n in defs.values()), (
        "no async route found in this file — the probe cannot distinguish the two forms, "
        "so the rail above proves nothing"
    )
