"""One caller does the work; everyone else waits for that one answer.

⛔ **THIS EXISTS BECAUSE OF A MEASUREMENT, NOT A THEORY.** A cold deep breadth
history read — `GET /api/breadth-monitor?days=8000` — cost **54,923 ms** on the
single web process (D-042, `docs/breadth/DECISIONS.md`). That endpoint is shipped,
paid and live: the Monitor's Time Navigator and Views both ask for deep windows.

**Why a duplicate is so much worse than a repeat.** The web pod is ONE uvicorn
process: one event loop and one anyio threadpool of 64. A sync route handler runs
in that threadpool, so N concurrent cold reads of the SAME window are N workers
each paying the full cost *and* contending on the same SQLite file — the
threadpool-exhaustion class that caused the 2026-07-01 524 outage. With a 5-minute
cache in front, every one of those N is computing a value the first of them is
about to store.

⚠️ **WHAT THIS DOES NOT DO — say it plainly, because the name oversells it.** It
does not bound CONCURRENCY: a waiter still occupies its threadpool worker while it
waits. It bounds duplicated WORK, and it bounds the SQLite contention that makes
each duplicate slower than the one before. The fix for the 55 s itself is the
reader programme (D-043); this is containment until that lands.

⭐ **The key is the CACHE key, deliberately.** Two callers collapse exactly when
they would have stored the same value under the same key — no wider, so a
different window is never made to wait for an unrelated one, and no narrower, so
two spellings of one window cannot both compute.

⛔ **A waiter's wait is BOUNDED and a timeout RAISES.** The tempting alternative —
"on timeout, compute it yourself" — reintroduces exactly the pile-up this prevents,
at the worst possible moment (when the leader is already struggling). A timeout
here means something is wrong, and `/api/breadth-monitor` turns it into a 503,
which is the honest answer.
"""
from __future__ import annotations

import os
import threading
from typing import Any, Callable, Dict, List

#: A waiter gives up after this long. Generously above the worst measured cold
#: read (~55 s), because a waiter that times out gets a 503 — the bound exists to
#: stop an unbounded hang, not to police a slow-but-working read.
_DEFAULT_WAIT_SECONDS = 180.0
_WAIT_ENV = "BREADTH_SINGLE_FLIGHT_WAIT_SECONDS"


class SingleFlightTimeout(TimeoutError):
    """A follower waited past the bound for a leader that never finished."""


def wait_seconds() -> float:
    """Read the bound at CALL time, never at import.

    An import-time capture cannot be changed without a rebuild and cannot be
    driven by a test — the same defect `test_the_flag_is_read_per_request` exists
    to prevent one layer up.
    """
    raw = (os.getenv(_WAIT_ENV) or "").strip()
    if not raw:
        return _DEFAULT_WAIT_SECONDS
    try:
        v = float(raw)
    except ValueError:
        return _DEFAULT_WAIT_SECONDS
    return v if v > 0 else _DEFAULT_WAIT_SECONDS


class _Call:
    __slots__ = ("done", "value", "error", "followers", "background")

    def __init__(self, background: bool = False) -> None:
        self.done = threading.Event()
        self.value: Any = None
        self.error: BaseException | None = None
        self.followers = 0
        self.background = background


# ── Background (warmer) flights: a member never queues behind a warmer ────────
#
# ⛔ MEASURED 2026-10-06 (web boot 17:46 UTC): three opens of `TSM EE` that started at
# 17:48:41, 17:49:36 and 17:50:18 all answered within 7 ms of each other at 17:50:23 (102 s,
# 47 s and 5 s), identical bodies, while unrelated sync routes on the same pod answered in
# 0.3 s. That is the shape of followers released by ONE in-flight computation. A follower's
# wait is bounded only by `wait_seconds()` (180 s), so whoever LEADS a key decides how long
# every member on that key waits, and at boot the leader is often a warmer running on a
# pod that is busy with every other warmer.
#
# So a thread doing BACKGROUND work (a boot warmer) marks itself with `background()`. Its
# flights are still shared with OTHER background callers, but a FOREGROUND caller (a
# member's request) that finds a background-led flight does not wait on it: it takes the
# key over and computes on its own thread, exactly as if no warmer existed. Later
# foreground callers then follow the MEMBER's flight, so a cold symbol is still built at
# most once for members. The cost is at most one duplicated read per key, and only when a
# member and a warmer collide on the same cold key.
_bg_local = threading.local()


