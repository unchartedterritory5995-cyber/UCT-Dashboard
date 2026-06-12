"""api/routers/modelbook.py — Model Book API.

A curated library of the best stocks in history, organized by year, with the
firm's playbook setups labeled on each stock's chart.

Reads are open to any logged-in user (Model Book is a FREE_PAGE). Writes
(curating stocks + labeling setups) are admin-only — mirrors the auth pattern
in api/routers/catalysts.py (get_current_user vs require_admin).

Routes:
    GET    /api/modelbook/years                    → [2025, 2024, ...]
    GET    /api/modelbook/stocks?year=2025          → curated stocks for a year
    GET    /api/modelbook/stock/{stock_id}          → stock + its setups[]
    POST   /api/modelbook/stocks                     → add stock          (admin)
    PUT    /api/modelbook/stock/{stock_id}          → edit stock         (admin)
    DELETE /api/modelbook/stock/{stock_id}          → remove stock       (admin)
    POST   /api/modelbook/stock/{stock_id}/setups   → label a setup      (admin)
    PUT    /api/modelbook/setup/{setup_id}          → edit a setup       (admin)
    DELETE /api/modelbook/setup/{setup_id}          → remove a setup     (admin)
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import modelbook_service as svc

router = APIRouter(prefix="/api/modelbook", tags=["modelbook"])

_GRADES = {"A+", "A", "B", "C", "F"}
_TIMEFRAMES = {"D", "W"}
_MARKER_SIDES = {"aboveBar", "belowBar"}
_MARKER_SHAPES = {"arrowUp", "arrowDown", "circle", "square"}
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ── Pydantic payloads ─────────────────────────────────────────────────────────

class StockIn(BaseModel):
    year: int
    symbol: str
    company: Optional[str] = None
    sector: Optional[str] = None      # curated watermark sector (renamed/delisted tickers); AI-filled if blank
    industry: Optional[str] = None    # curated watermark industry
    data_symbol: Optional[str] = None # exchange-suffixed provider symbol for non-US tickers (e.g. 005930.KS) → logo + earnings
    sort_order: Optional[int] = 0
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None


class StockPatch(BaseModel):
    year: Optional[int] = None
    symbol: Optional[str] = None
    company: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    data_symbol: Optional[str] = None
    sort_order: Optional[int] = None
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None
    company_desc: Optional[str] = None
    run_story: Optional[str] = None
    drawings_json: Optional[str] = None   # stock-level chart annotations (full-year view)


class SetupIn(BaseModel):
    setup_type: str
    label_date: str
    frame_start_date: Optional[str] = None
    timeframe: Optional[str] = "D"
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    marker_side: Optional[str] = "belowBar"
    marker_shape: Optional[str] = "arrowUp"
    drawings_json: Optional[str] = None   # JSON array of chart annotations


class SetupPatch(BaseModel):
    setup_type: Optional[str] = None
    label_date: Optional[str] = None
    frame_start_date: Optional[str] = None
    timeframe: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    marker_side: Optional[str] = None
    marker_shape: Optional[str] = None
    drawings_json: Optional[str] = None   # JSON array of chart annotations


class IndexDrawingsPatch(BaseModel):
    drawings_json: str   # JSON array of chart annotations for the index pane (measure marks)


class ExampleIn(BaseModel):
    # Charted example for the Setup Library (keyed by catalog setup name).
    setup_name: str
    symbol: str
    company: Optional[str] = None
    data_symbol: Optional[str] = None
    year: int
    label_date: Optional[str] = None
    frame_start_date: Optional[str] = None
    result_start_date: Optional[str] = None
    result_end_date: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = 0


class ExamplePatch(BaseModel):
    setup_name: Optional[str] = None
    symbol: Optional[str] = None
    company: Optional[str] = None
    data_symbol: Optional[str] = None
    year: Optional[int] = None
    label_date: Optional[str] = None
    frame_start_date: Optional[str] = None
    result_start_date: Optional[str] = None
    result_end_date: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    drawings_json: Optional[str] = None
    sort_order: Optional[int] = None


def _validate_example(d: dict) -> None:
    for key in ("label_date", "frame_start_date", "result_start_date", "result_end_date"):
        if d.get(key) not in (None, "") and not _ISO_DATE.match(d[key]):
            raise HTTPException(400, f"{key} must be YYYY-MM-DD")
    if d.get("grade") not in (None, "") and d["grade"] not in _GRADES:
        raise HTTPException(400, f"grade must be one of {sorted(_GRADES)}")
    if d.get("year") is not None and not (1900 <= int(d["year"]) <= 2100):
        raise HTTPException(400, "year out of range")
    if d.get("symbol") is not None and not str(d["symbol"]).strip():
        raise HTTPException(400, "symbol required")


class BarsIn(BaseModel):
    bars: list[dict]     # uploaded daily OHLCV: [{t:'YYYY-MM-DD', o,h,l,c, v}, ...]


def _clean_bars(raw: list[dict]) -> list[dict]:
    """Validate + normalize uploaded bars → sorted, deduped daily OHLCV. Raises
    HTTPException(400) on bad input."""
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "bars must be a non-empty array")
    if len(raw) > 20000:
        raise HTTPException(400, "too many bars (max 20000)")
    by_date: dict[str, dict] = {}
    for b in raw:
        try:
            t = str(b["t"])[:10]
            o, h, l, cl = float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "each bar needs t (YYYY-MM-DD) and numeric o/h/l/c")
        if not _ISO_DATE.match(t):
            raise HTTPException(400, f"bad date '{t}' — must be YYYY-MM-DD")
        if not all(x > 0 for x in (o, h, l, cl)):
            continue  # skip non-positive (bad) rows rather than poison the series
        try:
            v = int(float(b.get("v", 0) or 0))
        except (TypeError, ValueError):
            v = 0
        by_date[t] = {"t": t, "o": round(o, 4), "h": round(h, 4),
                      "l": round(l, 4), "c": round(cl, 4), "v": max(0, v)}
    out = [by_date[k] for k in sorted(by_date)]
    if not out:
        raise HTTPException(400, "no valid bars after cleaning")
    return out


class CatalystIn(BaseModel):
    catalyst_date: str
    title: str
    description: Optional[str] = None
    move_pct: Optional[float] = None
    sort_order: Optional[int] = 0
    source: Optional[str] = "manual"


class CatalystPatch(BaseModel):
    catalyst_date: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    move_pct: Optional[float] = None
    sort_order: Optional[int] = None


def _validate_catalyst(d: dict) -> None:
    if d.get("catalyst_date") is not None and not _ISO_DATE.match(d["catalyst_date"]):
        raise HTTPException(400, "catalyst_date must be YYYY-MM-DD")


def _validate_setup(d: dict) -> None:
    """Validate the enum/format fields present in a setup payload → 400 on bad."""
    if d.get("label_date") is not None and not _ISO_DATE.match(d["label_date"]):
        raise HTTPException(400, "label_date must be YYYY-MM-DD")
    if d.get("frame_start_date") not in (None, "") and not _ISO_DATE.match(d["frame_start_date"]):
        raise HTTPException(400, "frame_start_date must be YYYY-MM-DD")
    if d.get("timeframe") is not None and d["timeframe"] not in _TIMEFRAMES:
        raise HTTPException(400, f"timeframe must be one of {sorted(_TIMEFRAMES)}")
    if d.get("grade") not in (None, "") and d["grade"] not in _GRADES:
        raise HTTPException(400, f"grade must be one of {sorted(_GRADES)}")
    if d.get("marker_side") is not None and d["marker_side"] not in _MARKER_SIDES:
        raise HTTPException(400, f"marker_side must be one of {sorted(_MARKER_SIDES)}")
    if d.get("marker_shape") is not None and d["marker_shape"] not in _MARKER_SHAPES:
        raise HTTPException(400, f"marker_shape must be one of {sorted(_MARKER_SHAPES)}")


# ── Reads (any logged-in user) ────────────────────────────────────────────────

@router.get("/years")
def get_years(_user: dict = Depends(get_current_user)):
    return {"years": svc.list_years()}


@router.get("/stocks")
def get_stocks(year: int = Query(...), _user: dict = Depends(get_current_user)):
    return {"year": year, "stocks": svc.get_stocks_for_year(year)}


@router.get("/all-stocks")
def all_stocks(_user: dict = Depends(get_current_user)):
    """Minimal {id, year, symbol} for EVERY curated stock across all years — one
    round-trip the frontend uses to prefetch every chart/detail/earnings on open
    so switching years + tickers is instant. Lightweight (no setups/catalysts)."""
    return {"stocks": [{"id": s["id"], "year": s["year"], "symbol": s["symbol"]}
                       for s in svc.get_all_stocks()]}


@router.get("/stock/{stock_id}")
def get_stock(stock_id: int, _user: dict = Depends(get_current_user)):
    stock = svc.get_stock_detail(stock_id)
    if not stock:
        raise HTTPException(404, "Stock not found")
    # Always show "TICKER (Company)" in the header: if a stock was added without a
    # company name typed in, fill it from live ticker-meta (same source as the
    # chart watermark) and persist it so it's there permanently.
    if not stock.get("company") and stock.get("symbol"):
        try:
            from api.services.ticker_meta import get_ticker_meta as _gtm
            nm = (_gtm(stock["symbol"]) or {}).get("name")
            if nm:
                stock["company"] = nm
                svc.backfill_company(stock_id, nm)
        except Exception:
            pass
    # Auto-generate the company/story descriptions + watermark sector/industry on
    # first view (background). _needs_desc also fires when an older stock still
    # lacks sector/industry, so the new watermark fields backfill on next view.
    if _is_final_year(stock.get("year", 0)) and _needs_desc(stock):
        _gen_desc_async(stock)
    # Auto-generate bullish, stock-specific catalysts on first view (background),
    # once per stock — then kept permanently in the DB (no manual "Generate").
    if _needs_catalysts(stock):
        _gen_catalysts_async(stock)
    return stock


@router.post("/stock/{stock_id}/descriptions/generate")
def regenerate_descriptions(stock_id: int, _admin: dict = Depends(require_admin)):
    """Force-regenerate a stock's company description + year narrative now
    (synchronously) — the manual fallback when the auto pass returned nothing.
    Returns the refreshed stock detail."""
    stock = svc.get_stock_detail(stock_id)
    if not stock:
        raise HTTPException(404, "Stock not found")
    d = _generate_descriptions(stock["symbol"], stock.get("company"),
                               stock["year"], stock.get("oc_pct"))
    _persist_desc_result(stock_id, d)
    return svc.get_stock_detail(stock_id)


def _load_year_bars(symbol: str, year: int, stock_id=None) -> list:
    """Sorted daily bars for (symbol, year). PREFERS admin-uploaded custom bars
    (svc.modelbook_stock_bars) when present — a since-renamed/delisted ticker
    (e.g. YELL in 2013 traded as YRCW) has NO provider data under its current
    symbol, so the provider fetch returns nothing for the book year while the
    uploaded bars (what the chart already renders) are the real history. Falls
    back to the cached provider fetch. Returns [] on failure."""
    import json
    ystr = str(year)
    # 1. Uploaded custom bars win (provider can't cover the old/renamed symbol).
    if stock_id is not None:
        try:
            raw = svc.get_stock_bars(stock_id)
            if raw:
                yb = [b for b in json.loads(raw) if str(b.get("t", "")).startswith(ystr)]
                yb.sort(key=lambda b: b.get("t", ""))
                if yb:
                    return yb
        except Exception:
            pass
    # 2. Provider fetch (cached bars path).
    try:
        from api.services import bars_fetch
        resp = bars_fetch._get_bars_inner(symbol, "D", 5000)
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
        yb = [b for b in data.get("bars", []) if str(b.get("t", "")).startswith(ystr)]
        yb.sort(key=lambda b: b.get("t", ""))  # 'YYYY-MM-DD' sorts chronologically
        if yb:
            return yb
    except Exception:
        pass
    # 3. Deep history for old years the standard 5000-bar provider window can't
    #    reach (it only spans back to ~2006, so 2004/2005 stocks come up empty
    #    above). Pull yfinance period='max' merged with Massive via the deep path.
    #    Only reached when the cheap paths fail, and _compute_year_stats runs in
    #    the background warmer thread — so the yfinance latency never hits a user.
    try:
        from api.services import bars_fetch
        deep = bars_fetch._fetch_daily(symbol.upper(), 12000, deep=True)
        yb = [b for b in deep if str(b.get("t", "")).startswith(ystr)]
        yb.sort(key=lambda b: b.get("t", ""))
        return yb
    except Exception:
        return []


def _compute_year_stats(symbol: str, year: int, stock_id=None) -> dict:
    """For a (symbol, year): % move from year open→close, and from year
    low→high. Computed from daily bars and cached (closed-year stats are
    static). Returns {open_close_pct, low_high_pct} (None when unavailable)."""
    from api.services.cache import cache

    ckey = f"modelbook_yearstats_{symbol.upper()}_{year}"
    cached = cache.get(ckey)
    if cached is not None:
        return cached

    stats = {"open_close_pct": None, "low_high_pct": None, "avg_vol": None}
    try:
        yb = _load_year_bars(symbol, year, stock_id)
        if yb:
            o = yb[0].get("o")
            c = yb[-1].get("c")
            lows = [b["l"] for b in yb if b.get("l") is not None]
            highs = [b["h"] for b in yb if b.get("h") is not None]
            # DOLLAR volume per day = shares traded * close price.
            dvols = [b["v"] * b["c"] for b in yb if b.get("v") is not None and b.get("c") is not None]
            if o:
                stats["open_close_pct"] = round((c - o) / o * 100, 1)
            if lows and highs and min(lows):
                stats["low_high_pct"] = round((max(highs) - min(lows)) / min(lows) * 100, 1)
            if dvols:
                stats["avg_vol"] = round(sum(dvols) / len(dvols))  # avg daily $ volume
    except Exception:
        pass

    cache.set(ckey, stats, ttl=86400)  # 24h; full-year stats don't change
    return stats


def _is_final_year(year: int) -> bool:
    """Past calendar years are closed — their stats never change, so they can be
    persisted permanently. The current/future year must be recomputed."""
    from datetime import datetime, timezone
    return int(year) < datetime.now(timezone.utc).year


import threading as _threading
_warm_lock = _threading.Lock()
_warming_years = set()  # years with a background warm in flight (dedupe)


def _persist_stats_for(stocks, max_workers=2):
    """Compute + persist stats for the given stock rows that lack them.
    Low concurrency to avoid bars-SQLite write contention on the web pod.
    Only valid (non-None) results are persisted, so transient fetch failures
    retry on the next pass instead of sticking as a blank '—' forever."""
    import concurrent.futures
    # Recompute when the gain OR the (newer) avg_vol stat is missing — so adding
    # a new stat backfills existing rows instead of leaving them blank.
    pending = [s for s in stocks if s.get("oc_pct") is None or s.get("avg_vol") is None]
    if not pending:
        return

    def _work(s):
        try:
            st = _compute_year_stats(s["symbol"], s["year"], s.get("id"))
            oc = st.get("open_close_pct")
            if oc is not None:  # don't persist failures
                svc.save_stats(s["id"], oc, st.get("low_high_pct"), st.get("avg_vol"))
        except Exception:
            pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, pending))


def _warm_year_async(year: int):
    """Kick off a deduped background warm for one year. Non-blocking."""
    with _warm_lock:
        if year in _warming_years:
            return
        _warming_years.add(year)

    def _run():
        try:
            _persist_stats_for(svc.get_stocks_for_year(year))
        finally:
            with _warm_lock:
                _warming_years.discard(year)
    _threading.Thread(target=_run, daemon=True, name=f"mb-warm-{year}").start()


@router.get("/year-stats")
def year_stats(year: int = Query(...), _user: dict = Depends(get_current_user)):
    """Per-stock year price stats (open→close %, low→high %), keyed by symbol.

    ALWAYS instant: returns whatever is persisted on the stock rows (a plain DB
    read). Anything not yet computed comes back null and is filled by a deduped
    background warm — the frontend polls until it lands, then it's persisted
    permanently (closed-year stats never change)."""
    stocks = svc.get_stocks_for_year(year)
    final = _is_final_year(year)
    out = {}
    needWarm = False
    for s in stocks:
        oc = s.get("oc_pct")
        if oc is not None:
            out[s["symbol"]] = {"open_close_pct": oc, "low_high_pct": s.get("lh_pct")}
        else:
            out[s["symbol"]] = {"open_close_pct": None, "low_high_pct": None}
        if oc is None or s.get("avg_vol") is None:  # backfill gain and/or volume
            needWarm = True
    if needWarm and final:
        _warm_year_async(year)
    return {"year": year, "stats": out}


@router.get("/year-earnings")
def year_earnings(symbol: str = Query(...), year: int = Query(...),
                  data_symbol: str = Query(None),
                  _user: dict = Depends(get_current_user)):
    """Quarterly EPS + revenue (actual vs estimate, with % surprise) for the
    reports that landed during `year`. Lazy — fetched only when the Earnings tab
    is opened. Finnhub-backed + cached (closed years are static). `data_symbol`
    is the exchange-suffixed provider symbol for non-US tickers (e.g. 005930.KS)."""
    from api.services import earnings_estimates
    rows = earnings_estimates.get_year_earnings(symbol, year, data_symbol=data_symbol)
    return {"symbol": symbol.upper(), "year": year, "rows": rows}


@router.get("/intraday-day")
def intraday_day(symbol: str = Query(...), date: str = Query(...),
                 stock_id: int = Query(None),
                 _user: dict = Depends(get_current_user)):
    """5-minute intraday bars for a single REGULAR-HOURS session (09:30–16:00 ET)
    on `date` (YYYY-MM-DD). Powers the setup/catalyst-candle intraday popup.

    Admin-uploaded bars for (stock_id, date) WIN — that's how a foreign market or
    a >2yr-old session (no provider intraday) gets data. Otherwise fetched from
    the provider + cached (a closed session is static). Returns
    ``{symbol, date, bars:[{t,o,h,l,c,v}], source}`` — bars are unix-second
    timestamps to match the chart's intraday format. `bars` is EMPTY when nothing
    is available, which the frontend renders as 'intraday data unavailable'."""
    import re, json
    from datetime import datetime, timedelta, timezone
    from api.services.cache import cache

    sym = (symbol or "").upper().strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date or ""):
        raise HTTPException(400, "date must be YYYY-MM-DD")

    # 1. Admin-uploaded intraday bars for this (stock, date) win — provider can't
    #    cover foreign markets / sessions older than the ~2yr intraday window.
    if stock_id is not None:
        try:
            raw_up = svc.get_intraday_bars(stock_id, date)
            if raw_up:
                ub = json.loads(raw_up)
                if ub:
                    return {"symbol": sym, "date": date, "bars": ub, "source": "uploaded"}
        except Exception:
            pass

    ckey = f"modelbook_intraday_{sym}_{date}"
    cached = cache.get(ckey)
    if cached is not None:
        return cached

    bars: list[dict] = []
    try:
        from api.services.massive import get_agg_bars_minute
        # Fetch [date, date+1] then filter to the ET regular session — a UTC-day
        # window would clip the after-midnight-UTC tail of a US session.
        nxt = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        raw = get_agg_bars_minute(sym, 5, date, nxt)
        try:
            from zoneinfo import ZoneInfo
            et = ZoneInfo("America/New_York")
        except Exception:
            et = None
        for b in raw:
            try:
                ts = int(b["t"]) / 1000.0  # ms → s (UTC)
            except (KeyError, TypeError, ValueError):
                continue
            if et is not None:
                d_et = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(et)
                if d_et.strftime("%Y-%m-%d") != date:
                    continue
                mins = d_et.hour * 60 + d_et.minute
                if mins < 9 * 60 + 30 or mins >= 16 * 60:  # RTH 09:30–16:00 ET
                    continue
            bars.append({
                "t": int(ts),
                "o": round(b["o"], 2), "h": round(b["h"], 2),
                "l": round(b["l"], 2), "c": round(b["c"], 2),
                "v": int(b.get("v", 0)),
            })
        bars.sort(key=lambda x: x["t"])
    except Exception:
        bars = []

    out = {"symbol": sym, "date": date, "bars": bars}
    # Closed sessions never change → cache 30d; an empty/failed pull retries in 30m.
    cache.set(ckey, out, ttl=86400 * 30 if bars else 1800)
    return out


@router.get("/index-drawings")
def get_index_drawings(symbol: str = Query("^IXIC"), _user: dict = Depends(get_current_user)):
    """GLOBAL annotations for the index reference pane (^IXIC) — one shared set
    shown read-only on every stock's chart. Any logged-in user can read."""
    return {"symbol": symbol.upper(), "drawings_json": svc.get_index_drawings(symbol)}


