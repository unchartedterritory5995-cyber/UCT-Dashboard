"""Boot-window probe: what is a stuck sync request actually waiting on?

⛔ MEASURED 2026-10-06 (web boot, "Application startup complete" 20:01:47 UTC). The
first `GET /api/research/estimates/TSM?consensus=1` entered its handler at 20:03:20.5
(the edge log and the `[ee-slow]` line agree to 0.1 s, so the anyio threadpool did NOT
hold it back). Its FMP leg finished in 0.3 s. Its Yahoo leg (`get_estimates`) took
147.7 s, and three later opens of the same symbol followed its single-flight and were
released with it at 20:05:48.25. `_fetch` (the only vendor call on that leg) is bounded
at 15 s and logs on timeout -- it logged nothing. So the leader sat ~130 s somewhere in
`_build_estimates` OUTSIDE the vendor call, and no instrument could say where.

This module answers "where" on the next boot, cheaply:

  * `track(label)` registers the calling thread for the duration of a block. A sampler
    dumps the STACK of any tracked thread that is still inside its block at 10 s, 30 s,
    90 s, 180 s and 360 s -- the frame it is parked in is the answer, whatever it is
    (an import, a lock, a SQLite read on a cold volume, a pool queue).
  * `note(stage)` records the last stage a tracked thread reached, printed beside it.
  * `run_sampler()` (an asyncio task, started from the lifespan) does the above every
    5 s for the life of the process, and for the first `BOOT_WINDOW_S` seconds also logs
    one `[boot-probe]` line per tick: anyio threadpool tokens borrowed/total/waiting,
    live threads, the yfinance pool queue, event-loop lag, process CPU and I/O deltas and
    the kernel's I/O pressure (Linux only, skipped elsewhere), and which threads are
    inside an `import` (the import statement's own file:line, never another thread's
    locals).

Every read here is best-effort and wrapped: an instrument must never fail the work it
watches. Log volume: <= 60 `[boot-probe]` lines per boot, plus at most five
`[slow-stack]` lines per genuinely stuck tracked block.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional

_log = logging.getLogger("boot_probe")

#: Process-relative zero. The module is imported by the research router at app import,
#: i.e. seconds after the process starts -- close enough for a boot-window gate.
_T0 = time.monotonic()

BOOT_WINDOW_S = 300.0        # `[boot-probe]` summary lines only inside this window
ENTRY_LOG_WINDOW_S = 600.0   # route-entry lines only inside this window
TICK_S = 5.0
STACK_AT_S = (10.0, 30.0, 90.0, 180.0, 360.0)
STACK_DEPTH = 16
_IMPORT_FILE = "<frozen importlib._bootstrap>"


def boot_age() -> float:
    """Seconds since this module was imported (~process start)."""
    return time.monotonic() - _T0


def in_entry_window() -> bool:
    return boot_age() < ENTRY_LOG_WINDOW_S


# ── tracked blocks ───────────────────────────────────────────────────────────

class _Entry:
    __slots__ = ("label", "t0", "stage", "stage_t", "next_idx", "thread_name")

    def __init__(self, label: str) -> None:
        self.label = label
        self.t0 = time.monotonic()
        self.stage = "enter"
        self.stage_t = self.t0
        self.next_idx = 0
        self.thread_name = threading.current_thread().name


_lock = threading.Lock()
_tracked: Dict[int, _Entry] = {}


class track:
    """`with boot_probe.track("ee-yf TSM"):` -- see the module docstring. Re-entrant on
    one thread (the inner block wins while it runs; the outer one is restored after)."""

    def __init__(self, label: str) -> None:
        self.label = label
        self._prev: Optional[_Entry] = None
        self._mine: Optional[_Entry] = None

    def __enter__(self) -> "track":
        try:
            self._mine = _Entry(self.label)
            ident = threading.get_ident()
            with _lock:
                self._prev = _tracked.get(ident)
                _tracked[ident] = self._mine
        except Exception:                      # noqa: BLE001 -- never fail the watched work
            pass
        return self

    def __exit__(self, *_exc) -> None:
        try:
            ident = threading.get_ident()
            with _lock:
                if _tracked.get(ident) is self._mine:
                    if self._prev is not None:
                        _tracked[ident] = self._prev
                    else:
                        del _tracked[ident]
        except Exception:                      # noqa: BLE001
            pass


def note(stage: str) -> None:
    """Record the stage the calling thread's tracked block has reached. No-op untracked."""
    try:
        e = _tracked.get(threading.get_ident())
        if e is not None:
            e.stage = stage
            e.stage_t = time.monotonic()
    except Exception:                          # noqa: BLE001
        pass


def tracked_count() -> int:
    with _lock:
        return len(_tracked)


# ── stack summaries ──────────────────────────────────────────────────────────

def _short(path: str) -> str:
    p = (path or "").replace("\\", "/")
    for marker in ("/site-packages/", "/api/", "/lib/python"):
        i = p.rfind(marker)
        if i >= 0:
            return p[i + 1:] if marker == "/api/" else p[i + len(marker):]
    return p.rsplit("/", 1)[-1]


def stack_summary(frame, depth: int = STACK_DEPTH) -> str:
    """Innermost-first `file:line fn` list, joined by ' < '. Reads code objects and line
    numbers only -- never another thread's locals."""
    parts: List[str] = []
    f = frame
    while f is not None and len(parts) < depth:
        co = f.f_code
        parts.append(f"{_short(co.co_filename)}:{f.f_lineno} {co.co_name}")
        f = f.f_back
    return " < ".join(parts)


