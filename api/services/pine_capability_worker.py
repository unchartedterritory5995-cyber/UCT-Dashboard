"""U5 (2026-11-14) -- the capability DETECTOR in its own process, off the request GIL.

`pine_capabilities.capabilities_of` is linear and bounded (review B1), but it is Python `re`
plus the repaint classifier's lexer: 0.2-0.6 s on an adversarial near-128 KiB source, and every
millisecond of it HOLDS THE GIL. The web pod is ONE uvicorn process, so while a list request ran
the detector, every other request thread in the pod waited on it (#1204's final verify: the
process-wide gate and the 1/3 duty cycle bound HOW MUCH; they could not take it off the GIL).

With `PINE_CAPABILITY_DETECTOR_WORKER=on`, `runtime_definitions.capabilities_for` hands the run to
ONE long-lived child process (spawn context, a duplex `Pipe`) and WAITS ON THE PIPE, which releases
the GIL. Everything around the run is unchanged and still in the parent: the LRU, the persisted
store, the per-request `DetectorBudget`, the process-wide gate (one run at a time), both duty
cycles, the verdict door's per-member budget, the save door's bounded wait. Only the detector call
itself moved.

⛔⛔ EVERY FAILURE IS "PENDING", NEVER AN ADMISSION. `detect()` returns `(caps, elapsed, status)`;
`caps` is None for every status but `ok`, and `capabilities_for` turns None into `pending` (served
"still being checked", fail closed; the save door's 503 "busy, try again"):

    busy         another call holds the worker (a second caller never waits, never runs inline)
    unavailable  the worker is not up yet, or is in its restart cool-down
    timeout      no answer within `CALL_TIMEOUT_S`: the child is KILLED and restarted later
    crashed      the pipe broke or closed (the child died): restarted later
    error        an answer that is not a list of strings, or for another request

⛔ NO INLINE FALLBACK. A worker that cannot answer never sends the run back onto the request
thread: that is the exact stall this module exists to remove. With the flag OFF nothing here runs,
no process is started, and `capabilities_for` calls the detector in-process byte for byte as before.

Restarts are bounded: at most `MAX_STARTS_PER_WINDOW` starts per `START_WINDOW_S`; past that the
worker stays down (every call `unavailable`, i.e. pending) until the window passes. A start never
blocks a request: the child is spawned and its READY message awaited on a daemon thread; a caller
that may wait (the save door) waits for ready only within its own deadline.

The child imports only `pine_capabilities` (and what it imports). It holds no database
connection, no secret and no member data beyond the one source it is handed, which it never
writes anywhere.
"""
from __future__ import annotations

import importlib
import logging
import multiprocessing as mp
import os
import threading
import time
from typing import Any, Optional

log = logging.getLogger(__name__)

WORKER_ENV = "PINE_CAPABILITY_DETECTOR_WORKER"
#: The detector's hard per-call bound in the child. The slowest adversarial 128 KiB shape measured
#: 0.63 s (reviewer box); a run past this is a hung or pathological child, killed.
CALL_TIMEOUT_S = 2.0
#: How long a child may take to import and say READY before it is killed.
STARTUP_TIMEOUT_S = 20.0
MAX_STARTS_PER_WINDOW = 5
START_WINDOW_S = 300.0
DEFAULT_TARGET = "api.services.pine_capabilities:capabilities_of"

OK, BUSY, UNAVAILABLE, TIMEOUT, CRASHED, ERROR = "ok", "busy", "unavailable", "timeout", "crashed", "error"


def worker_enabled() -> bool:
    """`PINE_CAPABILITY_DETECTOR_WORKER == "on"`, read PER CALL. Unset, empty or anything else is
    off (a typo never moves the detector)."""
    return os.environ.get("PINE_CAPABILITY_DETECTOR_WORKER", "off").strip().lower() == "on"


def _resolve(target: str):
    mod, _, fn = target.partition(":")
    return getattr(importlib.import_module(mod), fn)


