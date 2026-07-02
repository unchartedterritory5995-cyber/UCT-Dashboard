"""Shared helper to run a blocking yfinance (or similar) callable under a hard
wall-clock timeout so a hung upstream can't pin the caller's worker thread —
the 2026-07-01 thread-exhaustion class. Mirrors massive._bounded_yf but shared
across services (fundamentals, dividends_calendar, ...).
"""
import concurrent.futures as _cf

# Small dedicated pool: at most N yfinance calls can be "in flight/hung" at once;
# beyond that, submits queue and time out fast, returning the caller's fallback.
_POOL = _cf.ThreadPoolExecutor(max_workers=6, thread_name_prefix="yf-util")


def bounded_call(fn, default, timeout: float = 12.0):
    """Run `fn()` with a hard `timeout` (seconds). Returns `default` on timeout
    or any exception. The calling thread is freed even if `fn` hangs."""
    try:
        return _POOL.submit(fn).result(timeout=timeout)
    except Exception:
        return default
