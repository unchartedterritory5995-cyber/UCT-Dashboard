"""The spine every adapter shares: one bounded, breakered, timed call (03 §3.8; step 2.4b P2.1).

`guarded(...)` is the only way an adapter reaches an upstream. It owns, in this order:

  1. **The budget.** The effective timeout is `min(this dependency's timeout, the job's remaining
     time)` — never the dependency's constant alone.
  2. **The breaker.** Open means the call is not made at all (`BREAKER_OPEN`), so the next member
     does not wait for a failure we already know about.
  3. **The retry**, with jitter, inside the same budget.
  4. **The clock**, so `elapsed_ms` is measured rather than assumed.

⛔⛔ A DEPENDENCY TIMEOUT IS NOT A DEADLINE, AND CONFUSING THEM IS A LIVE DEFECT. Measured
2026-09-13: `discord_chart_house.RENDER_TIMEOUT_S` is **60 s** over **two** attempts, behind a
**15 s** job deadline. The watchdog fires at 15 s, the member is told the render failed — and the
request runs on for another 105 seconds holding a worker. A per-dependency timeout answers "how long
may this upstream take"; only the job knows "how long is there left". Both, and the smaller wins.

⛔⛔ A PYTHON THREAD CANNOT BE CANCELLED, AND THIS MODULE DOES NOT PRETEND OTHERWISE. Every upstream
on this path is sync and blocking, so a timeout here means *we stop waiting*, not *it stops running*.
The abandoned call keeps a pool thread until the socket gives up. That is why the pool is BOUNDED and
named per dependency: a wedged upstream can consume its own pool and nothing else — and
`abandoned_calls()` reports it rather than letting it look like a healthy system that is merely slow.
This was C-02 with the whole 64-thread anyio pool, and the lesson was the bound, not the timeout.
"""
from __future__ import annotations

import concurrent.futures as cf
import threading
import time

from api.services.discord_render import breakers
from api.services.discord_render.adapters.result import (
    BREAKER_OPEN, DEADLINE, TIMEOUT, UNREACHABLE, UPSTREAM_ERROR, Result, fail,
)

#: Below this there is no point starting: a call given 200 ms cannot connect, and the member is
#: better served by the honest class now than by a spinner that is already out of time.
MIN_USEFUL_S = 0.25

#: One bounded pool per dependency, created on demand. Small on purpose — see the docstring.
_POOLS: dict[str, cf.ThreadPoolExecutor] = {}
_POOL_LOCK = threading.Lock()
_ABANDONED: dict[str, int] = {}

#: Threads per dependency. A wedged upstream can hold at most this many, and then its own calls fail
#: fast (`TIMEOUT` on the queue) while every other dependency is untouched.
POOL_SIZE = {"renderer": 4, "flow": 4, "bars": 4, "quote": 2, "entity": 2}
DEFAULT_POOL_SIZE = 2


def pool(name: str) -> cf.ThreadPoolExecutor:
    with _POOL_LOCK:
        p = _POOLS.get(name)
        if p is None:
            p = cf.ThreadPoolExecutor(max_workers=POOL_SIZE.get(name, DEFAULT_POOL_SIZE),
                                      thread_name_prefix=f"drender-{name}")
            _POOLS[name] = p
        return p


def abandoned_calls() -> dict[str, int]:
    """Calls we stopped waiting for, per dependency. ⛔ NOT the same as failures: an abandoned call
    may still succeed upstream. It is reported separately because a rising count means threads are
    being consumed by something that is not answering, which no success/failure ratio can show."""
    with _POOL_LOCK:
        return dict(_ABANDONED)


def reset_for_tests() -> None:
    with _POOL_LOCK:
        for p in _POOLS.values():
            p.shutdown(wait=False)
        _POOLS.clear()
        _ABANDONED.clear()
    breakers.reset_all_for_tests()


def budget(dep_timeout_s: float, remaining_s: float | None) -> float:
    """The effective timeout. `remaining_s=None` means the caller has no deadline (a warm, a probe),
    in which case the dependency's own timeout stands."""
    if remaining_s is None:
        return dep_timeout_s
    return min(dep_timeout_s, max(0.0, remaining_s))


