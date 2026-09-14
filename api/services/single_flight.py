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
    __slots__ = ("done", "value", "error", "followers")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.value: Any = None
        self.error: BaseException | None = None
        self.followers = 0


_lock = threading.Lock()
_inflight: Dict[str, _Call] = {}

#: Counters, for the health endpoint and for tests. `collapsed` is the whole
#: point of the module: it is the number of expensive reads that did NOT happen.
_counts = {"leaders": 0, "collapsed": 0, "timeouts": 0}


def run(key: str, fn: Callable[[], Any], wait: float | None = None) -> Any:
    """Run `fn()` once per in-flight `key`; concurrent callers share the result.

    The first caller for a key is the LEADER and runs `fn`. Callers arriving
    while it runs are FOLLOWERS: they block until the leader finishes and then
    return its value, or re-raise its exception.

    ⛔ Followers re-raise the leader's exception OBJECT, so a failure is shared
    rather than silently retried by each follower in turn — a stampede of retries
    against something already failing is the same pile-up wearing a different hat.
    """
    with _lock:
        call = _inflight.get(key)
        if call is None:
            call = _Call()
            _inflight[key] = call
            _counts["leaders"] += 1
            leader = True
        else:
            call.followers += 1
            _counts["collapsed"] += 1
            leader = False

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


def reset_for_tests() -> None:
    """Clear counters and occupancy. Tests only — never called by product code."""
    with _lock:
        _inflight.clear()
        for k in _counts:
            _counts[k] = 0
