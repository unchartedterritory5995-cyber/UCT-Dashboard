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
# At module level: there is no import cycle (only routers import this module, and nothing `share` imports reaches
# it), railed in both import orders by tests/test_old_body_readers_deep_json.py (F-ALIAS-1R A6).
from api.services.journal_two.widget_engine.share import S_BAD_CHARACTER

S_BODY_TOO_LARGE = "That is too much to send at once."
S_UNREADABLE_BODY = "That request couldn't be read."


class BodyTooDeep(Exception):
    """A JSON body nested past what the parser can recurse through (`loads_json`). NOT a `ValueError`, so a reader
    that answers a malformed body with its own 422 still tells the two apart."""


def loads_json(raw: bytes | str) -> Any:
    """THE decode of a JSON request body, shared by `read_json_object` and the older plain-shape readers
    (`notebook_template_gallery._read_json`, `notebook_journal_styles.paid_body`; F-ALIAS-1R A5). `json.loads`, with
    the parser's `RecursionError` (a body nested ~60,000 deep fits in 120 KB, under every size cap) raised as
    `BodyTooDeep` so no reader answers it with a 500. A malformed body is still the parser's `ValueError`."""
    try:
        return json.loads(raw)
    except RecursionError:
        raise BodyTooDeep() from None


#: The headers of the depth refusal below: an answer about one member's request is never cached.
NO_STORE = {"Cache-Control": "no-store"}


def loads_plain_body(raw: bytes | str) -> Any:
    """THE decode of the notebook routers' plain-shape body readers (`{"detail": "<sentence>"}`): `loads_json`, with a
    body too deep to parse (`BodyTooDeep`) answered here as ONE 400 `S_UNREADABLE_BODY` with no-store, never a 500
    (F-ALIAS-1R A5; W11-R55 for the five readers its review found). A malformed body is still the parser's
    `ValueError`, so each reader keeps its OWN malformed-body refusal (the expiry doors' 422 sentence included)."""
    try:
        return loads_json(raw)
    except BodyTooDeep:
        raise HTTPException(status_code=400, detail=S_UNREADABLE_BODY, headers=dict(NO_STORE)) from None


def bad_character_sentence() -> str:
    """The ONE sentence for text that cannot be saved (`share.S_BAD_CHARACTER`, the reducer's own), never retyped."""
    return S_BAD_CHARACTER


def unsavable_text(obj: Any) -> bool:
    """Task 11.12 fix round 2 (I-A): True when any string key or value in a decoded JSON body cannot be encoded as
    UTF-8 -- a lone UTF-16 surrogate (`"\\ud800"`, which `JSON.stringify` emits for a broken pair). SQLite refuses to
    store or even look one up (`UnicodeEncodeError`), so a door that lets one through answers a 500. A valid pair
    decodes to one astral character and encodes fine. Iterative; the caller has already bounded the depth."""
    stack = [obj]
    while stack:
        x = stack.pop()
        if isinstance(x, str):
            try:
                x.encode("utf-8")
            except UnicodeEncodeError:
                return True
        elif isinstance(x, dict):
            stack.extend(x.keys())
            stack.extend(x.values())
        elif isinstance(x, list):
            stack.extend(x)
    return False


async def read_json_object(read_raw: Callable[[], Awaitable[bytes]], max_depth: int,
                           err: Callable[[int, str, str], HTTPException], *, bad_character: str | None = None) -> dict:
    """`await read_raw()` (a `read_capped_body` call), decoded as one JSON object. Text that cannot be saved (a lone
    surrogate, `unsavable_text`) is 400 `invalid` with `bad_character`, else the reducer's sentence (a router whose
    store already words it, the widget definitions', passes its own)."""
    try:
        raw = await read_raw()
    except HTTPException as e:
        if e.status_code == 413:
            raise err(413, "invalid", S_BODY_TOO_LARGE) from None
        raise err(400, "invalid", S_UNREADABLE_BODY) from None
    if not raw.strip():
        return {}
    try:
        body: Any = loads_json(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, BodyTooDeep):
        raise err(400, "invalid", S_UNREADABLE_BODY) from None
    if not isinstance(body, dict) or _json_depth_exceeds(body, max_depth):
        raise err(400, "invalid", S_UNREADABLE_BODY)
    if unsavable_text(body):
        raise err(400, "invalid", bad_character or bad_character_sentence())
    return body
