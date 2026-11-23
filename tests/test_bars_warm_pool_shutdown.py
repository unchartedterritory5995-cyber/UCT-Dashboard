"""The web lifespan stops the bars-warm pool, so the bounded exit join does not wait on its idle workers.

Measured at web pod swaps after #2577 stopped the bars-seed pool: the exit join still spent its whole 5 s on
"bars-warm_0..3" (exits at 12.0-12.6 s). `api/services/bars_fetch.py` creates `_bars_warm_pool` (4 workers,
"bars-warm") AT IMPORT. Three code paths submit to it: `warm_bars_async` (the list warms of breadth, earnings,
engine_data, movers, screener, theme_performance and watchlists), the admin universe warm
(`_run_universe_warm`, `_run_universe_warm_multi_tf`), and scan_period's deep daily warm. Nothing stopped it
at exit. A ThreadPoolExecutor's idle worker waits on its queue until interpreter shutdown wakes it, and
api/serve_dual.py's `os._exit` never reaches that. Same defect and fix as the bars-seed pool
(tests/test_bars_seed_pool_shutdown.py, #2577) and the cold-preload pool
(tests/test_cold_preload_pool_shutdown.py, #2478).

ONE way to stop it: `bars_fetch.stop_bars_warm_pool(reopen=...)`.
  reopen=False  process shutdown (`shutdown_bars_warm_pool`, the web lifespan): stopped for good.
  reopen=True   the admin warm-universe-stop: a fresh pool in its place, unless the process already stopped it.
After a stop with nothing in its place, a submit raises RuntimeError, and every submitter already treats that as
"pool shutting down": nothing reaches a request handler (T2).

Mutation proof (predictions written before each run):
    1. the stop does nothing                              -> T1, T2, T3, T5b, T7a RED
    2. the stop waits on running work (wait=True)         -> T3, T5b RED
    3. the stop starts queued work (no cancel_futures)    -> T3, T5b RED
    4. the lifespan does not call it                      -> T4 RED
    5. the admin stop reopens after the process stop      -> R2 RED
    6. tests/conftest.py does not reopen the warm pool    -> T7b, T8b RED
"""
from __future__ import annotations

import ast
import pathlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait

from api.services import bars_fetch

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _workers(prefix):
    return [t for t in threading.enumerate() if t.name.startswith(prefix)]


def _fresh(monkeypatch, pool=None):
    """The module's warm-pool state for one test (monkeypatch puts the real one back afterwards)."""
    monkeypatch.setattr(bars_fetch, "_bars_warm_pool", pool if pool is not None else ThreadPoolExecutor(
        max_workers=4, thread_name_prefix="bars-warm-test"))
    monkeypatch.setattr(bars_fetch, "_bars_warm_closed", False, raising=False)


def _no_disk(monkeypatch):
    """The universe warms skip what the disk cache holds: here it holds nothing."""
    class _Disk:
        @staticmethod
        def get(*_a, **_k):
            return None

        @staticmethod
        def put(*_a, **_k):
            return None
    monkeypatch.setattr(bars_fetch, "disk_cache", _Disk)


def _fresh_warm_state(monkeypatch):
    """A fresh universe-warm status, the same dict for bars_fetch and the admin routes in api/routers/bars.py (which
    imported it by name)."""
    st = dict(bars_fetch._warm_state, running=False, done=0, skipped=0, errors=0, total=0)
    monkeypatch.setattr(bars_fetch, "_warm_state", st)
    from api.routers import bars as bars_router
    monkeypatch.setattr(bars_router, "_warm_state", st)


class _Admin:
    """A request carrying the admin bearer the warm routes check (PUSH_SECRET, set per test)."""
    headers = {"Authorization": "Bearer s3cret"}