@router.get("/stock/{stock_id}/bars")
def get_stock_bars(stock_id: int, _user: dict = Depends(get_current_user)):
    """Uploaded historical OHLCV for a delisted stock (served to the chart in
    place of the missing provider data). Any logged-in user can read."""
    import json
    raw = svc.get_stock_bars(stock_id)
    bars = []
    if raw:
        try:
            bars = json.loads(raw)
        except (ValueError, TypeError):
            bars = []
    return {"stock_id": stock_id, "bars": bars}


# ── AI-generated descriptions (company one-liner + "why it ran that year") ────

import os as _os
import time as _time_mod
_DESC_ENABLED = _os.environ.get("MODELBOOK_DESC_ENABLED", "1") == "1"
_DESC_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_DESC_RETRY_AFTER = 3 * 3600  # re-attempt a failed/empty generation after ~3h (self-heals on re-view)
_gen_lock = _threading.Lock()
_generating = set()  # stock ids with a description generation in flight


def _needs_desc(s) -> bool:
    """True if a stock still needs an LLM pass: it's missing its description OR its
    watermark sector/industry (the same call produces all of them). Either-never-
    attempted-or-attempt-is-stale gates it so we don't tight-loop / re-spend on
    tickers the model can't fully summarize."""
    if not _DESC_ENABLED:
        return False
    has_desc = bool(s.get("company_desc"))
    has_meta = bool(s.get("sector") or s.get("industry"))
    if has_desc and has_meta:
        return False
    da = s.get("desc_at")
    return (not da) or (int(_time_mod.time()) - da > _DESC_RETRY_AFTER)


