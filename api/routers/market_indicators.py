"""api/routers/market_indicators.py — the Market Indicators library's public surface.

Routes (read the router, not this list — a typed count beside the thing it describes is
this repo's most-repeated defect):
    GET /api/market-indicators            → the catalogue a client builds discovery from
    GET /api/market-indicators/search     → ranked results across BOTH catalogues
    GET /api/market-indicators/status     → coverage + provenance, for an operator
    GET /api/market-indicators/{sid}      → one series' full metadata

⛔⛔ BARS ARE NOT SERVED HERE. A market indicator is charted through `/api/bars/{ticker}`
exactly like an equity, an index or a breadth pseudo-ticker, via one interception branch
in `api/routers/bars.py`. A second bars endpoint would be a second charting
architecture, which is the thing this project is explicitly not allowed to build.

⚠️ READS ARE PAID, matching every other proprietary UCT surface (`cot.py`'s ruling:
"everything is paid, almost nothing is accessible for free"). `/status` is deliberately
open in the same way `/api/breadth-monitor/ohlc/status` is — it carries coverage
metadata and no series values, so the owner can check an ingest landed without a token.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.market_indicators import discovery as disc
from api.services.market_indicators import registry as reg
from api.services.market_indicators import series as mseries

router = APIRouter()
_log = logging.getLogger("market_indicators.router")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Market Indicators library.

    ⛔ DEFINED HERE, NOT IMPORTED FROM A SIBLING. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface locked
    me out" is answerable from the message alone. The standing rail is
    `tests/test_user_definitions_auth.py`, which walks `api/routers/` by AST and fails
    on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(
            status_code=402,
            detail="The Market Indicators library requires a paid plan")
    return user


@router.get("/api/market-indicators")
def get_catalogue(_user: dict = Depends(require_paid)):
    """The whole discoverable library: rows + families + universes.

    ⛔ ONE PAYLOAD, NOT THREE ENDPOINTS — the same reasoning as
    `breadth_symbols.library_catalog`. A client that has to join a catalogue to its
    families across two calls is a client that will grow its own copy of one of them.

    ⚠️ `dormant` RIDES ALONG AS A SEPARATE ARRAY, never mixed into `rows`. NYMO, NYSI,
    NAMO and NASI are fully described so the product surface can decide later whether to
    advertise them as "coming when Nasdaq history lands" — but they are not in the list a
    discovery panel renders and `/api/bars` refuses them, so no client change can make
    one reachable.
    """
    cat = disc.catalogue()
    cat["dormant"] = [disc.indicator_row(s) for s in reg.dormant_rows()]
    return cat


@router.get("/api/market-indicators/search")
def search_indicators(q: str = Query(default="", max_length=120),
                      limit: int = Query(default=40, ge=1, le=200),
                      _user: dict = Depends(require_paid)):
    return {"query": q, "results": disc.search(q, limit=limit)}


@router.get("/api/market-indicators/status")
def indicator_status():
    """Coverage + provenance. No auth — read-only metadata, no series values.

    ⭐ WHAT ACTUALLY EXISTS, not what the catalogue describes. Availability reports each
    published series' real first/last/point-count, so "the catalogue offers it" and
    "there is history behind it" stay two separate questions.

    ⛔⛔ IT READS A SNAPSHOT AND NEVER COMPUTES ONE. This route takes no auth, and
    computing availability here measured 87 SECONDS on production — four of the series
    read the shared breadth store, which is large and under concurrent write, so the
    cost depended on another writer's behaviour. A background thread warms the snapshot;
    this handler only ever reads it, and says so when it is not yet warm.
    """
    avail, fresh = mseries.availability_snapshot()
    out = {
        "published": len(reg.published_rows()),
        "dormant": len(reg.dormant_rows()),
        "availability": avail,
        # ⚠️ An EMPTY availability map and an UNCOMPUTED one are different claims.
        "availability_warming": not fresh,
    }
    try:
        from api.services.market_indicators import naaim_store
        out["naaim"] = naaim_store.stats()
    except Exception as e:
        out["naaim"] = {"error": str(e)}
    try:
        from api.services.market_indicators import cboe_store
        out["cboe"] = cboe_store.coverage()
    except Exception as e:
        out["cboe"] = {"error": str(e)}
    return out


@router.get("/api/market-indicators/{series_id:path}")
def get_series_meta(series_id: str, _user: dict = Depends(require_paid)):
    """One series' full metadata — methodology, provenance, licensing, semantics.

    ⚠️ RESOLVES DORMANT ROWS TOO, and says so in `status`. A reviewer asking "what
    would NYMO be, and why is it not here" should get an answer; a chart asking for its
    bars still gets nothing. Those are different questions and only one of them is
    gated.
    """
    row = reg.resolve(series_id, include_dormant=True)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No market indicator {series_id!r}")
    out = disc.indicator_row(row)
    if row.status == reg.ST_PUBLISHED:
        out["availability"] = mseries.availability().get(row.id)
    return out
