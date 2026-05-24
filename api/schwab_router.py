"""
FastAPI router for Schwab API integration.
Add to main.py: from schwab_router import router as schwab_router
                 app.include_router(schwab_router)
"""

from fastapi import APIRouter, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse
from urllib.parse import urlparse, parse_qs
import logging
import api.schwab_service as schwab

logger = logging.getLogger(__name__)

# Yahoo Finance uses different symbols for indices
YF_INDEX_MAP = {"SPX":"^GSPC", "NDX":"^NDX", "DJX":"^DJI", "RUT":"^RUT", "VIX":"^VIX", "XSP":"^GSPC"}

router = APIRouter(prefix="/api/schwab", tags=["schwab"])


@router.get("/status")
async def schwab_status():
    """Check if Schwab API is connected."""
    authenticated = schwab.is_authenticated()
    persistent = str(schwab.TOKEN_FILE).startswith("/data")
    return {
        "connected": authenticated,
        "hasAppKey": bool(schwab.APP_KEY),
        "tokenStorage": str(schwab.TOKEN_FILE),
        "persistent": persistent,
        "message": "Connected to Schwab API" + (" (persistent)" if persistent else " (will reset on deploy)") if authenticated else "Not connected. Visit /api/schwab/login to authenticate.",
    }


@router.get("/login")
async def schwab_login():
    """Redirect user to Schwab OAuth login page."""
    if not schwab.APP_KEY:
        return JSONResponse(
            status_code=500,
            content={"error": "SCHWAB_APP_KEY environment variable not set."},
        )
    auth_url = schwab.get_auth_url()
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def schwab_callback(request: Request):
    """Handle Schwab OAuth callback with authorization code."""
    code = request.query_params.get("code")
    if not code:
        return JSONResponse(
            status_code=400,
            content={
                "error": "No authorization code received.",
                "hint": "Check the URL for a 'code' parameter.",
                "url": str(request.url),
            },
        )

    try:
        tokens = await schwab.exchange_code(code)
        return JSONResponse(content={
            "status": "success",
            "message": "Schwab API connected! You can close this page.",
            "access_token_expires_in": tokens.get("expires_in", "unknown"),
        })
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Token exchange failed: {str(e)}"},
        )


@router.post("/refresh")
async def schwab_refresh():
    """Manually trigger token refresh."""
    tokens = await schwab.refresh_access_token()
    if tokens:
        return {"status": "success", "message": "Token refreshed."}
    return JSONResponse(
        status_code=401,
        content={"error": "Refresh failed. Re-authenticate at /api/schwab/login."},
    )


@router.get("/options-quote")
async def options_quote(
    symbol: str = Query(..., description="Ticker symbol, e.g. AAPL"),
    strike: float = Query(..., description="Strike price, e.g. 250"),
    expDate: str = Query(..., description="Expiration date YYYY-MM-DD, e.g. 2026-03-20"),
    cp: str = Query(..., description="C for Call, P for Put"),
):
    """Fetch current price for a single option contract."""
    result = await schwab.get_option_quote(symbol, strike, expDate, cp)
    return result


@router.post("/options-quotes")
async def options_quotes_batch(contracts: list[dict]):
    """
    Fetch current prices for multiple option contracts.
    Body: [{"symbol":"AAPL","strike":250,"expDate":"2026-03-20","cp":"C"}, ...]
    Falls back to Unusual Whales for contracts Schwab can't price.
    """
    results = await schwab.get_batch_option_quotes(contracts)

    # ── UW fallback for failed contracts ──
    failed_indices = [i for i, r in enumerate(results) if r.get("error") and not r.get("expired")]
    if failed_indices:
        try:
            from api.uw_service import get_batch_quotes as uw_batch
        except ImportError:
            try:
                from uw_service import get_batch_quotes as uw_batch
            except ImportError:
                uw_batch = None

        if uw_batch:
            failed_contracts = [contracts[i] for i in failed_indices]
            try:
                uw_results = await uw_batch(failed_contracts)
                recovered = 0
                for idx, uw_q in zip(failed_indices, uw_results):
                    if not uw_q.get("error"):
                        uw_q["_source"] = "uw"
                        results[idx] = uw_q
                        recovered += 1
                if recovered > 0:
                    logger.info("[UW fallback] Recovered %d/%d failed contracts", recovered, len(failed_indices))
            except Exception as e:
                logger.warning("[UW fallback] Error: %s", e)

    return {"quotes": results}


