"""Web-pod event-loop wedge watchdog (competitive-roadmap audit finding B3).

WHY THIS EXISTS
---------------
The web service is ONE uvicorn process = ONE asyncio event loop shared by all
~200 users (the documented 2026-07-01 524-outage surface — see CLAUDE.md
"Performance & Scale" and
``docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md``).
If that loop *wedges* — a blocking call, a deadlock, threadpool exhaustion — the
whole site hangs and NOTHING auto-recovers: Railway only restarts a container on
process EXIT, and the existing monitors are Discord-alert-only. The graceful-stop
work added *deploy* survival; this adds *liveness* survival.

HOW IT WORKS
------------
A background **daemon thread** (NOT on the event loop, so it keeps running even
when the loop is wedged) captures the running loop at start and, every
``WATCHDOG_CHECK_SEC`` (default 5s), schedules a trivial probe onto the loop via
``loop.call_soon_threadsafe`` and measures how long until it runs — the loop's
responsiveness / lag. Consecutive misses are counted. If the loop fails to
service the probe for ``WATCHDOG_WEDGE_SEC`` (default 30s) across enough
consecutive checks, and the kill is armed, it declares a wedge and:

  1. best-effort Discord alert (``DISCORD_WEBHOOK_URL``) with last-lag telemetry;
  2. best-effort flush stdout + dump a stack trace of ALL threads to the logs
     (``faulthandler.dump_traceback``) so the post-mortem survives the restart;
  3. ``os._exit(1)`` — Railway restarts the container. With the deploy-survival
     graceful-stop drain this is clean-ish; a wedged loop can't do better anyway.

SAFETY — the default is observe-nothing, kill-nothing
-----------------------------------------------------
A false-positive force-exit during launch would be self-inflicted downtime, so:

  * ``WATCHDOG_ENABLED`` defaults to ``0`` — ships DARK. ``os._exit`` is NEVER
    called unless ``WATCHDOG_ENABLED=1``.
  * ``WATCHDOG_OBSERVE`` is a hard override: when set it MEASURES and exposes lag
    but never exits (even if ENABLED is also set). Use it to gather a lag
    baseline before arming.
  * With both flags off (the default) the measuring thread does not even start.
  * The wedge threshold is generous — ``WATCHDOG_WEDGE_SEC`` of TOTAL
    unresponsiveness AND multiple consecutive missed probes (``should_kill``).

ARMING RUNBOOK (dark -> observe -> arm)
---------------------------------------
  1. Deploy DARK. Both flags unset. The router mounts; the thread does not run.
  2. Set ``WATCHDOG_OBSERVE=1`` and redeploy. Watch
     ``GET /api/watchdog/status`` -> ``max_lag_ms`` for a few days across
     market-open, deploys, and heavy jobs. Nothing can exit in this mode.
  3. Once you know the real ceiling, set ``WATCHDOG_WEDGE_SEC`` comfortably above
     the observed ``max_lag_ms`` (e.g. 3-5x), set ``WATCHDOG_ENABLED=1``, and
     UNSET ``WATCHDOG_OBSERVE`` (observe overrides the kill). Redeploy. The
     watchdog is now armed. Rollback = unset ``WATCHDOG_ENABLED`` (no rebuild).
"""

from __future__ import annotations

import asyncio
import math
import os
import threading
import time

# ---------------------------------------------------------------------------
# Config defaults (all env-overridable)
# ---------------------------------------------------------------------------
DEFAULT_CHECK_SEC = 5.0   # WATCHDOG_CHECK_SEC — probe cadence
DEFAULT_WEDGE_SEC = 30.0  # WATCHDOG_WEDGE_SEC — total unresponsiveness before a kill


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "0") == "1"


def _env_float(name: str, default: float) -> float:
    try:
        v = float(os.environ.get(name, "") or default)
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Pure wedge-decision function (heavily unit-tested — no side effects)
# ---------------------------------------------------------------------------
def should_kill(missed_streak: int, lag_ms: float, wedge_sec: float,
                check_sec: float, enabled: bool, observe: bool) -> bool:
    """Decide whether a wedge warrants a force-restart. PURE — no I/O.

    A kill requires ALL of:
      * ``enabled`` is True  (WATCHDOG_ENABLED — the master arm),
      * ``observe`` is False (WATCHDOG_OBSERVE is a hard no-kill override),
      * the loop has missed at least ``ceil(wedge_sec / check_sec)`` (floor 2)
        CONSECUTIVE probes — i.e. sustained unresponsiveness, not one blip,
      * the current probe lag is at least ``wedge_sec`` of wall time.

    Both the consecutive-miss count and the raw lag must clear the bar so a
    single slow GC pause or a fast-recovering flap can never trip the exit.
    """
    if not enabled or observe:
        return False
    if wedge_sec <= 0 or check_sec <= 0:
        return False
    min_consecutive = max(2, math.ceil(wedge_sec / check_sec))
    if missed_streak < min_consecutive:
        return False
    return lag_ms >= wedge_sec * 1000.0


