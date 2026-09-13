"""Per-dependency circuit breakers and bounded retries for the Discord render path (03 §3.8).

Each dependency the render path can wait on — the renderer, flow-worker, the quote feed, bars —
gets its own breaker. When one is failing, the next member does NOT wait for it to fail again: the
breaker is open, the call is skipped, and the caller degrades immediately with an honest class.

⛔ ONE BREAKER PER DEPENDENCY, NEVER ONE SHARED. A shared breaker opened by flow-worker would stop
chart renders, which is the opposite of degrading: `/chart` and `/flow` fail for different reasons
and must fail independently.

⛔ THE HALF-OPEN PROBE IS SINGLE-FLIGHT. Without that, the moment the cooldown expires every waiting
request probes at once — the thundering herd that knocked the dependency over in the first place.
Exactly one caller is let through; the rest keep failing fast until it reports back.

⛔ RETRY JITTER IS NOT DECORATION. A fixed 1.5 s retry (what the bars path used) re-synchronises
every caller that failed together, so the retry storm arrives in one spike. The delay is drawn from
a range, so retries spread out.

State is per-process and that is correct: a breaker is a statement about what THIS pod just
experienced. `web` runs one uvicorn process (CLAUDE.md), and a pod that restarts should probe again
rather than inherit another pod's pessimism.
"""
from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass, field

CLOSED, OPEN, HALF_OPEN = "closed", "open", "half_open"


@dataclass
class BreakerConfig:
    #: consecutive failures that open the breaker
    fail_threshold: int = 5
    #: OR this share of the last `window` calls (belt and braces: a dependency failing every other
    #: call never reaches a consecutive count but is just as broken)
    fail_ratio: float = 0.5
    window: int = 20
    #: how long to stay open before letting ONE probe through
    cooldown_s: float = 15.0
    #: consecutive probe successes needed to close again
    close_after: int = 1


@dataclass
class BreakerState:
    state: str = CLOSED
    consecutive_failures: int = 0
    opened_at: float | None = None
    recent: list = field(default_factory=list)      # True = ok, False = failed
    probe_in_flight: bool = False
    trips: int = 0
    short_circuits: int = 0


class Breaker:
    """One dependency's breaker. Thread-safe; the render workers are real threads."""

    def __init__(self, name: str, config: BreakerConfig | None = None, *, now=time.monotonic):
        self.name = name
        self.config = config or BreakerConfig()
        self._now = now
        self._lock = threading.Lock()
        self._s = BreakerState()

    # ── the question a caller asks before doing the work ────────────────────
    def allow(self) -> bool:
        """True when the call should be attempted. False means "open — degrade now, do not wait".

        A `True` returned in HALF_OPEN is the single probe; the caller MUST report back through
        `record_success`/`record_failure`, or the breaker stays half-open with its probe consumed."""
        with self._lock:
            s, c = self._s, self.config
            if s.state == CLOSED:
                return True
            if s.state == OPEN:
                if s.opened_at is not None and self._now() - s.opened_at >= c.cooldown_s:
                    s.state = HALF_OPEN
                    s.probe_in_flight = True
                    return True
                s.short_circuits += 1
                return False
            # HALF_OPEN: exactly one probe at a time.
            if s.probe_in_flight:
                s.short_circuits += 1
                return False
            s.probe_in_flight = True
            return True

    def record_success(self) -> None:
        with self._lock:
            s = self._s
            s.consecutive_failures = 0
            s.recent.append(True)
            del s.recent[:-self.config.window]
            if s.state in (HALF_OPEN, OPEN):
                s.state = CLOSED
                s.opened_at = None
                s.recent.clear()          # a fresh window: the old failures are the outage, not now
            s.probe_in_flight = False

    def record_failure(self) -> None:
        with self._lock:
            s, c = self._s, self.config
            s.consecutive_failures += 1
            s.recent.append(False)
            del s.recent[:-c.window]
            if s.state == HALF_OPEN:      # the probe failed: straight back to open, full cooldown
                s.state = OPEN
                s.opened_at = self._now()
                s.probe_in_flight = False
                s.trips += 1
                return
            s.probe_in_flight = False
            enough = len(s.recent) >= c.window
            ratio = (s.recent.count(False) / len(s.recent)) if s.recent else 0.0
            if s.consecutive_failures >= c.fail_threshold or (enough and ratio >= c.fail_ratio):
                if s.state != OPEN:
                    s.trips += 1
                s.state = OPEN
                s.opened_at = self._now()

    # ── introspection (for /renderhealth and the alert rules) ───────────────
    def _state_locked(self) -> str:
        """⛔ CALLER HOLDS THE LOCK. `threading.Lock` is not reentrant, so a public property that
        re-acquires it deadlocks the moment another locked method calls it — which is exactly what
        `snapshot()` did, hanging a worker until pytest's timeout killed it."""
        s = self._s
        if s.state == OPEN and s.opened_at is not None and self._now() - s.opened_at >= self.config.cooldown_s:
            return HALF_OPEN              # cooldown elapsed: the next caller gets the probe
        return s.state

    @property
    def state(self) -> str:
        with self._lock:
            return self._state_locked()

    def snapshot(self) -> dict:
        with self._lock:
            s = self._s
            return {"name": self.name, "state": self._state_locked(),
                    "consecutive_failures": s.consecutive_failures,
                    "recent_failures": s.recent.count(False), "recent_calls": len(s.recent),
                    "trips": s.trips, "short_circuits": s.short_circuits,
                    "opened_for_s": round(self._now() - s.opened_at, 1) if s.opened_at else None}

    def reset(self) -> None:
        with self._lock:
            self._s = BreakerState()