@router.get("/market-summary")
async def market_summary():
    """Fetch current prices for SPY, QQQ, DIA, IWM, VIX."""
    results = await schwab.get_market_summary()
    return {"indices": results}


@router.get("/market-narrative")
async def market_narrative():
    """Generate AI narrative of today's market using Claude + web search."""
    import os
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return JSONResponse(status_code=500, content={"error": "ANTHROPIC_API_KEY not set"})

    try:
        from datetime import datetime
        today = datetime.now()
        today_str = today.strftime("%A, %B %d, %Y")
        weekday = today.weekday()
        day_note = ""
        if weekday == 5:
            day_note = " (Saturday — markets closed, summarize Friday's action)"
        elif weekday == 6:
            day_note = " (Sunday — markets closed, summarize Friday's action)"
        
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=250,
            metadata={"user_id": "market_narrative:global"},
            system="You are a financial news writer. Respond with ONLY 2-3 concise sentences. No preamble. No search commentary. No disclaimers. No 'based on my search' or 'I found'. Just the market summary as if writing a Bloomberg terminal flash.",
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{
                "role": "user",
                "content": f"Today is {today_str}{day_note}. Write 2-3 sentences: How did US markets close on the most recent trading day? Include S&P 500, Nasdaq, Dow moves and the main catalyst."
            }],
        )
        text = " ".join(
            block.text for block in response.content
            if hasattr(block, "text")
        ).strip()
        for noise in ["Based on", "I can see", "Let me search", "The search results", "I notice", "I need to"]:
            if text.startswith(noise):
                sentences = text.split(". ")
                text = ". ".join(s for s in sentences if any(w in s for w in ["S&P", "Nasdaq", "Dow", "market", "stock", "fell", "rose", "gained", "dropped", "declined"]))
        return {"narrative": text if text else "Market summary unavailable."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ─── Daily Tracker Endpoints ──────────────────────────────────────────────────

@router.post("/track-contracts")
async def track_contracts(contracts: list[dict]):
    """
    Register top-flow CONV contracts for daily OI/price tracking.
    Called automatically by the dashboard whenever new flow data loads.
    Body: [{sym, cp, K, exp, grade, dir, hits, prem}, ...]
    """
    from api.daily_tracker import register_contracts
    count = register_contracts(contracts)
    return {"status": "ok", "registered": count}


@router.get("/snapshot-now")
async def snapshot_now():
    """
    Manually trigger an OI/price snapshot for all registered contracts.
    Normally runs automatically at 4:30 PM ET on weekdays.
    """
    from api.daily_tracker import store_daily_snapshot
    result = await store_daily_snapshot()
    return result


@router.get("/contract-history")
async def contract_history(
    sym: str = Query(..., description="Ticker, e.g. AAPL"),
    cp: str = Query(..., description="C or P"),
    strike: float = Query(..., description="Strike price, e.g. 200"),
    exp: str = Query(..., description="Expiry M/D or M/D/YYYY, e.g. 3/20"),
):
    """
    Return daily OI/price snapshots for a single contract.
    Used by the hover chart in the dashboard to overlay historical tracking data.
    Response: {"history": [{"date":"3/14/2026","oi":5000,"price":2.50,"spot":198.0,"volume":1234}, ...]}
    """
    from api.daily_tracker import get_history
    history = get_history(sym, cp, strike, exp)
    return {"sym": sym, "cp": cp, "strike": strike, "exp": exp, "history": history}


@router.get("/backfill-contract")
async def backfill_contract_history(
    sym: str = Query(..., description="Ticker, e.g. NVDA"),
    cp: str = Query(..., description="C or P"),
    strike: float = Query(..., description="Strike price, e.g. 200"),
    exp: str = Query(..., description="Expiry M/D or M/D/YYYY, e.g. 4/2"),
    days_back: int = Query(60, description="How many calendar days to backfill"),
):
    """
    Backfill daily volume + close price from Polygon.io for a single contract.
    Merges into contract_history.json without overwriting existing OI from daily tracker.
    Requires POLYGON_API_KEY env var (free key at https://polygon.io).
    """
    from api.daily_tracker import backfill_contract
    result = await backfill_contract(sym, cp, strike, exp, days_back)
    return result


@router.post("/backfill-all")
async def backfill_all_contracts(days_back: int = 60):
    """
    Backfill Polygon history for all registered CONV contracts.
    Polygon free tier allows 5 req/min — adds 13s delay between contracts.
    For 6 CONV contracts, completes in ~75 seconds.
    """
    from api.daily_tracker import backfill_all_registered
    result = await backfill_all_registered(days_back)
    return result


@router.get("/chart-proxy")
async def chart_proxy(
    sym: str = Query(..., description="Ticker symbol, e.g. AAPL"),
    range: str = Query("3mo", description="Chart range: 5min, 10min, 15min, 30min, 65min, 1d, 5d, 1mo, 3mo, 6mo, 1y"),
):
    """
    Proxy Finviz chart image using FINVIZ_API_KEY env var.
    Falls back to Yahoo Finance + matplotlib rendered chart if Finviz fails.
    Supports intraday minute intervals (5m, 10m, 15m, 30m, 65m).
    """
    import httpx
    import io
    import os
    from fastapi.responses import Response

    sym = sym.upper()
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    finviz_key = os.getenv("FINVIZ_API_KEY", "")

    transparent_gif = bytes([0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,
        0x00,0xff,0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x00,0x3b])

    # Detect intraday vs daily
    is_intraday = range.endswith("min")

    # ─── Finviz period mapping ───
    if is_intraday:
        mins = int(range.replace("min", ""))
        # Finviz elite supports i5, i15, i30, i60
        fv_freq = min([5, 15, 30, 60], key=lambda x: abs(x - mins))
        finviz_p = f"i{fv_freq}"
    else:
        finviz_p = "d" if range in ("1d", "5d", "1mo", "3mo") else "w" if range == "6mo" else "m"

    # ─── Yahoo Finance mapping ───
    if is_intraday:
        mins = int(range.replace("min", ""))
        yf_interval_map = {5: "5m", 10: "5m", 15: "15m", 30: "30m", 65: "60m"}
        yf_interval = yf_interval_map.get(mins, "15m")
        yf_range = "1d" if mins <= 10 else "5d"
    else:
        yf_interval = "1d" if range != "1y" else "1wk"
        yf_range = range

    # 1. Try Finviz with API key
    if finviz_key:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"https://elite.finviz.com/chart.ashx",
                    params={"t": sym, "ty": "c", "ta": "0", "p": finviz_p, "s": "l"},
                    headers={
                        "User-Agent": ua,
                        "Referer": "https://elite.finviz.com/",
                        "Authorization": f"Bearer {finviz_key}",
                    },
                )
            if resp.status_code == 200 and len(resp.content) > 500:
                return Response(
                    content=resp.content,
                    media_type=resp.headers.get("content-type", "image/gif"),
                    headers={"Cache-Control": "no-cache"},
                )
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"https://finviz.com/chart.ashx",
                    params={"t": sym, "ty": "c", "ta": "0", "p": finviz_p, "s": "l", "apikey": finviz_key},
                    headers={"User-Agent": ua, "Referer": "https://finviz.com/"},
                )
            if resp.status_code == 200 and len(resp.content) > 500:
                return Response(
                    content=resp.content,
                    media_type=resp.headers.get("content-type", "image/gif"),
                    headers={"Cache-Control": "no-cache"},
                )
        except Exception:
            pass

    # 2. Fallback: Yahoo Finance data + matplotlib candlestick chart
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{YF_INDEX_MAP.get(sym, sym)}",
                params={"interval": yf_interval, "range": yf_range, "includePrePost": "false"},
                headers={"User-Agent": ua},
            )
        if resp.status_code != 200:
            return Response(content=transparent_gif, media_type="image/gif", status_code=404)
        data = resp.json()
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        ohlc = result["indicators"]["quote"][0]
        opens  = ohlc.get("open",  [])
        closes = ohlc.get("close", [])
        highs  = ohlc.get("high",  [])
        lows   = ohlc.get("low",   [])

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches
        from datetime import datetime
        from matplotlib.ticker import FixedLocator, FixedFormatter

        valid = [(t, o, h, l, c) for t, o, h, l, c in zip(timestamps, opens, highs, lows, closes)
                 if all(v is not None for v in (o, h, l, c))]
        if not valid:
            return Response(content=transparent_gif, media_type="image/gif", status_code=404)

        bg, up_col, dn_col, grid_col = "#06090f", "#00e676", "#ff1744", "#1a2540"
        fig, ax = plt.subplots(figsize=(5.6, 1.4), dpi=100)
        fig.patch.set_facecolor(bg)
        ax.set_facecolor(bg)

        for i, (ts, o, h, l, c) in enumerate(valid):
            col = up_col if c >= o else dn_col
            ax.plot([i, i], [l, h], color=col, linewidth=0.6, solid_capstyle="round")
            body_h = max(abs(c - o), (h - l) * 0.015)
            rect = mpatches.FancyBboxPatch(
                (i - 0.28, min(o, c)), 0.56, body_h,
                boxstyle="square,pad=0", facecolor=col, edgecolor="none"
            )
            ax.add_patch(rect)

        # X-axis labels: time for intraday, month for daily
        if is_intraday:
            from zoneinfo import ZoneInfo
            et = ZoneInfo("America/New_York")
            seen = set()
            tick_indices, tick_labels = [], []
            for i, (ts, *_) in enumerate(valid):
                dt = datetime.fromtimestamp(ts, tz=et)
                is_multiday = yf_range != "1d"
                if is_multiday:
                    # Multi-day intraday: label once per day at market open
                    day_key = dt.date()
                    if day_key not in seen:
                        seen.add(day_key)
                        tick_indices.append(i)
                        tick_labels.append(dt.strftime("%m/%d"))
                else:
                    # Single-day: label every hour
                    hour_key = (dt.date(), dt.hour)
                    if hour_key not in seen:
                        seen.add(hour_key)
                        tick_indices.append(i)
                        tick_labels.append(dt.strftime("%I%p").lstrip("0").replace("AM","a").replace("PM","p"))
        else:
            seen_months = set()
            tick_indices, tick_labels = [], []
            for i, (ts, *_) in enumerate(valid):
                dt = datetime.utcfromtimestamp(ts)
                key = (dt.year, dt.month)
                if key not in seen_months:
                    seen_months.add(key)
                    tick_indices.append(i)
                    tick_labels.append(dt.strftime("%b"))

        ax.xaxis.set_major_locator(FixedLocator(tick_indices))
        ax.xaxis.set_major_formatter(FixedFormatter(tick_labels))
        ax.xaxis.set_minor_locator(FixedLocator([]))
        for lbl in ax.get_xticklabels():
            lbl.set_fontsize(6 if is_intraday else 7)
            lbl.set_color("#4a5c73")
            lbl.set_fontweight("bold")
        ax.tick_params(axis="x", length=0, pad=3)
        ax.set_xlim(-1, len(valid))
        # Set explicit Y limits matching what chart-bounds returns
        data_high = max(h for _, _, h, _, _ in valid)
        data_low = min(l for _, _, _, l, _ in valid)
        y_pad = (data_high - data_low) * 0.05
        ax.set_ylim(data_low - y_pad, data_high + y_pad)
        ax.yaxis.set_visible(True)
        ax.yaxis.tick_right()
        ax.tick_params(axis="y", length=0, pad=4, labelsize=6, colors="#4a5c73")
        ax.spines[:].set_visible(False)
        ax.grid(axis="x", color=grid_col, linewidth=0.4, linestyle="--")
        fig.tight_layout(pad=0.2)

        buf = io.BytesIO()
        plt.savefig(buf, format="png", facecolor=bg, dpi=100)
        plt.close(fig)
        buf.seek(0)
        return Response(
            content=buf.read(),
            media_type="image/png",
            headers={"Cache-Control": "no-cache"},
        )
    except Exception:
        return Response(content=transparent_gif, media_type="image/gif", status_code=404)


