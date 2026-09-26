"""chart_edge_service.py -- a per-render SERVICE capability for trusted renderers
that run OFF the web pod.

WHY THIS EXISTS
---------------
Two renderers screenshot the public `/r/chart` page from the owner's PC, not
from `chart-renderer`: Morning Wire's Substack letter (`substack/chartwidget.py`)
and Sunday Scans (`sunday_scan/charts.py`). Their headless page reads
`/api/bars/*` through the `bars-edge-router` Worker with no session, so it
classifies MISSING. Today that is harmless -- the Worker is SHADOW only -- but the
day enforcement lands, both lose every chart, and they lose them SILENTLY: each
drops a chart that fails its judge and ships the letter without it. That is
exactly how the wire lost all of its charts 2026-09-14..25 when the web pod's
`/api/bars` gate landed.

`chart_edge_token.mint_service()` is the machine trust path the Worker already
verifies (`X-Chart-Edge-Token`, `worker.js`), but only `render_house_chart`
could reach it. This route is the same mint for a caller outside the pod.

⛔⛔ PUSH_SECRET, NEVER CHART_RENDER_TOKEN. The render token is compiled into
the PUBLIC frontend bundle (`app/src/lib/renderToken.js`), so accepting it here
would hand a chart-data service capability to anyone who opens devtools.
PUSH_SECRET is the canonical internal service credential and already buys
`/api/bars` on this pod outright (`bars_auth.require_bars_access`), so a caller
that holds it gains nothing it did not have -- only a way to present it at the
edge, for 120 seconds, for one render.

⛔ `no-store`: a capability must never sit in a cache.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from api import chart_edge_token as cet
from api.flow_admin_auth import _push_secret_ok

router = APIRouter()

#: The header the Worker reads (`worker.js` SERVICE_HEADER) -- returned so a
#: caller never spells it a second way.
SERVICE_HEADER = "X-Chart-Edge-Token"


@router.post("/api/r/edge-service-token")
def edge_service_token(authorization: str = Header(default="")):
    if not _push_secret_ok(authorization):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = cet.mint_service()
    if not token:
        # An unset CHART_EDGE_SECRET is "no edge token", never a 500 -- the
        # caller renders exactly as it did before this route existed.
        raise HTTPException(status_code=503, detail="edge signing not configured")
    return JSONResponse({"token": token, "ttl": cet.render_ttl_seconds(),
                         "header": SERVICE_HEADER},
                        headers={"Cache-Control": "no-store"})
