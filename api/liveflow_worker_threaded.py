"""
Live Flow worker runner — isolated thread, isolated event loop.

Wraps liveflow_worker.run_forever() in a dedicated daemon thread with its
own asyncio event loop. This isolates the long-running SSE consumer from
FastAPI's main event loop, so SSE reads can never block HTTP request handlers.
(The SSE stream itself now uses a bounded read timeout — see
LIVEFLOW_SSE_READ_TIMEOUT in liveflow_worker, default 90s — so a silently-dead
connection raises httpx.ReadTimeout and reconnects instead of hanging forever;
the old timeout=None behavior is gone.)

Why this exists: in the original setup, liveflow_worker.run_forever() was
scheduled directly on FastAPI's main loop via asyncio.create_task(). When
the httpx SSE stream entered a bad state, it starved the loop and every
HTTP request queued behind it. Symptoms: Cloudflare 524 timeouts, 19s
CSV loads on /options-flow. Disabled 2026-06-16, re-enabled with this
wrapper 2026-06-17.

Deploy survival (2026-07-06): stop() mirrors api/massive_ws_worker.stop() —
a root coroutine captures loop + task refs into _state at thread start;
stop() flips liveflow_worker._STOP (backup path), schedules a threadsafe
cancel on the root task (first call only — double-stop guarded), and joins
the thread with a bounded timeout. Cancellation propagates through
run_forever's `async with httpx.AsyncClient()` blocks so both clients close
cleanly, and Bullflow sees a clean disconnect inside Railway's drain window.

If perf regresses after re-enabling, wrap the `start()` call in main.py
inside `if False:` to disable and ping the dev channel.
"""
import asyncio
import logging
import threading

log = logging.getLogger(__name__)

# Cross-thread refs captured by _worker_root() at thread start; consumed by
# stop(). NOT JSON-serializable — never expose via a status endpoint.
_state = {
    "thread": None,          # threading.Thread
    "loop": None,            # asyncio loop running in the worker thread
    "root_task": None,       # root Task wrapping run_forever
    "stop_requested": False, # set by stop(); guards against double-cancel
}


async def _worker_root():
    """Root coroutine for the worker thread's event loop.

    Exists so stop() — called from ANOTHER thread (uvicorn's lifespan
    teardown) — has a Task handle to cancel and a loop to schedule the cancel
    on. Captures both into _state BEFORE the first await so the
    stop()-before-refs race window is microseconds.
    """
    _state["loop"] = asyncio.get_running_loop()
    _state["root_task"] = asyncio.current_task()
    try:
        from api import liveflow_worker
        await liveflow_worker.run_forever()
    except asyncio.CancelledError:
        # Terminal cancel from stop(). Swallow it HERE — not in run_forever,
        # which must re-raise so its `async with httpx.AsyncClient()` contexts
        # unwind and close both clients — so run_until_complete() returns
        # instead of dumping a CancelledError via threading.excepthook.
        log.info("[liveflow-thread] root task cancelled — graceful stop complete")
    finally:
        _state["loop"] = None
        _state["root_task"] = None


def _run_loop_in_thread() -> None:
    """Create a dedicated event loop in this thread and run the worker forever."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    log.info("[liveflow-thread] dedicated loop created; starting worker")

    try:
        loop.run_until_complete(_worker_root())
    except Exception:
        log.exception("[liveflow-thread] worker crashed; thread exiting")
    finally:
        # Cancel any pending tasks (e.g. in-flight _delayed_discord_forward
        # timers) so loop.close() doesn't warn.
        try:
            pending = asyncio.all_tasks(loop)
            for t in pending:
                t.cancel()
            loop.run_until_complete(
                asyncio.gather(*pending, return_exceptions=True)
            )
        except Exception:
            pass
        try:
            loop.close()
        except Exception:
            pass
        log.info("[liveflow-thread] loop closed")


def start() -> None:
    """Start the worker thread. Idempotent — no-op if already running."""
    t = _state.get("thread")
    if t is not None and t.is_alive():
        log.info("[liveflow-thread] already running; skipping start")
        return
    t = threading.Thread(
        target=_run_loop_in_thread,
        name="liveflow-worker",
        daemon=True,  # dies with the process even if stop() is never called
    )
    _state["thread"] = t
    t.start()
    log.info("[liveflow-thread] thread started (daemon)")


def stop(timeout: float = 5.0) -> bool:
    """Gracefully stop the SSE worker. Safe from any thread, any number of
    times, whether or not start() ever ran. Never raises.

    Sequence (mirrors api/massive_ws_worker.stop()):
      1. Flip liveflow_worker._STOP so run_forever's `while not _STOP` exits
         even if the cancel below is lost (e.g. thread hasn't registered
         loop/task refs yet). With the bounded SSE read timeout the flag-only
         path converges within ~read_timeout + backoff.
      2. call_soon_threadsafe(root_task.cancel) — FIRST call only. Lands
         CancelledError at the consumer's current await; run_forever re-raises
         so the `async with httpx.AsyncClient()` blocks unwind, closing the
         SSE + Discord clients (clean disconnect on Bullflow's side).
      3. join(timeout): bounded. On timeout we return False — the daemon
         thread finishes behind us inside the Railway drain window.
    """
    try:
        already_requested = _state.get("stop_requested", False)
        _state["stop_requested"] = True

        # Backup path: cooperative flag checked by run_forever's loop. Set it
        # even when the worker never started — a post-stop start() then exits
        # immediately instead of reconnecting during shutdown.
        try:
            from api import liveflow_worker
            liveflow_worker._STOP = True
        except Exception:
            pass

        t = _state.get("thread")
        if t is None or not t.is_alive():
            log.info("[liveflow-thread] stop(): worker not running — nothing to do")
            return True

        if not already_requested:
            loop = _state.get("loop")
            task = _state.get("root_task")
            if loop is not None and task is not None:
                try:
                    loop.call_soon_threadsafe(task.cancel)
                    log.info("[liveflow-thread] stop(): cancel scheduled on worker loop")
                except RuntimeError:
                    pass  # loop already closed — thread exiting on its own
            else:
                log.info(
                    "[liveflow-thread] stop(): no loop/task refs yet — relying "
                    "on _STOP flag"
                )
        # else: a second stop() must NOT cancel again — a second CancelledError
        # could land inside cleanup awaits (client aclose) and abort them.

        t.join(timeout)
        if t.is_alive():
            log.warning(
                "[liveflow-thread] stop(): thread still alive after %.1fs — "
                "daemon thread finishes during the remaining drain window",
                timeout,
            )
            return False
        log.info("[liveflow-thread] stop(): worker thread exited cleanly")
        return True
    except Exception:
        # stop() runs during lifespan shutdown — it must never take the
        # process down with it.
        log.exception("[liveflow-thread] stop() failed (swallowed)")
        return False


def is_running() -> bool:
    """True if the worker thread is currently alive."""
    t = _state.get("thread")
    return t is not None and t.is_alive()