@router.get("/chart-bounds")
async def chart_bounds(
    sym: str = Query(..., description="Ticker symbol"),
    range: str = Query("3mo", description="Same range as chart-proxy"),
):
    """
    Return the actual high/low price bounds for a chart range.
    Used by the GEX overlay to accurately position level lines.
    """
    import httpx

    sym = sym.upper()
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    is_intraday = range.endswith("min")

    if is_intraday:
        mins = int(range.replace("min", ""))
        yf_interval_map = {5: "5m", 10: "5m", 15: "15m", 30: "30m", 65: "60m"}
        yf_interval = yf_interval_map.get(mins, "15m")
        yf_range = "1d" if mins <= 10 else "5d"
    else:
        yf_interval = "1d" if range != "1y" else "1wk"
        yf_range = range

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{YF_INDEX_MAP.get(sym, sym)}",
                params={"interval": yf_interval, "range": yf_range, "includePrePost": "false"},
                headers={"User-Agent": ua},
            )
        if resp.status_code != 200:
            return {"error": "Yahoo Finance error", "status": resp.status_code}
        data = resp.json()
        result = data["chart"]["result"][0]
        ohlc = result["indicators"]["quote"][0]
        highs = [h for h in ohlc.get("high", []) if h is not None]
        lows = [l for l in ohlc.get("low", []) if l is not None]
        if not highs or not lows:
            return {"error": "No price data"}
        data_high = max(highs)
        data_low = min(lows)
        y_pad = (data_high - data_low) * 0.05
        return {"high": data_high + y_pad, "low": data_low - y_pad, "sym": sym, "range": range}
    except Exception as e:
        return {"error": str(e)}