def importing_threads(frames: Optional[Dict[int, Any]] = None,
                      names: Optional[Dict[int, str]] = None,
                      limit: int = 5) -> List[str]:
    """`thread-name@file:line` for each thread currently inside an import, where file:line
    is the `import` statement that started it (the outermost importlib frame's caller)."""
    frames = sys._current_frames() if frames is None else frames
    names = names if names is not None else {t.ident: t.name for t in threading.enumerate()}
    out: List[str] = []
    for ident, frame in frames.items():
        f, caller, seen = frame, None, False
        hops = 0
        while f is not None and hops < 200:
            if f.f_code.co_filename == _IMPORT_FILE:
                seen = True
                caller = f.f_back
            f = f.f_back
            hops += 1
        if not seen:
            continue
        where = (f"{_short(caller.f_code.co_filename)}:{caller.f_lineno}"
                 if caller is not None else "?")
        out.append(f"{names.get(ident, ident)}@{where}")
        if len(out) >= limit:
            break
    return out


def slow_stacks(now: Optional[float] = None,
                frames: Optional[Dict[int, Any]] = None) -> List[str]:
    """One line per tracked block that just crossed its next `STACK_AT_S` threshold."""
    now = time.monotonic() if now is None else now
    with _lock:
        due = []
        for ident, e in _tracked.items():
            if e.next_idx >= len(STACK_AT_S):
                continue
            age = now - e.t0
            if age < STACK_AT_S[e.next_idx]:
                continue
            while e.next_idx < len(STACK_AT_S) and age >= STACK_AT_S[e.next_idx]:
                e.next_idx += 1
            due.append((ident, e, age))
    if not due:
        return []
    frames = sys._current_frames() if frames is None else frames
    lines = []
    for ident, e, age in due:
        fr = frames.get(ident)
        stack = stack_summary(fr) if fr is not None else "(no frame)"
        lines.append(
            f"[slow-stack] {e.label} age={age:.1f}s stage={e.stage} "
            f"(+{now - e.stage_t:.1f}s in it) thread={e.thread_name} boot+{boot_age():.0f}s | {stack}"
        )
    return lines


# ── process / pool readings (all best-effort) ────────────────────────────────

def _anyio_tokens() -> str:
    try:
        import anyio
        lim = anyio.to_thread.current_default_thread_limiter()
        waiting = lim.statistics().tasks_waiting
        return f"{lim.borrowed_tokens:.0f}/{lim.total_tokens:.0f} waiting={waiting}"
    except Exception as exc:                   # noqa: BLE001
        return f"? ({type(exc).__name__})"


def _yf_pool() -> str:
    try:
        from api.services import yf_util
        pool = yf_util._POOL
        return f"q={pool._work_queue.qsize()} threads={len(pool._threads)}/{pool._max_workers}"
    except Exception:                          # noqa: BLE001
        return "?"


def _read_proc_io() -> Optional[Dict[str, int]]:
    try:
        with open("/proc/self/io", "r") as fh:
            out = {}
            for line in fh:
                k, _, v = line.partition(":")
                out[k.strip()] = int(v.strip())
            return out
    except Exception:                          # noqa: BLE001
        return None


def _io_pressure() -> Optional[str]:
    try:
        with open("/proc/pressure/io", "r") as fh:
            for line in fh:
                if line.startswith("full"):
                    return line.split()[1]     # "avg10=12.34"
    except Exception:                          # noqa: BLE001
        return None
    return None


class _Deltas:
    def __init__(self) -> None:
        self.cpu = time.process_time()
        self.wall = time.monotonic()
        self.io = _read_proc_io()

    def step(self) -> str:
        cpu, wall, io = time.process_time(), time.monotonic(), _read_proc_io()
        dw = max(1e-6, wall - self.wall)
        parts = [f"cpu={100.0 * (cpu - self.cpu) / dw:.0f}%"]
        if io and self.io:
            rb = (io.get("read_bytes", 0) - self.io.get("read_bytes", 0)) / dw / 1e6
            wb = (io.get("write_bytes", 0) - self.io.get("write_bytes", 0)) / dw / 1e6
            parts.append(f"disk r={rb:.1f}MB/s w={wb:.1f}MB/s")
        psi = _io_pressure()
        if psi:
            parts.append(f"io-full {psi}")
        self.cpu, self.wall, self.io = cpu, wall, io
        return " ".join(parts)


def summary_line(lag: float, deltas: _Deltas) -> str:
    names = {t.ident: t.name for t in threading.enumerate()}
    imp = importing_threads(names=names)
    return (f"[boot-probe] boot+{boot_age():.0f}s anyio {_anyio_tokens()} "
            f"threads={len(names)} yf {_yf_pool()} loop-lag={lag * 1000:.0f}ms "
            f"{deltas.step()} tracked={tracked_count()} "
            f"importing={len(imp)}{(' ' + ', '.join(imp)) if imp else ''}")


async def run_sampler(tick: float = TICK_S, boot_window: float = BOOT_WINDOW_S) -> None:
    """Forever: every `tick` s dump stacks of stuck tracked blocks; inside the boot window
    also log one `[boot-probe]` summary. Runs ON the event loop (the anyio limiter can only
    be read from it); every reading is a few ms."""
    deltas = _Deltas()
    while True:
        t_before = time.monotonic()
        await asyncio.sleep(tick)
        lag = max(0.0, time.monotonic() - t_before - tick)
        try:
            for line in slow_stacks():
                _log.warning(line)
            if boot_age() < boot_window:
                _log.info(summary_line(lag, deltas))
        except Exception as exc:               # noqa: BLE001 -- the probe never dies on a reading
            _log.debug("[boot-probe] tick failed: %s", exc)


def reset_for_tests() -> None:
    with _lock:
        _tracked.clear()
