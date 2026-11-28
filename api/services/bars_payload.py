"""ONE serialization per /api/bars answer (S1 of the bars serve speedup, 2026-11-27).

⭐ WHAT THIS REMOVES. A cold /api/bars answer used to be serialized and re-parsed up to
four times on its way out: the serve branch built an `ORJSONResponse` (dumps), and every
router step that adds fields — today's daily bar, `newest_bar_is_forming`, the bar
contract + `tail_status` — did `orjson.loads(response.body)`, mutated the dict and built a
NEW `ORJSONResponse` (dumps again). A memory-cache hit paid all of it again, because the
cache holds the payload dict. Here the payload travels as a dict from the serve branch to
the router's last line and is serialized exactly once, there.

`PayloadResponse` is an `ORJSONResponse` (same constructor, same bytes, same headers,
`isinstance(..., JSONResponse)` still true) that holds its payload and renders on FIRST
READ of `.body` — or when Starlette sends it. So every in-process caller that reads
`resp.body` (prewarm, seeders, scans, seasonality, discord, tests) keeps working unchanged;
only the router, which reads `payload_of(resp)` instead, skips the bytes.

⛔ A PAYLOAD MAY BE SHARED WITH THE MEMORY CACHE (`_get_bars_inner` returns the very dict
it stored). Before this module every step worked on a parsed COPY, so nothing could reach
the cache entry. `payload_of` therefore hands out a SHALLOW COPY (the top-level dict is new;
`bars` and its rows are shared and are never mutated in place by any step — each step
assigns a new list), so an answer's added fields can never leak into the cached entry.
Rail: tests/test_bars_serialize_once.py (`test_the_cached_payload_is_never_mutated`).

⛔ RENDER ON THE WORKER THREAD. `render_once` is called at the end of the serve core, which
runs in the bars threadpool; a payload left for Starlette's `__call__` would be serialized
on the event loop. `__call__` still renders first as a safety net (Content-Length must be
in the headers it sends).
"""
from __future__ import annotations

import time as _time
import typing

from fastapi.responses import ORJSONResponse

# ⛔ orjson is imported where it is USED, never at module top. bars_fetch imports this module,
# and a dozen light callers import bars_fetch only for its NYSE calendar (`_is_nyse_holiday`)
# inside a try/except that falls back to "every weekday is a session". The master deploy
# gate runs those callers in a minimal environment without orjson, so a top-level import here
# broke the import of bars_fetch there, the calendar fell back silently, and Labor Day read as
# a trading day (tests/test_discord_render_ops.py, 2026-11-28). This matches what the module
# replaced: fastapi's ORJSONResponse also only needs orjson when it renders.


def _orjson():
    import orjson
    return orjson


def _opts(oj):
    return oj.OPT_NON_STR_KEYS | oj.OPT_SERIALIZE_NUMPY

#: Test-only: when True, `PayloadResponse` behaves like the pre-S1 path (renders at
#: construction, and `payload_of` re-parses the bytes). The golden rails serve every
#: scenario both ways and assert the decoded answers and headers are identical.
LEGACY_REPARSE = False


def dumps(payload) -> bytes:
    """The bytes `ORJSONResponse` would produce for `payload` (the one encoder)."""
    oj = _orjson()
    return oj.dumps(payload, option=_opts(oj))


class PayloadResponse(ORJSONResponse):
    """An `ORJSONResponse` whose body is rendered lazily, once, from `.payload`."""

    def __init__(self, content: typing.Any = None, status_code: int = 200,
                 headers: typing.Mapping[str, str] | None = None,
                 media_type: str | None = None, background=None) -> None:
        self.status_code = status_code
        if media_type is not None:
            self.media_type = media_type
        self.background = background
        self.payload = content
        self._body = None
        self._deferring = True              # `init_headers` reads `.body`: no Content-Length yet
        self.init_headers(headers)
        self._deferring = False
        if LEGACY_REPARSE:
            _ = self.body

    # Starlette's Response stores `body` as a plain attribute; here it is a property so
    # the bytes are made only when someone actually needs them.
    @property
    def body(self):                         # type: ignore[override]
        if self._body is None:
            if self._deferring:
                return None
            self._set_body(self.render(self.payload))
        return self._body

    @body.setter
    def body(self, value) -> None:
        self._set_body(value)

    def _set_body(self, value) -> None:
        self._body = value
        if self._deferring or value is None:
            return
        # Content-Length exactly as `Response.init_headers` would have computed it.
        hdrs = self.headers
        if "content-length" in hdrs:
            del hdrs["content-length"]
        if not (self.status_code < 200 or self.status_code in (204, 304)):
            hdrs["content-length"] = str(len(value))

    @property
    def rendered(self) -> bool:
        return self._body is not None

    async def __call__(self, scope, receive, send) -> None:
        _ = self.body                        # Content-Length before the headers go out
        await super().__call__(scope, receive, send)


def payload_of(response):
    """The answer's payload as a dict this caller may mutate at the top level, or raise
    (the caller's `except` then returns the response unchanged, exactly as a failed
    `orjson.loads(response.body)` did). A `PayloadResponse` hands over a shallow copy of
    its dict (no parse); anything else is parsed from its bytes, as before."""
    if isinstance(response, PayloadResponse) and not LEGACY_REPARSE:
        p = response.payload
        return dict(p) if isinstance(p, dict) else p
    return _orjson().loads(response.body)


def render_once(response) -> float | None:
    """Render a not-yet-rendered `PayloadResponse` now; the ms it took, else None."""
    if isinstance(response, PayloadResponse) and not response.rendered:
        t0 = _time.perf_counter()
        _ = response.body
        return (_time.perf_counter() - t0) * 1000.0
    return None