@router.get("/chart-ohlc")
async def chart_ohlc(
    sym: str = Query(..., description="Ticker symbol"),
    range: str = Query("3mo", description="5min, 10min, 15min, 30min, 65min, 1d, 5d, 1mo, 3mo, 6mo, 1y"),
):
    """
    Return OHLC candlestick data as JSON for Lightweight Charts.
    Timestamps in UTC seconds. Intraday returns minute bars, daily returns day bars.
    """
    import httpx

    sym = sym.upper()
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    is_intraday = range.endswith("min")

    if is_intraday:
        mins = int(range.replace("min", ""))
        yf_interval_map = {5: "5m", 10: "5m", 15: "15m", 30: "30m", 65: "60m"}
        yf_interval = yf_interval_map.get(mins, "15m")
        yf_range = "1d" if mins <= 10 else "5d"
    else:
        yf_interval = "1d" if range != "1y" else "1wk"
        yf_range = range

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{YF_INDEX_MAP.get(sym, sym)}",
                params={"interval": yf_interval, "range": yf_range, "includePrePost": "false"},
                headers={"User-Agent": ua},
            )
        if resp.status_code != 200:
            return {"error": f"Yahoo Finance error: {resp.status_code}"}
        data = resp.json()
        result = data["chart"]["result"][0]
        timestamps = result.get("timestamp", [])
        ohlc = result["indicators"]["quote"][0]
        opens = ohlc.get("open", [])
        highs = ohlc.get("high", [])
        lows = ohlc.get("low", [])
        closes = ohlc.get("close", [])

        candles = []
        for t, o, h, l, c in zip(timestamps, opens, highs, lows, closes):
            if all(v is not None for v in (o, h, l, c)):
                candles.append({"time": int(t), "open": round(o, 2), "high": round(h, 2), "low": round(l, 2), "close": round(c, 2)})

        return {"sym": sym, "range": range, "intraday": is_intraday, "candles": candles}
    except Exception as e:
        return {"error": str(e)}


