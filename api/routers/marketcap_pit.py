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
MODES (owner decision 2026-10-06): OFF (default) | PREVIEW (MCAP_PIT_PREVIEW=1, MCAP_PIT_ENABLED not 1) | ON
(MCAP_PIT_ENABLED=1, member authority -- unchanged). PREVIEW is a production VERIFICATION state for the real reader:
a request is served only when it says so (`X-MCAP-Preview: 1`) AND passes the normal entitlement AND its server-side
role is `admin` (the auth_middleware.require_admin concept). Every other caller -- anonymous, ordinary or entitled
member, the service bearer, an admin WITHOUT the header -- gets the dark 404, so nothing reveals the mode. The header
is not the lock (the admin role is); it is what keeps CONSUMERS dark: the chart / member clients never send it, so
their pit-status stays 404 and they behave as OFF -- even in an admin's own browser.

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

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse, Response

from api.bars_auth import require_bars_access
from api.services.marketcap import pit_serving

_CACHE = "private, no-cache"          # always revalidate: a pointer advance is visible on the next request
_ISO = r"^\d{4}-\d{2}-\d{2}$"
_TICKER = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,15}$"


PREVIEW_HEADER = "X-MCAP-Preview"


def mode() -> str:
    """OFF | PREVIEW | ON. ON wins; PREVIEW never widens ON's audience."""
    if os.environ.get("MCAP_PIT_ENABLED", "0") == "1":
        return "ON"
    if os.environ.get("MCAP_PIT_PREVIEW", "0") == "1":
        return "PREVIEW"
    return "OFF"


def _preview_request(request: Request) -> bool:
    return mode() == "PREVIEW" and request.headers.get(PREVIEW_HEADER) == "1"


def _enabled(request: Request) -> None:
    if mode() == "ON" or _preview_request(request):
        return
    raise HTTPException(status_code=404, detail="Not Found")


def _reader_access(request: Request, uct_session: Optional[str] = Cookie(None), authorization: str = Header(default="")) -> dict:
    """ON: the chart-data entitlement, unchanged. PREVIEW: that SAME entitlement, then the server-side admin role --
    any failure is the dark 404 (an unauthorized caller learns nothing about the mode)."""
    if mode() == "ON":
        return require_bars_access(uct_session, authorization)
    try:
        user = require_bars_access(uct_session, authorization)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Not Found")
    if user.get("role") != "admin":
        raise HTTPException(status_code=404, detail="Not Found")
    return user


router = APIRouter(dependencies=[Depends(_enabled)])


def _answer(request: Request, status: int, body: dict, etag: Optional[str]):
    headers = {"Cache-Control": "private, no-store"} if status != 200 else {"Cache-Control": _CACHE}
    if body.get("build_id"):
        headers["X-MCAP-Build"] = body["build_id"]
    if mode() == "PREVIEW":
        headers["X-MCAP-Mode"] = "PREVIEW"
        headers["Vary"] = PREVIEW_HEADER
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
def marketcap_pit_status(request: Request, _access: dict = Depends(_reader_access)):
    status, body, etag = pit_serving.status()
    return _answer(request, status, body, etag)


@router.get("/api/marketcap/pit/{ticker}/latest")
def marketcap_pit_latest(request: Request, ticker: str = Path(..., pattern=_TICKER),
                         _access: dict = Depends(_reader_access)):
    status, body, etag = pit_serving.latest(ticker)
    return _answer(request, status, body, etag)


@router.get("/api/marketcap/pit/{ticker}")
def marketcap_pit_series(request: Request, ticker: str = Path(..., pattern=_TICKER),
                         start: Optional[str] = Query(default=None, pattern=_ISO),
                         end: Optional[str] = Query(default=None, pattern=_ISO),
                         _access: dict = Depends(_reader_access)):
    start, end = _date("start", start), _date("end", end)
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="start must be <= end")
    status, body, etag = pit_serving.series(ticker, start, end)
    return _answer(request, status, body, etag)
