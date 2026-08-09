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

⚠️ 2026-08-08 — THIS MODULE NO LONGER OWNS A POOL. It is a thin, raise-semantics
adapter over ``yf_util.bounded_call``, which owns the one pool, the one
deadline, and the one rate-limit breaker for the whole process. It kept its own
8-wide ``ThreadPoolExecutor`` until then, which meant a 429 seen here did not
back off the calls going through ``yf_util`` (or ``massive._bounded_yf``, or
the fully-unguarded function-local imports) and vice-versa — three pools, no
shared knowledge of an upstream that had started refusing us. The public
surface (``fetch_history`` / ``run_in_pool`` / ``pool_status``, all raising
``concurrent.futures.TimeoutError`` on deadline) is unchanged, and every caller
of the two raising functions catches broad ``Exception``.

See: docs/superpowers/specs/2026-05-05-phase-2-async-bars-router-design.md §8
"""
from __future__ import annotations

import logging
import os
from typing import Any

from api.services import yf_util

_logger = logging.getLogger(__name__)

# Kept for back-compat: `yf_util` reads YFINANCE_POOL_WORKERS as a fallback for
# YF_POOL_WORKERS, so an operator's existing env still sizes the pool.
_MAX_WORKERS = int(os.environ.get("YFINANCE_POOL_WORKERS", "8"))

# Default per-call deadline. 8s comfortably covers 95th-percentile yfinance
# responses observed in prod logs (median ~600ms, p95 ~3s); past 8s we
# almost always see a hung connection and prefer to fail fast and let the
# fetch path's own fallback chain (Massive → FMP → yfinance) try the next
# source. Override per-call via the ``timeout`` kwarg.
_DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("YFINANCE_TIMEOUT_SECONDS", "8.0"))


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

    try:
        # `_do_fetch` is handed to the guard, so the AST census sees this
        # yfinance reach as guarded by construction — no alias needed.
        return yf_util.bounded_call(_do_fetch, None, timeout=deadline, reraise=True)
    except Exception as exc:
        # A timed-out future is NOT cancelled — yfinance's underlying socket
        # call can't be interrupted from another thread, so cancel() returns
        # False and the work continues until its own timeout fires. Letting it
        # finish naturally (vs leaking) keeps the pool slot reusable.
        #
        # A suppressed call (breaker open) raises YFRateLimitError and is
        # logged here at debug, not warning: the whole point of the breaker is
        # that a rate-limited provider stops flooding the log.
        if yf_util.is_rate_limit_error(exc):
            _logger.debug("[yfinance-pool] %s suppressed — yfinance rate-limited", ticker)
        else:
            _logger.warning(
                "[yfinance-pool] %s %s failed within %ss (%s) — abandoning result",
                ticker, history_kwargs, deadline, type(exc).__name__,
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
    try:
        return yf_util.bounded_call(fn, None, timeout=deadline, reraise=True)
    except Exception as exc:
        if yf_util.is_rate_limit_error(exc):
            _logger.debug("[yfinance-pool] pooled call suppressed — yfinance rate-limited")
        else:
            _logger.warning(
                "[yfinance-pool] pooled call failed within %ss (%s) — abandoning result",
                deadline, type(exc).__name__,
            )
        raise


def pool_status() -> dict:
    """Return current pool state for diagnostic / health endpoint use.

    Reads the SHARED guard (`yf_util`) — this module no longer owns a pool.
    Carries the breaker fields too, so an operator looking at "the yfinance
    pool" can see that calls are being suppressed rather than hanging."""
    status = dict(yf_util.guard_status())
    status["default_timeout_seconds"] = _DEFAULT_TIMEOUT_SECONDS
    return status
