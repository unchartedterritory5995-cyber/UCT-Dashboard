"""The web lifespan stops the cold-preload pool, so the bounded exit join does not wait on its idle workers.

Measured 2026-11-22 (the first swap after api/serve_dual.py's hard exit): the fixed pod logged
"[serve-dual] exiting with 4 non-daemon thread(s) still running after 5s: cold-preload_0, cold-preload_1,
cold-preload_2, cold-preload_3". A ThreadPoolExecutor's idle worker waits on its queue until interpreter
shutdown wakes it, and os._exit never reaches that, so every swap paid the whole 5 s budget.

Mutation proof (run before calling these done):
    1. shutdown() does nothing                         -> test_shutdown_lets_the_idle_workers_exit_at_once RED
    2. the lifespan does not call it                    -> test_the_lifespan_stops_the_pool_after_it_serves RED
"""
from __future__ import annotations

import ast
import pathlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait

from api.services.discord_render import cold_start_guard as guard

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _workers(prefix):
    return [t for t in threading.enumerate() if t.name.startswith(prefix)]


def test_shutdown_lets_the_idle_workers_exit_at_once(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cold-preload-test")
    monkeypatch.setattr(guard, "_executor", pool)
    wait([pool.submit(time.sleep, 0.05) for _ in range(4)])
    workers = _workers("cold-preload-test")
    assert workers and all(not t.daemon for t in workers)
    # control: idle, they do NOT exit on their own (this is what held the join)
    for t in workers:
        t.join(0.2)
    assert all(t.is_alive() for t in workers), "the control cannot tell: idle workers already exited"
    guard.shutdown()
    deadline = time.monotonic() + 3
    for t in workers:
        t.join(max(0.0, deadline - time.monotonic()))
    assert not [t.name for t in workers if t.is_alive()]


def test_the_lifespan_stops_the_pool_after_it_serves():
    """The call sits in the lifespan's shutdown half (after its one `yield`), and is the guard's own."""
    tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    life = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    yield_line = next(n.lineno for n in ast.walk(life) if isinstance(n, ast.Yield))
    aliases = {a.asname or a.name for n in ast.walk(life) if isinstance(n, ast.ImportFrom) and n.lineno > yield_line
               and n.module == "api.services.discord_render" for a in n.names if a.name == "cold_start_guard"}
    calls = [n for n in ast.walk(life) if isinstance(n, ast.Call) and n.lineno > yield_line
             and isinstance(n.func, ast.Attribute) and n.func.attr == "shutdown"
             and isinstance(n.func.value, ast.Name) and n.func.value.id in aliases]
    assert aliases and calls, "the lifespan's shutdown never stops the cold-preload pool"
