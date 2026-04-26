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

    # Find the earnings row for this sym (provides context to the analysis).
    # Search today's bmo/amc first, then fall back to the weekly calendar for
    # future-dated earnings (e.g., user clicks AMT on the calendar before its
    # report date — it's not in today's data but it IS in the calendar).
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

    # Fallback: scan the weekly calendar for future earnings entries
    if row is None:
        try:
            from api.services.engine import _load_wire_data
            wire = _load_wire_data() or {}
            cal = wire.get("weekly_calendar") or {}
            for date_str, day in cal.items():
                if not isinstance(day, dict):
                    continue
                for bucket in ("bmo", "amc"):
                    for entry in day.get(bucket, []) or []:
                        if isinstance(entry, dict) and entry.get("sym") == sym:
                            row = dict(entry)
                            # Future earnings → mark pending so preview path is used
                            row.setdefault("verdict", "Pending")
                            break
                    if row:
                        break
                if row:
                    break
        except Exception:
            pass

    try:
        # Treat as pending if explicitly marked OR if no reported_eps yet (future
        # earnings on calendar that don't have a verdict set).
        is_pending = (
            (row and row.get("verdict", "").lower() == "pending")
            or (row and row.get("reported_eps") is None)
            or (row is None)  # unknown sym: still try preview, gives useful output
        )
        if is_pending:
            return _generate_earnings_preview(sym, row or {"sym": sym})
        return _generate_earnings_analysis(sym, row)
    except Exception as e:
        # Anthropic API or other transient failure — return graceful fallback
        return {
            "sym": sym,
            "analysis": None,
            "analysis_headline": None,
            "analysis_bullets": [],
            "preview_text": "",
            "preview_bullets": [],
            "beat_history": [],
            "yoy_eps_growth": None,
            "beat_streak": None,
            "news": [],
            "error": str(e),
        }