def _desc_messages(symbol, company, year, gain_pct):
    """Build (system, prompt) for the description LLM call. Extracted so the debug
    endpoint can exercise the EXACT same prompt."""
    gain_txt = f"about {round(gain_pct)}%" if gain_pct is not None else "a large amount"
    system = ("You write concise, factual stock study notes for a trader's model book. "
              "Output JSON only — no preamble, no markdown fences.")
    prompt = (
        f"Stock: {symbol} ({company or symbol}). Calendar year: {year}. "
        f"The stock rose {gain_txt} that year.\n\n"
        'Return JSON exactly: {"company_desc": "...", "run_story": "...", '
        '"sector": "...", "industry": "..."}\n'
        "- company_desc: ONE plain sentence on what the company does.\n"
        "- sector: the company's GICS sector AS OF that year (e.g. \"Technology\", "
        "\"Communication Services\", \"Consumer Cyclical\", \"Healthcare\", "
        "\"Financial Services\", \"Industrials\", \"Energy\"). Use the name the "
        "company traded under that year, even if it was later renamed or acquired.\n"
        "- industry: the company's specific GICS industry that year (e.g. "
        "\"Software - Infrastructure\", \"Entertainment\", \"Personal Services\", "
        "\"Semiconductors\"). Keep it short — 1-4 words.\n"
        "- run_story: 2-3 sentences on WHY the stock made its big move that year — "
        "the specific catalysts/drivers, or the broader market theme it rode. "
        "Be factual and specific to that year; if unsure of specifics, describe the "
        "dominant theme/driver. No price targets, no buy/sell advice.\n\n"
        "STYLE — IMPORTANT (these notes sit next to each other, so they must read "
        "differently):\n"
        "- The ticker and the % gain are ALREADY shown above the note. Do NOT restate "
        "them. Do NOT begin with the ticker symbol or company name.\n"
        "- Do NOT open with 'surged', 'soared', 'rallied', 'rose', 'skyrocketed', "
        "'jumped' or any generic move-verb. Lead straight with the actual driver, "
        "catalyst, product, or theme.\n"
        "- Vary the sentence structure from a typical writeup — open with the catalyst, "
        "the demand story, the macro theme, an event, or a fundamental shift, not a "
        "price statement. Get straight to substance.\n"
        "- AVOID cliche/hype words: do NOT use 'explosive', 'explosive demand', "
        "'massive', 'skyrocketing', 'red-hot', 'insatiable', 'meteoric', 'parabolic', "
        "'breakneck', 'frenzy', or 'on fire'. Use precise, varied, plain language and a "
        "different opening word than other notes would naturally use."
    )
    return system, prompt


def _generate_descriptions(symbol, company, year, gain_pct):
    """Claude → {company_desc, run_story, sector, industry}. One sentence on what
    the company does, a brief factual reason it ran that year, plus its GICS
    sector/industry for the chart watermark (the live ticker-meta lookup fails for
    renamed/delisted symbols like SQ→Block, WTW, WWE — this is the historical
    fallback). Returns None on failure."""
    if not _DESC_ENABLED:
        return None
    import json as _json
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        # The curated company column is often empty (the watermark reads the name
        # from live ticker-meta, not this column). Without a name the model burns
        # its token budget GUESSING what the ticker is (e.g. "NB") and truncates the
        # JSON → no summary. Fall back to the same live name source the watermark uses.
        if not company:
            try:
                from api.services.ticker_meta import get_ticker_meta as _get_ticker_meta
                company = (_get_ticker_meta(symbol) or {}).get("name") or None
            except Exception:
                company = None
        system, prompt = _desc_messages(symbol, company, year, gain_pct)
        # Retry transient failures: when stocks are added, catalysts + recap +
        # description generation can fire together and transiently overload the
        # API. A single failure would otherwise stamp desc_at and blank the note.
        text = None
        for attempt in range(3):
            try:
                msg = client.messages.create(
                    model=_DESC_MODEL, max_tokens=700, temperature=0.7,
                    system=system, messages=[{"role": "user", "content": prompt}],
                )
                text = "".join(getattr(b, "text", "") for b in msg.content).strip()
                if text:
                    break
            except Exception:
                text = None
            _time_mod.sleep(1.5 * (attempt + 1))
        if not text:
            return None
        obj = _parse_desc_json(text)
        if obj is None:
            return None
        cd = (obj.get("company_desc") or "").strip()
        rs = (obj.get("run_story") or "").strip()
        sec = (obj.get("sector") or "").strip() or None
        ind = (obj.get("industry") or "").strip() or None
        if cd or rs:
            return {"company_desc": cd, "run_story": rs, "sector": sec, "industry": ind}
        # Got the GICS meta but no usable description — surface the meta so the
        # watermark fills, flagged so the caller re-attempts the description later.
        if sec or ind:
            return {"company_desc": "", "run_story": "", "sector": sec, "industry": ind, "_meta_only": True}
        return None
    except Exception:
        return None


def _parse_desc_json(text):
    """Tolerant JSON extraction from an LLM reply: strip ```json fences, then take
    the outermost {...}. Returns the dict, or None if it can't parse."""
    import json as _json
    if not text:
        return None
    t = text.strip()
    # Strip markdown code fences if present.
    if t.startswith("```"):
        t = t.split("```", 2)[1] if t.count("```") >= 2 else t.strip("`")
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    s, e = t.find("{"), t.rfind("}")
    if s == -1 or e == -1 or e <= s:
        return None
    try:
        return _json.loads(t[s:e + 1])
    except Exception:
        return None


@router.get("/debug-index-drawings")
def debug_index_drawings(symbol: str = Query("^IXIC")):
    """Diagnostic (no auth): dump the raw global index-pane annotations so we can
    see the stored point-time format (string / number / business-day object)."""
    import json as _json
    raw = svc.get_index_drawings(symbol)
    out = {"symbol": symbol.upper(), "raw_len": len(raw or "")}
    try:
        arr = _json.loads(raw) if raw else []
        out["count"] = len(arr)
        out["sample_point_times"] = [
            {"type": d.get("type"), "times": [p.get("time") for p in (d.get("points") or [])],
             "time_pytypes": [type(p.get("time")).__name__ for p in (d.get("points") or [])],
             "advPct": d.get("advPct")}
            for d in arr[:12]
        ]
    except Exception as ex:
        out["error"] = f"{type(ex).__name__}: {ex}"
    return out


@router.get("/debug-desc/{sym}")
def debug_desc(sym: str, year: int = Query(default=0)):
    """Diagnostic (no auth): show exactly what the description LLM returns for a
    ticker, so we can see why a summary won't generate. Reports the raw text,
    stop_reason, parse result, and the final _generate_descriptions output."""
    import os as _osd
    from datetime import datetime, timezone
    y = year or (datetime.now(timezone.utc).year - 1)
    out = {
        "sym": sym.upper(), "year": y, "desc_enabled": _DESC_ENABLED, "model": _DESC_MODEL,
        "anthropic_key": "set" if _osd.environ.get("ANTHROPIC_API_KEY") else "MISSING",
    }
    # Use the curated company name (as the real call does) so the model isn't left
    # guessing the ticker.
    company = None
    try:
        for s in svc.get_stocks_for_year(y):
            if (s.get("symbol") or "").upper() == sym.upper():
                company = s.get("company")
                break
    except Exception:
        pass
    if not company:
        try:
            from api.services.ticker_meta import get_ticker_meta as _gtm
            company = (_gtm(sym.upper()) or {}).get("name") or None
        except Exception:
            company = None
    out["company"] = company
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        out["client"] = "ok" if client else "None"
        if client:
            system, prompt = _desc_messages(sym.upper(), company, y, None)
            try:
                msg = client.messages.create(
                    model=_DESC_MODEL, max_tokens=700, temperature=0.7,
                    system=system, messages=[{"role": "user", "content": prompt}],
                )
                text = "".join(getattr(b, "text", "") for b in msg.content)
                out["stop_reason"] = getattr(msg, "stop_reason", None)
                out["raw_text"] = text[:2500]
                out["parsed"] = _parse_desc_json(text)
            except Exception as ex:
                out["llm_error"] = f"{type(ex).__name__}: {ex}"
    except Exception as ex:
        out["error"] = f"{type(ex).__name__}: {ex}"
    out["generate_result"] = _generate_descriptions(sym.upper(), company, y, None)
    return out


