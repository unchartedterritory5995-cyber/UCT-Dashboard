"""The web lifespan stops the bars-seed pool, so the bounded exit join does not wait on its idle workers.

Measured at a web pod swap: "[serve-dual] exiting with 4 non-daemon thread(s) still running after 5s:
bars-seed_0..3", "exit after 12.0s (shutdown 7.0s, join 5.00s)". `api/routers/stream.py` `_kick_seed`
creates its ThreadPoolExecutor lazily (the first chart stream's D8 seed) and nothing ever shut it down. A
ThreadPoolExecutor's idle worker waits on its queue until interpreter shutdown wakes it, and
api/serve_dual.py's `os._exit` never reaches that, so every swap paid the whole 5 s budget. The same defect
and fix as the cold-preload pool (tests/test_cold_preload_pool_shutdown.py, #2478).

Mutation proof (run before calling these done):
    1. shutdown_seed_pool() does nothing               -> T1, T2, T3 RED
    2. _kick_seed ignores the stop                      -> T2 RED
    3. the stop waits on a running seed (wait=True)     -> T3 RED
    4. the stop starts a queued seed (no cancel)        -> T3 RED
    5. the lifespan does not call it                    -> T4 RED
"""
from __future__ import annotations

import ast
import pathlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait

from api.routers import stream

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _workers(prefix):
    return [t for t in threading.enumerate() if t.name.startswith(prefix)]


def _fresh(monkeypatch, pool=None):
    """The module's seed state for one test (monkeypatch puts the real one back afterwards)."""
    monkeypatch.setattr(stream, "_seed_pool", pool)
    monkeypatch.setattr(stream, "_seed_closed", False, raising=False)
    monkeypatch.setattr(stream, "_seed_inflight", 0)
    monkeypatch.setattr(stream, "_SEED_MAX_INFLIGHT", 16)


def test_T1_the_stop_lets_the_idle_seed_workers_exit_at_once(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bars-seed-t1")
    _fresh(monkeypatch, pool)
    wait([pool.submit(time.sleep, 0.05) for _ in range(4)])
    workers = _workers("bars-seed-t1")
    assert workers and all(not t.daemon for t in workers)
    # control: idle, they do NOT exit on their own (this is what held the join)
    for t in workers:
        t.join(0.2)
    assert all(t.is_alive() for t in workers), "the control cannot tell: idle workers already exited"
    stream.shutdown_seed_pool()
    deadline = time.monotonic() + 3
    for t in workers:
        t.join(max(0.0, deadline - time.monotonic()))
    assert not [t.name for t in workers if t.is_alive()]
    stream.shutdown_seed_pool()                                    # a second call is harmless


def test_T2_after_the_stop_a_kick_starts_nothing(monkeypatch):
    _fresh(monkeypatch, None)
    stream.shutdown_seed_pool()                                    # never created: harmless
    stream.shutdown_seed_pool()                                    # twice: harmless
    before = set(_workers("bars-seed"))
    ran = threading.Event()
    assert stream._kick_seed(lambda sym: ran.set(), "AAA") is False   # "not started", the caller's skip
    assert not ran.wait(0.3)
    assert stream._seed_pool is None                               # no new pool
    assert set(_workers("bars-seed")) == before                    # no new worker
    assert stream._seed_inflight == 0


def test_T3_the_stop_never_waits_on_a_running_seed_and_drops_a_queued_one(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-seed-t3")
    _fresh(monkeypatch, pool)
    started, gate, queued_ran = threading.Event(), threading.Event(), threading.Event()

    def running(sym):
        started.set()
        gate.wait(3)

    assert stream._kick_seed(running, "AAA") is True
    assert started.wait(2)
    assert stream._kick_seed(lambda sym: queued_ran.set(), "BBB") is True   # queued behind it
    t0 = time.monotonic()
    stream.shutdown_seed_pool()
    assert time.monotonic() - t0 < 0.5                             # a bars read for a stream going away: not waited on
    gate.set()
    for t in _workers("bars-seed-t3"):
        t.join(3)
    assert not _workers("bars-seed-t3")
    assert not queued_ran.is_set()                                 # never started


def test_T5_a_kick_that_loses_the_race_with_the_stop_leaves_the_count_right(monkeypatch):
    """The kick took the pool under the lock, the stop shut it down, then the kick submits: the executor
    refuses (RuntimeError). The kick answers False and gives its in-flight place back."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-seed-t5")
    pool.shutdown(wait=False)                     # the stop won the race; the flag is not what refuses here
    _fresh(monkeypatch, pool)
    ran = []
    assert stream._kick_seed(ran.append, "LATE") is False
    assert stream._seed_inflight == 0
    assert ran == []


def test_T6_a_test_that_wants_seeds_can_reopen_the_state_after_a_lifespan_stopped_it(monkeypatch):
    """Two tests in this suite run the real api.main lifespan through shutdown, which stops the pool for the
    rest of the pytest process. A test that kicks seeds must set its own state (as _fresh does, and as
    test_bar_broadcaster_tv_replay's F3 does); this pins that doing so is enough."""
    _fresh(monkeypatch)
    stream.shutdown_seed_pool()                   # what an earlier lifespan test leaves behind
    assert stream._kick_seed(lambda s: None, "X") is False
    monkeypatch.setattr(stream, "_seed_closed", False)
    monkeypatch.setattr(stream, "_seed_pool", None)
    done = threading.Event()
    assert stream._kick_seed(lambda s: done.set(), "X") is True
    assert done.wait(5)
    stream._seed_pool.shutdown(wait=True)
    assert stream._seed_inflight == 0


def test_T4_the_lifespan_stops_the_seed_pool_after_it_serves():
    """The call sits in the lifespan's shutdown half (after its one `yield`), and is the stream router's own."""
    tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    life = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    yield_line = next(n.lineno for n in ast.walk(life) if isinstance(n, ast.Yield))
    aliases = {a.asname or a.name for n in ast.walk(life) if isinstance(n, ast.ImportFrom) and n.lineno > yield_line
               and n.module == "api.routers" for a in n.names if a.name == "stream"}
    calls = [n for n in ast.walk(life) if isinstance(n, ast.Call) and n.lineno > yield_line
             and isinstance(n.func, ast.Attribute) and n.func.attr == "shutdown_seed_pool"
             and isinstance(n.func.value, ast.Name) and n.func.value.id in aliases]
    assert aliases and calls, "the lifespan's shutdown never stops the bars-seed pool"
