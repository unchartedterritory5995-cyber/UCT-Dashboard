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

⛔⛔ EVERY FAILURE IS "PENDING", NEVER AN ADMISSION. `detect()` returns `(caps, ran, status)`;
`caps` is None for every status but `ok`, and `capabilities_for` turns None into `pending` (served
"still being checked", fail closed; the save door's 503 "busy, try again"). `ran` is the CHILD's
own run time (review L2): what the duty cycle and the request budget are charged with, never the
parent's wall time (a wait for READY, a pipe, a timeout).

    busy         another call holds the worker (a second caller never waits, never runs inline)
    unavailable  the worker is not up yet, or is in its restart cool-down
    quarantined  THIS source timed out or made the detector raise recently (review M1): it is not
                 sent again until its quarantine ends, so one slow source cannot take the worker
                 down on every list; the quarantine doubles on each repeat, up to a cap
    timeout      no answer within `CALL_TIMEOUT_S` (or the pipe would not take the source within
                 `SEND_TIMEOUT_S`): the child is KILLED and restarted later
    crashed      the pipe broke or closed (the child died): restarted later
    error        the detector RAISED (the child is healthy and is KEPT; the source is
                 quarantined), or an answer that is not a list of strings or is for another
                 request (the protocol is out of step: the child is killed)

⛔ NO INLINE FALLBACK. A worker that cannot answer never sends the run back onto the request
thread: that is the exact stall this module exists to remove. With the flag OFF nothing here runs,
no process is started, and `capabilities_for` calls the detector in-process byte for byte as before.

Restarts are bounded in TWO budgets: a crash (or a child that would not start) spends
`MAX_STARTS_PER_WINDOW` per `START_WINDOW_S`; a restart after a TIMEOUT spends its own, larger
`MAX_TIMEOUT_STARTS_PER_WINDOW` (review M1: the source that hung is quarantined, so a timeout does
not loop, and it must not use up the crash budget). Past either, every call is `unavailable`
(pending) until the window passes. A start never blocks a request: the child is spawned and its
READY message awaited on a daemon thread; a caller that may wait (the save door) waits for ready
only within its own deadline.

⚠️ WHAT THE CHILD HOLDS (review L7). It is a spawned interpreter, so it INHERITS the web process's
environment variables, secrets included; it reads none of them. It imports only
`pine_capabilities` (and what that imports), opens no database or network connection, and is
handed exactly one thing per call: a source it scans and never writes anywhere.

Operator read: `status()` (pid, alive, ready, counters, quarantine size), served to admins at
`GET /api/user-definitions/capability-worker`. Stopped at web shutdown (`shutdown()`, lifespan).
"""
from __future__ import annotations

import hashlib
import importlib
import logging
import multiprocessing as mp
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Optional

log = logging.getLogger(__name__)

WORKER_ENV = "PINE_CAPABILITY_DETECTOR_WORKER"
#: The detector's hard per-call bound in the child. The slowest adversarial 128 KiB shape measured
#: 0.63 s (reviewer box); a run past this is a hung or pathological child, killed.
CALL_TIMEOUT_S = 2.0
#: How long the pipe may take to accept a source (review L3). A healthy child is always reading.
SEND_TIMEOUT_S = 1.0
#: How long a child may take to import and say READY before it is killed.
STARTUP_TIMEOUT_S = 20.0
MAX_STARTS_PER_WINDOW = 5
MAX_TIMEOUT_STARTS_PER_WINDOW = 30
START_WINDOW_S = 300.0
#: The quarantine of a source that timed out or made the detector raise: base, doubling, cap.
QUARANTINE_BASE_S = 600.0
QUARANTINE_MAX_S = 6 * 3600.0
QUARANTINE_MAX_ENTRIES = 1024
#: Follow-up review (L1 option): a MEMBER whose sources struck this many times inside the window
#: is quarantined as a member, so one-character variants of a hanging script cannot evade the
#: per-source quarantine. Only fresh detector runs are refused; stored and cached sets still serve.
MEMBER_STRIKES_LIMIT = 2
MEMBER_STRIKE_WINDOW_S = 600.0
DEFAULT_TARGET = "api.services.pine_capabilities:capabilities_of"

OK, BUSY, UNAVAILABLE, QUARANTINED, TIMEOUT, CRASHED, ERROR = (
    "ok", "busy", "unavailable", "quarantined", "timeout", "crashed", "error")
_START_CRASH, _START_TIMEOUT = "crash", "timeout"


def worker_enabled() -> bool:
    """`PINE_CAPABILITY_DETECTOR_WORKER == "on"` (case and surrounding spaces ignored, as
    `capability_admission_on` reads its own mode), read PER CALL. Unset, empty or anything else is
    off: a typo never moves the detector."""
    return os.environ.get("PINE_CAPABILITY_DETECTOR_WORKER", "off").strip().lower() == "on"


def _resolve(target: str):
    mod, _, fn = target.partition(":")
    return getattr(importlib.import_module(mod), fn)


def _child_main(conn, target: str) -> None:  # pragma: no cover - runs in the child process
    """The child: import the detector, warm it, say READY, then answer `(rid, source)` with
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


def _key(source: Any) -> str:
    return hashlib.sha256(source.encode("utf-8", "surrogatepass")).hexdigest() if isinstance(source, str) else ""


class _Worker:
    def __init__(self, target: str = DEFAULT_TARGET):
        self.target = target
        self.call_lock = threading.Lock()      # one call in flight; a second caller is `busy`
        self.state_lock = threading.Lock()
        self.proc = None
        self.conn = None
        self.ready = threading.Event()
        self.starting = False
        self.starts: list = []                 # (monotonic time, kind) of recent starts
        self.next_start_kind = _START_CRASH
        self.rid = 0
        self.quarantine: "OrderedDict[str, tuple]" = OrderedDict()   # key -> (until, strikes)
        self.q_lock = threading.Lock()
        self.member_strikes: "OrderedDict[str, list]" = OrderedDict()   # member -> strike times
        self.stats = {"starts": 0, "calls": 0, "ok": 0, "busy": 0, "unavailable": 0, "quarantined": 0,
                      "timeout": 0, "crashed": 0, "error": 0, "raised": 0, "killed": 0}

    # ─── quarantine (review M1) ──────────────────────────────────────────────
    def quarantined(self, key: str, now: float) -> bool:
        with self.q_lock:
            hit = self.quarantine.get(key)
            if hit is None:
                return False
            if now >= hit[0]:
                return False          # expired: tried again; a repeat failure doubles the term
            return True

    def strike(self, key: str, now: float) -> None:
        with self.q_lock:
            strikes = (self.quarantine.get(key, (0.0, 0))[1]) + 1
            term = min(QUARANTINE_MAX_S, QUARANTINE_BASE_S * (2 ** (strikes - 1)))
            self.quarantine[key] = (now + term, strikes)
            self.quarantine.move_to_end(key)
            while len(self.quarantine) > QUARANTINE_MAX_ENTRIES:
                self.quarantine.popitem(last=False)

    def member_quarantined(self, member: Optional[str], now: float) -> bool:
        if not member:
            return False
        with self.q_lock:
            times = [t for t in self.member_strikes.get(member, ()) if now - t < MEMBER_STRIKE_WINDOW_S]
            if times:
                self.member_strikes[member] = times
            else:
                self.member_strikes.pop(member, None)
            return len(times) >= MEMBER_STRIKES_LIMIT

    def strike_member(self, member: Optional[str], now: float) -> None:
        if not member:
            return
        with self.q_lock:
            self.member_strikes.setdefault(member, []).append(now)
            self.member_strikes.move_to_end(member)
            while len(self.member_strikes) > QUARANTINE_MAX_ENTRIES:
                self.member_strikes.popitem(last=False)

    def _strike(self, key: str, member: Optional[str]) -> None:
        now = time.monotonic()
        self.strike(key, now)
        self.strike_member(member, now)

    # ─── lifecycle ────────────────────────────────────────────────────────────
    def _may_start(self, now: float, kind: str) -> bool:
        self.starts = [(t, k) for t, k in self.starts if now - t < START_WINDOW_S]
        cap = MAX_TIMEOUT_STARTS_PER_WINDOW if kind == _START_TIMEOUT else MAX_STARTS_PER_WINDOW
        return sum(1 for _t, k in self.starts if k == kind) < cap

    def ensure_started(self) -> None:
        """Start the child if it is down and its restart budget allows. Never blocks on it."""
        with self.state_lock:
            if self.proc is not None or self.starting:
                return
            now = time.monotonic()
            kind = self.next_start_kind
            if not self._may_start(now, kind):
                return
            self.starts.append((now, kind))
            self.next_start_kind = _START_CRASH
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

    def kill(self, proc=None, *, reason: str = _START_CRASH) -> None:
        """Stop the child (terminate now, reap off-thread) and forget it; the next call restarts
        it, charged to the budget `reason` names."""
        with self.state_lock:
            if proc is not None and proc is not self.proc:
                return
            p, c = self.proc, self.conn
            self.proc = self.conn = None
            self.ready.clear()
            if p is not None:
                self.next_start_kind = reason
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

    def _send(self, conn, msg) -> Optional[str]:
        """`conn.send(msg)` bounded by `SEND_TIMEOUT_S` (review L3): None when sent, else a status."""
        box: dict = {}

        def go():
            try:
                conn.send(msg)
                box["ok"] = True
            except BaseException as exc:  # noqa: BLE001
                box["err"] = exc
        t = threading.Thread(target=go, daemon=True, name="pine-capability-detector-send")
        t.start()
        t.join(SEND_TIMEOUT_S)
        if t.is_alive():
            return TIMEOUT
        return None if box.get("ok") else CRASHED

    # ─── one call ────────────────────────────────────────────────────────────
    def detect(self, source: str, *, timeout: Optional[float] = None,
               ready_wait: float = 0.0, member: Optional[str] = None) -> tuple:
        """`(caps or None, seconds to charge, status)`. Never raises, never runs the detector here.
        `timeout` defaults to `CALL_TIMEOUT_S`, read per call. The seconds are the CHILD's own run
        time for an answer, and (follow-up review L1) the WALL time a TIMEOUT held the call for:
        a hang still charges the cool-down, the request budget and the member's verdict spend.
        `member`, when given, is struck with the source on a timeout or a raise."""
        timeout = CALL_TIMEOUT_S if timeout is None else timeout
        self.stats["calls"] += 1
        if not self.call_lock.acquire(blocking=False):
            self.stats["busy"] += 1
            return None, 0.0, BUSY
        try:
            key = _key(source)
            now = time.monotonic()
            if self.quarantined(key, now) or self.member_quarantined(member, now):
                self.stats["quarantined"] += 1
                return None, 0.0, QUARANTINED
            if not self.ready.is_set():
                self.ensure_started()
                if ready_wait <= 0 or not self.ready.wait(ready_wait):
                    self.stats["unavailable"] += 1
                    return None, 0.0, UNAVAILABLE
            proc, conn = self.proc, self.conn
            if proc is None or conn is None:
                self.stats["unavailable"] += 1
                return None, 0.0, UNAVAILABLE
            self.rid += 1
            rid = self.rid
            t_call = time.perf_counter()
            sent = self._send(conn, (rid, source))
            if sent == TIMEOUT:
                log.warning("[capability-worker] the pipe did not take a source in %.1fs; killing it",
                            SEND_TIMEOUT_S)
                self.kill(proc, reason=_START_TIMEOUT)
                self.stats["timeout"] += 1
                return None, time.perf_counter() - t_call, TIMEOUT
            try:
                if sent is not None:
                    raise BrokenPipeError("send failed")
                if not conn.poll(max(0.0, timeout)):
                    log.warning("[capability-worker] detector call timed out after %.2fs; killing it "
                                "and quarantining the source", timeout)
                    self._strike(key, member)
                    self.kill(proc, reason=_START_TIMEOUT)
                    self.stats["timeout"] += 1
                    return None, time.perf_counter() - t_call, TIMEOUT
                msg = conn.recv()
            except (EOFError, OSError, BrokenPipeError):
                log.warning("[capability-worker] detector process died; restarting on the next call")
                self.kill(proc)
                self.stats["crashed"] += 1
                return None, 0.0, CRASHED
            if not (isinstance(msg, tuple) and len(msg) == 4 and msg[0] == rid and isinstance(msg[3], (int, float))):
                self.kill(proc)                # out of step: this child cannot be trusted
                self.stats["error"] += 1
                return None, 0.0, ERROR
            ran = max(0.0, float(msg[3]))
            if msg[1] is not True:
                # the detector RAISED on this source: the child is healthy and stays (review M1)
                self._strike(key, member)
                self.stats["raised"] += 1
                self.stats["error"] += 1
                return None, ran, ERROR
            if not (isinstance(msg[2], list) and all(isinstance(x, str) for x in msg[2])):
                self.kill(proc)
                self.stats["error"] += 1
                return None, 0.0, ERROR
            self.stats["ok"] += 1
            return frozenset(msg[2]), ran, OK
        except Exception:  # noqa: BLE001 - fail closed on anything unforeseen
            log.exception("[capability-worker] detector call failed")
            self.kill()
            self.stats["error"] += 1
            return None, 0.0, ERROR
        finally:
            self.call_lock.release()

    def status(self) -> dict:
        p = self.proc
        with self.q_lock:
            q = len(self.quarantine)
            mq = sum(1 for times in self.member_strikes.values() if len(times) >= MEMBER_STRIKES_LIMIT)
        return {"enabled": worker_enabled(), "alive": bool(p is not None and p.is_alive()),
                "ready": self.ready.is_set(), "pid": getattr(p, "pid", None), "quarantine": q,
                "members_quarantined": mq,
                "call_timeout_s": CALL_TIMEOUT_S, **self.stats}


_WORKER = _Worker()


def detect(source: str, *, timeout: Optional[float] = None, ready_wait: float = 0.0,
           member: Optional[str] = None) -> tuple:
    """The detector's answer for `source` from the worker process: `(caps, ran, status)`."""
    return _WORKER.detect(source, timeout=timeout, ready_wait=ready_wait, member=member)


def is_quarantined(source: Any, member: Optional[str] = None) -> bool:
    """Is this source (or this member) quarantined right now? The save door's wording reads it."""
    now = time.monotonic()
    return _WORKER.quarantined(_key(source), now) or _WORKER.member_quarantined(member, now)


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
    """Stop the child (web shutdown). Idempotent; never raises."""
    try:
        _WORKER.kill()
    except Exception:  # noqa: BLE001
        pass
