"""The background lane: heavy sweeps no member waits for run after the boot settles, one item at a
time, at a bounded share of the wall clock.

⚰️ WHAT THIS FIXES (measured on production web, 2026-11-17). For ~15 minutes after EVERY restart the
whole site answered about 10x slower: `/api/health`, a dictionary read, took p50 1.2-1.6 s at the
edge for the first 16 minutes after the 19:54:38Z boot and 6-58 ms after that. The request-timing
record called it "interpreter lock: slow seconds had tokens free". The stored event-loop stall
captures (`/api/watchdog/stacks`) named who held the interpreter: in every capture from +201 s to
+1090 s, 17-30 threads were busy at once, and the same long sweepers were in nearly all of them:
`weekly-key-purge`, `bars-offgrid-sweep` (13,355 tickers, "0 off-grid row(s) removed", 1,480 s),
the continuous audit's universe sweep (4 threads validating ~12 M bars in Python), the breadth
self-heal, the exchange-breadth hash, the split heal. After +1090 s there was no stall at all.

Why many busy threads cost so much more than their CPU: `sqlite3` hands the interpreter lock back
on every row it steps, and every hand-off waits for whichever thread holds it (see
`api/services/gil_tuning.py`: 852 rows took 1.7 ms alone, 1,640 ms beside ONE busy thread and
42,900 ms beside two, at the 5 ms default interval). The cost grows with the NUMBER of threads
running Python at once, so a dozen sweepers that each look modest on a CPU graph starve every
request together.

⚰️ AND WHY THE BOOT QUIET WINDOW (2026-11-12) DID NOT FIX IT. It started five jobs 2-10 minutes
later. They then all ran at once from minute 4 to minute 18: the storm moved, it did not shrink.
A delay alone cannot bound how many sweepers run together or how much of the clock they take.

THE RULE, three parts behind one lock:
  1. SETTLE. Lane work does not start until `settle_s` after process start (default 600 s), so the
     minutes when every member's tab reconnects and the member-facing warmers run are left alone.
  2. ONE AT A TIME. One item (typically one ticker) of lane work runs at once in the process,
     whichever sweep submits it.
  3. DUTY. After each item the lane stays closed for `busy * (1 - duty) / duty` (default duty 0.2),
     so all lane work TOGETHER uses at most a fifth of the wall clock. The pause is a sleep: the
     sweeper holds no interpreter lock while it waits. The pause grows with the item's own
     duration, so when the pod is busy (items take longer) the lane backs off by itself.

WHAT GOES IN THE LANE: work no member waits for and that a serve-time guard already covers
(repairs, audits, verifications). NEVER the bars prewarm, the R2 snapshot pull, a member-facing
warmer or anything a request waits on: those stay as they are (CLAUDE.md bars invariants).

⛔ WEB PROCESS ONLY. The lane does nothing until `activate()` is called, and only the web lifespan
(`api/main.py`) calls it. The same sweep functions run in other processes that must NOT be paced:
the worker calls the weekly purge SYNCHRONOUSLY on purpose and its R2 uploader waits for it
(`api/worker_main.py`), and every service pulls its bars from that snapshot.

Knobs: `BG_LANE_ENABLED` (unset or anything but 0/false/no/off = on; off makes `turn()` a plain
pass-through, which is the behaviour before this module), `BG_LANE_SETTLE_S`, `BG_LANE_DUTY`. A value
that does not parse or is out of range falls back to the default and never becomes an extreme.
Rails: tests/test_bg_lane.py.
"""
from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

ENV_ENABLED = "BG_LANE_ENABLED"
ENV_SETTLE = "BG_LANE_SETTLE_S"
ENV_DUTY = "BG_LANE_DUTY"
DEFAULT_SETTLE_S = 600.0
DEFAULT_DUTY = 0.2
SETTLE_RANGE = (0.0, 3600.0)
DUTY_RANGE = (0.02, 1.0)
#: One item's pause is never longer than this, so one pathological item cannot close the lane for long.
MAX_PAUSE_S = 5.0
#: While waiting for the settle window, wake at least this often (a test can shorten the window).
SETTLE_POLL_S = 5.0
_OFF = frozenset({"0", "false", "no", "off"})

#: Process start, as near as this module can know it. `activate` is given `api.main`'s own
#: `_BOOT_T0` (taken before every heavy import), which is earlier than this module's import.
_t0 = time.monotonic()
_active = False
_lock = threading.Lock()
_local = threading.local()
_stats_lock = threading.Lock()
_stats: Dict[str, Dict[str, Any]] = {}