def _persist_desc_result(stock_id, d) -> None:
    """Persist a _generate_descriptions result: a real description is saved as
    done; a meta-only result fills the watermark but leaves the description to
    re-attempt later; a None failure just stamps the attempt (avoids tight loop)."""
    try:
        if d and not d.get("_meta_only"):
            svc.save_descriptions(stock_id, d["company_desc"], d["run_story"],
                                  d.get("sector"), d.get("industry"))
        else:
            if d and (d.get("sector") or d.get("industry")):
                svc.save_watermark_meta(stock_id, d.get("sector"), d.get("industry"))
            svc.mark_desc_attempt(stock_id)  # stamp attempt so we don't loop
    except Exception:
        pass


def _generate_descriptions_for(stocks, max_workers=3):
    pending = [s for s in stocks if _needs_desc(s)]
    if not pending:
        return
    import concurrent.futures

    def _work(s):
        d = _generate_descriptions(s["symbol"], s.get("company"), s["year"], s.get("oc_pct"))
        _persist_desc_result(s["id"], d)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, pending))


def _gen_desc_async(stock):
    """Deduped background generation of one stock's descriptions."""
    sid = stock.get("id")
    if not sid or not _DESC_ENABLED:
        return
    with _gen_lock:
        if sid in _generating:
            return
        _generating.add(sid)

    def _run():
        try:
            d = _generate_descriptions(stock["symbol"], stock.get("company"),
                                       stock["year"], stock.get("oc_pct"))
            _persist_desc_result(sid, d)
        finally:
            with _gen_lock:
                _generating.discard(sid)
    _threading.Thread(target=_run, daemon=True, name=f"mb-desc-{sid}").start()


def warm_all_stats() -> None:
    """Background pre-warm at startup: compute + persist price stats, AI
    descriptions, AND bullish catalysts for every curated closed-year stock that
    lacks them (each generated once, then kept forever). Low concurrency + a delay
    past the startup bars-resync window. Re-checks once more to catch transients."""
    import time as _time
    for delay in (35, 120):
        _time.sleep(delay)
        try:
            stocks = [s for s in svc.get_all_stocks() if _is_final_year(s["year"])]
        except Exception:
            continue
        stats_done = all(s.get("oc_pct") is not None and s.get("avg_vol") is not None for s in stocks)
        desc_done = not any(_needs_desc(s) for s in stocks)
        try:
            cat_pending = [s for s in svc.get_stocks_needing_catalysts() if _is_final_year(s["year"])]
        except Exception:
            cat_pending = []
        # Pre-warm recaps for EVERY closed year in the tab range (not just curated
        # years) so hovering ANY year is instant — no on-demand "generating…" wait.
        # _needs_recap skips years already done, so this only spends tokens on the
        # first deploy. The in-progress year is excluded (it would go stale) and
        # regenerates on demand.
        try:
            from datetime import datetime as _dt, timezone as _tz
            _cy = _dt.now(_tz.utc).year
            recap_pending = [y for y in range(_MIN_RECAP_YEAR, _cy) if _needs_recap(y)]
        except Exception:
            recap_pending = []
        if stats_done and desc_done and not cat_pending and not recap_pending:
            return  # fully warmed
        if not stats_done:
            _persist_stats_for(stocks, max_workers=2)
            try:
                stocks = [s for s in svc.get_all_stocks() if _is_final_year(s["year"])]
            except Exception:
                pass
        _generate_descriptions_for(stocks)
        _generate_catalysts_for(cat_pending)
        _generate_recaps_for(recap_pending, max_workers=3)


# ── AI-generated catalysts (the year's most impactful, move-driving events) ───

_CATALYST_ENABLED = _os.environ.get("MODELBOOK_CATALYSTS_ENABLED", "1") == "1"
_CATALYST_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")


def _fetch_year_bars(symbol: str, year: int, stock_id=None) -> list:
    """Sorted daily bars for the (symbol, year), preferring uploaded custom bars
    (so catalysts generate for delisted/renamed tickers whose provider data
    doesn't cover the book year — e.g. YELL=YRCW in 2013)."""
    return _load_year_bars(symbol, year, stock_id)


def _big_up_days(bars: list, top_n: int = 12) -> list:
    """The largest single-day UP moves of the year (% GAIN vs prior close), so the
    LLM attributes BULLISH catalysts to days the stock actually jumped. Down days
    are excluded — catalysts are positive, stock-specific events only."""
    out = []
    prev_c = None
    for b in bars:
        c, o, t = b.get("c"), b.get("o"), b.get("t")
        if c is None or not t:
            if c is not None:
                prev_c = c
            continue
        if prev_c:
            pct = (c - prev_c) / prev_c * 100
        elif o:
            pct = (c - o) / o * 100
        else:
            pct = 0.0
        if pct > 0:
            out.append({"date": str(t)[:10], "pct": round(pct, 1)})
        prev_c = c
    out.sort(key=lambda d: d["pct"], reverse=True)
    return out[:top_n]


def _snap_trading_day(d: str, trading_days: list, day_set: set, year: int):
    """Snap an LLM-returned date to the nearest real trading day (≤5 days away),
    so the chart marker + gold candle always land on an actual bar. Drops dates
    outside the year or too far from any session."""
    from datetime import date
    if not _ISO_DATE.match(d or "") or not d.startswith(str(year)):
        return None
    if d in day_set:
        return d
    try:
        td = date.fromisoformat(d)
    except ValueError:
        return None
    best, best_diff = None, None
    for cand in trading_days:
        try:
            diff = abs((date.fromisoformat(cand) - td).days)
        except ValueError:
            continue
        if best_diff is None or diff < best_diff:
            best, best_diff = cand, diff
    return best if (best is not None and best_diff is not None and best_diff <= 5) else None


def _generate_catalysts(symbol, company, year, gain_pct, stock_id=None):
    """Claude → list of the year's top 3-5 catalysts, each anchored to a real
    big-move trading day. Returns None on failure (no rows written)."""
    if not _CATALYST_ENABLED:
        return None
    import json as _json
    try:
        bars = _fetch_year_bars(symbol, year, stock_id)
        if not bars:
            return None
        trading_days = sorted({str(b["t"])[:10] for b in bars if b.get("t")})
        day_set = set(trading_days)
        movers = _big_up_days(bars, top_n=12)
        if not movers:
            return None
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        gain_txt = f"about {round(gain_pct)}%" if gain_pct is not None else "a large amount"
        movers_txt = "\n".join(
            f"- {m['date']} -> +{m['pct']}%" for m in movers
        )
        system = ("You identify the real, STOCK-SPECIFIC bullish catalysts that ignited a "
                  "stock's biggest up-moves, for a trader's model book. Be factual and "
                  "specific to the given year. Output JSON only — no preamble, no fences.")
        prompt = (
            f"Stock: {symbol} ({company or symbol}). Calendar year: {year}. "
            f"Full-year move: {gain_txt}.\n\n"
            f"The stock's largest single-day GAINS that year (date -> that day's % up move):\n"
            f"{movers_txt}\n\n"
            f"Identify the 3-5 most impactful BULLISH, COMPANY-SPECIFIC catalysts that "
            f"ignited a sharp UP move in {symbol} during {year}.\n"
            'Return JSON exactly: {"catalysts": [{"date": "YYYY-MM-DD", "title": "...", '
            '"description": "...", "move_pct": 0.0}, ...]}, ordered most impactful first.\n'
            "- date: the trading day the catalyst hit. STRONGLY PREFER a date from the "
            "list above (those are the real up-move days).\n"
            "- title: a 2-5 word headline of the company-specific event (e.g. \"Q3 earnings "
            "beat\", \"AI supply deal\", \"Major customer win\", \"Product launch\", "
            "\"FDA approval\", \"Analyst upgrade\", \"Guidance raise\", \"Index inclusion\").\n"
            "- description: ONE factual sentence on the catalyst and why it drove the stock up.\n"
            "- move_pct: the approximate single-day % GAIN that day (positive number).\n\n"
            "STRICT RULES:\n"
            "- ONLY positive, bullish catalysts that pushed the stock UP. NEVER include "
            "negative, bearish, disappointing, or sell-off events.\n"
            "- ONLY stock-specific company events (earnings, products, partnerships, "
            "contracts/customer wins, approvals, analyst upgrades, M&A, guidance raises, "
            "index inclusion). Do NOT include market-wide or macro catalysts (Fed/interest "
            "rates, broad market or sector rallies, index-wide themes, 'risk-on' sentiment).\n"
            "- Factual and specific to that year. If unsure of the exact news for "
            "a given day, attribute it to the most likely company-specific driver given the "
            "year's dominant theme. No price targets, no buy/sell advice."
        )
        msg = client.messages.create(
            model=_CATALYST_MODEL, max_tokens=900, temperature=0.5,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        s, e = text.find("{"), text.rfind("}")
        if s == -1 or e == -1:
            return None
        raw = (_json.loads(text[s:e + 1]).get("catalysts")) or []
        out = []
        for i, it in enumerate(raw[:5]):
            title = (it.get("title") or "").strip()
            if not title:
                continue
            d = _snap_trading_day((it.get("date") or "").strip(), trading_days, day_set, year)
            if not d:
                continue
            try:
                mp = round(float(it.get("move_pct")), 1) if it.get("move_pct") is not None else None
            except (TypeError, ValueError):
                mp = None
            out.append({
                "catalyst_date": d,
                "title": title[:80],
                "description": ((it.get("description") or "").strip()[:400]) or None,
                "move_pct": mp,
                "sort_order": i,
                "source": "ai",
            })
        return out or None
    except Exception:
        return None


# ── Auto-generated catalysts (no manual click; generated once, kept forever) ──

_CATALYST_RETRY_AFTER = 86400  # don't re-attempt a failed generation for ~1 day
_gen_cat_lock = _threading.Lock()
_generating_catalysts = set()  # stock ids with a catalyst generation in flight


def _needs_catalysts(stock_detail) -> bool:
    """True if a stock still needs auto-generated catalysts: none yet AND either
    never attempted or the last attempt is stale (so failures retry, successes
    don't — once generated they're kept permanently in the DB)."""
    if not _CATALYST_ENABLED or stock_detail.get("catalysts"):
        return False
    ca = stock_detail.get("catalysts_at")
    return (not ca) or (int(_time_mod.time()) - ca > _CATALYST_RETRY_AFTER)


def _gen_one_stock_catalysts(stock) -> None:
    items = _generate_catalysts(
        stock["symbol"], stock.get("company"), stock["year"],
        stock.get("oc_pct") if stock.get("oc_pct") is not None else stock.get("gain_pct"),
        stock.get("id"),
    )
    if items:
        svc.replace_catalysts(stock["id"], items)
    else:
        svc.mark_catalysts_attempt(stock["id"])  # stamp so we don't loop on empties


def _gen_catalysts_async(stock):
    """Deduped background catalyst generation for one stock (first-view trigger)."""
    sid = stock.get("id")
    if not sid or not _CATALYST_ENABLED:
        return
    with _gen_cat_lock:
        if sid in _generating_catalysts:
            return
        _generating_catalysts.add(sid)

    def _run():
        try:
            _gen_one_stock_catalysts(stock)
        except Exception:
            try:
                svc.mark_catalysts_attempt(sid)
            except Exception:
                pass
        finally:
            with _gen_cat_lock:
                _generating_catalysts.discard(sid)
    _threading.Thread(target=_run, daemon=True, name=f"mb-catalysts-{sid}").start()


def _generate_catalysts_for(stocks, max_workers=2):
    """Batch background catalyst generation (the startup warm). Low concurrency to
    be gentle on the Anthropic API + SQLite. Caller pre-filters to those needing it."""
    if not stocks:
        return
    import concurrent.futures

    def _work(s):
        try:
            _gen_one_stock_catalysts(s)
        except Exception:
            try:
                svc.mark_catalysts_attempt(s["id"])
            except Exception:
                pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, stocks))


