"""Economic data -- the member API.

    GET /api/econ/catalog
    GET /api/econ/series/{symbol}?asof=<unix>&start=YYYY-MM-DD&end=YYYY-MM-DD
    GET /api/econ/latest?symbols=USCPIYOY,USUNRATE,...   (the newest few points of each, one read)
    GET /api/econ/status

DARK BY DEFAULT: every route answers 404 unless ECON_ENABLED=1 -- the flag is a
ROUTER dependency, so it answers before entitlement and before parameter
validation (a dark feature does not reveal its shape).

ENTITLEMENT: catalog + series + latest take `require_bars_access` -- the ONE chart-data
authority (owner ruling #7; `meets_plan_gate`: admin / paid / comped / trial, or
the push-secret service bearer). 401 = not signed in, 403 = not entitled.
`status` is UNAUTHENTICATED and carries dates/states only, never a value.

CACHING: strong content ETag + `Cache-Control: private` (entitlement-gated; a
shared cache keyed by URL would hand an entitled payload to anyone -- the
barspack-401 lesson). 304 on If-None-Match.

⛔ ISOLATION: this module imports NOTHING from the stock-bars machinery (bars,
bars_fetch, massive, market calendar, tail status). It reads published econ
artifacts through `api.services.econ.serving` and nothing else.
tests/econ/test_isolation.py pins that by AST.
"""
from __future__ import annotations

import os
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from api.bars_auth import require_bars_access
from api.services.econ import serving

_CACHE = "private, max-age=60, stale-while-revalidate=600"
_CACHE_STATUS = "private, max-age=30"
_ISO = r"^\d{4}-\d{2}-\d{2}$"


def _enabled() -> None:
    if os.environ.get("ECON_ENABLED", "0") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(dependencies=[Depends(_enabled)])


def _answer(request: Request, status: int, body: dict, etag: Optional[str], cache: str):
    if status != 200 or etag is None:
        return JSONResponse(body, status_code=status, headers={"Cache-Control": "private, max-age=30"})
    inm = request.headers.get("if-none-match")
    if inm and etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": cache})
    return JSONResponse(body, headers={"ETag": etag, "Cache-Control": cache})


def _date(name: str, value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be a real ISO date (YYYY-MM-DD)")
    return value


@router.get("/api/econ/catalog")
def econ_catalog(request: Request, _access: dict = Depends(require_bars_access)):
    status, body, etag = serving.catalog()
    return _answer(request, status, body, etag, _CACHE)


@router.get("/api/econ/series/{symbol}")
def econ_series(request: Request, symbol: str,
                asof: Optional[int] = Query(default=None, ge=0, le=4_102_444_800),
                start: Optional[str] = Query(default=None, pattern=_ISO),
                end: Optional[str] = Query(default=None, pattern=_ISO),
                _access: dict = Depends(require_bars_access)):
    start, end = _date("start", start), _date("end", end)
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="start must be <= end")
    status, body, etag = serving.series(symbol, asof=asof, start=start, end=end)
    return _answer(request, status, body, etag, _CACHE)


_LATEST_SYMBOL = re.compile(r"^(?:econ:)?[a-z0-9]{1,32}$", re.IGNORECASE)


@router.get("/api/econ/latest")
def econ_latest(request: Request,
                symbols: str = Query(..., min_length=1, max_length=1600),
                _access: dict = Depends(require_bars_access)):
    """The newest few points of up to `serving.LATEST_MAX_SYMBOLS` series in one answer
    (the Terminal's ECON board). Comma-separated; duplicates answer once; a symbol the
    registry does not serve answers as a `not_found` row, never a 404 for the whole read."""
    wanted: list[str] = []
    for tok in symbols.split(","):
        t = tok.strip()
        if not t:
            continue
        if not _LATEST_SYMBOL.match(t):
            raise HTTPException(status_code=422, detail="symbols must be comma-separated series symbols")
        if t.upper() not in wanted:
            wanted.append(t.upper())
    if not wanted:
        raise HTTPException(status_code=422, detail="symbols must name at least one series")
    if len(wanted) > serving.LATEST_MAX_SYMBOLS:
        raise HTTPException(status_code=422, detail=f"at most {serving.LATEST_MAX_SYMBOLS} symbols")
    status, body, etag = serving.latest(wanted)
    return _answer(request, status, body, etag, _CACHE)


@router.get("/api/econ/status")
def econ_status(request: Request):
    status, body, etag = serving.status()
    return _answer(request, status, body, etag, _CACHE_STATUS)
