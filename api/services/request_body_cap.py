"""Wave 14 -- ONE cap on a request body, enforced WHILE the body is read.

⛔ THE GAP THIS CLOSES (census row :264 and S-3 in
`docs/notebook/security-review-notebook-routes.md`). A route that checked only
the DECLARED `Content-Length` let a chunked upload, or one with no length, or
one whose length lied, be parsed IN FULL -- spooled to a temp file or buffered
in memory -- before any size check ran. The voice-notes door spooled up to
whatever reached it before the service's 90 MiB read cap; the note image, hero
and attachment doors buffered the whole upload before their 5 / 25 MiB checks.

THE MECHANISM, one place: `_arm` swaps the request's ASGI `receive` for a
counting one. Every byte the body parser (or `request.body()`) pulls goes
through it, and the pull that passes the cap raises `BodyTooLarge` -- before
that chunk is handed to the parser, so nothing past the cap is ever spooled.

  * `BodyTooLarge` IS a `MultiPartException`, deliberately: Starlette's
    multipart parser closes every temp file it opened when (and only when) a
    `MultiPartException` escapes the read loop. Any other exception type
    would leave the spooled parts to the garbage collector.
  * Starlette then turns it into a 400; the helper reads its own `tripped`
    flag and answers 413 with the route's sentence instead.
  * A declared `Content-Length` over the cap is refused before ONE byte is
    read; a malformed one is a 400.
  * The cap on a multipart body is the file's own cap plus `FRAMING_SLACK`
    (boundaries, part headers, the few small fields). The file's exact cap is
    then checked on the parsed part's size -- same 413, same sentence.

Limits are passed as CALLABLES read per request, so the route's constant stays
the one authority (a test that moves it moves the cap) -- and nothing here does
work at import (the 10/02 boot lesson): module constants only.
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Callable

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException

# Room for multipart framing around a file at its exact cap: the boundary
# lines, each part's headers and the routes' few short text fields.
FRAMING_SLACK = 64 * 1024

BAD_LENGTH_SENTENCE = "Bad Content-Length"


class BodyTooLarge(MultiPartException):
    """Raised by the counting receive. A MultiPartException so Starlette's
    parser closes its spooled temp files on the way out."""

    def __init__(self, limit: int) -> None:
        super().__init__(f"request body over {limit} bytes")
        self.limit = limit


class _Cap:
    __slots__ = ("limit", "seen", "tripped")

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.seen = 0
        self.tripped = False


def _arm(request: Request, limit: int, sentence: str) -> _Cap:
    """Refuse a declared length over `limit`; then make every later read of
    this request's body count, and stop at `limit`."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            n = int(declared)
        except ValueError:
            raise HTTPException(status_code=400, detail=BAD_LENGTH_SENTENCE) from None
        if n < 0:
            raise HTTPException(status_code=400, detail=BAD_LENGTH_SENTENCE)
        if n > limit:
            raise HTTPException(status_code=413, detail=sentence)

    cap = _Cap(limit)
    inner = request._receive

    async def counting_receive():
        message = await inner()
        if message.get("type") == "http.request":
            cap.seen += len(message.get("body", b"") or b"")
            if cap.seen > cap.limit:
                cap.tripped = True
                raise BodyTooLarge(cap.limit)
        return message

    request._receive = counting_receive
    return cap


async def read_capped_body(request: Request, limit: int, sentence: str) -> bytes:
    """The whole body, never more than `limit` bytes of it held. 413 with
    `sentence` past the cap, however the length was (or was not) declared."""
    cap = _arm(request, limit, sentence)
    try:
        return await request.body()
    except BodyTooLarge:
        raise HTTPException(status_code=413, detail=sentence) from None


async def read_capped_form(request: Request, limit: int, sentence: str, *,
                           max_files: int = 1, max_fields: int = 4) -> FormData:
    """The parsed multipart form, its body capped at `limit` while it streams.
    Past the cap: every part's temp file is already closed (see the module
    docstring) and the answer is 413 with `sentence`. Any other parse failure
    is re-raised for the route to word."""
    cap = _arm(request, limit, sentence)
    try:
        return await request.form(max_files=max_files, max_fields=max_fields)
    except Exception:
        if cap.tripped:
            raise HTTPException(status_code=413, detail=sentence) from None
        raise


def _missing(field: str) -> RequestValidationError:
    # The shape FastAPI gives a missing `File(...)` parameter.
    return RequestValidationError([{"type": "missing", "loc": ("body", field),
                                    "msg": "Field required", "input": None}])


def capped_upload(field: str, max_bytes: Callable[[], int],
                  sentence: Callable[[], str]) -> Callable[..., AsyncIterator[UploadFile]]:
    """A dependency standing in for `UploadFile = File(...)`: the one file in
    `field`, at most `max_bytes()` bytes, read with the body capped while it
    streams. Its temp file is closed when the request ends.

    ⛔ DECLARE IT AFTER THE ROUTE'S AUTH DEPENDENCY. FastAPI parses a `File(...)`
    parameter BEFORE any dependency runs, so an anonymous caller could make the
    process spool a body; a dependency runs in declaration order, so the auth
    check in front of this one refuses first."""

    async def dependency(request: Request) -> AsyncIterator[UploadFile]:
        limit, words = max_bytes(), sentence()
        form = await read_capped_form(request, limit + FRAMING_SLACK, words,
                                      max_files=1, max_fields=4)
        try:
            upload = form.get(field)
            if not isinstance(upload, UploadFile):
                raise _missing(field)
            if upload.size is None or upload.size > limit:
                raise HTTPException(status_code=413, detail=words)
            yield upload
        finally:
            await form.close()

    return dependency