# ── AI year recaps (hover a year tab → a recap of that market year) ───────────

_RECAP_ENABLED = _os.environ.get("MODELBOOK_RECAP_ENABLED", "1") == "1"
_RECAP_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_RECAP_RETRY_AFTER = 86400  # don't re-attempt a failed generation for ~1 day
_MIN_RECAP_YEAR = 1990
_gen_recap_lock = _threading.Lock()
_generating_recaps = set()  # years with a recap generation in flight


def _recap_out(r: dict) -> dict:
    """Shape a stored recap row for the API (parse themes_json → list)."""
    import json
    themes = []
    try:
        t = json.loads(r.get("themes_json") or "[]")
        themes = t if isinstance(t, list) else []
    except (ValueError, TypeError):
        themes = []
    return {
        "year": r["year"],
        "status": "ready",
        "headline": r.get("headline"),
        "recap": r.get("recap"),
        "market_tone": r.get("market_tone"),
        "trader_score": r.get("trader_score"),
        "themes": themes,
    }


def _needs_recap(year: int) -> bool:
    """True if a year still needs a recap: none yet AND either never attempted or
    the last attempt is stale (failures retry, successes are kept permanently)."""
    if not _RECAP_ENABLED:
        return False
    r = svc.get_year_recap(year)
    if r and r.get("recap"):
        return False
    ra = (r or {}).get("recap_at")
    return (not ra) or (int(_time_mod.time()) - ra > _RECAP_RETRY_AFTER)


def _nasdaq_year_stats(year: int):
    """Best-effort Nasdaq Composite (^IXIC) year stats to GROUND the recap:
    open→close % and worst peak-to-trough drawdown. Provider history only reaches
    ~2006, so this is None for older years — the model then leans on its own
    market-history knowledge (which is strong for these well-known years)."""
    try:
        yb = _load_year_bars("^IXIC", year)
        if not yb or len(yb) < 20:
            return None
        o, c = yb[0].get("o"), yb[-1].get("c")
        closes = [b["c"] for b in yb if b.get("c") is not None]
        peak, mdd = None, 0.0
        for px in closes:
            if peak is None or px > peak:
                peak = px
            if peak:
                mdd = min(mdd, (px - peak) / peak)
        return {
            "return_pct": round((c - o) / o * 100, 1) if o else None,
            "max_drawdown_pct": round(mdd * 100, 1),
        }
    except Exception:
        return None


def _clip_sentence(text: str, cap: int) -> str:
    """Trim overly-long prose at a SENTENCE boundary (never mid-word) so a recap
    can't be left dangling like '…and the r'. Returns text unchanged when short."""
    text = (text or "").strip()
    if len(text) <= cap:
        return text
    cut = text[:cap]
    p = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[:p + 1] if p > cap * 0.6 else cut.rstrip(" ,;:-")).strip()


def _generate_year_recap(year: int):
    """Claude → a varied, factual recap of `year` as a US-equity market year for a
    momentum/breakout swing trader's model book. Grounded with the year's curated
    leaders (real data) + Nasdaq stats when available. Returns a dict or None."""
    if not _RECAP_ENABLED:
        return None
    import json as _json
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        leaders = []
        for s in svc.get_stocks_for_year(year)[:12]:
            g = s.get("oc_pct") if s.get("oc_pct") is not None else s.get("gain_pct")
            gtxt = f"+{round(g)}%" if g is not None else "?"
            sec = f", {s['sector']}" if s.get("sector") else ""
            leaders.append(f"{s['symbol']} ({s.get('company') or s['symbol']}, {gtxt}{sec})")
        nas = _nasdaq_year_stats(year)
        ctx = []
        if nas and nas.get("return_pct") is not None:
            ctx.append(f"Nasdaq Composite {year}: {nas['return_pct']:+}% (year open→close), "
                       f"worst drawdown {nas['max_drawdown_pct']}%.")
        if leaders:
            ctx.append("Big model-book winners that year: " + "; ".join(leaders) + ".")
        ctx_txt = "\n".join(ctx) if ctx else "(No extra data — rely on your own market-history knowledge.)"

        system = ("You are a market historian writing recap notes for a swing trader's "
                  "model book — one per calendar year. Be factual and specific to the year. "
                  "Output JSON only, no preamble, no markdown fences.")
        prompt = (
            f"Write a recap of the U.S. stock market in {year}.\n\n"
            f"Grounding data:\n{ctx_txt}\n\n"
            'Return JSON exactly: {"headline": "...", "market_tone": "...", '
            '"trader_score": 0, "themes": ["..."], "recap": "..."}\n'
            "- headline: 3-7 words capturing the year's character (NOT starting with the year).\n"
            "- market_tone: a 2-4 word label (e.g. \"Roaring bull\", \"Brutal bear\", "
            "\"Choppy and range-bound\", \"V-shaped recovery\").\n"
            "- trader_score: an integer 1-10 for how HOSPITABLE the year was to a momentum / "
            "breakout swing trader who buys strength and leadership. 1-3 = hostile (downtrend, "
            "whipsaws, breakouts fail); 4-6 = mixed/selective; 7-8 = favorable (clean trends, "
            "follow-through, leadership works); 9-10 = exceptional, target-rich.\n"
            "- themes: 2-5 SHORT leadership theme/group labels that led that year (e.g. "
            "\"Dot-com & networking\", \"Homebuilders\", \"Solar\", \"AI infrastructure\", "
            "\"Chinese internet\", \"Mega-cap tech\"). Tie to the grounding winners when given.\n"
            "- recap: 4-6 sentences (roughly 110-160 words — a tight, complete paragraph, never "
            "left mid-thought) covering (a) how the broad market traded (indices, trend, "
            "volatility, the key macro driver), (b) what kind of stocks/groups led, and (c) how "
            "friendly the tape was to buying breakouts and holding winners. Plain, concrete prose.\n\n"
            "STYLE — IMPORTANT (these recaps sit next to each other across many years, so each "
            "MUST read differently):\n"
            "- Do NOT begin with the year or 'In YYYY' or 'YYYY was'. Vary the opening across "
            "years — lead with the macro driver, the mood, a pivotal event, the leadership, or "
            "the character of the tape.\n"
            "- Do NOT use a fixed template or the same sentence skeleton every year. Vary "
            "structure and rhythm.\n"
            "- Avoid hype clichés ('explosive', 'massive', 'skyrocketing', 'roller-coaster', "
            "'rollercoaster', 'perfect storm'). Be precise.\n"
            "- Describe the trading climate in plain market terms (trend persistence, "
            "follow-through, breadth, failed breakouts, leadership) — do NOT name any specific "
            "trading methodology or system."
        )
        msg = client.messages.create(
            model=_RECAP_MODEL, max_tokens=700, temperature=0.85,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        s, e = text.find("{"), text.rfind("}")
        if s == -1 or e == -1:
            return None
        obj = _json.loads(text[s:e + 1])
        headline = (obj.get("headline") or "").strip() or None
        recap = (obj.get("recap") or "").strip() or None
        if not recap:
            return None
        tone = (obj.get("market_tone") or "").strip() or None
        try:
            score = int(round(float(obj.get("trader_score")))) if obj.get("trader_score") is not None else None
            if score is not None:
                score = max(1, min(10, score))
        except (TypeError, ValueError):
            score = None
        themes = obj.get("themes") or []
        themes = [str(t).strip()[:40] for t in themes if str(t).strip()][:6] if isinstance(themes, list) else []
        return {
            "headline": headline[:80] if headline else None,
            "recap": _clip_sentence(recap, 1500),  # generous cap, never mid-word
            "market_tone": tone[:40] if tone else None,
            "trader_score": score,
            "themes_json": _json.dumps(themes),
            "model": _RECAP_MODEL,
        }
    except Exception:
        return None


def _gen_one_year_recap(year: int) -> None:
    data = _generate_year_recap(year)
    if data:
        svc.save_year_recap(year, data)
    else:
        svc.mark_recap_attempt(year)  # stamp so we don't loop on empties


def _gen_recap_async(year: int):
    """Deduped background recap generation for one year (first-hover trigger)."""
    if not _RECAP_ENABLED:
        return
    with _gen_recap_lock:
        if year in _generating_recaps:
            return
        _generating_recaps.add(year)

    def _run():
        try:
            _gen_one_year_recap(year)
        except Exception:
            try:
                svc.mark_recap_attempt(year)
            except Exception:
                pass
        finally:
            with _gen_recap_lock:
                _generating_recaps.discard(year)
    _threading.Thread(target=_run, daemon=True, name=f"mb-recap-{year}").start()


def _generate_recaps_for(years, max_workers=2):
    """Batch background recap generation (startup warm). Caller pre-filters."""
    if not years:
        return
    import concurrent.futures

    def _work(y):
        try:
            _gen_one_year_recap(y)
        except Exception:
            try:
                svc.mark_recap_attempt(y)
            except Exception:
                pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, years))


