"""RS Ranking endpoints — IBD-style Relative Strength percentile rankings.

GET /api/rs-rankings       → full ranked list
GET /api/rs-rankings/{ticker} → single stock RS data
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.services.rs_ranking import compute_rs_scores, get_rs_for_ticker

router = APIRouter()


@router.get("/api/rs-rankings")
def rs_rankings():
    """Return full RS-ranked stock list (1-99 percentile, best first)."""
    try:
        data = compute_rs_scores()
        return JSONResponse(content=data)
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )


@router.get("/api/rs-rankings/{ticker}")
def rs_ranking_single(ticker: str):
    """Return RS data for a single ticker."""
    try:
        data = get_rs_for_ticker(ticker)
        if data is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"No RS data for {ticker.upper()}"},
            )
        return JSONResponse(content=data)
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )
