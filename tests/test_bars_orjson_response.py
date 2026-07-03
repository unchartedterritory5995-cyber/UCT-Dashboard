"""Bars responses serialize via orjson — fast + NaN-safe.

orjson is ~7-8x faster than stdlib json on the shared web event loop (measured
4.9ms->0.6ms at 5000 bars) AND emits `null` for NaN/Inf, whereas stdlib json
emits the invalid `NaN` token that crashes the browser's JSON.parse and blanks
the whole chart. This pins both properties so a refactor can't silently regress
to stdlib JSONResponse on the bars path.
"""
import orjson
from fastapi.responses import ORJSONResponse

from api.services import bars_fetch
from api.routers import bars as bars_router


def test_bars_serving_paths_use_orjson():
    # Both the service layer and the router alias JSONResponse -> ORJSONResponse.
    assert bars_fetch.JSONResponse is ORJSONResponse
    assert bars_router.JSONResponse is ORJSONResponse


def test_orjson_renders_nan_as_null_not_invalid_token():
    # A NaN OHLC must degrade to a droppable null bar, NOT the invalid `NaN`
    # token that stdlib json emits (which is unparseable client-side).
    body = orjson.dumps({"c": float("nan"), "h": float("inf")})
    assert b"NaN" not in body and b"Infinity" not in body
    assert orjson.loads(body) == {"c": None, "h": None}


def test_orjson_response_preserves_headers_and_body():
    payload = {"ticker": "AAPL", "tf": "D",
               "bars": [{"t": "2026-07-03", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}]}
    r = bars_fetch.JSONResponse(content=payload, headers={"Cache-Control": "no-store"})
    assert r.headers.get("cache-control") == "no-store"
    assert orjson.loads(bytes(r.body)) == payload