@router.get("/year-recap")
def year_recap(year: int = Query(...), _user: dict = Depends(get_current_user)):
    """An AI recap of `year` as a market year (broad market, leadership themes,
    momentum-trader climate), shown on year-tab hover. Generated once on first
    request, then kept permanently. Returns {status:'generating'} while the
    background job runs; the frontend polls until it's ready."""
    from datetime import datetime, timezone
    cy = datetime.now(timezone.utc).year
    if year < _MIN_RECAP_YEAR or year > cy + 1:
        raise HTTPException(400, f"year must be {_MIN_RECAP_YEAR}..{cy + 1}")
    r = svc.get_year_recap(year)
    if r and r.get("recap"):
        return _recap_out(r)
    if _needs_recap(year):
        _gen_recap_async(year)
        return {"year": year, "status": "generating"}
    # Attempted recently but came back empty/failed — tell the client to stop
    # polling (it retries server-side after _RECAP_RETRY_AFTER on a later hover).
    return {"year": year, "status": "unavailable"}


# ── Writes (admin only) ───────────────────────────────────────────────────────

@router.post("/stocks")
def add_stock(payload: StockIn, _admin: dict = Depends(require_admin)):
    if not payload.symbol.strip():
        raise HTTPException(400, "symbol is required")
    return svc.create_stock(payload.model_dump())


@router.put("/stock/{stock_id}")
def edit_stock(stock_id: int, payload: StockPatch, _admin: dict = Depends(require_admin)):
    stock = svc.update_stock(stock_id, payload.model_dump(exclude_unset=True))
    if not stock:
        raise HTTPException(404, "Stock not found")
    return stock


@router.put("/index-drawings")
def edit_index_drawings(payload: IndexDrawingsPatch, symbol: str = Query("^IXIC"),
                        _admin: dict = Depends(require_admin)):
    """Admin: replace the GLOBAL index-pane annotations for a symbol. Validates
    that the body parses as a JSON array before storing."""
    import json
    try:
        parsed = json.loads(payload.drawings_json)
    except (ValueError, TypeError):
        raise HTTPException(400, "drawings_json must be valid JSON")
    if not isinstance(parsed, list):
        raise HTTPException(400, "drawings_json must be a JSON array")
    stored = svc.set_index_drawings(symbol, payload.drawings_json)
    return {"symbol": symbol.upper(), "drawings_json": stored}


# ── Setup Library examples ────────────────────────────────────────────────────

@router.get("/setup-examples")
def get_setup_examples(setup: str = Query(...), _user: dict = Depends(get_current_user)):
    return {"setup": setup, "examples": svc.list_setup_examples(setup)}


