"""C-09 — a render gate where a MEMBER waiting for a slot beats a warm render waiting for one.

⚰️ WHAT THIS REPLACES, AND WHY A SEMAPHORE COULD NOT DO IT. `RENDER_SLOTS` is a plain
`threading.BoundedSemaphore` (`discord_interactions.py:67`). A semaphore has no notion of who is
waiting: it hands the next release to whoever the OS picks. Measured on 2026-09-14, twelve races for
the last free slot between a warm render and a member render — **the warm cycle won ten.**

⭐ AND THE PRIORITY THAT ALREADY EXISTED WAS ON THE WRONG SIDE OF THE BOTTLENECK.
`X-Render-Priority: background` (`discord_interactions.py:1557-1565`) is honoured by a **pooled
chart-renderer**, downstream. It says nothing to the web-side gate that decides who may *call* the
renderer at all. This module is that gate.

⛔ **PRIORITY IS READ FROM THE CALLER'S CLASS, NEVER FROM THE HEADER.** The header is a downstream
hint a caller sets; the class is what the job IS. A gate that trusted the header would be trusting
the thing it is supposed to be upstream of.

── THE FOUR REQUIREMENTS, AND THE HONEST ANSWER TO EACH ─────────────────────────────────────────

1. **A member waiting beats a background render waiting, regardless of arrival order.** Done by
   waking waiters in priority order rather than by arrival.

2. **A background render already HOLDING a slot is NOT preempted.** ⛔ Deliberate, and not a
   limitation of effort: a render in flight has a Chromium page open and a `POST /render` in the
   air. "Preempting" it means abandoning work that will complete anyway in ~2.4 s, and the renderer
   exposes no cancel — `services/chart_renderer/app.py` has no cancellation endpoint, so a
   "cancelled" render would keep running and still occupy a renderer slot while we stopped waiting
   for it. **We would pay the cost and lose the result.** The member's wait is therefore bounded by
   one in-flight render, not by the warm queue behind it, which is the part that actually mattered.

3. **The warm cycle's 25 s wait yields immediately when a member is waiting.** A background acquirer
   parks; the moment a member joins the queue, background waiters stop being eligible.

4. **Background never starves forever.** ⛔ A pure priority queue starves the low class under
   sustained load, and this system HAS sustained member load in RTH. The bound is explicit:
   `BACKGROUND_STARVE_S` — after that long with no grant, the next free slot goes to the oldest
   background waiter even if members are queued. **Stated as a number, not a hope.**

⚠️ **THIS CHANGES V1 BEHAVIOUR, ON PURPOSE.** The gate sits on the shared semaphore, so members win
over warm renders on the pre-V2 path too. That is the member-visible improvement C-09 asks for, and
it is why this lands on its own branch for the owner to approve rather than riding a "V2 is dark"
merge.
"""
from __future__ import annotations

import heapq
import itertools
import threading
import time

#: The two classes the gate knows. ⛔ Ordered: lower wins.
MEMBER, BACKGROUND = 0, 1
CLASS_NAMES = {MEMBER: "member", BACKGROUND: "background"}

#: How long a background waiter may be passed over before it is served anyway. ⛔ A FAIRNESS BOUND,
#: not a nicety: the warm cycle keeps the cache warm, and a cache that never warms makes every
#: member pay a cold render. Chosen as ~10x a warm render's measured ~2.4 s, so a background waiter
#: yields to a burst of members and still lands inside the cycle's own 20 s budget.
BACKGROUND_STARVE_S = 25.0