def activate(t0_monotonic: Optional[float] = None) -> None:
    """Turn the lane on for THIS process (the web lifespan calls it; nothing else should)."""
    global _t0, _active
    if t0_monotonic is not None:
        _t0 = float(t0_monotonic)
    _active = True


def enabled(environ=None) -> bool:
    """On only in a process that called `activate()`, and not switched off by `BG_LANE_ENABLED`."""
    env = os.environ if environ is None else environ
    return _active and (env.get(ENV_ENABLED) or "1").strip().lower() not in _OFF


def _num(raw, default: float, lo: float, hi: float) -> float:
    try:
        v = float(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if v != v or not (lo <= v <= hi):          # NaN or out of range: the default, never a clamp
        return default
    return v


def settle_s(environ=None) -> float:
    env = os.environ if environ is None else environ
    return _num(env.get(ENV_SETTLE), DEFAULT_SETTLE_S, *SETTLE_RANGE)


def duty(environ=None) -> float:
    env = os.environ if environ is None else environ
    return _num(env.get(ENV_DUTY), DEFAULT_DUTY, *DUTY_RANGE)


def pause_for(busy_s: float, d: Optional[float] = None) -> float:
    """Seconds the lane stays closed after an item that took `busy_s`, so lane work is busy at most
    `d` of the wall clock."""
    d = duty() if d is None else d
    if d >= 1.0 or busy_s <= 0:
        return 0.0
    return min(MAX_PAUSE_S, busy_s * (1.0 - d) / d)


def settle_remaining(now: Optional[float] = None) -> float:
    now = time.monotonic() if now is None else now
    return max(0.0, settle_s() - (now - _t0))


def _stat(name: str) -> Dict[str, Any]:
    s = _stats.get(name)
    if s is None:
        s = _stats[name] = {"items": 0, "busy_s": 0.0, "paused_s": 0.0, "settle_wait_s": 0.0,
                            "first_item_at_s": None, "last_item_at_s": None}
    return s


def wait_settled(name: str) -> float:
    """Block the CALLING background thread until the settle window has passed; seconds waited.
    Never call it on the event loop or on a request path."""
    if not enabled():
        return 0.0
    t = time.monotonic()
    while True:
        rem = settle_remaining()
        if rem <= 0:
            break
        time.sleep(min(rem, SETTLE_POLL_S))
    waited = time.monotonic() - t
    if waited > 0:
        with _stats_lock:
            _stat(name)["settle_wait_s"] += waited
    return waited


@contextmanager
def turn(name: str) -> Iterator[None]:
    """`with bg_lane.turn("weekly-key-purge"): <one item of work>`. See the module docstring.

    Re-entrant on one thread: an item that calls code which takes its own turn runs that inner
    work inside the outer turn (no second wait, no deadlock)."""
    if not enabled():
        yield
        return
    if getattr(_local, "depth", 0):
        _local.depth += 1
        try:
            yield
        finally:
            _local.depth -= 1
        return
    wait_settled(name)
    with _lock:
        _local.depth = 1
        t = time.perf_counter()
        try:
            yield
        finally:
            _local.depth = 0
            busy = time.perf_counter() - t
            pause = pause_for(busy)
            if pause > 0:
                time.sleep(pause)
            now_s = round(time.monotonic() - _t0, 1)
            with _stats_lock:
                s = _stat(name)
                s["items"] += 1
                s["busy_s"] += busy
                s["paused_s"] += pause
                if s["first_item_at_s"] is None:
                    s["first_item_at_s"] = now_s
                s["last_item_at_s"] = now_s


def stats() -> Dict[str, Any]:
    """For `/api/health`: the knobs in force and, per sweep, items run, busy and paused seconds, and
    when (seconds after boot) its first and latest item ran. Counters only."""
    with _stats_lock:
        per = {k: {**v, "busy_s": round(v["busy_s"], 3), "paused_s": round(v["paused_s"], 3),
                   "settle_wait_s": round(v["settle_wait_s"], 1)} for k, v in _stats.items()}
    return {"enabled": enabled(), "settle_s": settle_s(), "duty": duty(),
            "settle_remaining_s": round(settle_remaining(), 1), "sweeps": per}


def _reset_for_tests(active: bool = False) -> None:
    global _t0, _active
    _t0 = time.monotonic()
    _active = active
    with _stats_lock:
        _stats.clear()
    _local.depth = 0