def test_T1_the_stop_lets_the_idle_warm_workers_exit_at_once(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bars-warm-t1")
    _fresh(monkeypatch, pool)
    wait([pool.submit(time.sleep, 0.05) for _ in range(4)])
    workers = _workers("bars-warm-t1")
    assert workers and all(not t.daemon for t in workers)
    # control: idle, they do NOT exit on their own (this is what held the join)
    for t in workers:
        t.join(0.2)
    assert all(t.is_alive() for t in workers), "the control cannot tell: idle workers already exited"
    bars_fetch.shutdown_bars_warm_pool()
    deadline = time.monotonic() + 3
    for t in workers:
        t.join(max(0.0, deadline - time.monotonic()))
    assert not [t.name for t in workers if t.is_alive()]
    assert bars_fetch._bars_warm_closed is True
    bars_fetch.shutdown_bars_warm_pool()                           # a second call is harmless


def test_T2_after_the_stop_every_submitter_starts_nothing_and_raises_nothing(monkeypatch):
    """What "refused" means per submitter, so no request handler sees an exception in a pod's last seconds:
      warm_bars_async             returns None (fire-and-forget, as before)
      the two universe warms      stop submitting; the status says not running
      scan_period's deep warm     its background thread stops submitting
    and no new pool, no new worker."""
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bars-warm-t2")
    _fresh(monkeypatch, pool)
    _no_disk(monkeypatch)
    _fresh_warm_state(monkeypatch)
    inner, deep = [], []
    monkeypatch.setattr(bars_fetch, "_get_bars_inner", lambda *a, **k: inner.append(a))
    monkeypatch.setattr(bars_fetch, "warm_ticker_daily_deep", lambda *a, **k: deep.append(a))
    bars_fetch.shutdown_bars_warm_pool()
    before = set(_workers("bars-warm"))

    assert bars_fetch.warm_bars_async(["AAA", "BBB"], tf="D", bars=10) is None
    bars_fetch._run_universe_warm(["AAA", "BBB"], "60", 10)
    assert bars_fetch._warm_state["running"] is False
    bars_fetch._run_universe_warm_multi_tf(["AAA", "BBB"], ["D", "60"], 10)
    assert bars_fetch._warm_state["running"] is False

    from api.services import scan_period
    monkeypatch.setattr(scan_period, "_PERIOD_WARM_ENABLED", True)
    monkeypatch.setattr(scan_period, "_period_warm_seen", set())
    scan_period._kick_period_daily_warm("scan_period_20200102_20200301", [{"sym": "AAA"}, {"sym": "BBB"}])
    for t in [t for t in threading.enumerate() if t.name == "period-daily-warm"]:
        t.join(3)

    time.sleep(0.2)
    assert inner == [] and deep == []                               # nothing ran
    assert bars_fetch._bars_warm_pool is pool                       # no new pool
    assert not set(_workers("bars-warm")) - before                  # no new worker


def test_T3_the_stop_never_waits_on_running_work_and_drops_queued_work(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-t3")
    _fresh(monkeypatch, pool)
    started, gate, queued_ran = threading.Event(), threading.Event(), threading.Event()

    def running():
        started.set()
        gate.wait(3)

    pool.submit(running)
    assert started.wait(2)
    pool.submit(queued_ran.set)                                     # queued behind it
    t0 = time.monotonic()
    bars_fetch.shutdown_bars_warm_pool()
    assert time.monotonic() - t0 < 0.5                              # a warm for a process going away: not waited on
    gate.set()
    for t in _workers("bars-warm-t3"):
        t.join(3)
    assert not _workers("bars-warm-t3")
    assert not queued_ran.is_set()                                  # never started


def test_T5a_a_universe_warm_whose_submit_loses_the_race_ends_with_its_status_right(monkeypatch):
    """The pool was stopped before the warm's first submit (the flag is not what refuses here): the submit
    raises, the warm stops submitting, and its status is not left saying "running"."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-t5a")
    pool.shutdown(wait=False)
    _fresh(monkeypatch, pool)
    _no_disk(monkeypatch)
    _fresh_warm_state(monkeypatch)
    ran = []
    monkeypatch.setattr(bars_fetch, "_get_bars_inner", lambda *a, **k: ran.append(a))
    bars_fetch._run_universe_warm(["AAA", "BBB", "CCC"], "60", 10)
    st = bars_fetch._warm_state
    assert (st["running"], st["done"], st["errors"], st["total"]) == (False, 0, 0, 3)
    assert ran == []


def test_T5b_a_universe_warm_stopped_with_work_queued_counts_every_submitted_job(monkeypatch):
    """One job running, two queued, then the stop: the queued two are cancelled and counted as done with an
    error, the running one finishes and is counted, and the warm ends not running."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-t5b")
    _fresh(monkeypatch, pool)
    _no_disk(monkeypatch)
    _fresh_warm_state(monkeypatch)
    started, gate = threading.Event(), threading.Event()
    ran = []

    def _inner(sym, tf, bars):
        ran.append(sym)
        if sym == "AAA":
            started.set()
            gate.wait(3)

    monkeypatch.setattr(bars_fetch, "_get_bars_inner", _inner)
    runner = threading.Thread(target=bars_fetch._run_universe_warm, args=(["AAA", "BBB", "CCC"], "60", 10),
                              daemon=True, name="t5b-universe-warm")
    runner.start()
    try:
        assert started.wait(2)
        deadline = time.monotonic() + 2
        while pool._work_queue.qsize() < 2 and time.monotonic() < deadline:   # BBB and CCC queued
            time.sleep(0.01)
        assert pool._work_queue.qsize() == 2
        t0 = time.monotonic()
        bars_fetch.shutdown_bars_warm_pool()
        assert time.monotonic() - t0 < 0.5
    finally:
        gate.set()
    runner.join(5)
    assert not runner.is_alive()
    st = bars_fetch._warm_state
    assert (st["running"], st["done"], st["errors"]) == (False, 3, 2)
    assert ran == ["AAA"]


def test_R1_the_admin_stop_cancels_the_queue_and_puts_a_fresh_pool_in_place(monkeypatch):
    """/api/admin/warm-universe-stop: what it did before this change, through the one stop. (A pin: green
    before and after.)"""
    from api.routers import bars as bars_router
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-r1")
    monkeypatch.setattr(bars_fetch, "_bars_warm_pool", pool)
    _fresh_warm_state(monkeypatch)
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    started, gate, queued_ran = threading.Event(), threading.Event(), threading.Event()
    pool.submit(lambda: (started.set(), gate.wait(3)))
    assert started.wait(2)
    pool.submit(queued_ran.set)

    try:
        out = bars_router.warm_universe_stop(_Admin())
    finally:
        gate.set()
    assert out["status"] == "stopped"
    fresh = bars_fetch._bars_warm_pool
    assert fresh is not pool
    assert fresh.submit(lambda: 7).result(5) == 7                   # the next warm can start
    for t in _workers("bars-warm-r1"):
        t.join(3)
    assert not _workers("bars-warm-r1") and not queued_ran.is_set()
    fresh.shutdown(wait=True)


def test_R2_after_the_process_stop_the_admin_stop_does_not_reopen(monkeypatch):
    from api.routers import bars as bars_router
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-r2")
    _fresh(monkeypatch, pool)
    _fresh_warm_state(monkeypatch)
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    bars_fetch.shutdown_bars_warm_pool()
    assert bars_router.warm_universe_stop(_Admin())["status"] == "stopped"
    assert bars_fetch._bars_warm_pool is pool and bars_fetch._bars_warm_closed is True
    bars_fetch.stop_bars_warm_pool(reopen=True)                     # the shared stop says the same
    assert bars_fetch._bars_warm_pool is pool and bars_fetch._bars_warm_closed is True


def test_R3_the_admin_stop_does_not_leave_a_running_universe_warm_hung(monkeypatch):
    """Found writing T5b, older than this change: `concurrent.futures.as_completed` is never woken for a future
    that `shutdown(cancel_futures=True)` cancels. CPython notifies its waiters only when a worker picks the job up
    (`set_running_or_notify_cancel`), which a cancelled job never is. So after every admin stop with work queued,
    the universe warm's runner thread waited for ever and its counters stayed short. It now reads each job through
    the job's own `result()`, which a cancel does wake."""
    from api.routers import bars as bars_router
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bars-warm-r3")
    monkeypatch.setattr(bars_fetch, "_bars_warm_pool", pool)
    _no_disk(monkeypatch)
    _fresh_warm_state(monkeypatch)
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    started, gate = threading.Event(), threading.Event()
    ran = []

    def _inner(sym, tf, bars):
        ran.append(sym)
        if sym == "AAA":
            started.set()
            gate.wait(3)

    monkeypatch.setattr(bars_fetch, "_get_bars_inner", _inner)
    runner = threading.Thread(target=bars_fetch._run_universe_warm_multi_tf, args=(["AAA", "BBB", "CCC"], ["60"], 10),
                              daemon=True, name="r3-universe-warm")
    runner.start()
    try:
        assert started.wait(2)
        deadline = time.monotonic() + 2
        while pool._work_queue.qsize() < 2 and time.monotonic() < deadline:   # BBB and CCC queued
            time.sleep(0.01)
        assert pool._work_queue.qsize() == 2
        assert bars_router.warm_universe_stop(_Admin())["status"] == "stopped"
    finally:
        gate.set()
    runner.join(5)
    fresh = bars_fetch._bars_warm_pool
    if fresh is not pool:
        fresh.shutdown(wait=False)
    assert not runner.is_alive(), "the universe warm's runner is still waiting on the jobs the stop cancelled"
    st = bars_fetch._warm_state
    assert (st["running"], st["done"], st["errors"]) == (False, 3, 2)
    assert ran == ["AAA"]


def test_T7a_a_test_that_leaves_the_pool_stopped():
    """First half of a PAIR (T7b reads what this leaves). What a lifespan test does: stop the real pool and
    put nothing back. No monkeypatch here on purpose."""
    bars_fetch.shutdown_bars_warm_pool()
    assert bars_fetch._bars_warm_closed is True


def test_T7b_the_next_test_finds_the_pool_open_again():
    """tests/conftest.py reopens a pool the previous test left stopped (with the module's own factory);
    without it this test, and every later test that submits a warm job, would be refused. (Run alone it
    passes trivially: T7a is what arms it.)"""
    assert bars_fetch._bars_warm_closed is False
    assert bars_fetch._bars_warm_pool.submit(lambda: 42).result(5) == 42


def test_T8a_a_test_that_stops_the_pool_and_only_then_patches_it_open(monkeypatch):
    """First half of a PAIR (T8b). The first patch of the state is made while it is closed, so monkeypatch's
    undo (which runs after the conftest fixture's teardown) puts "closed" back."""
    bars_fetch.shutdown_bars_warm_pool()
    monkeypatch.setattr(bars_fetch, "_bars_warm_closed", False)
    monkeypatch.setattr(bars_fetch, "_bars_warm_pool", bars_fetch._new_bars_warm_pool())
    assert bars_fetch._bars_warm_closed is False


def test_T8b_the_next_test_still_finds_the_pool_open():
    """The conftest fixture's BEFORE half reopens what T8a's undo closed again."""
    assert bars_fetch._bars_warm_closed is False
    assert bars_fetch._bars_warm_pool.submit(lambda: 43).result(5) == 43


def test_T4_the_lifespan_stops_the_warm_pool_after_it_serves():
    """The call sits in the lifespan's shutdown half (after its one `yield`), and is bars_fetch's own."""
    tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    life = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    yield_line = next(n.lineno for n in ast.walk(life) if isinstance(n, ast.Yield))
    aliases = {a.asname or a.name for n in ast.walk(life) if isinstance(n, ast.ImportFrom) and n.lineno > yield_line
               and n.module == "api.services" for a in n.names if a.name == "bars_fetch"}
    calls = [n for n in ast.walk(life) if isinstance(n, ast.Call) and n.lineno > yield_line
             and isinstance(n.func, ast.Attribute) and n.func.attr == "shutdown_bars_warm_pool"
             and isinstance(n.func.value, ast.Name) and n.func.value.id in aliases]
    assert aliases and calls, "the lifespan's shutdown never stops the bars-warm pool"


def test_T9_one_way_to_stop_it():
    """The admin stop and the process stop are the same function; nothing else in api/ builds or shuts down
    this pool (a second copy is how two stops come to disagree)."""
    import inspect
    from api.routers import bars as bars_router
    src = inspect.getsource(bars_router.warm_universe_stop)
    assert "stop_bars_warm_pool(reopen=True)" in src
    assert "_BarsWarmExecutor(" not in src and ".shutdown(" not in src
    hits = []
    for p in (ROOT / "api").rglob("*.py"):
        text = p.read_text(encoding="utf-8", errors="replace")
        if "_bars_warm_pool.shutdown(" in text or "_bars_warm_pool = " in text:
            hits.append(p.relative_to(ROOT).as_posix())
    assert hits == ["api/services/bars_fetch.py"], hits
