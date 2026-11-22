"""Per-step timing for SLOW preference saves (speed follow-up, 2026-11-16).

WHY
---
In the 2026-11-16 regular session `POST /api/auth/preferences` answered in 1.0 s at the median and
10 s at p95, and held 9% of all server time (request-timing layer). It is NOT the auth.db write
lock: 0 "database is locked" lines in the web log over 45 minutes of the session, and the write
path (timeout=3, one retry) would print them. So the time is spent somewhere inside the handler,
or waiting for the interpreter lock, and nothing says which.

WHAT
----
`Phases` marks each step of the save. A save slower than SLOW_S logs ONE line:

    [prefs-slow] key=<key> bytes=<value size> total_ms=.. cpu_ms=.. validate=w/c bound=w/c ... rest=w/c

`w` is the step's wall time and `c` the CPU time THIS THREAD used in it (`time.thread_time`).
c close to w = the step computes (parse, copy, validate a big layout); w much larger than c = it
waits (the interpreter lock, a disk, a lock). That split is the whole point.

Nothing about the member: no user id, no value, only the preference KEY (sanitised) and the
value's size. Fast saves (the normal case) log nothing. Never raises into the save.
"""
from __future__ import annotations

import logging
import re
import time

_log = logging.getLogger("api.prefs_timing")

#: A save at least this slow is logged (seconds).
SLOW_S = 1.0

_KEY_SAFE = re.compile(r"[^A-Za-z0-9_.:-]")


class Phases:
    __slots__ = ("t0", "c0", "t", "c", "parts")

    def __init__(self) -> None:
        self.t0 = self.t = time.perf_counter()
        self.c0 = self.c = time.thread_time()
        self.parts: list = []

    def mark(self, name: str) -> None:
        """Close the step that just ran under `name`."""
        t, c = time.perf_counter(), time.thread_time()
        self.parts.append((name, t - self.t, c - self.c))
        self.t, self.c = t, c

    def report(self, key, size: int):
        """Log the steps if the save was slow. Returns the line (None when fast). Never raises."""
        try:
            t, c = time.perf_counter(), time.thread_time()
            total = t - self.t0
            if total < SLOW_S:
                return None
            parts = self.parts + [("rest", t - self.t, c - self.c)]
            line = "[prefs-slow] key=%s bytes=%d total_ms=%.0f cpu_ms=%.0f %s" % (
                _KEY_SAFE.sub("?", str(key or ""))[:64], int(size or 0), total * 1000, (c - self.c0) * 1000,
                " ".join("%s=%.0f/%.0f" % (n, w * 1000, cpu * 1000) for n, w, cpu in parts))
            _log.warning(line)
            return line
        except Exception:  # noqa: BLE001 - an instrument never costs a save
            return None