# ─── Earnings Dates (Yahoo Finance) ──────────────────────────────────────────

from datetime import datetime as _datetime, date as _date
import asyncio as _asyncio

_earnings_cache: dict = {}
_EARNINGS_TTL_HOURS = 12


_yf_crumb = None
_yf_session = None

def _get_yf_session():
    """Get a Yahoo Finance session with valid crumb."""
    global _yf_crumb, _yf_session
    import requests
    if _yf_crumb and _yf_session:
        return _yf_session, _yf_crumb
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
    # Get cookies
    s.get("https://fc.yahoo.com", timeout=8)
    # Get crumb
    r = s.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=8)
    if r.status_code == 200 and r.text:
        _yf_crumb = r.text.strip()
        _yf_session = s
        print(f"[earnings] Got Yahoo crumb: {_yf_crumb[:8]}...", flush=True)
        return s, _yf_crumb
    raise Exception(f"Failed to get crumb: {r.status_code}")


def _fetch_earnings_yf(symbol: str):
    """Fetch next earnings date from Yahoo Finance quoteSummary API."""
    try:
        s, crumb = _get_yf_session()
        resp = s.get(
            f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
            params={"modules": "calendarEvents", "crumb": crumb},
            timeout=8
        )
        if resp.status_code == 401:
            # Crumb expired — reset and retry once
            global _yf_crumb, _yf_session
            _yf_crumb = None
            _yf_session = None
            s, crumb = _get_yf_session()
            resp = s.get(
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                params={"modules": "calendarEvents", "crumb": crumb},
                timeout=8
            )
        if resp.status_code != 200:
            print(f"[earnings] Yahoo returned {resp.status_code} for {symbol}", flush=True)
            return None

        data = resp.json()
        cal = data.get("quoteSummary", {}).get("result", [{}])[0].get("calendarEvents", {})
        earnings = cal.get("earnings", {})
        dates = earnings.get("earningsDate", [])

        if not dates:
            print(f"[earnings] {symbol}: no earningsDate in response", flush=True)
            return None

        raw = dates[0].get("raw") if isinstance(dates[0], dict) else dates[0]
        if not raw:
            return None

        from datetime import datetime as dt
        ed = dt.utcfromtimestamp(raw).date()
        today = _date.today()
        days_until = (ed - today).days

        m, d, y = ed.month, ed.day, ed.year
        date_str = f"{m}/{d}" if y == today.year else f"{m}/{d}/{str(y)[-2:]}"
        confirmed = len(dates) == 1

        print(f"[earnings] {symbol}: {date_str} in {days_until}d {'confirmed' if confirmed else 'estimated'}", flush=True)
        return {"date": date_str, "daysUntil": days_until, "confirmed": confirmed, "timing": ""}
    except Exception as e:
        print(f"[earnings] {symbol} exception: {e}", flush=True)
        return None


