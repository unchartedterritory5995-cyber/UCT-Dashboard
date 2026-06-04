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
    sort_order: Optional[int] = 0
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None


class StockPatch(BaseModel):
    year: Optional[int] = None
    symbol: Optional[str] = None
    company: Optional[str] = None
    sort_order: Optional[int] = None
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None
    company_desc: Optional[str] = None
    run_story: Optional[str] = None


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


@router.get("/stock/{stock_id}")
def get_stock(stock_id: int, _user: dict = Depends(get_current_user)):
    stock = svc.get_stock_detail(stock_id)
    if not stock:
        raise HTTPException(404, "Stock not found")
    # Auto-generate the company/story descriptions on first view (background).
    if not stock.get("company_desc") and _is_final_year(stock.get("year", 0)):
        _gen_desc_async(stock)
    # Auto-generate bullish, stock-specific catalysts on first view (background),
    # once per stock — then kept permanently in the DB (no manual "Generate").
    if _needs_catalysts(stock):
        _gen_catalysts_async(stock)
    return stock


def _compute_year_stats(symbol: str, year: int) -> dict:
    """For a (symbol, year): % move from year open→close, and from year
    low→high. Computed from daily bars and cached (closed-year stats are
    static). Returns {open_close_pct, low_high_pct} (None when unavailable)."""
    import json
    from api.services.cache import cache
    from api.services import bars_fetch

    ckey = f"modelbook_yearstats_{symbol.upper()}_{year}"
    cached = cache.get(ckey)
    if cached is not None:
        return cached

    stats = {"open_close_pct": None, "low_high_pct": None, "avg_vol": None}
    try:
        resp = bars_fetch._get_bars_inner(symbol, "D", 5000)
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
        ystr = str(year)
        yb = [b for b in data.get("bars", []) if str(b.get("t", "")).startswith(ystr)]
        yb.sort(key=lambda b: b.get("t", ""))  # 'YYYY-MM-DD' sorts chronologically
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
            st = _compute_year_stats(s["symbol"], s["year"])
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
                  _user: dict = Depends(get_current_user)):
    """Quarterly EPS + revenue (actual vs estimate, with % surprise) for the
    reports that landed during `year`. Lazy — fetched only when the Earnings tab
    is opened. Finnhub-backed + cached (closed years are static)."""
    from api.services import earnings_estimates
    rows = earnings_estimates.get_year_earnings(symbol, year)
    return {"symbol": symbol.upper(), "year": year, "rows": rows}


# ── AI-generated descriptions (company one-liner + "why it ran that year") ────

import os as _os
import time as _time_mod
_DESC_ENABLED = _os.environ.get("MODELBOOK_DESC_ENABLED", "1") == "1"
_DESC_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_DESC_RETRY_AFTER = 86400  # don't re-attempt a failed generation for ~1 day
_gen_lock = _threading.Lock()
_generating = set()  # stock ids with a description generation in flight


def _needs_desc(s) -> bool:
    """True if a stock still needs descriptions: none yet AND either never
    attempted or the last attempt is stale. Prevents a tight retry/cost loop on
    tickers the model can't summarize."""
    if not _DESC_ENABLED or s.get("company_desc"):
        return False
    da = s.get("desc_at")
    return (not da) or (int(_time_mod.time()) - da > _DESC_RETRY_AFTER)


def _generate_descriptions(symbol, company, year, gain_pct):
    """Claude → {company_desc, run_story}. One sentence on what the company does +
    a brief, factual reason it made its big move that year. Returns None on failure."""
    if not _DESC_ENABLED:
        return None
    import json as _json
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        gain_txt = f"about {round(gain_pct)}%" if gain_pct is not None else "a large amount"
        system = ("You write concise, factual stock study notes for a trader's model book. "
                  "Output JSON only — no preamble, no markdown fences.")
        prompt = (
            f"Stock: {symbol} ({company or symbol}). Calendar year: {year}. "
            f"The stock rose {gain_txt} that year.\n\n"
            'Return JSON exactly: {"company_desc": "...", "run_story": "..."}\n'
            "- company_desc: ONE plain sentence on what the company does.\n"
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
        msg = client.messages.create(
            model=_DESC_MODEL, max_tokens=400, temperature=0.7,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        s, e = text.find("{"), text.rfind("}")
        if s == -1 or e == -1:
            return None
        obj = _json.loads(text[s:e + 1])
        cd = (obj.get("company_desc") or "").strip()
        rs = (obj.get("run_story") or "").strip()
        return {"company_desc": cd, "run_story": rs} if (cd or rs) else None
    except Exception:
        return None


def _generate_descriptions_for(stocks, max_workers=3):
    pending = [s for s in stocks if _needs_desc(s)]
    if not pending:
        return
    import concurrent.futures

    def _work(s):
        d = _generate_descriptions(s["symbol"], s.get("company"), s["year"], s.get("oc_pct"))
        try:
            if d:
                svc.save_descriptions(s["id"], d["company_desc"], d["run_story"])
            else:
                svc.mark_desc_attempt(s["id"])  # stamp attempt so we don't loop
        except Exception:
            pass
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
            if d:
                svc.save_descriptions(sid, d["company_desc"], d["run_story"])
            else:
                svc.mark_desc_attempt(sid)  # stamp attempt so we don't loop
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
        if stats_done and desc_done and not cat_pending:
            return  # fully warmed
        if not stats_done:
            _persist_stats_for(stocks, max_workers=2)
            try:
                stocks = [s for s in svc.get_all_stocks() if _is_final_year(s["year"])]
            except Exception:
                pass
        _generate_descriptions_for(stocks)
        _generate_catalysts_for(cat_pending)


# ── AI-generated catalysts (the year's most impactful, move-driving events) ───

_CATALYST_ENABLED = _os.environ.get("MODELBOOK_CATALYSTS_ENABLED", "1") == "1"
_CATALYST_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")


def _fetch_year_bars(symbol: str, year: int) -> list:
    """Sorted daily bars for the (symbol, year). Reuses the cached bars path."""
    import json
    from api.services import bars_fetch
    resp = bars_fetch._get_bars_inner(symbol, "D", 5000)
    body = getattr(resp, "body", None)
    data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
    ystr = str(year)
    yb = [b for b in data.get("bars", []) if str(b.get("t", "")).startswith(ystr)]
    yb.sort(key=lambda b: b.get("t", ""))
    return yb


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


def _generate_catalysts(symbol, company, year, gain_pct):
    """Claude → list of the year's top 3-5 catalysts, each anchored to a real
    big-move trading day. Returns None on failure (no rows written)."""
    if not _CATALYST_ENABLED:
        return None
    import json as _json
    try:
        bars = _fetch_year_bars(symbol, year)
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