def _child_main(conn, target: str) -> None:  # pragma: no cover - runs in the child process
    """The child: import the detector, say READY, then answer `(rid, source)` with
    `(rid, True, sorted ids, seconds)` or `(rid, False, None, seconds)` until the pipe closes."""
    try:
        fn = _resolve(target)
    except Exception:  # noqa: BLE001
        fn = None
    if fn is not None:
        try:   # warm the lazy imports (the repaint classifier) before saying READY
            fn('//@version=5\nindicator("warm")\nplot(close)\n')
        except Exception:  # noqa: BLE001
            fn = None
    try:
        conn.send(("ready", fn is not None))
    except (EOFError, OSError):
        return
    if fn is None:
        return
    while True:
        try:
            rid, source = conn.recv()
        except (EOFError, OSError):
            return
        t0 = time.perf_counter()
        try:
            caps = sorted(fn(source))
            conn.send((rid, True, caps, time.perf_counter() - t0))
        except Exception:  # noqa: BLE001
            conn.send((rid, False, None, time.perf_counter() - t0))


def _reap(p) -> None:
    try:
        p.join(1.0)
        if p.is_alive():
            p.kill()
            p.join(1.0)
    except Exception:  # noqa: BLE001
        pass


class _Worker:
    def __init__(self, target: str = DEFAULT_TARGET):
        self.target = target
        self.call_lock = threading.Lock()      # one call in flight; a second caller is `busy`
        self.state_lock = threading.Lock()
        self.proc = None
        self.conn = None
        self.ready = threading.Event()
        self.starting = False
        self.starts: list = []                 # monotonic times of recent starts
        self.rid = 0
        self.stats = {"starts": 0, "calls": 0, "ok": 0, "busy": 0, "unavailable": 0,
                      "timeout": 0, "crashed": 0, "error": 0, "killed": 0}

    # ─── lifecycle ────────────────────────────────────────────────────────────
    def _may_start(self, now: float) -> bool:
        self.starts = [t for t in self.starts if now - t < START_WINDOW_S]
        return len(self.starts) < MAX_STARTS_PER_WINDOW

    def ensure_started(self) -> None:
        """Start the child if it is down and the restart budget allows. Never blocks on it."""
        with self.state_lock:
            if self.proc is not None or self.starting:
                return
            now = time.monotonic()
            if not self._may_start(now):
                return
            self.starts.append(now)
            self.starting = True
            self.ready.clear()
            try:
                ctx = mp.get_context("spawn")
                parent, child = ctx.Pipe(duplex=True)
                proc = ctx.Process(target=_child_main, args=(child, self.target), daemon=True,
                                   name="pine-capability-detector")
                proc.start()
                child.close()
            except Exception:  # noqa: BLE001
                log.exception("[capability-worker] could not start the detector process")
                self.starting = False
                return
            self.proc, self.conn = proc, parent
            self.stats["starts"] += 1
        threading.Thread(target=self._await_ready, args=(proc, parent), daemon=True,
                         name="pine-capability-detector-ready").start()

    def _await_ready(self, proc, conn) -> None:
        ok = False
        try:
            if conn.poll(STARTUP_TIMEOUT_S):
                msg = conn.recv()
                ok = isinstance(msg, tuple) and msg == ("ready", True)
        except (EOFError, OSError):
            ok = False
        with self.state_lock:
            self.starting = False
            if self.proc is not proc:
                return
            if ok:
                self.ready.set()
                log.info("[capability-worker] detector process ready (pid=%s)", proc.pid)
                return
        log.warning("[capability-worker] detector process failed to start; killing it")
        self.kill(proc)

    def kill(self, proc=None) -> None:
        """Stop the child (terminate, then kill) and forget it; the next call restarts it."""
        with self.state_lock:
            if proc is not None and proc is not self.proc:
                return
            p, c = self.proc, self.conn
            self.proc = self.conn = None
            self.ready.clear()
        if c is not None:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
        if p is not None:
            self.stats["killed"] += 1
            try:
                p.terminate()
            except Exception:  # noqa: BLE001
                log.exception("[capability-worker] could not stop the detector process")
            # the reap (and a SIGKILL for a child that ignores SIGTERM) never holds the caller
            threading.Thread(target=_reap, args=(p,), daemon=True,
                             name="pine-capability-detector-reap").start()

    # ─── one call ────────────────────────────────────────────────────────────
    def detect(self, source: str, *, timeout: Optional[float] = None,
               ready_wait: float = 0.0) -> tuple:
        """`(caps or None, elapsed seconds, status)`. Never raises, never runs the detector here.
        `timeout` defaults to `CALL_TIMEOUT_S`, read per call."""
        t0 = time.perf_counter()
        timeout = CALL_TIMEOUT_S if timeout is None else timeout
        self.stats["calls"] += 1
        if not self.call_lock.acquire(blocking=False):
            self.stats["busy"] += 1
            return None, 0.0, BUSY
        try:
            if not self.ready.is_set():
                self.ensure_started()
                if ready_wait <= 0 or not self.ready.wait(ready_wait):
                    self.stats["unavailable"] += 1
                    return None, time.perf_counter() - t0, UNAVAILABLE
            proc, conn = self.proc, self.conn
            if proc is None or conn is None:
                self.stats["unavailable"] += 1
                return None, time.perf_counter() - t0, UNAVAILABLE
            self.rid += 1
            rid = self.rid
            try:
                conn.send((rid, source))
                if not conn.poll(max(0.0, timeout)):
                    log.warning("[capability-worker] detector call timed out after %.2fs; killing it", timeout)
                    self.kill(proc)
                    self.stats["timeout"] += 1
                    return None, time.perf_counter() - t0, TIMEOUT
                msg = conn.recv()
            except (EOFError, OSError, BrokenPipeError):
                log.warning("[capability-worker] detector process died; restarting on the next call")
                self.kill(proc)
                self.stats["crashed"] += 1
                return None, time.perf_counter() - t0, CRASHED
            elapsed = time.perf_counter() - t0
            if not (isinstance(msg, tuple) and len(msg) == 4 and msg[0] == rid and msg[1] is True
                    and isinstance(msg[2], list) and all(isinstance(x, str) for x in msg[2])):
                self.kill(proc)
                self.stats["error"] += 1
                return None, elapsed, ERROR
            self.stats["ok"] += 1
            return frozenset(msg[2]), elapsed, OK
        except Exception:  # noqa: BLE001 - fail closed on anything unforeseen
            log.exception("[capability-worker] detector call failed")
            self.kill()
            self.stats["error"] += 1
            return None, time.perf_counter() - t0, ERROR
        finally:
            self.call_lock.release()

    def status(self) -> dict:
        p = self.proc
        return {"enabled": worker_enabled(), "alive": bool(p is not None and p.is_alive()),
                "ready": self.ready.is_set(), "pid": getattr(p, "pid", None), **self.stats}


_WORKER = _Worker()


def detect(source: str, *, timeout: Optional[float] = None, ready_wait: float = 0.0) -> tuple:
    """The detector's answer for `source` from the worker process: `(caps, elapsed, status)`."""
    return _WORKER.detect(source, timeout=timeout, ready_wait=ready_wait)


def prestart() -> None:
    """Start the worker ahead of the first request (web boot), when the flag is on. Never blocks."""
    if worker_enabled():
        _WORKER.ensure_started()


def status() -> dict:
    return _WORKER.status()


def _reset_for_tests(target: str = DEFAULT_TARGET) -> "_Worker":
    """Tests only: stop the current child and install a fresh worker running `target`."""
    global _WORKER
    _WORKER.kill()
    _WORKER = _Worker(target)
    return _WORKER


def shutdown() -> None:
    _WORKER.kill()
