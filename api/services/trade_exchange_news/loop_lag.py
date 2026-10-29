"""⏱ LATENCY AUDIT -- how late web's event loop runs (measurement only).

Every ``INTERVAL_S`` the sampler asks to wake up; how much LATER than asked it
actually woke is the time some other coroutine (or a blocking call) held the
loop. A slow ingest answer with a large lag here is web being busy; a slow
answer with no lag is the work itself (or the network). One tiny task, one
deque of floats -- no content, no I/O.
"""
from __future__ import annotations

import asyncio
import collections
import time

INTERVAL_S = 0.25
WINDOW = 240                         # the last minute at INTERVAL_S


class LoopLag:
    def __init__(self) -> None:
        self.samples: collections.deque[float] = collections.deque(maxlen=WINDOW)
        self._task: asyncio.Task | None = None

    async def _run(self) -> None:
        while True:
            t0 = time.perf_counter()
            await asyncio.sleep(INTERVAL_S)
            self.samples.append(max(0.0, (time.perf_counter() - t0 - INTERVAL_S) * 1000))

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def snapshot(self) -> dict[str, float | int | None]:
        s = sorted(self.samples)
        if not s:
            return {"n": 0, "p50_ms": None, "p95_ms": None, "max_ms": None, "last_ms": None}
        return {"n": len(s), "p50_ms": round(s[len(s) // 2], 1),
                "p95_ms": round(s[min(len(s) - 1, int(0.95 * (len(s) - 1)))], 1),
                "max_ms": round(s[-1], 1), "last_ms": round(self.samples[-1], 1)}


LAG = LoopLag()
