import os
from fastapi import APIRouter, HTTPException, Request
from api.services.engine import get_earnings, _generate_earnings_analysis, _generate_earnings_preview
from api.services.earnings_estimates import get_earnings_intel
from api.services.cache import cache
from api.limiter import limiter

router = APIRouter()


@router.get("/api/earnings")
def earnings():
    try:
        return get_earnings()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/earnings-gaps")
def earnings_gaps():
    """Live change_pct for all current earnings tickers. TTL 30 s."""
    cached = cache.get("earnings_gaps_live")
    if cached is not None:
        return cached

    data = get_earnings()
    all_syms = [e["sym"] for e in data.get("bmo", []) + data.get("amc", []) if e.get("sym")]
    if not all_syms:
        cache.set("earnings_gaps_live", {}, ttl=30)
        return {}

    try:
        from api.services.massive import _get_client
        result = _get_client().get_batch_snapshots(all_syms)
    except Exception:
        result = {}

    cache.set("earnings_gaps_live", result, ttl=30)
    return result


@router.get("/api/earnings/intel/{ticker}")
def earnings_intel(ticker: str):
    """Analyst consensus, EPS beat history, and price targets for a ticker."""
    ticker = ticker.upper()
    try:
        result = get_earnings_intel(ticker)
        if result is None:
            raise HTTPException(status_code=404, detail=f"No earnings intel available for {ticker}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/earnings-analysis/{sym}")
@limiter.limit("10/minute")
def earnings_analysis(request: Request, sym: str):
    sym = sym.upper()

    # Find the earnings row for this sym (provides context to the analysis)
    try:
        data = get_earnings()
    except Exception:
        data = {}

    row = None
    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            if entry.get("sym") == sym:
                row = entry
                break
        if row:
            break

    try:
        if row and row.get("verdict", "").lower() == "pending":
            return _generate_earnings_preview(sym, row)
        return _generate_earnings_analysis(sym, row)
    except Exception as e:
        # Anthropic API or other transient failure — return graceful fallback
        return {
            "sym": sym,
            "analysis": None,
            "preview_text": "",
            "preview_bullets": [],
            "beat_history": [],
            "yoy_eps_growth": None,
            "beat_streak": None,
            "news": [],
            "error": str(e),
        }