class _Budget:
    """The whole call's budget, and the ONLY way to get a number out of it is to ask the clock.

    ⛔⛔ THIS CLASS EXISTS TO MAKE THE ONCE-PER-CALL DERIVATION UNWRITABLE, NOT MERELY UNWRITTEN.
    ⚰️ The defect it closes: `guarded` computed the effective timeout once and handed that same
    float to every attempt, so an N-attempt hop could spend N × the budget. Lane E's chaos harness
    measured **4.6 s against a 2 s deadline**. The fix at integration re-derived the number inside
    the attempt — correct, and one edit away from being undone, because the once-per-call float was
    still sitting in scope with a name on it.

    ⭐ So the attempt runner is handed THIS, never a float. `remaining()` subtracts the clock every
    time it is called; there is no accessor that returns a stored per-attempt number, and
    `total_s` is deliberately named for what it is — the whole call's ceiling, a REPORTING figure
    (`budget_s` in the failure meta) and never a per-attempt one. Handing a float to `_attempt`
    now raises `AttributeError` on the first line instead of quietly overrunning the deadline.

    ⛔ `wait()` is the same rule for the retry backoff. `_call`'s own docstring has always
    promised "the retry, with jitter, INSIDE the same budget" and the code did not do it: the
    jittered delay was slept in full regardless of how much time was left, so a hop could refuse
    every remaining attempt for want of budget and still sit past its deadline sleeping between
    them. The upstream work was bounded; the CALL was not, and the member had already been
    answered. (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`.)
    """

    __slots__ = ("total_s", "_started", "_now")

    def __init__(self, total_s: float, started: float, now):
        self.total_s = total_s
        self._started = started
        self._now = now

    def remaining(self) -> float:
        """Seconds left of the whole call, read from the clock NOW. Can be zero or negative."""
        return self.total_s - (self._now() - self._started)

    def elapsed_ms(self) -> float:
        return (self._now() - self._started) * 1000.0

    def wait(self, seconds: float, sleep) -> None:
        """Sleep `seconds`, or whatever is left of the budget — whichever is shorter."""
        sleep(max(0.0, min(seconds, self.remaining())))


def _attempt(name: str, fn, budget: _Budget):
    """ONE attempt. The budget is read HERE, from the clock, and nowhere else.

    ⛔⛔ MODULE-LEVEL ON PURPOSE — DO NOT MOVE IT BACK INSIDE `guarded`. As a closure it could see
    `eff`, the whole-call float, and passing that to `submit` is a one-token edit that reads as
    correct and silently restores the N × budget overrun. Out here `eff` is not a name that
    exists, so the wrong version cannot be typed; `__code__.co_freevars` is `()` and
    `test_the_per_attempt_budget_derivation_is_the_only_shape_the_source_allows` reads that from
    the parse tree and fails by name if it ever stops being true.

    ⭐ `budget` shadows the module-level `budget()` helper inside this function, deliberately: the
    only budget reachable from an attempt is the live one.
    """
    left = budget.remaining()
    if left < MIN_USEFUL_S:
        raise cf.TimeoutError(f"{name}: {left:.3f}s left of a {budget.total_s:.3f}s budget")
    fut = pool(name).submit(fn, left)
    try:
        return fut.result(timeout=left)
    except cf.TimeoutError:
        fut.cancel()                       # only helps if it never started; honest either way
        with _POOL_LOCK:
            _ABANDONED[name] = _ABANDONED.get(name, 0) + 1
        raise
    # ⛔ No `except Exception` here. The breaker must SEE the dependency's own failure, and a
    # swallow at this level is how four causes became one sentence (C-08).


