"""R63(c) AMENDED — cold loads never run on the event loop, and nothing gates the swap.

⛔⛔ THE FIRST DESIGN FOR THIS WAS WRONG, AND THE REASON IS R68'S REASON ONE LAYER DOWN.
The original R63(c) was "a two-list preload barrier gated on the readiness endpoint" —
hold traffic until every cold path is warm. R68 found that gating RAILWAY's healthcheck on
readiness caused a real outage (2026-07-26, `650865d5`): the platform does not keep an old
pod serving while a new one waits to become ready, so a wait-until-warm gate turns "slow
first load" into "nothing answers at all". A barrier *inside the app*, in front of every
request, reproduces the identical shape one layer down — the pod is reachable, but every
request queues behind the barrier until warm, which is unresponsive-until-warm from a
member's chair. Same failure, moved, not removed.

⭐ THE FIX THAT DOES NOT HAVE THAT SHAPE AVAILABLE: preload runs in a background thread
started at boot, so almost every request simply arrives after preload is done and pays
nothing. The rare request that races ahead of ONE resource's preload does not wait behind
a gate for ALL resources — it `await`s that ONE resource's own future. Waiting on a
`concurrent.futures.Future` via `asyncio.wrap_future` yields the event loop back to every
OTHER coroutine while it waits, so a slow resource costs the requests that need it, and
costs nothing else. There is no point where the whole app is unresponsive, at boot or ever.

DESIGN
------
* `register(name, loader)` — declare a resource. `loader` is a zero-arg callable that
  computes and returns the value; it runs EXACTLY ONCE, ever, on the shared preload
  executor, never on the caller's thread.
* `start_boot_preload()` — call once, at startup, off the event loop (a `threading.Thread`,
  matching `_start_dashboard_warm_background`'s idiom). Submits every registered loader to
  the executor immediately; does not wait for them.
* `await get_async(name)` — the ONLY way an `async def` handler may read a registered
  resource. Returns immediately if already warm. If not yet warm, awaits the SAME future
  the boot thread is filling — never a second, redundant load, and never a synchronous
  call on the loop.
* `get_sync(name, timeout=None)` — for a handler already off the loop (a threadpool job,
  a background task). Blocks that thread only, which is what such threads are for.
* A resource asked for before ANYONE has called `register` — or before `start_boot_preload`
  has run — is not an error and does not silently do nothing: `get_async`/`get_sync`
  self-heal by submitting the loader themselves, ONCE, guarded by a lock, still on the
  executor, never inline. Preload is a head start, not a precondition for correctness — a
  resource must become available even if the boot thread was skipped, delayed, or raced.

⛔ NEVER RAISES INTO A CALLER'S HAPPY PATH FOR A LOADER THAT RAISES. The loader's exception
is captured on the future and re-raised to whoever awaits/reads it (never swallowed — a
caller needs to know its data is missing), but a raising loader never kills the preload
thread or blocks any OTHER resource's load.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import threading
from typing import Callable

logger = logging.getLogger(__name__)

#: Bounded and named, matching commands.py's `_symbol_pool`/`_io_pool` idiom. Preload work is
#: bursty at boot and near-idle after — a small pool is enough, and an unbounded one would let
#: one runaway loader look like N concurrent ones.
_MAX_PRELOAD_WORKERS = 4
_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=_MAX_PRELOAD_WORKERS, thread_name_prefix="cold-preload")

_lock = threading.Lock()
_loaders: dict[str, Callable[[], object]] = {}
_futures: dict[str, concurrent.futures.Future] = {}
_preload_started = False


def register(name: str, loader: Callable[[], object]) -> None:
    """Declare a resource. Idempotent by name — registering the same name twice with an
    identical loader is a no-op; registering it with a DIFFERENT loader is a programming
    error (two authorities over one resource), and raises rather than silently picking one."""
    with _lock:
        existing = _loaders.get(name)
        if existing is not None and existing is not loader:
            raise ValueError(
                f"cold_start_guard: {name!r} is already registered with a different loader — "
                "two authorities over one resource; register it once, in one place")
        _loaders[name] = loader


def registered_names() -> tuple[str, ...]:
    """For a self-check to enumerate what this guard knows about."""
    with _lock:
        return tuple(_loaders)


def _ensure_submitted(name: str) -> "concurrent.futures.Future | None":
    """Start `name`'s load on the executor if it has not started yet. Returns the future, or
    None if `name` was never registered (the caller decides what that means)."""
    with _lock:
        fut = _futures.get(name)
        if fut is not None:
            return fut
        loader = _loaders.get(name)
        if loader is None:
            return None
        fut = _executor.submit(_run_one, name, loader)
        _futures[name] = fut
        return fut


def _run_one(name: str, loader: Callable[[], object]) -> object:
    try:
        return loader()
    except Exception:
        # ⛔ Logged, not swallowed — swallowed here would be `lesson_a_swallowed_error_becomes_
        # a_confident_finding` one module over: the future re-raises this to every awaiter, so
        # the caller sees it too; this line is so the FIRST failure is visible in the log even
        # if nothing ever awaits this particular resource.
        logger.exception("[cold-start-guard] preload of %r failed", name)
        raise


def start_boot_preload() -> int:
    """Fire every currently-registered loader on the executor. Call ONCE, at startup, off the
    event loop. Returns how many were submitted (0 is not an error — nothing may be
    registered yet in a given process shape, e.g. a worker that never imports the render
    package). Safe to call again later: already-submitted names are left alone."""
    global _preload_started
    with _lock:
        _preload_started = True
        names = tuple(_loaders)
    started = 0
    for name in names:
        if _ensure_submitted(name) is not None:
            started += 1
    return started


def is_warm(name: str) -> bool:
    with _lock:
        fut = _futures.get(name)
    return fut is not None and fut.done()


async def get_async(name: str):
    """The ONLY sanctioned way for an `async def` handler to read a registered resource.

    ⛔⛔ NEVER `fut.result()` HERE WITHOUT THE `await`. `Future.result()` blocks the calling
    thread until done — called directly on the event loop thread, that IS the outage-shaped
    bug this module exists to remove, just spelled differently. `asyncio.wrap_future` is what
    turns a thread-executor future into something `await` can yield on, handing control back
    to every other coroutine on this loop while it waits."""
    fut = _ensure_submitted(name)
    if fut is None:
        raise KeyError(f"cold_start_guard: {name!r} was never registered")
    if fut.done():
        return fut.result()
    return await asyncio.wrap_future(fut)


def get_sync(name: str, *, timeout: "float | None" = None):
    """For a caller already off the event loop (a threadpool job, a background task). Blocks
    the CALLING thread only — that is what such a thread is for."""
    fut = _ensure_submitted(name)
    if fut is None:
        raise KeyError(f"cold_start_guard: {name!r} was never registered")
    return fut.result(timeout=timeout)


def _reset_for_tests() -> None:
    """Test-only. A module-level registry surviving between tests would let one test's
    registration leak into another's assertions about what IS registered."""
    global _preload_started
    with _lock:
        _loaders.clear()
        _futures.clear()
        _preload_started = False
