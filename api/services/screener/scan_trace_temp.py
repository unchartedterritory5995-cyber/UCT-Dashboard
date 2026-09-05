"""TEMPORARY diagnostic instrumentation for the Package 8G-B scanner-serving
investigation (owner-authorized, 2026-09-05). Measures where wall-clock
time goes for a real `POST /api/screener/scan` request in production, to
distinguish "waiting before the handler runs" from "computing inside it".

Logs ONLY when total observed latency exceeds SLOW_THRESHOLD_MS. No user
data, no auth/session details, no request or response bodies, no secrets.

⛔ NOT A PERMANENT OBSERVABILITY SYSTEM. Remove this file and its two call
sites (`api/main.py`'s middleware registration, `api/routers/screener.py`'s
`screener_scan`) in one revert commit once production trace evidence has
been collected. See branch `fix/8gb-scanner-trace-instrumentation`.

What this CAN distinguish: `pre_route_ms` (everything between ASGI ingress
and the route body's first line -- middleware ordering, FastAPI routing,
Pydantic body validation, the `require_paid`/auth dependency chain, AND any
threadpool dispatch/queueing wait, all bundled as ONE number) vs
`run_scan_ms` (the actual `query.run_scan` call) vs `post_scan_ms`
(building the return value + FastAPI's response validation/serialization +
this middleware's own overhead capturing it).

What this CANNOT distinguish, by design (avoiding broader/riskier changes
to a dependency shared by many other routers): auth-DB-lookup time
specifically, vs Pydantic parsing time specifically, vs pure threadpool
queue-wait time specifically -- all three live inside `pre_route_ms`
together. State that limitation in the final report; do not overclaim.
"""
import logging
import os
import threading
import time

logger = logging.getLogger("scanner.trace_temp")

SLOW_THRESHOLD_MS = 300.0
_BOOT_MONO = time.monotonic()


def record(request, t_route_entry: float, t_before_scan: float,
           t_after_scan: float, rows_returned) -> None:
    """Call once, right before returning from `screener_scan`. Never raises
    into the caller -- diagnostics must not be able to break a real request."""
    try:
        t_ingress = getattr(request.state, "t_ingress", None)
        if t_ingress is None:
            return
        now = time.perf_counter()
        total_ms = (now - t_ingress) * 1000
        if total_ms < SLOW_THRESHOLD_MS:
            return
        logger.warning(
            "[scan-trace] total_ms=%.1f pre_route_ms=%.1f run_scan_ms=%.1f "
            "post_scan_ms=%.1f rows=%s pid=%s thread_id=%s active_threads=%d "
            "git_sha=%s process_uptime_s=%.0f",
            total_ms,
            (t_route_entry - t_ingress) * 1000,
            (t_after_scan - t_before_scan) * 1000,
            (now - t_after_scan) * 1000,
            rows_returned,
            os.getpid(), threading.get_ident(), threading.active_count(),
            os.environ.get("RAILWAY_GIT_COMMIT_SHA", "")[:8],
            time.monotonic() - _BOOT_MONO,
        )
    except Exception:
        pass