# ---------------------------------------------------------------------------
# Module state (guarded by _lock)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_stop_event = threading.Event()
_thread: threading.Thread | None = None
_started = False
_loop: asyncio.AbstractEventLoop | None = None


def _fresh_state() -> dict:
    return {
        "last_lag_ms": 0.0,
        "max_lag_ms": 0.0,
        "checks": 0,
        "missed_streak": 0,
        "last_ok_monotonic": None,
        "last_checked_at": None,   # epoch seconds
        "started_at": None,        # epoch seconds
        "running": False,
        "enabled": False,
        "observe_only": False,
        "check_sec": DEFAULT_CHECK_SEC,
        "wedge_sec": DEFAULT_WEDGE_SEC,
    }


_state = _fresh_state()


# ---------------------------------------------------------------------------
# Status accessor + FastAPI router
# ---------------------------------------------------------------------------
def get_status() -> dict:
    """Read-only snapshot of the watchdog's telemetry. Never raises."""
    with _lock:
        s = dict(_state)
    return {
        "enabled": s["enabled"],
        "observe_only": s["observe_only"],
        "running": s["running"],
        "last_lag_ms": round(s["last_lag_ms"], 1),
        "max_lag_ms": round(s["max_lag_ms"], 1),
        "checks": s["checks"],
        "missed_streak": s["missed_streak"],
        "started_at": s["started_at"],
        "check_sec": s["check_sec"],
        "wedge_sec": s["wedge_sec"],
        "last_checked_at": s["last_checked_at"],
    }


try:  # keep the core importable even where FastAPI is absent (pure-logic tests)
    from fastapi import APIRouter

    router = APIRouter(prefix="/api/watchdog", tags=["watchdog"])

    @router.get("/status")
    def watchdog_status():  # no auth — read-only telemetry
        return get_status()
except Exception:  # pragma: no cover - fastapi always present in the app
    router = None


# ---------------------------------------------------------------------------
# Wedge action: alert + thread dump + hard exit
# ---------------------------------------------------------------------------
def _post_discord(webhook: str, content: str) -> bool:
    """Best-effort Discord webhook post. Never raises. (Mirrors worker_main.)"""
    try:
        import json as _json
        import urllib.request as _u
        data = _json.dumps({"content": content[:1900]}).encode()
        req = _u.Request(webhook, data=data,
                         headers={"Content-Type": "application/json",
                                  "User-Agent": "uct-loop-watchdog/1"})
        with _u.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[watchdog] Discord post failed: {type(e).__name__}: {e}",
              flush=True)
        return False


def _dump_all_threads() -> None:
    """Dump every thread's stack to the logs so the wedge post-mortem survives."""
    import sys
    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        sys.stderr.flush()
    except Exception:
        pass
    try:
        import faulthandler
        faulthandler.dump_traceback(all_threads=True)
    except Exception:
        # Fallback: format each thread's current frame by hand.
        try:
            import sys as _sys
            import traceback as _tb
            for tid, frame in _sys._current_frames().items():
                print(f"\n[watchdog] --- thread {tid} ---", flush=True)
                print("".join(_tb.format_stack(frame)), flush=True)
        except Exception:
            pass


def _trigger_wedge(lag_ms: float, missed: int, wedge_sec: float,
                   webhook: str | None) -> None:
    """Alert, dump all threads, then os._exit(1). Best-effort up to the exit."""
    secs = lag_ms / 1000.0
    msg = (f"\U0001F534 web event loop WEDGED — unresponsive ~{secs:.0f}s "
           f"({missed} consecutive missed probes, threshold {wedge_sec:.0f}s). "
           f"Force-restarting the container via os._exit so Railway swaps in a "
           f"fresh process. last_lag={lag_ms:.0f}ms")
    try:
        print(f"[watchdog] {msg}", flush=True)
    except Exception:
        pass
    if webhook:
        _post_discord(webhook, msg)
    _dump_all_threads()
    # Hard exit — referenced as os._exit so tests can monkeypatch it.
    os._exit(1)


# ---------------------------------------------------------------------------
# The measuring loop (runs on the daemon thread)
# ---------------------------------------------------------------------------
def _probe_ran(sched_monotonic: float, evt: threading.Event) -> None:
    """Runs ON the event loop. Records how long the probe took to be serviced."""
    run_monotonic = time.monotonic()
    lag_ms = (run_monotonic - sched_monotonic) * 1000.0
    with _lock:
        _state["last_lag_ms"] = lag_ms
        if lag_ms > _state["max_lag_ms"]:
            _state["max_lag_ms"] = lag_ms
        _state["checks"] += 1
        _state["missed_streak"] = 0
        _state["last_ok_monotonic"] = run_monotonic
        _state["last_checked_at"] = time.time()
    evt.set()


