"""A bounded pool of background workers whose size IS a semaphore's permits.

Wave 7 lane G, fix round 1 (I-1). Document extraction and OCR both used to start
ONE DAEMON THREAD PER DOCUMENT and let the thread wait on a small semaphore. The
semaphore bounded how many ran at once; nothing bounded how many threads were
waiting. Email-in can deliver 20 attachments in one message, so a burst of mail
became a burst of parked threads on the one web process.

Here a worker thread exists only while it HOLDS a permit: `submit` queues the
job and starts a worker only if a permit is free; a worker drains the queue and
gives its permit back when the queue is empty. So the live thread count is at
most the semaphore's size, the queue holds only the job's arguments (a document
id), and the semaphore stays the one number that decides the bound -- the
release rails that pin `J2_OCR_MAX_CONCURRENCY` to `_OCR_SEMAPHORE` still mean
what they say.

⛔ THE RACE THIS HAS TO GET RIGHT. A job queued in the instant between a worker
seeing an empty queue and that worker releasing its permit finds no free permit
and starts nobody. So a worker checks the queue again AFTER releasing, and takes
a permit back to run what it finds. A job is appended BEFORE its submitter tries
for a permit, so whoever holds the permit at that moment re-checks after the job
is already there.

⚠️ Per-process state, like every other bound on this single web process
(CLAUDE.md, "SINGLE-PROCESS assumptions"): a second instance doubles it.
"""
from __future__ import annotations

import collections
import logging
import threading
from typing import Any, Callable

log = logging.getLogger(__name__)


class PermitPool:
    def __init__(self, name: str, semaphore: threading.Semaphore) -> None:
        self.name = name
        self._sem = semaphore
        self._jobs: collections.deque[tuple[Callable[..., Any], tuple[Any, ...]]] = (
            collections.deque())
        self._lock = threading.Lock()

    def submit(self, fn: Callable[..., Any], *args: Any) -> None:
        """Queue `fn(*args)`. Returns at once; never blocks on a busy pool."""
        with self._lock:
            self._jobs.append((fn, args))
        self._start_worker_if_a_permit_is_free()

    def pending(self) -> int:
        """Jobs queued and not yet started."""
        with self._lock:
            return len(self._jobs)

    def _start_worker_if_a_permit_is_free(self) -> None:
        if not self._sem.acquire(blocking=False):
            return      # every permit is held, and each holder drains the queue
        try:
            threading.Thread(target=self._drain, daemon=True, name=self.name).start()
        except BaseException:
            # No thread means nobody will release this permit. Give it back; the
            # job stays queued for the next worker.
            self._sem.release()
            raise

    def _drain(self) -> None:
        while True:
            try:
                while True:
                    with self._lock:
                        if not self._jobs:
                            break
                        fn, args = self._jobs.popleft()
                    try:
                        fn(*args)
                    except Exception as e:  # noqa: BLE001 — one job, never the worker
                        log.warning("[%s] job failed: %s", self.name, type(e).__name__)
            finally:
                self._sem.release()
            with self._lock:
                more = bool(self._jobs)
            if not more or not self._sem.acquire(blocking=False):
                return