class background:
    """Context manager: flights this thread leads inside the block are BACKGROUND flights.

        with single_flight.background():
            warm_research_panels()

    Re-entrant; restores the previous mode on exit."""

    def __enter__(self) -> "background":
        self._prev = getattr(_bg_local, "on", False)
        _bg_local.on = True
        return self

    def __exit__(self, *_exc) -> None:
        _bg_local.on = self._prev


def in_background() -> bool:
    """True while the calling thread is inside `background()`."""
    return bool(getattr(_bg_local, "on", False))


_lock = threading.Lock()
_inflight: Dict[str, _Call] = {}

#: Counters, for the health endpoint and for tests. `collapsed` is the whole
#: point of the module: it is the number of expensive reads that did NOT happen.
_counts = {"leaders": 0, "collapsed": 0, "timeouts": 0}
#: Member flights that took a key over from a background (warmer) flight. Kept OUT of
#: `_counts` so `stats()` keeps its shape for the breadth callers that read it.
_preempted = [0]


def run(key: str, fn: Callable[[], Any], wait: float | None = None,
        on_role: Callable[[str], None] | None = None) -> Any:
    """Run `fn()` once per in-flight `key`; concurrent callers share the result.

    The first caller for a key is the LEADER and runs `fn`. Callers arriving
    while it runs are FOLLOWERS: they block until the leader finishes and then
    return its value, or re-raise its exception.

    ⛔ Followers re-raise the leader's exception OBJECT, so a failure is shared
    rather than silently retried by each follower in turn — a stampede of retries
    against something already failing is the same pile-up wearing a different hat.

    `on_role` is told `"leader"` or `"follower"` for THIS call, under the same lock
    that decides it. ⛔ It exists because the alternative — diffing the `collapsed`
    counter around the call — is wrong precisely when it matters: two arrivals on
    one key each see the other's increment, so the instrument misattributes under
    the exact concurrency it was built to observe. A callback cannot: the decision
    and the report are the same critical section. It is fully optional, and it is
    wrapped so an observer that raises can never break the flight it is watching.
    """
    bg = in_background()
    with _lock:
        call = _inflight.get(key)
        if call is None or (call.background and not bg):
            # No flight, or only a WARMER's flight and this caller is a member: lead a new
            # flight. Replacing the entry makes later members follow this one; the warmer's
            # own `finally` only removes the entry if it is still its own (see below).
            if call is not None:
                _preempted[0] += 1
            call = _Call(background=bg)
            _inflight[key] = call
            _counts["leaders"] += 1
            leader = True
        else:
            call.followers += 1
            _counts["collapsed"] += 1
            leader = False
    _tell(on_role, "leader" if leader else "follower")

    if leader:
        try:
            call.value = fn()
        except BaseException as exc:        # noqa: BLE001 — re-raised below, never swallowed
            call.error = exc
        finally:
            # ⛔ Remove the entry BEFORE waking the followers, so a caller arriving
            # one instruction later becomes a fresh leader rather than joining a
            # finished call and waiting for an event that will never be set again.
            with _lock:
                if _inflight.get(key) is call:
                    del _inflight[key]
            call.done.set()
        if call.error is not None:
            raise call.error
        return call.value

    bound = wait_seconds() if wait is None else wait
    if not call.done.wait(timeout=bound):
        with _lock:
            _counts["timeouts"] += 1
        raise SingleFlightTimeout(
            f"waited {bound:.0f}s for an in-flight computation of {key!r}"
        )
    if call.error is not None:
        raise call.error
    return call.value



def _tell(on_role: Callable[[str], None] | None, role: str) -> None:
    """Report the role, never raise. An observer is not allowed to fail a flight."""
    if on_role is None:
        return
    try:
        on_role(role)
    except Exception:
        pass


def inflight_keys() -> List[str]:
    """Snapshot of the keys currently being computed. Read-only."""
    with _lock:
        return sorted(_inflight)


def stats() -> dict:
    """Counters since process start, plus live occupancy.

    `collapsed` counts the duplicate computations this module PREVENTED. A flat
    `collapsed` under load does not mean the module is broken — it means nothing
    is arriving concurrently on one key, which is the healthy case.
    """
    with _lock:
        return {**_counts, "inflight": len(_inflight)}


def preempted() -> int:
    """How many member flights took a key over from a warmer's flight since start."""
    with _lock:
        return _preempted[0]


def reset_for_tests() -> None:
    """Clear counters and occupancy. Tests only — never called by product code."""
    with _lock:
        _inflight.clear()
        for k in _counts:
            _counts[k] = 0
        _preempted[0] = 0