@router.post("/earnings")
async def get_earnings_dates(req: dict):
    """Batch fetch next earnings dates from Yahoo Finance."""
    symbols = req.get("symbols", [])[:50]
    results = {}
    now = _datetime.now()
    to_fetch = []

    for sym in symbols:
        sym = sym.upper().strip()
        if not sym:
            continue
        cached = _earnings_cache.get(sym)
        if cached and (now - cached["_at"]).total_seconds() < _EARNINGS_TTL_HOURS * 3600:
            results[sym] = {k: v for k, v in cached.items() if k != "_at"}
            continue
        to_fetch.append(sym)

    if to_fetch:
        loop = _asyncio.get_event_loop()
        for i, sym in enumerate(to_fetch):
            if i > 0:
                await _asyncio.sleep(0.15)
            try:
                info = await loop.run_in_executor(None, _fetch_earnings_yf, sym)
                if info:
                    _earnings_cache[sym] = {**info, "_at": now}
                    results[sym] = info
                else:
                    _earnings_cache[sym] = {"date": None, "daysUntil": None, "confirmed": False, "timing": "", "_at": now}
                    results[sym] = None
            except Exception as e:
                results[sym] = {"error": str(e)}

    return {"earnings": results}


@router.get("/earnings-test")
async def earnings_test(sym: str = Query("QCOM", description="Ticker to test")):
    """Debug endpoint — test earnings fetch for a single ticker."""
    import requests
    sym = sym.upper().strip()
    debug = {"symbol": sym, "steps": []}
    try:
        s, crumb = _get_yf_session()
        debug["steps"].append(f"Got crumb: {crumb[:8]}...")
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
        debug["steps"].append(f"Fetching {url}")
        resp = s.get(url, params={"modules": "calendarEvents", "crumb": crumb}, timeout=8)
        debug["status_code"] = resp.status_code
        if resp.status_code != 200:
            debug["steps"].append(f"Bad status: {resp.status_code}")
            debug["response_text"] = resp.text[:500]
            return debug
        data = resp.json()
        debug["steps"].append("Got JSON response")
        cal = data.get("quoteSummary", {}).get("result", [{}])[0].get("calendarEvents", {})
        earnings = cal.get("earnings", {})
        dates = earnings.get("earningsDate", [])
        debug["calendarEvents_keys"] = list(cal.keys()) if cal else "empty"
        debug["earnings_keys"] = list(earnings.keys()) if earnings else "empty"
        debug["earningsDate_raw"] = dates
        if dates:
            raw = dates[0].get("raw") if isinstance(dates[0], dict) else dates[0]
            debug["first_date_raw"] = raw
            if raw:
                from datetime import datetime as dt
                ed = dt.utcfromtimestamp(raw).date()
                debug["parsed_date"] = str(ed)
                debug["days_until"] = (ed - _date.today()).days
        debug["steps"].append("Done")
    except Exception as e:
        debug["error"] = str(e)
    return debug