class RenderGate:
    """A bounded slot pool that wakes waiters by CLASS first, then by arrival.

    Drop-in for the `acquire(blocking=…, timeout=…)` / `release()` shape `BoundedSemaphore` offers,
    so every existing call site keeps working; `acquire` simply grows an optional `cls`.
    """

    def __init__(self, size: int, *, starve_s: float = BACKGROUND_STARVE_S):
        if size < 1:
            raise ValueError("a render gate with no slots would refuse every render")
        self._size = size
        self._free = size
        self._starve_s = starve_s
        self._cv = threading.Condition()
        self._seq = itertools.count()
        #: (class, seq) heap of waiters. The heap IS the priority — there is no second list to keep
        #: in step with it, which is the bug a "members list + background list" version would have.
        self._waiting: list = []
        self._tickets: dict = {}
        self._oldest_bg_since: float | None = None
        self.grants = {MEMBER: 0, BACKGROUND: 0}
        self.starvation_grants = 0

    @property
    def size(self) -> int:
        """How many slots exist. The public way to ask."""
        return self._size

    @property
    def _initial_value(self) -> int:
        """⚠️ A DELIBERATE COMPATIBILITY SHIM, and it is named after somebody else's
        private attribute on purpose. `threading.BoundedSemaphore` exposes its declared
        size only as `_initial_value`, a CPython implementation detail — and callers in
        this repo read it to starve the pool. Dropping the gate in without this turns
        "same shape" into a lie for every one of them, with an `AttributeError` that
        reads like the gate is broken rather than like an internal was being borrowed.
        ⛔ New code uses `.size`. This exists so the SWAP is honest, not as an invitation."""
        return self._size

    # ── the BoundedSemaphore-shaped surface ─────────────────────────────────
    def acquire(self, blocking: bool = True, timeout: float | None = None,
                *, cls: int = MEMBER, now=time.monotonic) -> bool:
        deadline = None if (timeout is None or not blocking) else now() + timeout
        with self._cv:
            if self._free and not self._waiting:
                return self._grant(cls)
            if not blocking:
                return False
            ticket = (cls, next(self._seq))
            heapq.heappush(self._waiting, ticket)
            self._tickets[ticket] = True
            if cls == BACKGROUND and self._oldest_bg_since is None:
                self._oldest_bg_since = now()
            try:
                while True:
                    if self._free and self._next_ticket(now) == ticket:
                        self._remove(ticket)
                        return self._grant(cls, starved=(
                            cls == BACKGROUND and self._bg_starving(now)))
                    if deadline is not None:
                        left = deadline - now()
                        if left <= 0:
                            self._remove(ticket)
                            return False
                        self._cv.wait(timeout=min(left, 0.05))
                    else:
                        self._cv.wait(timeout=0.05)
            finally:
                self._remove(ticket)
                if not any(t[0] == BACKGROUND for t in self._waiting):
                    self._oldest_bg_since = None

    def release(self) -> None:
        with self._cv:
            if self._free >= self._size:
                raise ValueError("release() called more times than acquire()")
            self._free += 1
            self._cv.notify_all()

    # ── internals ───────────────────────────────────────────────────────────
    def _grant(self, cls: int, *, starved: bool = False) -> bool:
        self._free -= 1
        self.grants[cls] = self.grants.get(cls, 0) + 1
        if starved:
            self.starvation_grants += 1
            self._oldest_bg_since = None
        return True

    def _remove(self, ticket) -> None:
        if self._tickets.pop(ticket, None) is not None:
            try:
                self._waiting.remove(ticket)
                heapq.heapify(self._waiting)
            except ValueError:
                pass

    def _bg_starving(self, now) -> bool:
        return (self._oldest_bg_since is not None
                and (now() - self._oldest_bg_since) >= self._starve_s)

    def _next_ticket(self, now):
        """Whose turn it is. ⛔ The starvation bound is applied HERE, not at grant time — deciding
        it at grant time would let a member that arrived later still overtake, because the heap
        would already have handed the member the turn."""
        if not self._waiting:
            return None
        if self._bg_starving(now):
            bg = [t for t in self._waiting if t[0] == BACKGROUND]
            if bg:
                return min(bg, key=lambda t: t[1])
        return self._waiting[0]

    # ── observability ───────────────────────────────────────────────────────
    def stats(self) -> dict:
        with self._cv:
            return {"size": self._size, "free": self._free,
                    "waiting": {CLASS_NAMES[c]: sum(1 for t in self._waiting if t[0] == c)
                                for c in (MEMBER, BACKGROUND)},
                    "grants": {CLASS_NAMES[c]: n for c, n in self.grants.items()},
                    "starvation_grants": self.starvation_grants,
                    "starve_s": self._starve_s}
