"""The interpreter's thread switch interval, set for request latency.

⚰️ WHAT THIS FIXES (measured 2026-11-12). CPython lets a thread that wants the GIL wait
one "switch interval" (5 ms by default) before it asks the running thread to give it
up. A thread that releases and re-takes the GIL many times in a row pays that wait EVERY
time while any other thread is running Python code. `sqlite3` releases the GIL around
every row it steps, so reading N rows is N hand-offs:

    852 daily rows, this box, one sqlite connection (scratch script, read-only):
        nothing else running in the process ............. 1.7 ms
        ONE other thread busy in Python ................. 1,640 ms   (~1,000x)
        TWO other threads busy .......................... 42,900 ms

The web pod is one process with dozens of background threads (live bars, revalidation
after every chart request, schedulers). On production the SAME 852-row read of one
ticker's daily bars answered in 3 ms inside `/api/bars` and then took 900 to 1,500 ms
inside `/api/signature/columns` a moment later (`Server-Timing: rs-bars`), which is what
left a chart's RS panes blank for 1.2 to 2.0 s behind its candles on every symbol
change. The read was never slow; the hand-offs around it were.

A shorter interval bounds each hand-off, so the same read costs at most N x interval
instead of N x 5 ms. The price is more frequent switching between threads that are both
busy in Python: a few percent of their throughput, on a process whose job is answering
requests.

Knob: ``PY_SWITCH_INTERVAL_MS`` (milliseconds). Unset means `DEFAULT_MS`. ``5`` restores
the interpreter's own default. A value that is not a number, or is outside
[`MIN_MS`, `MAX_MS`], changes NOTHING (the interpreter's interval is left as it is) and
says so: a typo must not silently become an extreme setting.
"""
from __future__ import annotations

import os
import sys

ENV = "PY_SWITCH_INTERVAL_MS"
#: Ten times shorter than the interpreter's 5 ms.
DEFAULT_MS = 0.5
MIN_MS = 0.05
MAX_MS = 10.0


def resolve(raw: str | None) -> float | None:
    """The interval to set, in milliseconds, or None to leave the interpreter alone.

    Unset or blank means the default. Anything unparseable or out of range means None:
    refused, never clamped, so the value in force is always one somebody chose.
    """
    if raw is None or not str(raw).strip():
        return DEFAULT_MS
    try:
        ms = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if ms != ms or not (MIN_MS <= ms <= MAX_MS):          # NaN, or outside the range
        return None
    return ms


def apply(environ=None) -> dict:
    """Set the switch interval from the environment. Never raises.

    Returns ``{"applied": bool, "ms": float, "was_ms": float, "raw": str | None}`` where
    ``ms`` is the interval in force after the call.
    """
    # The literal read is what the flag ledger's AST scan recognises (`knobs` row in
    # docs/feature_flags.json); `environ` is a test's stand-in.
    raw = os.environ.get("PY_SWITCH_INTERVAL_MS") if environ is None else environ.get(ENV)
    was_ms = sys.getswitchinterval() * 1000.0
    ms = resolve(raw)
    if ms is None:
        return {"applied": False, "ms": was_ms, "was_ms": was_ms, "raw": raw}
    try:
        sys.setswitchinterval(ms / 1000.0)
    except Exception:                                      # noqa: BLE001 - a tuning step never fails a boot
        return {"applied": False, "ms": sys.getswitchinterval() * 1000.0, "was_ms": was_ms, "raw": raw}
    return {"applied": True, "ms": sys.getswitchinterval() * 1000.0, "was_ms": was_ms, "raw": raw}