@router.get("/ytd-performance")
async def ytd_performance(symbols: str = Query(..., description="Comma-separated tickers")):
    """
    Return YTD% and % off 52-week high for a list of tickers via Yahoo Finance.
    GET /api/schwab/ytd-performance?symbols=NVDA,AMD,MU
    Returns: {"ytd": {"NVDA": 45.2}, "off52": {"NVDA": -8.3}}
    """
    import httpx
    from datetime import datetime

    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    ytd_results = {}
    off52_results = {}
    current_year = datetime.now().year

    async with httpx.AsyncClient(timeout=10.0) as client:
        for sym in tickers[:30]:
            try:
                resp = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                    params={"interval": "1d", "range": "1y", "includePrePost": "false"},
                    headers={"User-Agent": ua},
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                result = data.get("chart", {}).get("result", [{}])[0]
                timestamps = result.get("timestamp", [])
                quote = result.get("indicators", {}).get("quote", [{}])[0]
                closes = quote.get("close", [])
                highs = quote.get("high", [])

                # 52-week high
                valid_highs = [h for h in highs if h is not None]
                valid_closes = [c for c in closes if c is not None]
                if valid_highs and valid_closes:
                    high_52 = max(valid_highs)
                    current = valid_closes[-1]
                    off52_results[sym] = round((current - high_52) / high_52 * 100, 1)

                # YTD: find first close on or after Jan 1 of current year
                ytd_start = None
                for i, ts in enumerate(timestamps):
                    if ts is None:
                        continue
                    dt = datetime.utcfromtimestamp(ts)
                    if dt.year >= current_year and closes[i] is not None:
                        ytd_start = closes[i]
                        break
                if ytd_start and valid_closes:
                    current = valid_closes[-1]
                    ytd_results[sym] = round((current - ytd_start) / ytd_start * 100, 1)
            except Exception:
                continue

    return {"ytd": ytd_results, "off52": off52_results}


@router.get("/oi-change-batch")
async def oi_change_batch(symbols: str = Query(..., description="Comma-separated tickers")):
    """
    Return net OI change (sum of all contracts' OI changes) for each ticker.
    Positive = new positions opening, Negative = positions closing.
    GET /api/schwab/oi-change-batch?symbols=NVDA,AMD,MU
    """
    try:
        from api.uw_service import get_oi_change
    except ImportError:
        from uw_service import get_oi_change

    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    results = {}

    for sym in tickers[:25]:
        try:
            data = await get_oi_change(sym)
            if not data:
                continue
            # Sum net OI change across all contracts
            net_oi = 0
            call_oi = 0
            put_oi = 0
            for contract in data:
                change = int(contract.get("oi_change", 0) or 0)
                cp = (contract.get("option_type") or "").upper()
                net_oi += change
                if "CALL" in cp:
                    call_oi += change
                elif "PUT" in cp:
                    put_oi += change
            results[sym] = {"net": net_oi, "call": call_oi, "put": put_oi}
        except Exception:
            continue

    return {"oi_changes": results}

@router.get("/mktcap-batch")
async def mktcap_batch(symbols: str = Query(..., description="Comma-separated tickers")):
    """
    Return market cap for a list of tickers via Schwab API (Yahoo fallback).
    GET /api/schwab/mktcap-batch?symbols=AAPL,MSFT,NVDA
    Returns: {"mktcap": {"AAPL": 2940000000000, "MSFT": 3100000000000}}
    """
    try:
        from api.schwab_service import get_mktcap_batch
    except ImportError:
        from schwab_service import get_mktcap_batch

    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    results = await get_mktcap_batch(tickers[:50])
    return {"mktcap": results}
