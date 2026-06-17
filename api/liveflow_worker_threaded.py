"""
Live Flow worker runner — isolated thread, isolated event loop.

Wraps liveflow_worker.run_forever() in a dedicated daemon thread with its
own asyncio event loop. This isolates the long-running SSE consumer
(httpx with timeout=None) from FastAPI's main event loop, so SSE reads
can never block HTTP request handlers.

Why this exists: in the original setup, liveflow_worker.run_forever() was
scheduled directly on FastAPI's main loop via asyncio.create_task(). When
the httpx SSE stream entered a bad state, it starved the loop and every
HTTP request queued behind it. Symptoms: Cloudflare 524 timeouts, 19s
CSV loads on /options-flow. Disabled 2026-06-16, re-enabled with this
wrapper 2026-06-17.

If perf regresses after re-enabling, wrap the `start()` call in main.py
inside `if False:` to disable and ping the dev channel.
"""
import asyncio
import logging
import threading
from typing import Optional

log = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None
_loop: Optional[asyncio.AbstractEventLoop] = None


def _run_loop_in_thread() -> None:
    """Create a dedicated event loop in this thread and run the worker forever."""
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    log.info("[liveflow-thread] dedicated loop created; starting worker")

    try:
        from api import liveflow_worker
        _loop.run_until_complete(liveflow_worker.run_forever())
    except Exception:
        log.exception("[liveflow-thread] worker crashed; thread exiting")
    finally:
        # Cancel any pending tasks so loop.close() doesn't warn
        try:
            pending = asyncio.all_tasks(_loop)
            for t in pending:
                t.cancel()
            _loop.run_until_complete(
                asyncio.gather(*pending, return_exceptions=True)
            )
        except Exception:
            pass
        try:
            _loop.close()
        except Exception:
            pass
        log.info("[liveflow-thread] loop closed")


def start() -> None:
    """Start the worker thread. Idempotent — no-op if already running."""
    global _thread
    if _thread is not None and _thread.is_alive():
        log.info("[liveflow-thread] already running; skipping start")
        return
    _thread = threading.Thread(
        target=_run_loop_in_thread,
        name="liveflow-worker",
        daemon=True,  # dies with the process; no shutdown hook needed
    )
    _thread.start()
    log.info("[liveflow-thread] thread started (daemon)")


def is_running() -> bool:
    """True if the worker thread is currently alive."""
    return _thread is not None and _thread.is_alive()