def _run(check_sec: float, wedge_sec: float, enabled: bool, observe: bool,
         webhook: str | None) -> None:
    loop = _loop
    if loop is None:
        return
    outstanding = False
    sched_monotonic = 0.0
    evt: threading.Event | None = None

    while not _stop_event.is_set():
        if not outstanding:
            sched_monotonic = time.monotonic()
            evt = threading.Event()
            try:
                loop.call_soon_threadsafe(_probe_ran, sched_monotonic, evt)
            except RuntimeError:
                # Loop is closed/closing (normal at shutdown) — stop measuring.
                break
            outstanding = True

        # Wait up to one interval for the probe to be serviced.
        if evt is not None and evt.wait(timeout=check_sec):
            # Serviced — a healthy check. missed_streak already reset in probe.
            outstanding = False
            # Hold a steady cadence: sleep whatever's left of this interval.
            remaining = check_sec - (time.monotonic() - sched_monotonic)
            if remaining > 0:
                _stop_event.wait(timeout=remaining)
            continue

        # Not serviced within the interval → a miss. Keep the SAME probe queued
        # (it will fire when the loop recovers) and accumulate unresponsiveness.
        now = time.monotonic()
        current_lag_ms = (now - sched_monotonic) * 1000.0
        with _lock:
            _state["missed_streak"] += 1
            missed = _state["missed_streak"]
            _state["last_lag_ms"] = current_lag_ms
            if current_lag_ms > _state["max_lag_ms"]:
                _state["max_lag_ms"] = current_lag_ms
            _state["last_checked_at"] = time.time()

        if should_kill(missed, current_lag_ms, wedge_sec, check_sec,
                       enabled, observe):
            _trigger_wedge(current_lag_ms, missed, wedge_sec, webhook)
            return  # os._exit already fired (unless monkeypatched in tests)

    with _lock:
        _state["running"] = False


# ---------------------------------------------------------------------------
# Public lifecycle
# ---------------------------------------------------------------------------
def start_watchdog(loop: asyncio.AbstractEventLoop | None = None) -> bool:
    """Start the watchdog. Call from the FastAPI lifespan STARTUP.

    Captures the running loop (``asyncio.get_running_loop()`` when ``loop`` is
    not passed). Idempotent, never raises, returns True iff the measuring thread
    is running afterward. With both ``WATCHDOG_ENABLED`` and ``WATCHDOG_OBSERVE``
    off (the default) it starts nothing and returns False.
    """
    global _thread, _started, _loop
    try:
        enabled = _env_flag("WATCHDOG_ENABLED")
        observe = _env_flag("WATCHDOG_OBSERVE")
        check_sec = _env_float("WATCHDOG_CHECK_SEC", DEFAULT_CHECK_SEC)
        wedge_sec = _env_float("WATCHDOG_WEDGE_SEC", DEFAULT_WEDGE_SEC)

        with _lock:
            _state["enabled"] = enabled
            _state["observe_only"] = observe
            _state["check_sec"] = check_sec
            _state["wedge_sec"] = wedge_sec

        if not (enabled or observe):
            print("[watchdog] dark — WATCHDOG_ENABLED and WATCHDOG_OBSERVE both "
                  "off; not starting (set WATCHDOG_OBSERVE=1 to gather a "
                  "lag baseline).", flush=True)
            return False

        # Idempotent: a live thread stays.
        if _started and _thread is not None and _thread.is_alive():
            return True

        if loop is None:
            loop = asyncio.get_running_loop()
        _loop = loop

        _stop_event.clear()
        with _lock:
            _state["missed_streak"] = 0
            _state["checks"] = 0
            _state["last_lag_ms"] = 0.0
            _state["max_lag_ms"] = 0.0
            _state["last_ok_monotonic"] = time.monotonic()
            _state["started_at"] = time.time()
            _state["running"] = True

        webhook = os.environ.get("DISCORD_WEBHOOK_URL")
        _thread = threading.Thread(
            target=_run,
            args=(check_sec, wedge_sec, enabled, observe, webhook),
            name="event-loop-watchdog",
            daemon=True,
        )
        _started = True
        _thread.start()
        mode = "ARMED (will os._exit on wedge)" if (enabled and not observe) \
            else "observe-only (no kill)"
        print(f"[watchdog] started — {mode}; check={check_sec:.1f}s "
              f"wedge={wedge_sec:.1f}s", flush=True)
        return True
    except Exception as e:  # noqa: BLE001 — never break boot
        print(f"[watchdog] start failed (non-fatal): {type(e).__name__}: {e}",
              flush=True)
        return False


def stop_watchdog(timeout: float = 2.0) -> None:
    """Signal the thread to stop and join it. Idempotent, never raises."""
    global _thread, _started
    try:
        _stop_event.set()
        t = _thread
        if t is not None and t.is_alive():
            t.join(timeout=timeout)
        with _lock:
            _state["running"] = False
        _thread = None
        _started = False
        _stop_event.clear()
    except Exception:
        pass


def _reset_for_tests() -> None:
    """Test hook: stop the thread and reset all module state."""
    global _loop
    stop_watchdog(timeout=2.0)
    _loop = None
    with _lock:
        _state.clear()
        _state.update(_fresh_state())
