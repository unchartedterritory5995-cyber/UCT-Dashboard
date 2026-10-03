"""Market Cap V1 (point-in-time share state) -- the member API.

    GET /api/marketcap/pit/{ticker}?start=YYYY-MM-DD&end=YYYY-MM-DD
    GET /api/marketcap/pit/{ticker}/latest
    GET /api/marketcap/pit-status

CONTRACT (the dark reader's, api/services/marketcap/serve.py, plus two additive blocks):
    series -> {"ticker", "issuer_id", "listing", "company_level": true, "build_id",
               "points": [["YYYY-MM-DD", company_market_cap_usd], ...],
               "gaps": [{"start", "end", "reason", "n_days"}, ...],      # every missing day reason-coded, never 0
               "structure": [...], "authority": {...}, "currentness": {...}}
    latest -> {"ticker", "issuer_id", "date", "company_market_cap", "security_market_cap", "build_id",
               ["reason"], "authority", "currentness"}

DARK BY DEFAULT: every route answers 404 unless MCAP_PIT_ENABLED=1 -- a ROUTER dependency, so it answers before
entitlement and before parameter validation (a dark feature does not reveal its shape).

ENTITLEMENT: `require_bars_access` -- the ONE chart-data authority (admin / paid / comped / trial, or the push-secret
service bearer). 401 = not signed in, 403 = not entitled. Both are decided BEFORE any lookup, so an unauthorized
caller gets the same answer for a ticker that exists and one that does not. pit-status is gated the same way: it
carries no values, but it names builds and dates.

CACHING: `Cache-Control: private, no-cache` -- private because entitlement-gated (a shared cache keyed by URL would hand
an entitled payload to anyone; the barspack-401 lesson), no-cache so a browser revalidates every time instead of
holding a superseded build for max-age. The ETag includes the build id and manifest sha, so a pointer advance is a new
ETag and a 304 can never revalidate an old build. Every response names its build in `X-MCAP-Build`.

READ-ONLY: reads published, hash-verified artifacts through api.services.marketcap.pit_serving; it never opens a build
DB, never builds, never writes.
"""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse, Response

from api.bars_auth import require_bars_access
from api.services.marketcap import pit_serving

_CACHE = "private, no-cache"          # always revalidate: a pointer advance is visible on the next request
_ISO = r"^\d{4}-\d{2}-\d{2}$"
_TICKER = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,15}$"


def _enabled() -> None:
    if os.environ.get("MCAP_PIT_ENABLED", "0") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(dependencies=[Depends(_enabled)])


def _answer(request: Request, status: int, body: dict, etag: Optional[str]):
    headers = {"Cache-Control": "private, no-store"} if status != 200 else {"Cache-Control": _CACHE}
    if body.get("build_id"):
        headers["X-MCAP-Build"] = body["build_id"]
    if status != 200 or etag is None:
        return JSONResponse(body, status_code=status, headers=headers)
    headers["ETag"] = etag
    inm = request.headers.get("if-none-match")
    if inm and etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


def _date(name: str, value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be a real ISO date (YYYY-MM-DD)")
    return value


@router.get("/api/marketcap/pit-status")
def marketcap_pit_status(request: Request, _access: dict = Depends(require_bars_access)):
    status, body, etag = pit_serving.status()
    return _answer(request, status, body, etag)


@router.get("/api/marketcap/pit/{ticker}/latest")
def marketcap_pit_latest(request: Request, ticker: str = Path(..., pattern=_TICKER),
                         _access: dict = Depends(require_bars_access)):
    status, body, etag = pit_serving.latest(ticker)
    return _answer(request, status, body, etag)


@router.get("/api/marketcap/pit/{ticker}")
def marketcap_pit_series(request: Request, ticker: str = Path(..., pattern=_TICKER),
                         start: Optional[str] = Query(default=None, pattern=_ISO),
                         end: Optional[str] = Query(default=None, pattern=_ISO),
                         _access: dict = Depends(require_bars_access)):
    start, end = _date("start", start), _date("end", end)
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="start must be <= end")
    status, body, etag = pit_serving.series(ticker, start, end)
    return _answer(request, status, body, etag)
