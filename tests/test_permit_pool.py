"""Wave 7 lane G, fix round 1 (I-1) -- `PermitPool`, the bounded worker pool
behind document extraction and OCR.

What these rails hold:

  * THE BOUND IS THE SEMAPHORE: however many jobs are queued, no more worker
    threads exist than the semaphore has permits, and every permit comes back.
  * EVERY JOB RUNS, EXACTLY ONCE -- including the one queued in the instant a
    worker has seen an empty queue but not yet released its permit (the race
    `_drain` re-checks for). That interleaving is FORCED here, not hoped for.
  * A job that raises costs that job only.
"""
from __future__ import annotations

import threading
import time

from api.services.journal_two.permit_pool import PermitPool


def _live(name: str) -> int:
    return sum(1 for t in threading.enumerate() if t.name == name and t.is_alive())


def _wait(pred, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(0.005)
    return pred()


def test_a_burst_never_holds_more_threads_than_permits_and_every_job_runs():
    sem = threading.Semaphore(2)
    pool = PermitPool("test-pool-burst", sem)
    release = threading.Event()
    ran = []
    lock = threading.Lock()

    def job(i):
        release.wait(10)
        with lock:
            ran.append(i)

    for i in range(40):
        pool.submit(job, i)
    assert _wait(lambda: _live("test-pool-burst") == 2)
    time.sleep(0.05)
    assert _live("test-pool-burst") == 2, "a queued job must not get a thread of its own"
    assert pool.pending() == 38
    release.set()
    assert _wait(lambda: len(ran) == 40)
    assert sorted(ran) == list(range(40)), "every job ran, exactly once"
    assert _wait(lambda: _live("test-pool-burst") == 0)
    assert sem._value == 2, "every permit came back"


def test_a_job_queued_while_the_last_worker_is_releasing_still_runs():
    """⛔ The race. The worker has seen the queue empty and is about to give its
    permit back; a job arrives in exactly that instant, finds no free permit,
    and starts nobody. Forced deterministically: the permit's `release` submits
    the second job before it releases. Without the re-check after release, the
    second job is stranded."""
    ran = []
    pool_box = {}

    class ReleaseHook(threading.Semaphore):
        fired = False

        def release(self, n=1):
            if not self.fired:
                self.fired = True
                pool_box["pool"].submit(ran.append, "second")   # finds no permit
            super().release(n)

    pool = pool_box["pool"] = PermitPool("test-pool-race", ReleaseHook(1))
    pool.submit(ran.append, "first")
    assert _wait(lambda: ran == ["first", "second"]), f"stranded: ran={ran}"
    assert _wait(lambda: _live("test-pool-race") == 0)


def test_many_submitters_every_job_exactly_once():
    sem = threading.Semaphore(3)
    pool = PermitPool("test-pool-many", sem)
    seen = []
    lock = threading.Lock()

    def job(i):
        with lock:
            seen.append(i)

    gate = threading.Barrier(8)

    def submitter(base):
        gate.wait()
        for k in range(250):
            pool.submit(job, base * 1000 + k)

    threads = [threading.Thread(target=submitter, args=(b,)) for b in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert _wait(lambda: len(seen) == 2000)
    assert sorted(seen) == sorted(b * 1000 + k for b in range(8) for k in range(250))
    assert _wait(lambda: sem._value == 3)


def test_a_failing_job_costs_that_job_only():
    sem = threading.Semaphore(1)
    pool = PermitPool("test-pool-fail", sem)
    ran = []

    def boom():
        raise RuntimeError("one bad document")

    pool.submit(boom)
    pool.submit(ran.append, "after")
    assert _wait(lambda: ran == ["after"])
    assert _wait(lambda: sem._value == 1)