def guarded(name: str, fn, *, dep_timeout_s: float, remaining_s: float | None = None,
            corr_id: str | None = None, attempts: int = 1, retry_on=(Exception,),
            timeout_on: tuple = (), unreachable_on: tuple = (), provider: str | None = None,
            sleep=time.sleep, now=time.monotonic) -> Result | float:
    """Run `fn(timeout_s)` under the budget, the breaker and the clock.

    Returns a `Result` when the call did not produce data — `DEADLINE`, `BREAKER_OPEN`, `TIMEOUT` or
    `UPSTREAM_ERROR`, each named. On success it returns the pair `(value, elapsed_ms)` so the adapter
    can build the envelope from the payload it alone understands; the spine does not know what bars,
    a quote or a PNG look like and must not guess.

    ⛔ `fn` RECEIVES THE EFFECTIVE TIMEOUT. An adapter that ignores the argument and passes its own
    constant to the client has re-created the defect this exists to close;
    `test_the_function_is_handed_the_effective_timeout_not_the_constant` is the rail, and
    `test_the_bars_adapter_is_bounded_by_the_job_and_not_by_its_own_constant` is the same check one
    level up, on a real adapter.
    """
    started = now()
    eff = budget(dep_timeout_s, remaining_s)
    if eff < MIN_USEFUL_S:
        return fail(DEADLINE, provider=provider or name, corr_id=corr_id, elapsed_ms=0.0,
                    budget_s=round(eff, 3), dep_timeout_s=dep_timeout_s)

    # ⛔⛔ THE BUDGET IS RE-READ PER ATTEMPT, AND `_Budget` IS WHAT MAKES THAT THE ONLY PATH.
    # ⚰️ `eff` was handed to every attempt, so an N-attempt hop could spend N × the budget — Lane
    # E's chaos harness measured **4.6 s against a 2 s deadline** with the bars adapter's own
    # `ATTEMPTS = 2`. The live blast radius was zero only by luck: `bindings` passes `attempts=1`
    # for an unrelated reason (OI-25, the caller already retries), so the layer built to stop an
    # upstream overrunning the deadline would have overrun it itself the moment anyone used its own
    # default. ⭐ `eff` is used below for the DEADLINE pre-check only; from here on the single
    # authority over "how long is there left" is `job_budget`, and the attempt runner is a
    # module-level function that cannot see `eff` at all.
    job_budget = _Budget(eff, started, now)

    try:
        value = breakers.call(name, lambda: _attempt(name, fn, job_budget),
                              attempts=attempts, retry_on=retry_on,
                              # ⛔ THE BACKOFF IS INSIDE THE BUDGET TOO, which is what this module's
                              # own docstring has always claimed. Without this a hop refuses its
                              # remaining attempts for want of time and then sleeps past the
                              # deadline anyway, having already answered the member.
                              sleep=lambda s: job_budget.wait(s, sleep))
    except breakers.BreakerOpen:
        return fail(BREAKER_OPEN, provider=provider or name, corr_id=corr_id,
                    elapsed_ms=job_budget.elapsed_ms(), breaker=breakers.breaker(name).snapshot())
    except (cf.TimeoutError, *timeout_on) as e:
        # ⛔ TWO KINDS OF TIMEOUT, ONE CLASS. `cf.TimeoutError` is US giving up on the wait;
        # `timeout_on` is the CLIENT giving up on the socket (`httpx.TimeoutException`). The member
        # experience is identical and the operator action is identical, so they are one class —
        # but the spine cannot know a client's exception vocabulary, so the adapter declares it.
        # ⚰️ Without this, an `httpx.TimeoutException` fell through to UPSTREAM_ERROR, and flow's
        # fallback rule ("do not start the slower leg when the budget is gone") read it as a
        # transport error and started the slower leg anyway. Caught by its own test.
        return fail(TIMEOUT, provider=provider or name, corr_id=corr_id,
                    elapsed_ms=job_budget.elapsed_ms(), budget_s=round(job_budget.total_s, 3),
                    attempts=attempts, via="client" if not isinstance(e, cf.TimeoutError) else "wait")
    except unreachable_on as e:
        # ⛔ "COULD NOT REACH IT" IS NOT "IT ANSWERED WITH AN ERROR". Different sentence to a member,
        # different next action for us, and in the flow adapter it is what decides whether the
        # in-process fallback runs at all. C-08 was these two sharing one `except`.
        return fail(UNREACHABLE, provider=provider or name, corr_id=corr_id,
                    elapsed_ms=job_budget.elapsed_ms(), error=type(e).__name__)
    except Exception as e:  # noqa: BLE001 — named, not swallowed: the class reaches the member
        return fail(UPSTREAM_ERROR, provider=provider or name, corr_id=corr_id,
                    elapsed_ms=job_budget.elapsed_ms(), error=type(e).__name__)
    return value, job_budget.elapsed_ms()


def is_result(outcome) -> bool:
    """`guarded` returned a failure rather than a value. Written out so a call site reads as a
    question about what happened, not as an isinstance check nobody re-reads."""
    return isinstance(outcome, Result)
