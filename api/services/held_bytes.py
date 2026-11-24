"""A held answer's JSON bytes, made ONCE and off the request (speed pass 3, 2026-11-24).

WHY. Live (2026-11-24 05:55 ET) a per-stock panel's READY answer still took 0.8 to 1.5 s (STAT 1.25 s, ERNS 1.45 s,
OIC 1.07 s, SETH 0.78 s, VFP 0.77 s) although each module already held it. One cost the request still paid: a route
that returns a dict has FastAPI turn it into bytes on EVERY request (`jsonable_encoder`, then `json.dumps`), and it
does that on the event loop, where every other request waits behind it; on a pod with many busy threads each of those
CPU milliseconds costs far more. Measured on invented answers (dev PC, not production): ERNS with 150 reporters
(98 KB) 26 ms, SETH one stock with 300 signals (59 KB) 18 ms, VFP (22 KB) 3 ms, OIC (10 KB) 2 ms, STAT about 1 ms; the
held bytes cost about 0.003 ms.

HOW. A module that holds an answer calls `remember(answer)` on the thread that built it (never the request), and
`forget(answer)` when it drops it. A route returns `response(answer)`: the bytes made for that very object, else the
bytes made now on the route's own thread (never the event loop) and not kept. `render` IS FastAPI's own path for a
returned dict (`jsonable_encoder`, then `JSONResponse`), so the answer is byte for byte the one the route gave before,
with the same `application/json` type.

BOUNDED. At most `MAX_ANSWERS` answers and `MAX_BYTES` bytes; past either, the oldest is dropped (its route then makes
its bytes on the request, as before). An entry keeps its answer object alive with it, so its identity is never reused.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any, Optional

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response

MAX_ANSWERS = 640
MAX_BYTES = 16_000_000

_lock = threading.Lock()
_memo: "OrderedDict[int, tuple[Any, bytes]]" = OrderedDict()   # id(answer) -> (answer, its bytes)
_total = 0
renders = 0                                                      # bytes made (tests)


def render(answer: Any) -> bytes:
    """The bytes FastAPI sends for `answer` returned from a route: `jsonable_encoder`, then `JSONResponse`."""
    global renders
    renders += 1
    return JSONResponse(content=jsonable_encoder(answer)).body


def _drop(key: int) -> None:
    global _total
    hit = _memo.pop(key, None)
    if hit is not None:
        _total -= len(hit[1])


def remember(answer: Any) -> None:
    """Make `answer`'s bytes now (on the caller's thread: the build, never the request) and keep them for it."""
    global _total
    if not isinstance(answer, dict):
        return
    body = render(answer)
    with _lock:
        _drop(id(answer))
        _memo[id(answer)] = (answer, body)
        _total += len(body)
        while _memo and (len(_memo) > MAX_ANSWERS or _total > MAX_BYTES):
            _drop(next(iter(_memo)))


def forget(answer: Any) -> None:
    """The module dropped `answer`: its bytes go with it."""
    with _lock:
        hit = _memo.get(id(answer))
        if hit is not None and hit[0] is answer:
            _drop(id(answer))


def held(answer: Any) -> Optional[bytes]:
    """The bytes kept for this very object, or None."""
    with _lock:
        hit = _memo.get(id(answer))
        if hit is not None and hit[0] is answer:
            _memo.move_to_end(id(answer))
            return hit[1]
    return None


def response(answer: Any) -> Response:
    """What a route returns for `answer`: its kept bytes, else bytes made now on this (the route's) thread."""
    body = held(answer)
    return Response(content=render(answer) if body is None else body, media_type="application/json")


def size() -> tuple[int, int]:
    """(answers kept, bytes kept)."""
    with _lock:
        return len(_memo), _total


def reset_for_tests() -> None:
    global _total, renders
    with _lock:
        _memo.clear()
        _total = 0
        renders = 0
