"""A StreamingResponse that releases what its stream took, even if the body never starts.

Review of #2751, F: an async generator's `finally` runs only once the generator has taken a step. A response
torn down before that (the client gone at `http.response.start`, Starlette's disconnect listener cancelling
the body task first) never steps it, so whatever the route acquired before returning (an admission slot,
upstream interest, a fan-out registration) leaks until the process restarts.

`ReleasingStreamingResponse(content, on_close=release)` calls `release` in a `finally` around the whole ASGI
call, so it runs on every exit: normal end, disconnect, cancellation, a failed first send. `release` must be
idempotent (the generator's own `finally` calls it too); `release_once` makes any callable so.

Used by /api/stream/quotes (api/routers/quote_stream.py). /api/stream/bars has the same shape and can adopt it
with the same two lines (not done in the PR that added this: another session is editing that generator).
"""
from __future__ import annotations

import logging
from typing import Callable

from fastapi.responses import StreamingResponse

log = logging.getLogger("api.sse_response")


def release_once(fn: Callable[[], None]) -> Callable[[], None]:
    """`fn`, callable any number of times, run at most once; an exception is logged, never raised."""
    done = [False]

    def release() -> None:
        if done[0]:
            return
        done[0] = True
        try:
            fn()
        except Exception as e:  # noqa: BLE001 - a release must never mask the stream's own outcome
            log.warning("[sse_response] release failed: %s: %s", type(e).__name__, e)

    return release


class ReleasingStreamingResponse(StreamingResponse):
    def __init__(self, content, *, on_close: Callable[[], None], **kwargs):
        super().__init__(content, **kwargs)
        self._on_close = on_close

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._on_close()
