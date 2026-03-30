from fastapi import APIRouter, Request
from api.services.transcripts import get_transcript_summary
from api.limiter import limiter

router = APIRouter()


@router.get("/api/transcripts/{symbol}")
@limiter.limit("10/minute")
def transcript_summary(request: Request, symbol: str):
    """AI summary of the latest earnings call transcript for a ticker."""
    symbol = symbol.upper()
    try:
        result = get_transcript_summary(symbol)
        if result is None:
            return {"available": False, "symbol": symbol}
        return result
    except Exception as e:
        return {"available": False, "symbol": symbol, "error": str(e)}
