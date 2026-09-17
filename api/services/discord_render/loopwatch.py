"""Measure how long the ONE event loop is blocked, continuously (step 2.4b P2.9; C-02).

`web` is a single uvicorn process with one event loop shared by the whole dashboard. When that loop
is blocked, two things fail together and neither says why: Discord's 3-second acknowledgement, and
the renderer's page load. They co-occurred **37× more often than chance** — that is C-02, and it is
the single fact the V2 architecture is shaped around.

⛔⛔ AND IT WAS COMPLETELY UNMEASURED. `/api/health` returns 200 with a rising uptime straight
through a blocked loop; the alert rules read the jobs table, which cannot see a stall that happens
BEFORE a job exists. Everything we had answered a question next to the one that matters.

**How it measures.** A task sleeps `INTERVAL_S` and compares the wall clock against what it asked
for. The overshoot is time the loop could not get back to it — which is, by definition, time it
spent inside something that did not yield. ⭐ There is no way to blame a particular caller from
here, and this deliberately does not try: it reports THAT the loop stalled and for how long, which
is the fact nobody had. Attribution is a profiler's job, on a pod that is already known to be sick.

⛔ THE SAMPLE IS THE MAXIMUM, NOT THE MEAN. A loop that is fine 99% of the time and blocked for 4
seconds once has failed one member completely, and an average over a minute renders that as 40 ms —
healthy-looking. `p95` and `max` are reported; the mean is deliberately absent.

⛔ AND IT COSTS ONE TIMER PER INTERVAL. It is on the loop it measures, which is the only place it
CAN be: a thread cannot observe the loop's responsiveness, only its own. `INTERVAL_S` is 0.5 s, so
the probe itself is two wake-ups a second on a loop that already serves hundreds.
"""
from __future__ import annotations

import asyncio
import os
import time

#: How often to take a reading. Small enough to catch a one-second stall, large enough to be free.
INTERVAL_S = 0.5
#: Readings kept. At 0.5 s that is the last ~5 minutes, which matches the shortest alert window.
WINDOW = 600
#: A stall under this is scheduling noise, not a finding. Measured on an idle loop this box runs at
#: 1–4 ms; 50 ms is well clear of that and well under the 3 s that costs a member their reply.
NOISE_MS = 50.0
ENV = "DISCORD_RENDER_LOOPWATCH_ENABLED"


def enabled() -> bool:
    """A kill switch, so unset means ON — there is nothing to protect by leaving a measurement off,
    and a flag nobody set must not be indistinguishable from a deliberate shutdown."""
    return str(os.environ.get(ENV, "")).strip().lower() not in ("0", "false", "no", "off")


class LoopWatch:
    """One reading every `INTERVAL_S`, for as long as it runs. Never raises into the loop."""

    def __init__(self, *, interval_s: float = INTERVAL_S, window: int = WINDOW,
                 clock=time.perf_counter, sleep=None):
        self.interval_s = interval_s
        self.window = window
        self._clock = clock
        self._sleep = sleep or asyncio.sleep
        self.samples: list[float] = []
        self.started_at: float | None = None
        self._task: asyncio.Task | None = None
        self._stop = False

    def record(self, overshoot_ms: float) -> None:
        """⛔ NEGATIVE OVERSHOOT IS CLAMPED TO ZERO, NOT DISCARDED. A clock that reports the sleep
        finishing early is a clock problem, and dropping the reading would quietly shrink the
        denominator — the sample count is what tells an operator the probe was alive."""
        self.samples.append(max(0.0, overshoot_ms))
        if len(self.samples) > self.window:
            del self.samples[:-self.window]
        # ⛔ THE TRAILING WINDOW FORGETS. It holds `window` samples (~5 min at 0.5 s), so a stall
        # older than that is GONE from `snapshot()`. Every "max" this programme has quoted was a
        # window max, never a pod max, and the first census could only bracket events by watching
        # the window rise and fall. The durable record (R30) keeps each stall with its wall-clock
        # and uptime so it can be joined to what the pod was doing — which is what OI-44's
        # attribution needs. It also carries the only page path that is not V2-gated (OI-45).
        try:
            from api.services.discord_render import stall_record
            stall_record.note(max(0.0, overshoot_ms), uptime_s=self.uptime_s(),
                              commit=(os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12])
        except Exception:  # noqa: BLE001 — the probe must never be what breaks the loop
            pass

    def uptime_s(self) -> float:
        """Seconds since this watcher started. The watcher starts in the lifespan, so this is
        the pod's age for every practical purpose — and it is the input to R34's tier-2 floor."""
        return (time.time() - self.started_at) if self.started_at else 0.0

    async def _run(self) -> None:
        while not self._stop:
            asked = self.interval_s
            before = self._clock()
            try:
                await self._sleep(asked)
            except asyncio.CancelledError:
                return
            self.record(((self._clock() - before) - asked) * 1000.0)

    def start(self) -> "LoopWatch":
        """⛔ MUST BE CALLED ON THE LOOP IT MEASURES. From a worker thread there is no running loop
        to attach to; rather than raise into a lifespan, it stays un-started and `snapshot()` says
        `running: False` — which is a reading an operator can act on, unlike a probe that claims to
        be fine because it never ran."""
        if self._task is None:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return self
            self.started_at = time.time()
            self._task = asyncio.ensure_future(self._run())
        return self

    def stop(self) -> None:
        self._stop = True
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def snapshot(self) -> dict:
        """What `/renderhealth` prints and the alert rule reads.

        ⛔ `samples: 0` IS A DISTINCT ANSWER FROM A HEALTHY LOOP. A probe that never ran and a loop
        that never stalled both produce no stalls; only the count separates them, and reporting a
        cheerful `max_ms: 0` for a probe that is not running is the proxy-reading-zero defect."""
        n = len(self.samples)
        if not n:
            return {"running": self._task is not None, "samples": 0, "max_ms": None,
                    "p95_ms": None, "stalls": None}
        ordered = sorted(self.samples)
        idx = min(n - 1, int(round(0.95 * (n - 1))))
        return {"running": self._task is not None, "samples": n,
                "max_ms": round(ordered[-1], 1), "p95_ms": round(ordered[idx], 1),
                "stalls": sum(1 for s in self.samples if s > NOISE_MS)}


_WATCH: LoopWatch | None = None


def get() -> LoopWatch | None:
    return _WATCH


def start() -> LoopWatch | None:
    """Called from the lifespan, on the loop it measures."""
    global _WATCH
    if not enabled():
        return None
    if _WATCH is None:
        _WATCH = LoopWatch().start()
    return _WATCH


def stop() -> None:
    global _WATCH
    w, _WATCH = _WATCH, None
    if w is not None:
        w.stop()


def snapshot() -> dict:
    w = _WATCH
    return w.snapshot() if w is not None else {"running": False, "samples": 0, "max_ms": None,
                                               "p95_ms": None, "stalls": None}
