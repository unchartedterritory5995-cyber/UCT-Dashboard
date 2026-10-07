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
  * A JSON body goes through `capped_json`, a dependency that stands in for a
    declared body parameter. FastAPI reads a declared body before ANY dependency
    runs, so it could be neither capped nor ordered after a gate or a session.

Limits are passed as CALLABLES read per request, so the route's constant stays
the one authority (a test that moves it moves the cap) -- and nothing here does
work at import (the 10/02 boot lesson): module constants only.
"""
from __future__ import annotations

import email.message
import json
from typing import Any, AsyncIterator, Callable, NamedTuple, Optional

from fastapi import Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import TypeAdapter, ValidationError
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

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


def _is_json_content_type(value: Optional[str]) -> bool:
    """FastAPI's own rule for when a body is parsed as JSON: no Content-Type at
    all, or `application/json`, or `application/<anything>+json`. Kept exact: a
    `text/plain` body is one a cross-site form can send without a preflight."""
    if not value:
        return True
    message = email.message.Message()
    message["content-type"] = value
    if message.get_content_maintype() != "application":
        return False
    subtype = message.get_content_subtype()
    return subtype == "json" or subtype.endswith("+json")


def capped_json(annotation: Any, max_bytes: Callable[[], int], sentence: Callable[[], str], *,
                after: Optional[Callable[..., Any]] = None) -> Callable[..., Any]:
    """A dependency standing in for a declared JSON body parameter -- `body: Model`,
    `payload: dict`, `payload: dict | None = None` -- that reads the body CAPPED, and
    only AFTER `after` has run:

        def route(payload: dict = Depends(capped_json(dict, ..., after=get_current_user)),
                  user: dict = Depends(get_current_user)): ...

    ⛔ WHY A DEPENDENCY AND NOT THE PARAMETER. FastAPI reads the body for a declared
    body parameter BEFORE it solves any dependency: before a router's dark-flag gate,
    before the session check, and with no size limit. So an anonymous caller could
    make the process buffer a body of any size, and a route behind a dark flag
    answered 422 to malformed JSON where every other request to it answered 404.

    `after` is the route's own session dependency. This dependency depends on it, so
    FastAPI solves it first whatever order the route's parameters are written in, and
    solves it ONCE (the route's own `Depends(after)` reuses the cached answer). A
    router-level gate runs before both. A door with no session (a token in the body)
    passes no `after` and still gets the cap.

    The value is validated against `annotation` and every refusal keeps the status
    and the error shape FastAPI gave: 422 `json_invalid` for broken JSON, 422
    `missing` at `("body",)` for an absent required body, pydantic's own errors under
    `("body", ...)`, and the same Content-Type rule. Past the cap: 413, `sentence()`.

    The `TypeAdapter` is built on first use, not here: nothing at import."""
    box: list[TypeAdapter] = []

    def _adapter() -> TypeAdapter:
        if not box:
            box.append(TypeAdapter(annotation))
        return box[0]

    async def _read(request: Request) -> Any:
        raw = await read_capped_body(request, max_bytes(), sentence())
        value: Any = None
        if raw:
            if _is_json_content_type(request.headers.get("content-type")):
                try:
                    value = json.loads(raw)
                except json.JSONDecodeError as e:
                    raise RequestValidationError(
                        [{"type": "json_invalid", "loc": ("body", e.pos), "msg": "JSON decode error",
                          "input": {}, "ctx": {"error": e.msg}}], body=e.doc) from None
                except ValueError:
                    raise HTTPException(status_code=400, detail="There was an error parsing the body") from None
            else:
                value = raw
        adapter = _adapter()
        try:
            return adapter.validate_python(value)
        except ValidationError as e:
            if value is None:
                raise _missing_body() from None
            raise RequestValidationError(
                [{**err, "loc": ("body", *err["loc"])} for err in e.errors(include_url=False)],
                body=value) from None

    if after is None:
        async def dependency(request: Request) -> Any:
            return await _read(request)
    else:
        async def dependency(request: Request, _caller: Any = Depends(after)) -> Any:  # noqa: B008
            return await _read(request)

    dependency.max_bytes = max_bytes        # read by the body census, never by a route
    return dependency


def _missing_body() -> RequestValidationError:
    # The shape FastAPI gives a required body parameter that was not sent.
    return RequestValidationError([{"type": "missing", "loc": ("body",),
                                    "msg": "Field required", "input": None}])


def _missing(field: str) -> RequestValidationError:
    # The shape FastAPI gives a missing `File(...)` parameter.
    return RequestValidationError([{"type": "missing", "loc": ("body", field),
                                    "msg": "Field required", "input": None}])


class CappedMultipart(NamedTuple):
    """One file part plus the named text fields, each `None` when absent."""
    file: UploadFile
    fields: dict[str, Optional[str]]


def capped_multipart(field: str, max_bytes: Callable[[], int], sentence: Callable[[], str], *,
                     fields: tuple[str, ...] = (), text_parts: int = 0,
                     exact: bool = True) -> Callable[..., AsyncIterator[CappedMultipart]]:
    """A dependency standing in for `UploadFile = File(...)` plus `x: str = Form(...)`
    parameters: the one file in `field` and the text fields named in `fields`, read
    with the body capped while it streams. Its temp file is closed when the request
    ends.

    The body cap is `max_bytes()` + `FRAMING_SLACK` + `text_parts` text parts at
    Starlette's own per-part ceiling (`MultiPartParser.max_part_size`, read, never
    restated). A route whose text fields are short leaves `text_parts` at 0 -- the
    slack already holds them; a route that takes a big text field (a chart's bars as
    JSON) names how many such parts it accepts.

    `exact=True` holds the file part to `max_bytes()` exactly (413, `sentence()`).
    `exact=False` leaves that judgement to the route -- for a door whose own answer to
    a file just over its cap is not a 413 -- while the body cap still bounds what is
    read. Field values are passed through as strings; typing them is the route's.

    ⛔ DECLARE IT AFTER THE ROUTE'S AUTH DEPENDENCY. FastAPI parses a `File(...)`
    parameter BEFORE any dependency runs, so an anonymous caller could make the
    process spool a body; a dependency runs in declaration order, so the auth
    check in front of this one refuses first."""

    async def dependency(request: Request) -> AsyncIterator[CappedMultipart]:
        limit, words = max_bytes(), sentence()
        body_limit = limit + FRAMING_SLACK + text_parts * MultiPartParser.max_part_size
        form = await read_capped_form(request, body_limit, words,
                                      max_files=1, max_fields=max(4, len(fields) + 1))
        try:
            upload = form.get(field)
            if not isinstance(upload, UploadFile):
                raise _missing(field)
            if exact and (upload.size is None or upload.size > limit):
                raise HTTPException(status_code=413, detail=words)
            # A file part can never sit in a text field here: `max_files=1` and the
            # file above is that one, so Starlette refuses a second file (400).
            yield CappedMultipart(upload, {name: form.get(name) for name in fields})
        finally:
            await form.close()

    return dependency


def capped_upload(field: str, max_bytes: Callable[[], int],
                  sentence: Callable[[], str]) -> Callable[..., UploadFile]:
    """`capped_multipart` for a door that takes only the file: the dependency
    standing in for `UploadFile = File(...)`. Built ON `capped_multipart` (it resolves
    that dependency and hands back its file), never a second implementation, and
    under the same rule: declare it after the route's auth dependency."""
    parts_dependency = capped_multipart(field, max_bytes, sentence)

    async def dependency(parts: CappedMultipart = Depends(parts_dependency)) -> UploadFile:
        return parts.file

    return dependency
