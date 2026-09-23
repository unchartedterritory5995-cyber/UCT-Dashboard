"""Historical point-in-time fundamentals -- the chart's series API.

    GET /api/fundamentals/pit/catalog
    GET /api/fundamentals/pit/series/{symbol}?series=revenue_ttm,net_margin_ttm

Dark by default: every route answers 404 unless FUNDAMENTALS_PIT_ENABLED=1, so
shipping the code changes nothing until the store is populated and the flag is
set. Chart-data entitlement is the SAME gate as /api/bars (`require_bars_access`:
a paid/comped/trial member, or a trusted service caller) -- not weaker.

CACHING: responses carry a strong ETag and `Cache-Control: private` -- they are
entitlement-gated, and a shared edge cache keyed by URL alone would serve an
entitled payload to anyone (the barspack-401 lesson). Edge caching of this
route needs the chart-edge entitlement mechanism and is a production decision
(docs/fundamentals-pit/MORNING-PLAN.md), not something this router assumes.
No SEC request ever happens on this path.
"""
from __future__ import annotations

import hashlib
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from api.bars_auth import require_bars_access
from api.services.fundamentals_pit import catalog as C, serving

router = APIRouter()

_CACHE = "private, max-age=300, stale-while-revalidate=3600"


def _enabled() -> None:
    if os.environ.get("FUNDAMENTALS_PIT_ENABLED", "0") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/fundamentals/pit/catalog")
def pit_catalog(request: Request, _access: dict = Depends(require_bars_access)):
    _enabled()
    body = C.payload()
    etag = '"' + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:32] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _CACHE})
    return JSONResponse(body, headers={"ETag": etag, "Cache-Control": _CACHE})


@router.get("/api/fundamentals/pit/series/{symbol}")
def pit_series(symbol: str, request: Request, series: str = Query(..., max_length=2000),
               _access: dict = Depends(require_bars_access)):
    _enabled()
    ids = [s.strip() for s in series.split(",") if s.strip()][:40]
    status, body, etag = serving.series_response(symbol, ids)
    if status != 200:
        return JSONResponse(body, status_code=status, headers={"Cache-Control": "private, max-age=60"})
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _CACHE})
    return JSONResponse(body, headers={"ETag": etag, "Cache-Control": _CACHE})
