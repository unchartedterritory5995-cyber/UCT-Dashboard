"""Readiness gate — hold live traffic until the pod's caches are actually warm.

WHY THIS EXISTS (2026-07-26 diagnosis)
--------------------------------------
`railway.json` points `healthcheckPath` at a route, and Railway switches live
traffic to the new pod the instant that route returns 200. `/api/health` answers
200 as soon as uvicorn binds -- it checks nothing. But the warm threads in
`api/main.py` are deliberately staggered AFTER boot:

    T+20s   _start_dashboard_warm_background   movers/themes/news/breadth/calendar
    T+45s   _start_hot_tier_warm_background    bars hot tier -> CHARTS
    T+60s   _start_darkpool_prewarm_background darkpool
    T+120s  _start_rs_rankings_warm_background RS rankings (~17s compute)

So every deploy opened a 0-120s window where real users were served by a pod
with empty caches, paying the very cold recomputes those warmers exist to
prevent (`compute_rs_scores` computes INLINE on a miss). On 2026-07-26 there
were 40 deploys -> 40 such windows, reported by the owner as "slow to load
different sections, slow to load different charts" all day.

This module is the gate. `/api/ready` (the new healthcheckPath) stays 503 until
every registered warmer has finished, so Railway keeps serving from the OLD --
already warm -- pod until the new one can actually take traffic.

DESIGN NOTES
------------
* This is a SEPARATE endpoint from `/api/health` on purpose. `/api/health` is
  liveness and has other consumers -- notably `worker_main`'s down-alert monitor
  which posts a red alert to Discord when the web origin fails. Making /api/health
  fail during warm would fire a false "site is down" alert on every deploy.
* The deadline is a HARD cap. A warmer that hangs or crashes must never be able
  to fail a deploy -- past the deadline the gate releases and the pod goes live
  anyway (and `snapshot()` says so, so it is visible rather than silent).
* Gates are marked done on FAILURE too. The warmers are best-effort by design;
  "attempted" is what readiness cares about, not "succeeded".
"""
from __future__ import annotations

import contextlib
import threading
import time

# Generous vs the T+120s RS warmer (+ ~17s compute), and far under the 600s
# `healthcheckTimeout` in railway.json, so a slow-but-working boot still
# cuts over normally.
DEFAULT_DEADLINE_SECONDS = 240.0


class Readiness:
    """Tracks a set of named warm gates and answers "can this pod take traffic?"."""

    def __init__(
        self,
        deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
        clock=time.monotonic,
    ):
        self._deadline = float(deadline_seconds)
        self._clock = clock
        self._start = clock()
        self._lock = threading.Lock()
        # name -> done?  (insertion-ordered, so pending/done lists are stable)
        self._gates: dict[str, bool] = {}

    def register(self, name: str) -> None:
        """Declare a warm gate that must finish before this pod is ready."""
        with self._lock:
            self._gates.setdefault(name, False)

    def mark_done(self, name: str) -> None:
        """Mark a gate finished. Unknown names are ignored (never raises inside
        a warmer's cleanup path)."""
        with self._lock:
            if name in self._gates:
                self._gates[name] = True

    @contextlib.contextmanager
    def gate(self, name: str):
        """Run a warmer so its gate is marked done even if the warmer raises."""
        try:
            yield
        finally:
            self.mark_done(name)

    def _elapsed(self) -> float:
        return self._clock() - self._start

    def deadline_exceeded(self) -> bool:
        return self._elapsed() > self._deadline

    def is_ready(self) -> bool:
        with self._lock:
            all_done = all(self._gates.values())
        return all_done or self.deadline_exceeded()

    def snapshot(self) -> dict:
        with self._lock:
            pending = [n for n, done in self._gates.items() if not done]
            done = [n for n, d in self._gates.items() if d]
        exceeded = self.deadline_exceeded()
        return {
            "ready": (not pending) or exceeded,
            "pending": pending,
            "done": done,
            "elapsed_seconds": int(self._elapsed()),
            "deadline_seconds": int(self._deadline),
            "deadline_exceeded": exceeded,
        }


# Process-wide default used by the app. Tests build their own instances.
default = Readiness()


def register(name: str) -> None:
    default.register(name)


def mark_done(name: str) -> None:
    default.mark_done(name)


def gate(name: str):
    return default.gate(name)


def is_ready() -> bool:
    return default.is_ready()


def snapshot() -> dict:
    return default.snapshot()