@router.post("/setup-examples")
def add_setup_example(payload: ExampleIn, _admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    _validate_example(data)
    return svc.create_setup_example(data)


@router.put("/setup-example/{example_id}")
def edit_setup_example(example_id: int, payload: ExamplePatch,
                       _admin: dict = Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    _validate_example(data)
    example = svc.update_setup_example(example_id, data)
    if not example:
        raise HTTPException(404, "Example not found")
    return example


@router.delete("/setup-example/{example_id}")
def remove_setup_example(example_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_setup_example(example_id):
        raise HTTPException(404, "Example not found")
    return {"deleted": example_id}


def _invalidate_year_derived(stock_id: int) -> None:
    """After bars change: reset stored stats + AI catalysts (svc) AND drop the
    in-memory year-stats cache entry so the next /year-stats recomputes from the
    new bars instead of returning the stale (often empty) cached value."""
    stock = svc.get_stock_detail(stock_id)
    svc.reset_year_derived(stock_id)
    if stock:
        from api.services.cache import cache
        cache.invalidate(f"modelbook_yearstats_{str(stock['symbol']).upper()}_{stock['year']}")


@router.put("/stock/{stock_id}/bars")
def edit_stock_bars(stock_id: int, payload: BarsIn, _admin: dict = Depends(require_admin)):
    """Admin: upload historical OHLCV for a delisted stock (parsed from a
    TradingView CSV client-side). Validated, deduped, sorted, then stored."""
    import json
    clean = _clean_bars(payload.bars)
    if not svc.set_stock_bars(stock_id, json.dumps(clean)):
        raise HTTPException(404, "Stock not found")
    _invalidate_year_derived(stock_id)  # recompute stats + catalysts from the new bars
    return {"stock_id": stock_id, "count": len(clean),
            "first": clean[0]["t"], "last": clean[-1]["t"]}


@router.delete("/stock/{stock_id}/bars")
def remove_stock_bars(stock_id: int, _admin: dict = Depends(require_admin)):
    svc.delete_stock_bars(stock_id)
    _invalidate_year_derived(stock_id)  # fall back to provider data for stats/catalysts
    return {"stock_id": stock_id, "cleared": True}


class IntradayBarsIn(BaseModel):
    date: str            # session date 'YYYY-MM-DD' these 5-min bars belong to
    bars: list[dict]     # [{t: unix_seconds, o, h, l, c, v}, ...]


def _clean_intraday(raw: list[dict]) -> list[dict]:
    """Validate + normalize uploaded 5-min bars → sorted, deduped by unix-second
    timestamp. Raises HTTPException(400) on bad input."""
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "bars must be a non-empty array")
    if len(raw) > 5000:
        raise HTTPException(400, "too many bars (max 5000)")
    by_t: dict[int, dict] = {}
    for b in raw:
        try:
            t = int(float(b["t"]))
            o, h, l, cl = float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "each bar needs t (unix seconds) and numeric o/h/l/c")
        if t > 10_000_000_000:   # caller sent milliseconds → seconds
            t //= 1000
        if t <= 0 or not all(x > 0 for x in (o, h, l, cl)):
            continue
        try:
            v = int(float(b.get("v", 0) or 0))
        except (TypeError, ValueError):
            v = 0
        by_t[t] = {"t": t, "o": round(o, 4), "h": round(h, 4),
                   "l": round(l, 4), "c": round(cl, 4), "v": max(0, v)}
    out = [by_t[k] for k in sorted(by_t)]
    if not out:
        raise HTTPException(400, "no valid bars after cleaning")
    return out


@router.put("/stock/{stock_id}/intraday-day")
def upload_intraday_day(stock_id: int, payload: IntradayBarsIn,
                        _admin: dict = Depends(require_admin)):
    """Admin: upload 5-min OHLCV for one session (parsed from a TradingView CSV
    client-side) so the setup-candle intraday popup has data the providers can't
    supply (foreign markets / sessions older than the ~2yr intraday window)."""
    import json
    if not _ISO_DATE.match(payload.date or ""):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    clean = _clean_intraday(payload.bars)
    if not svc.set_intraday_bars(stock_id, payload.date, json.dumps(clean)):
        raise HTTPException(404, "Stock not found")
    return {"stock_id": stock_id, "date": payload.date, "count": len(clean)}


@router.delete("/stock/{stock_id}/intraday-day")
def remove_intraday_day(stock_id: int, date: str = Query(...),
                        _admin: dict = Depends(require_admin)):
    svc.delete_intraday_bars(stock_id, date)
    return {"stock_id": stock_id, "date": date, "cleared": True}


@router.delete("/stock/{stock_id}")
def remove_stock(stock_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_stock(stock_id):
        raise HTTPException(404, "Stock not found")
    return {"deleted": stock_id}


@router.post("/stock/{stock_id}/setups")
def add_setup(stock_id: int, payload: SetupIn, _admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    _validate_setup(data)
    setup = svc.create_setup(stock_id, data)
    if setup is None:
        raise HTTPException(404, "Stock not found")
    return setup


@router.put("/setup/{setup_id}")
def edit_setup(setup_id: int, payload: SetupPatch, _admin: dict = Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    _validate_setup(data)
    setup = svc.update_setup(setup_id, data)
    if not setup:
        raise HTTPException(404, "Setup not found")
    return setup


@router.delete("/setup/{setup_id}")
def remove_setup(setup_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_setup(setup_id):
        raise HTTPException(404, "Setup not found")
    return {"deleted": setup_id}


# ── AI-generated setup descriptions ("why this setup worked") ─────────────────
# Manual, admin-only, on-demand. The result is stored PERMANENTLY in the setup's
# `notes` (generate once → kept forever → zero Anthropic spend on later views).
# Opus 4.8 distills WHY the setup worked into a few short bullets (fundamental /
# technical / thematic), grounded on the real daily price action around the setup
# day, without naming any trader or methodology. Web search is opt-in (off by
# default — it was the source of multi-minute "stuck" runs). Wired to a button,
# never auto-run.

_SETUP_DESC_ENABLED = _os.environ.get("MODELBOOK_SETUP_DESC_ENABLED", "1") == "1"
# The smartest model on purpose — this is the "test how well it does" feature, and
# it's a manual admin click whose output is cached forever, so cost is bounded.
_SETUP_DESC_MODEL = _os.environ.get("MODELBOOK_SETUP_DESC_MODEL", "claude-opus-4-8")
# Web search is OFF by default. The server-tool loop (multiple searches + retries)
# is what made generation slow and prone to getting "stuck" for minutes — and the
# model already knows these iconic historical setups. We ground it on the real
# price action instead. Flip MODELBOOK_SETUP_DESC_WEB=1 to add live web grounding
# back (catalysts/chatter) once we want to invest in making that path reliable.
_SETUP_DESC_WEB = _os.environ.get("MODELBOOK_SETUP_DESC_WEB", "0") == "1"
_SETUP_DESC_WEB_TOOL = {"type": "web_search_20260209", "name": "web_search"}


def _format_bar_window(bars: list, center_date: str, before: int = 12, after: int = 15) -> str:
    """A compact O/H/L/C + volume slice of the daily bars around the setup day, so
    the model can SEE the price action (base, volume signature, how far it ran,
    whether it held its stop) instead of guessing it."""
    if not bars:
        return "(no daily bars available)"
    idx = None
    for i, b in enumerate(bars):
        t = str(b.get("t", ""))[:10]
        if t == center_date:
            idx = i
            break
        if t > center_date:  # walked past it → nearest session
            idx = i
            break
    if idx is None:
        idx = len(bars) - 1
    lo, hi = max(0, idx - before), min(len(bars), idx + after + 1)
    lines = []
    for b in bars[lo:hi]:
        t = str(b.get("t", ""))[:10]
        mark = "   <-- setup day" if t == center_date else ""
        try:
            lines.append(
                f"{t}: {b['o']:.2f}/{b['h']:.2f}/{b['l']:.2f}/{b['c']:.2f}"
                f"  vol {int(b.get('v', 0)):,}{mark}"
            )
        except (KeyError, TypeError, ValueError):
            continue
    return "\n".join(lines) or "(no daily bars available)"


def _setup_candle_facts(bars: list, center_date: str) -> str:
    """Pre-computed setup-day candle metrics, injected into the prompt so the model
    never eyeballs arithmetic off the raw OHLC rows. (It claimed 'open near the low'
    on a candle that opened 31% up the range — LLMs are unreliable at mental math, so
    we hand it the numbers.) Returns '' when the setup day isn't in the bars."""
    idx = None
    for i, b in enumerate(bars or []):
        if str(b.get("t", ""))[:10] == center_date:
            idx = i
            break
    if idx is None:
        return ""
    b = bars[idx]
    try:
        o, h, low, c = float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])
        v = float(b.get("v") or 0)
    except (KeyError, TypeError, ValueError):
        return ""
    rng = h - low
    lines = [
        f"SETUP-DAY CANDLE FACTS for {center_date} (pre-computed — base ALL claims about the "
        f"setup candle on these numbers; do not re-derive them from the rows):",
        f"- O {o:.2f} / H {h:.2f} / L {low:.2f} / C {c:.2f}, volume {int(v):,}",
    ]
    if rng > 0:
        op = (o - low) / rng * 100
        cp = (c - low) / rng * 100
        lines.append(f"- Open sits {op:.0f}% up the day's range (0% = at the low, 100% = at the high)")
        lines.append(f"- Close sits {cp:.0f}% up the day's range")
    prior = bars[max(0, idx - 20):idx]
    try:
        pr = [float(p["h"]) - float(p["l"]) for p in prior]
        avg_r = (sum(pr) / len(pr)) if pr else 0
        if avg_r > 0 and rng > 0:
            lines.append(f"- Day's range is {rng / avg_r:.1f}x the prior-{len(pr)}-session average range")
    except (KeyError, TypeError, ValueError):
        pass
    pv = [float(p.get("v") or 0) for p in prior]
    pv = [x for x in pv if x > 0]
    if pv and v > 0:
        lines.append(f"- Volume is {v / (sum(pv) / len(pv)):.1f}x the prior-{len(pv)}-session average")
    if prior:
        try:
            prior_hi = max(float(p["h"]) for p in prior)
            lines.append(f"- New high vs the prior {len(prior)} sessions: {'YES' if h > prior_hi else 'no'}")
            prev_c = float(prior[-1]["c"])
            if prev_c > 0:
                lines.append(f"- Open vs prior close: {(o - prev_c) / prev_c * 100:+.1f}% gap")
        except (KeyError, TypeError, ValueError):
            pass
    return "\n".join(lines) + "\n\n"


_BULLET_LABEL_RE = re.compile(
    r"^(\s*[•\-*]\s*)(?:catalyst|technical|thematic|fundamental|fundamentals|theme)\s*[:\-—]\s*",
    re.IGNORECASE,
)


def _clean_setup_note(text: str) -> str:
    """Keep ONLY the bulleted note, clean. Two passes:
      1. slice off any process narration the model prepends before the bullets
         ('I'll research what was happening… Let me retry the searches.'),
      2. strip the category labels it sometimes puts at the start of a bullet
         ('• Catalyst: …', '• Technical: …', '• Thematic: …') so each bullet
         starts straight with the substance."""
    if not text:
        return ""
    i = text.find("•")
    if i == -1:  # model used -, *, or a numbered list instead of •
        m = re.search(r"(?m)^\s*([-*]|\d+[.)])\s+", text)
        i = m.start() if m else -1
    if i > 0:
        text = text[i:]
    lines = [_BULLET_LABEL_RE.sub(r"\1", ln) for ln in text.splitlines()]
    return "\n".join(lines).strip()


_SETUP_DESC_SYSTEM = (
    "You are a master swing-trading analyst writing an ULTRA-CONCISE teaching note for a "
    "curated 'model book' of the best stock setups in history. You blend a deep fundamental, "
    "technical, and thematic read of the setup into a few sharp bullet points.\n\n"
    "Your analytical lens is the distilled wisdom of the great momentum and growth traders — "
    "specifically think in the frameworks of Jesse Livermore (pivotal points, the line of least "
    "resistance, sitting tight in leaders), Mark Minervini (volatility contraction, progressive "
    "tightening, risk-first entries off tight pivots), William O'Neil (fundamental acceleration "
    "in the leaders, base stages and counts, volume confirmation, market direction), Qullamaggie "
    "/ Kristjan Kullamägi (high tight flags, breakouts on leading ADR names, only 1-2 tight-risk "
    "entries on true leaders), and Nicolas Darvas (boxes, new-high buying, letting the stock "
    "prove itself). Choose whichever lens genuinely fits THIS setup type and price action.\n\n"
    "HARD RULE: NEVER name any trader, author, book, or methodology in the output — no "
    "'Livermore', no 'CAN SLIM', no 'VCP', no 'Darvas box'. The teachings speak through the "
    "analysis in plain language, uncredited. Be concrete and factual about the specific stock "
    "and day. No present-tense buy/sell advice, no price targets."
)


def _generate_setup_description(setup: dict, stock: dict) -> Optional[str]:
    """Claude (Opus 4.8) + web search → a web-grounded teaching note for one setup.
    Raises on hard failure (so the endpoint can surface it); returns None only when
    the model genuinely produced no text."""
    if not _SETUP_DESC_ENABLED:
        raise RuntimeError("Setup description generation is disabled")
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client()
    if client is None:
        raise RuntimeError("Anthropic client unavailable (check ANTHROPIC_API_KEY)")

    symbol = stock["symbol"]
    company = stock.get("company") or symbol
    year = stock["year"]
    label_date = setup.get("label_date")
    setup_type = setup.get("setup_type") or "setup"
    grade = setup.get("grade")
    bracket = []
    if setup.get("entry_price") is not None:
        bracket.append(f"entry ${setup['entry_price']}")
    if setup.get("stop_price") is not None:
        bracket.append(f"stop ${setup['stop_price']}")
    if setup.get("target_price") is not None:
        bracket.append(f"target ${setup['target_price']}")
    bracket_txt = ", ".join(bracket) or "no entry/stop/target recorded"

    year_bars = _load_year_bars(symbol, year, stock.get("id"))
    window_txt = _format_bar_window(year_bars, label_date)
    facts_txt = _setup_candle_facts(year_bars, label_date)

    # Where does this setup sit in the stock's sequence of labeled setups? Later
    # entries should be framed against the earlier ones (theme more established,
    # second chance to get involved, etc.) — see SEQUENCE rules in the prompt.
    others = [s for s in (stock.get("setups") or [])
              if s.get("id") != setup.get("id") and s.get("label_date")]
    others.sort(key=lambda s: s["label_date"])
    if others:
        seq_lines = "\n".join(
            f"- {s.get('setup_type') or 'setup'} on {s['label_date']}" for s in others)
        sequence_txt = (
            f"Other labeled setups on {symbol} this year (for sequence context — this note is "
            f"ONLY about the {label_date} setup):\n{seq_lines}\n\n"
        )
    else:
        sequence_txt = ""

    research = (
        "Use web search to research what was actually happening around this date — the catalyst, "
        "the broader market/indices, the sector, sympathy moves in related names, and trader "
        "sentiment. A few quick, targeted searches are enough — do NOT over-research.\n\n"
        if _SETUP_DESC_WEB else
        "Using your own knowledge of this stock and period plus the price action above, identify "
        "what was driving it — the catalyst, the broader market backdrop, the sector/theme, and "
        "any sympathy names.\n\n"
    )
    prompt = (
        f"Setup: **{setup_type}** in {symbol} ({company}) on {label_date} "
        f"(grade {grade or 'n/a'}; {bracket_txt}).\n\n"
        f"Daily price action around the setup day (date: open/high/low/close, volume):\n"
        f"{window_txt}\n\n"
        f"{facts_txt}"
        f"{sequence_txt}"
        f"{research}"
        "Write a SHORT bulleted note on why this was a great setup. STRICT FORMAT:\n"
        "- Begin IMMEDIATELY with the first '• ' bullet. Output NOTHING before it — no narration, "
        "no 'I'll research…', no 'Let me search…', no process talk, no preamble of any kind.\n"
        "- Output EXACTLY 4 bullets, each starting with '• ' and separated by a BLANK line.\n"
        "- Each bullet is ONE complete sentence of roughly 18-28 words — substantial but tight. "
        "Keep the four bullets visually similar in length; no one-liner stubs, no run-ons.\n"
        "- Start each bullet DIRECTLY with the substance. Do NOT prefix bullets with a category "
        "label like 'Catalyst:', 'Technical:', 'Thematic:', or 'Fundamental:'.\n"
        "- No intro line, no headers, no closing line, no citations.\n"
        "- Keep the WHOLE note under ~105 words total. Every word earns its place.\n\n"
        "Across the bullets, weave in (WITHOUT labeling them) the fundamental reason (the catalyst "
        "— earnings/sales acceleration, product, deal, story), the technical reason "
        "(base/consolidation, the volume signature, the pivot, moving-average support, character "
        "of the move), and the thematic reason (the market backdrop and the sector/theme driving "
        "it, plus any sympathy names). Stay factual to that year; if unsure of exact details, lean "
        "on the price action and the year's dominant theme. Do NOT name any trader or methodology.\n\n"
        "POINT-IN-TIME RULES (critical):\n"
        "- Write ONLY what a trader could observe ON the setup day — no hindsight. Never "
        "retro-label the theme with a name that only became consensus later (e.g. don't call it a "
        "'super-cycle' if that narrative wasn't established yet on the setup date). If the theme "
        "was early-stage, SAY it was early: observable sympathy strength in the peer group is the "
        "tell, not the later consensus story.\n"
        "- This note is about the '<-- setup day' candle and the days around IT — only. Never "
        "transplant traits of the stock's other labeled setups onto this one; the sequence list "
        "is purely for staging the narrative (entry #1 vs entry #2), never a source of candle or "
        "price-action claims.\n\n"
        "CONDITIONAL OBSERVATIONS — NOT a checklist. Each may ONLY be stated if the SETUP-DAY "
        "CANDLE FACTS above support it; those numbers are authoritative — never contradict them, "
        "and OMIT any observation they don't support:\n"
        "- Character change: only if the FACTS show meaningful range expansion (≥ ~1.5x) plus "
        "volume expansion (≥ ~1.5x) AND a new high — then also name the follow-through condition "
        "(the setup day's low should not be breached if the move is to continue).\n"
        "- Candle quality: use the open/close range positions from the FACTS. Only call the open "
        "'near the low' if its position is ≤ ~15%, and the close 'near the high' if ≥ ~85%. "
        "Otherwise describe what the candle actually did (e.g. 'opened mid-range, reversed off "
        "the lows, closed at the highs').\n"
        "- Extended-leader psychology: only if this setup formed after an already-extended move "
        "(short flag / brief consolidation following a big run) — most traders are afraid to buy "
        "it, but the strongest stocks stay extended; the best leaders may offer only 1-2 chances "
        "to get involved with tight risk.\n"
        "- Theme maturation: only if this is a later setup on the stock (see sequence above) — "
        "stage the theme vs the earlier setup (early then, visibly confirming now as related names "
        "make explosive high-volume moves), and only as established as it actually was on THIS "
        "date."
    )

    messages = [{"role": "user", "content": prompt}]

    # Bounded so it can never get "stuck": a hard per-request timeout, low effort
    # (the output is 5 short bullets — the value is the synthesis, not deep
    # reasoning), and small max_tokens. With web search OFF (the default) this is a
    # single fast call (~15-25s, no server-tool loop). With web search ON, allow a
    # couple of pause_turn resumes for the server-side search loop.
    bounded = client.with_options(timeout=90.0, max_retries=1)
    use_effort = True  # toggled off if the installed SDK predates output_config

    def _call(msgs):
        nonlocal use_effort
        kwargs = dict(
            model=_SETUP_DESC_MODEL,
            max_tokens=2000,
            thinking={"type": "adaptive"},          # Opus 4.8: adaptive only (no budget_tokens / temperature)
            system=_SETUP_DESC_SYSTEM,
            messages=msgs,
        )
        if _SETUP_DESC_WEB:
            kwargs["tools"] = [_SETUP_DESC_WEB_TOOL]
        if use_effort:
            kwargs["output_config"] = {"effort": "low"}
        try:
            return bounded.messages.create(**kwargs)
        except TypeError:
            if not use_effort:
                raise
            use_effort = False                      # old SDK → retry without effort
            kwargs.pop("output_config", None)
            return bounded.messages.create(**kwargs)

    resp = _call(messages)
    # Only the web-search server tool can pause_turn; resume it a bounded number of
    # times. (With web search off there's no tool loop, so this never runs.)
    conts = 0
    while _SETUP_DESC_WEB and getattr(resp, "stop_reason", None) == "pause_turn" and conts < 2:
        resp = _call([{"role": "user", "content": prompt},
                      {"role": "assistant", "content": resp.content}])
        conts += 1

    text = "".join(
        getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text"
    ).strip()
    return _clean_setup_note(text) or None


# Generation runs in a background thread (kept off the request path so a slow run
# never trips a proxy timeout). The POST kicks it off and returns immediately; the
# frontend polls describe-status until the note is written (or an error recorded).
_gen_desc_lock = _threading.Lock()
_generating_descs = set()   # setup ids with a description generation in flight
_desc_errors = {}           # setup_id -> last error string (cleared on new run / success)


def _run_setup_desc(setup_id: int) -> None:
    try:
        setup = svc.get_setup(setup_id)
        if not setup:
            _desc_errors[setup_id] = "Setup not found"
            return
        stock = svc.get_stock_detail(setup["stock_id"])
        if not stock:
            _desc_errors[setup_id] = "Stock not found"
            return
        text = _generate_setup_description(setup, stock)
        if text:
            svc.update_setup(setup_id, {"notes": text})
            _desc_errors.pop(setup_id, None)
        else:
            _desc_errors[setup_id] = "The model returned no description — try again."
    except Exception as e:
        _desc_errors[setup_id] = f"Generation failed: {str(e)[:240]}"
    finally:
        with _gen_desc_lock:
            _generating_descs.discard(setup_id)


@router.post("/setup/{setup_id}/describe")
def describe_setup(setup_id: int, _admin: dict = Depends(require_admin)):
    """Kick off (background) AI generation of a web-grounded teaching description for
    one setup. Admin-only and manual — each run spends Anthropic tokens, so it's
    wired to a button, never auto-run. The result persists in the setup's `notes`
    forever (later views are a free DB read). Returns immediately with
    {status:'generating'}; poll GET describe-status for completion."""
    if not _SETUP_DESC_ENABLED:
        raise HTTPException(503, "Setup description generation is disabled")
    setup = svc.get_setup(setup_id)
    if not setup:
        raise HTTPException(404, "Setup not found")
    with _gen_desc_lock:
        if setup_id in _generating_descs:
            return {"status": "generating"}  # already running — don't double-spend
        _generating_descs.add(setup_id)
    _desc_errors.pop(setup_id, None)
    _threading.Thread(target=_run_setup_desc, args=(setup_id,), daemon=True,
                      name=f"mb-setupdesc-{setup_id}").start()
    return {"status": "generating"}


@router.get("/setup/{setup_id}/describe-status")
def describe_setup_status(setup_id: int, _admin: dict = Depends(require_admin)):
    """Poll target for the background description job: 'generating' while in flight,
    'error' (with message) on failure, else 'done' with the current notes."""
    with _gen_desc_lock:
        if setup_id in _generating_descs:
            return {"status": "generating"}
    err = _desc_errors.get(setup_id)
    if err:
        return {"status": "error", "error": err}
    setup = svc.get_setup(setup_id)
    if not setup:
        raise HTTPException(404, "Setup not found")
    return {"status": "done", "notes": setup.get("notes")}


# ── Catalyst writes (admin only) ──────────────────────────────────────────────

@router.post("/stock/{stock_id}/catalysts/generate")
def generate_catalysts(stock_id: int, force: bool = Query(False),
                       _admin: dict = Depends(require_admin)):
    """AI-generate the year's top catalysts and REPLACE the stock's catalyst set.
    Synchronous (one LLM call). Returns the updated stock detail.

    Idempotent by default: catalysts persist in the DB forever once generated, so
    if they already exist we return them WITHOUT spending Anthropic tokens. Pass
    force=true (the "Regenerate" button) to deliberately re-run the LLM."""
    if not _CATALYST_ENABLED:
        raise HTTPException(503, "Catalyst generation is disabled")
    stock = svc.get_stock_detail(stock_id)
    if not stock:
        raise HTTPException(404, "Stock not found")
    if stock.get("catalysts") and not force:
        return stock  # already generated — no LLM call, no tokens spent
    items = _generate_catalysts(
        stock["symbol"], stock.get("company"), stock["year"],
        stock.get("oc_pct") if stock.get("oc_pct") is not None else stock.get("gain_pct"),
        stock_id,
    )
    if not items:
        raise HTTPException(502, "Could not generate catalysts — try again.")
    if svc.replace_catalysts(stock_id, items) is None:
        raise HTTPException(404, "Stock not found")
    return svc.get_stock_detail(stock_id)


@router.post("/stock/{stock_id}/catalysts")
def add_catalyst(stock_id: int, payload: CatalystIn, _admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    _validate_catalyst(data)
    cat = svc.create_catalyst(stock_id, data)
    if cat is None:
        raise HTTPException(404, "Stock not found")
    return cat


@router.put("/catalyst/{catalyst_id}")
def edit_catalyst(catalyst_id: int, payload: CatalystPatch, _admin: dict = Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    _validate_catalyst(data)
    cat = svc.update_catalyst(catalyst_id, data)
    if not cat:
        raise HTTPException(404, "Catalyst not found")
    return cat


@router.delete("/catalyst/{catalyst_id}")
def remove_catalyst(catalyst_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_catalyst(catalyst_id):
        raise HTTPException(404, "Catalyst not found")
    return {"deleted": catalyst_id}
