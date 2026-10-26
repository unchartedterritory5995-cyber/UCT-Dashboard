"""The ONE JSON-object body reader of the widget routers (Task 10.12 fix round 1, review M2).

`POST /api/j2/widget-definitions/*` and `POST /api/j2/notebook-shelf-widgets/{kind}` both read a small JSON
object. Each router passes the bytes read through `request_body_cap.read_capped_body` with its OWN limit
constant (so the body census can state the limit at the call site) and this module does the rest, once:

  * past the cap: 413 `invalid`, `S_BODY_TOO_LARGE`;
  * a malformed Content-Length, bytes that are not UTF-8 JSON, a parser that recurses out, a value that is not
    an object, or an object nested deeper than `max_depth`: 400 `invalid`, `S_UNREADABLE_BODY`;
  * an empty body is `{}`.

The router's own `err(status, code, message)` builds each refusal, so each router keeps its own headers and the
`{"detail": {"code", "message"}}` shape.
"""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from api.services.journal_two.json_depth import _json_depth_exceeds

S_BODY_TOO_LARGE = "That is too much to send at once."
S_UNREADABLE_BODY = "That request couldn't be read."


async def read_json_object(read_raw: Callable[[], Awaitable[bytes]], max_depth: int,
                           err: Callable[[int, str, str], HTTPException]) -> dict:
    """`await read_raw()` (a `read_capped_body` call), decoded as one JSON object."""
    try:
        raw = await read_raw()
    except HTTPException as e:
        if e.status_code == 413:
            raise err(413, "invalid", S_BODY_TOO_LARGE) from None
        raise err(400, "invalid", S_UNREADABLE_BODY) from None
    if not raw.strip():
        return {}
    try:
        body: Any = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise err(400, "invalid", S_UNREADABLE_BODY) from None
    if not isinstance(body, dict) or _json_depth_exceeds(body, max_depth):
        raise err(400, "invalid", S_UNREADABLE_BODY)
    return body
