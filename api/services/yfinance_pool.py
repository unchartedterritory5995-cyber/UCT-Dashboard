"""Bounded thread pool + hard timeout for yfinance calls.

yfinance's ``Ticker.history()`` uses ``requests`` under the hood with
generous default timeouts. Under upstream slowness or transient hangs,
a single call can block its calling thread for minutes. Without bounds,
that means:

  - The anyio worker thread serving the request stays held indefinitely
  - With anyio's pool tuned to 64, 64 hung yfinance calls saturate FastAPI
  - Cold-cache requests then queue, p99 grows unbounded

This module wraps every yfinance history call in a bounded
``ThreadPoolExecutor(max_workers=8)`` with a per-call ``Future.result(timeout=N)``.
The caller-perceived deadline is enforced regardless of what yfinance is
doing internally; even if leaked threads accumulate they are bounded at
``_MAX_WORKERS`` total.

This is Phase 2A — a defensive precursor to the full Phase 2 async refactor.
The full Phase 2 wraps this module in ``asyncio.to_thread`` from the async
handler layer; the bounded pool stays as the inner safety net.

See: docs/superpowers/specs/2026-05-05-phase-2-async-bars-router-design.md §8
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutureTimeout
from typing import Any

_logger = logging.getLogger(__name__)

# Tunable via env so an operator can widen the pool without a redeploy.
# Default 8 matches the strategic doc's recommendation; observed yfinance
# burst concurrency in production is typically <5, so 8 leaves headroom.
_MAX_WORKERS = int(os.environ.get("YFINANCE_POOL_WORKERS", "8"))

# Default per-call deadline. 8s comfortably covers 95th-percentile yfinance
# responses observed in prod logs (median ~600ms, p95 ~3s); past 8s we
# almost always see a hung connection and prefer to fail fast and let the
# fetch path's own fallback chain (Massive → FMP → yfinance) try the next
# source. Override per-call via the ``timeout`` kwarg.
_DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("YFINANCE_TIMEOUT_SECONDS", "8.0"))

# Module-level pool: shared across all callers in this process. Threads
# are reused across calls, so worst-case live threads = _MAX_WORKERS even
# under sustained load. The "leaked-on-timeout" thread continues running
# the underlying yfinance call until the OS-level socket timeout finishes
# it; the pool just doesn't accept new work past _MAX_WORKERS until at
# least one slot frees up.
_pool = ThreadPoolExecutor(
    max_workers=_MAX_WORKERS,
    thread_name_prefix="yf-pool",
)


def fetch_history(ticker: str, *, timeout: float | None = None, **history_kwargs: Any):
    """Run ``yfinance.Ticker(ticker).history(**history_kwargs)`` on the
    bounded pool with a hard caller-side timeout.

    Returns the resulting DataFrame on success. Raises
    ``concurrent.futures.TimeoutError`` if the call exceeds the deadline,
    which callers should treat the same as "yfinance returned empty"
    (i.e. fall through to the next source in the fetch chain).

    Why a per-call timeout instead of relying on yfinance's request-level
    timeout: yfinance's ``Ticker.history()`` performs multiple downstream
    requests (info, quotes, earnings dates) and a hung request anywhere
    in that chain holds the calling thread. The Future-level timeout is
    the only reliable upper bound on caller wait time.
    """
    deadline = timeout if timeout is not None else _DEFAULT_TIMEOUT_SECONDS

    def _do_fetch():
        # Late import so test code that monkey-patches yfinance does not
        # need to reach across module boundaries — patch on the api.services
        # path and we'll pick it up here.
        import yfinance as yf
        return yf.Ticker(ticker).history(**history_kwargs)

    fut = _pool.submit(_do_fetch)
    try:
        return fut.result(timeout=deadline)
    except _FutureTimeout:
        # Don't cancel the future — yfinance's underlying socket call can't
        # be interrupted from another thread, so cancel() returns False and
        # the work continues until its own timeout fires. Letting it finish
        # naturally (vs leaking) keeps the pool slot reusable.
        _logger.warning(
            f"[yfinance-pool] {ticker} {history_kwargs} exceeded {deadline}s — abandoning result"
        )
        raise


def run_in_pool(fn, *, timeout: float | None = None):
    """Run an arbitrary yfinance-touching callable on the bounded pool with a
    hard caller-side timeout — same discipline as ``fetch_history`` but for
    non-history calls (financial statements, ``.info``, etc.).

    Raises ``concurrent.futures.TimeoutError`` on deadline; callers should
    treat that as "no data, fall through" exactly like an empty result.
    """
    deadline = timeout if timeout is not None else _DEFAULT_TIMEOUT_SECONDS
    fut = _pool.submit(fn)
    try:
        return fut.result(timeout=deadline)
    except _FutureTimeout:
        _logger.warning(f"[yfinance-pool] pooled call exceeded {deadline}s — abandoning result")
        raise


def pool_status() -> dict:
    """Return current pool state for diagnostic / health endpoint use."""
    return {
        "max_workers": _MAX_WORKERS,
        "default_timeout_seconds": _DEFAULT_TIMEOUT_SECONDS,
        # Internal attrs of ThreadPoolExecutor — best-effort, may break across
        # Python versions. Wrapped in a try so a CPython internal change
        # never crashes a health request.
        "active_threads": _try_attr("_threads", 0),
        "queued_work": _try_attr("_work_queue", None),
    }


def _try_attr(name: str, default):
    try:
        v = getattr(_pool, name)
        if hasattr(v, "qsize"):
            return v.qsize()
        if hasattr(v, "__len__"):
            return len(v)
        return v
    except Exception:
        return default
