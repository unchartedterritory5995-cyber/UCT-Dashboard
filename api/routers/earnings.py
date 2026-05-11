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
        result = get_earnings()
        try:
            from api.routers.bars import warm_bars_async
            tickers = [
                e["sym"].upper()
                for bucket in (result.get("bmo") or [], result.get("amc") or [], result.get("amc_tonight") or [])
                for e in bucket if isinstance(e, dict) and e.get("sym")
            ]
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=8000)
        except Exception:
            pass
        return result
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


@router.get("/api/debug/earnings-sources/{sym}")
def debug_earnings_sources(sym: str):
    """Diagnostic: hit each earnings-data source and report status + sample.

    Use to see why preview_text/beat_streak/etc are empty. Shows which of FMP,
    Alpha Vantage, Finnhub, Anthropic returns usable data for this ticker.
    """
    import os, requests
    sym = sym.upper()
    out = {}

    fmp_key = os.environ.get("FMP_API_KEY", "")
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    ant_key = os.environ.get("ANTHROPIC_API_KEY", "")

    out["env"] = {
        "FMP_API_KEY":         "set" if fmp_key else "MISSING",
        "ALPHAVANTAGE_API_KEY":"set" if av_key else "MISSING",
        "FINNHUB_API_KEY":     "set" if fh_key else "MISSING",
        "ANTHROPIC_API_KEY":   "set" if ant_key else "MISSING",
    }

    # Test each FMP earnings endpoint variant
    fmp_tests = [
        ("v3/earnings-surprises", f"https://financialmodelingprep.com/api/v3/earnings-surprises/{sym}?apikey={fmp_key}"),
        ("stable/earnings-surprises", f"https://financialmodelingprep.com/stable/earnings-surprises?symbol={sym}&apikey={fmp_key}"),
        ("v3/historical/earning_calendar", f"https://financialmodelingprep.com/api/v3/historical/earning_calendar/{sym}?apikey={fmp_key}"),
        ("stable/earnings", f"https://financialmodelingprep.com/stable/earnings?symbol={sym}&limit=12&apikey={fmp_key}"),
        ("stable/historical-earning-calendar", f"https://financialmodelingprep.com/stable/historical-earning-calendar?symbol={sym}&limit=12&apikey={fmp_key}"),
    ]
    out["fmp"] = {}
    if fmp_key:
        for name, url in fmp_tests:
            try:
                r = requests.get(url, timeout=8)
                body = r.text[:200] if r.status_code != 200 else None
                if r.status_code == 200:
                    try:
                        data = r.json()
                        if isinstance(data, list):
                            out["fmp"][name] = f"OK list[{len(data)}]" + (f" sample={data[0]}" if data else "")
                        elif isinstance(data, dict):
                            out["fmp"][name] = f"OK dict keys={list(data.keys())[:5]}"
                        else:
                            out["fmp"][name] = f"OK type={type(data).__name__}"
                    except Exception as je:
                        out["fmp"][name] = f"200 but JSON parse failed: {je}"
                else:
                    out["fmp"][name] = f"{r.status_code}: {body}"
            except Exception as e:
                out["fmp"][name] = f"exception: {e}"

    # Test AV
    if av_key:
        try:
            r = requests.get(f"https://www.alphavantage.co/query?function=EARNINGS&symbol={sym}&apikey={av_key}", timeout=10)
            data = r.json()
            if data.get("quarterlyEarnings"):
                out["av"] = f"OK quarters={len(data['quarterlyEarnings'])}"
            else:
                out["av"] = f"empty/error: {str(data)[:200]}"
        except Exception as e:
            out["av"] = f"exception: {e}"

    # Test Anthropic with a one-line haiku call
    if ant_key:
        try:
            from api.services.engine import _get_anthropic_client
            client = _get_anthropic_client()
            msg = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=20,
                messages=[{"role": "user", "content": "Say 'pong' and nothing else."}],
            )
            out["anthropic"] = f"OK: {msg.content[0].text[:50]}"
        except Exception as e:
            out["anthropic"] = f"exception: {type(e).__name__}: {e}"

    # Test Finnhub transcript availability
    if fh_key:
        try:
            r = requests.get(f"https://finnhub.io/api/v1/stock/transcripts/list?symbol={sym}&token={fh_key}", timeout=8)
            data = r.json()
            tr_count = len(data.get("transcripts", []))
            out["finnhub_transcripts"] = f"OK count={tr_count}" if tr_count else f"empty: {str(data)[:200]}"
        except Exception as e:
            out["finnhub_transcripts"] = f"exception: {e}"

    return out


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
            "analysis_summary": None,
            "analysis_bullets": [],
            "preview_text": "",
            "preview_bullets": [],
            "beat_history": [],
            "yoy_eps_growth": None,
            "beat_streak": None,
            "news": [],
            "error": str(e),
        }


@router.get("/api/chart/markers/{ticker}")
@router.get("/api/chart-markers/{ticker}")
def chart_markers_endpoint(ticker: str, days: int = 730):
    """Earnings beat/miss history + stock splits + dividends for chart annotation.

    `days` filters output to events within the last N calendar days
    (1 ≤ days ≤ 3650). The underlying fetch always pulls a 5-year window
    so the per-ticker cache entry serves both short and long ranges; we
    only post-filter the cached result here.
    """
    from datetime import date, timedelta
    from api.services.earnings_estimates import get_chart_markers

    days = max(1, min(int(days or 730), 3650))
    cutoff = (date.today() - timedelta(days=days)).isoformat()

    raw = get_chart_markers(ticker.upper()) or {}
    return {
        "earnings":  [e for e in (raw.get("earnings")  or []) if (e.get("date") or "") >= cutoff],
        "splits":    [s for s in (raw.get("splits")    or []) if (s.get("date") or "") >= cutoff],
        "dividends": [d for d in (raw.get("dividends") or []) if (d.get("date") or "") >= cutoff],
    }
