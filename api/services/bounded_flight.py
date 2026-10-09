"""Run slow provider work OFF the request thread, wait a bounded time, never twice.

Wave-2 audit 2026-10-08: the TRAN panel's cold open measured ~17 s. The transcript
read is a chain of provider calls on the request thread -- FMP's quarter index
(10 s timeout) then the body (10 s), and on an FMP miss up to four AlphaVantage
probes (15 s each). Each call is bounded; the CHAIN was not, and it held one of the
pod's 64 shared anyio workers the whole time (CLAUDE.md "Performance & Scale").

`run(key, fn, budget)` submits `fn` to a small dedicated pool, keyed so concurrent
callers for the same key share ONE in-flight job, and waits at most `budget`
seconds. Past the budget it raises `Pending`; the job is NOT cancelled -- it keeps
running and the provider services cache what it finds, so the caller's next ask
(a 503 + Retry-After the client re-polls, or a "generating" status) is a cache hit
or joins the same job instead of starting a second chain.
"""
from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as _FutTimeout
from typing import Any, Callable, Dict

_POOL: ThreadPoolExecutor | None = None
_MU = threading.RLock()   # re-entrant: add_done_callback can fire inline under it
_INFLIGHT: Dict[str, Future] = {}
_MAX_WORKERS = 8


class Pending(TimeoutError):
    """The job is still running past the caller's budget; ask again shortly."""


def _pool() -> ThreadPoolExecutor:
    global _POOL
    if _POOL is None:
        with _MU:
            if _POOL is None:
                _POOL = ThreadPoolExecutor(max_workers=_MAX_WORKERS,
                                           thread_name_prefix="bounded-flight")
    return _POOL


def _forget(key: str, fut: Future) -> None:
    with _MU:
        if _INFLIGHT.get(key) is fut:
            _INFLIGHT.pop(key, None)


def run(key: str, fn: Callable[[], Any], budget: float) -> Any:
    """`fn()`'s value (or its exception) if it finishes within `budget` seconds;
    otherwise raise `Pending` and leave the job running for the next ask."""
    with _MU:
        fut = _INFLIGHT.get(key)
        if fut is None:
            fut = _pool().submit(fn)
            _INFLIGHT[key] = fut
            fut.add_done_callback(lambda f, k=key: _forget(k, f))
    try:
        return fut.result(timeout=max(0.0, float(budget)))
    except _FutTimeout:
        raise Pending(key) from None


def inflight(key: str) -> bool:
    with _MU:
        return key in _INFLIGHT
