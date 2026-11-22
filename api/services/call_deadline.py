"""The wall-clock end of the work this thread is doing for someone.

A turn's deadline has to reach code that never sees the turn: a stream's read loop, a retry
loop in a provider wrapper, a wait on the browser. A ContextVar carries it there, with no
parameter threaded through every signature. Unset, nothing here changes anything.

Python cannot kill a thread, so this is cooperative: `cap()` shortens the next timeout and
`expired()` stops the next attempt. A single socket read that is already blocked ends at
its own timeout.
"""
from __future__ import annotations

import contextlib
import contextvars
import time

_end: contextvars.ContextVar = contextvars.ContextVar("call_deadline_end", default=None)


class Expired(Exception):
    """The deadline passed while a call was running. Not an HTTP error: the call may have been billed."""


class NotStarted(Expired):
    """The deadline passed before the call was sent, so nothing can have been billed."""


@contextlib.contextmanager
def until(at: float):
    """Everything in this block ends by `at` (time.monotonic). An inner scope can only shorten it."""
    outer = _end.get()
    token = _end.set(at if outer is None else min(outer, at))
    try:
        yield
    finally:
        _end.reset(token)


def left() -> float | None:
    """Seconds until the deadline, or None when there is none."""
    at = _end.get()
    return None if at is None else at - time.monotonic()


def expired() -> bool:
    remaining = left()
    return remaining is not None and remaining <= 0


def cap(timeout: float) -> float:
    """`timeout`, shortened to what is left. Past the deadline it RAISES: a tiny timeout would still send the
    request on a pooled connection, and the provider could bill it."""
    remaining = left()
    if remaining is None:
        return timeout
    if remaining <= 0:
        raise NotStarted()
    return min(timeout, remaining)