class BreakerOpen(RuntimeError):
    """Raised by `call` when the breaker is open. Carries the dependency name for the failure class."""

    def __init__(self, name: str):
        super().__init__(f"{name} breaker open")
        self.name = name


# ── the registry: one breaker per dependency, created once ──────────────────

_REGISTRY: dict[str, Breaker] = {}
_REGISTRY_LOCK = threading.Lock()

#: Defaults per dependency. A renderer render is slow and expensive, so it tolerates fewer
#: consecutive failures than a cheap quote lookup before it stops making members wait.
DEFAULTS = {
    "renderer": BreakerConfig(fail_threshold=5, window=20, cooldown_s=15.0),
    "flow": BreakerConfig(fail_threshold=4, window=20, cooldown_s=30.0),
    "quote": BreakerConfig(fail_threshold=8, window=40, cooldown_s=20.0),
    "bars": BreakerConfig(fail_threshold=8, window=40, cooldown_s=10.0),
}


def breaker(name: str) -> Breaker:
    with _REGISTRY_LOCK:
        b = _REGISTRY.get(name)
        if b is None:
            b = Breaker(name, DEFAULTS.get(name) or BreakerConfig())
            _REGISTRY[name] = b
        return b


def snapshot_all() -> dict:
    with _REGISTRY_LOCK:
        names = list(_REGISTRY)
    return {n: _REGISTRY[n].snapshot() for n in names}


def reset_all_for_tests() -> None:
    with _REGISTRY_LOCK:
        _REGISTRY.clear()


# ── bounded retry with jitter ──────────────────────────────────────────────

def retry_delay(attempt: int, base_s: float = 0.4, spread_s: float = 0.5, *, rand=random.random) -> float:
    """Delay before `attempt` (1 = the first retry). `base_s` + up to `spread_s`, doubling per
    attempt. Jittered, because a fixed delay re-synchronises every caller that failed together."""
    return (base_s * (2 ** max(0, attempt - 1))) + rand() * spread_s


def call(name: str, fn, *, attempts: int = 1, retry_on=(Exception,), base_s: float = 0.4,
         spread_s: float = 0.5, sleep=time.sleep, rand=random.random):
    """Run `fn()` behind the named breaker, with `attempts` total tries (1 = no retry).

    Raises `BreakerOpen` WITHOUT calling `fn` when the breaker is open — that is the point: the
    member does not wait for a dependency we already know is down. Any other exception is the
    dependency's own, re-raised after the breaker has been told."""
    b = breaker(name)
    if not b.allow():
        raise BreakerOpen(name)
    last = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            out = fn()
        except retry_on as e:  # noqa: PERF203 — the retry IS the loop
            last = e
            if attempt >= attempts:
                b.record_failure()
                raise
            sleep(retry_delay(attempt, base_s, spread_s, rand=rand))
            continue
        except BaseException:
            b.record_failure()
            raise
        b.record_success()
        return out
    b.record_failure()                     # unreachable in practice; never silently return None
    raise last if last else RuntimeError(f"{name}: no attempt ran")
