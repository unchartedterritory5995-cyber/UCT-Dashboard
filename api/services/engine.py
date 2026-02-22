"""
api/services/engine.py

Reads data for the engine endpoints. Primary source is morning_wire_state.json
(written by the 7:35 AM morning-wire run). Falls back to live engine calls
when state keys are absent.

Key findings from inspecting morning_wire_engine.py:
  fetch_breadth()        → returns dict with keys: pct_above_50, pct_above_200,
                           nyad, nyhl, breadth_score
  fetch_theme_tracker()  → returns dict keyed by ETF ticker, each value has:
                           name, ticker, etf_name, 1W, 1M, 3M, holdings
  fetch_leadership()     → returns list of dicts (requires analyst arg = AIAnalyst instance)
  fetch_finviz_news()    → returns list of dicts: headline, source, url, datetime, category, summary
  fetch_earnings_whispers() → list of dicts: symbol, date, hour, eps_actual, eps_estimate, etc.

State file keys (morning_wire_state.json):
  distribution_days_spy, distribution_days_qqq, rally_start_date, rally_day_count,
  market_phase, ftd_detected, ftd_date, last_run_date, historical_breadth,
  historical_risk_appetite, stockbee_cache, stockbee_last_5_days,
  positioning_cache, aaii_cache, naaim_cache
"""
import sys
import os
import json

MORNING_WIRE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "morning-wire")
)
if MORNING_WIRE_PATH not in sys.path:
    sys.path.insert(0, MORNING_WIRE_PATH)

STATE_FILE = os.path.join(MORNING_WIRE_PATH, "morning_wire_state.json")

from api.services.cache import cache


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


# ─── Breadth ──────────────────────────────────────────────────────────────────

def get_breadth() -> dict:
    cached = cache.get("breadth")
    if cached:
        return cached

    state = _load_state()

    # State file stores breadth under "breadth_data" if the engine wrote it.
    # If not present, attempt a live fetch then fall back to zeros.
    breadth = state.get("breadth_data")
    if not breadth:
        try:
            import morning_wire_engine as eng
            raw = eng.fetch_breadth()
            breadth = _normalize_breadth(raw, state)
        except Exception as e:
            breadth = {
                "pct_above_50ma": 0,
                "pct_above_200ma": 0,
                "advancing": 0,
                "declining": 0,
                "breadth_score": 50.0,
                "distribution_days": state.get("distribution_days_qqq", 0),
                "market_phase": state.get("market_phase", "Unknown"),
                "error": str(e),
            }
    else:
        # If it was cached in state, normalise field names just in case
        breadth = _normalize_breadth(breadth, state)

    cache.set("breadth", breadth, ttl=3600)
    return breadth


def _normalize_breadth(raw: dict, state: dict) -> dict:
    """
    fetch_breadth() uses keys: pct_above_50, pct_above_200, breadth_score.
    Map them to our public API keys: pct_above_50ma, pct_above_200ma.
    """
    if not isinstance(raw, dict):
        raw = {}
    return {
        "pct_above_50ma": raw.get("pct_above_50ma", raw.get("pct_above_50", 0) or 0),
        "pct_above_200ma": raw.get("pct_above_200ma", raw.get("pct_above_200", 0) or 0),
        "advancing": raw.get("advancing", 0),
        "declining": raw.get("declining", 0),
        "breadth_score": raw.get("breadth_score", 50.0),
        "distribution_days": state.get("distribution_days_qqq", 0),
        "market_phase": state.get("market_phase", "Unknown"),
    }


# ─── Themes ───────────────────────────────────────────────────────────────────

def get_themes() -> dict:
    cached = cache.get("themes")
    if cached:
        return cached

    state = _load_state()
    themes = state.get("themes_data")
    if not themes:
        try:
            import morning_wire_engine as eng
            raw = eng.fetch_theme_tracker()
            themes = _normalize_themes(raw)
        except Exception as e:
            themes = {"leaders": [], "laggards": [], "period": "1W", "error": str(e)}
    else:
        # Already normalised by engine if stored in our format; pass through
        if "leaders" not in themes:
            themes = _normalize_themes(themes)

    cache.set("themes", themes, ttl=3600)
    return themes


def _normalize_themes(raw) -> dict:
    """
    fetch_theme_tracker() returns a dict keyed by ETF ticker.
    Each value has: name, ticker, 1W, 1M, 3M, holdings, etf_name.

    We sort by 1W performance and split into top 8 leaders / bottom 8 laggards.
    """
    if not isinstance(raw, dict) or not raw:
        return {"leaders": [], "laggards": [], "period": "1W"}

    items = []
    for ticker, data in raw.items():
        if not isinstance(data, dict):
            continue
        pct_val = data.get("1W", 0) or 0
        pct_str = f"{pct_val:+.2f}%" if isinstance(pct_val, (int, float)) else str(pct_val)
        bar = min(100, max(0, abs(pct_val) * 8)) if isinstance(pct_val, (int, float)) else 50
        items.append({
            "name": data.get("name", ticker),
            "ticker": ticker,
            "pct": pct_str,
            "pct_val": pct_val,
            "bar": round(bar),
        })

    items.sort(key=lambda x: x["pct_val"], reverse=True)

    def clean(item):
        return {"name": item["name"], "ticker": item["ticker"], "pct": item["pct"], "bar": item["bar"]}

    return {
        "leaders": [clean(i) for i in items[:8]],
        "laggards": [clean(i) for i in items[-8:][::-1]],
        "period": "1W",
    }


# ─── Leadership ───────────────────────────────────────────────────────────────

def get_leadership() -> list:
    cached = cache.get("leadership")
    if cached:
        return cached

    state = _load_state()
    # Leadership data is injected into state by the engine as a JS variable;
    # look for it under "leadership_data". It typically won't be there unless
    # engine.py has been extended to store it — return empty list if absent.
    data = state.get("leadership_data", [])
    if not isinstance(data, list):
        data = []

    cache.set("leadership", data, ttl=3600)
    return data


# ─── Rundown ──────────────────────────────────────────────────────────────────

def get_rundown() -> dict:
    cached = cache.get("rundown")
    if cached:
        return cached

    state = _load_state()
    data = state.get("rundown_data", {"html": "", "date": ""})
    if not isinstance(data, dict):
        data = {"html": str(data), "date": ""}

    cache.set("rundown", data, ttl=3600)
    return data


# ─── Earnings ─────────────────────────────────────────────────────────────────

def get_earnings() -> dict:
    cached = cache.get("earnings")
    if cached:
        return cached

    state = _load_state()
    data = state.get("earnings_data")
    if not data:
        try:
            import morning_wire_engine as eng
            import datetime
            today = datetime.date.today().strftime("%Y-%m-%d")
            raw = eng.fetch_earnings_whispers(today)
            data = _normalize_earnings(raw)
        except Exception as e:
            data = {"bmo": [], "amc": [], "error": str(e)}
    else:
        if "bmo" not in data:
            data = _normalize_earnings(data if isinstance(data, list) else [])

    cache.set("earnings", data, ttl=1800)
    return data


def _normalize_earnings(raw) -> dict:
    """
    fetch_earnings_whispers() returns a flat list with "hour": "bmo" | "amc".
    Split into bmo / amc buckets and expose clean fields.
    """
    bmo, amc = [], []
    for item in (raw or []):
        if not isinstance(item, dict):
            continue
        entry = {
            "sym": item.get("symbol", item.get("sym", "")),
            "eps_actual": item.get("eps_actual"),
            "eps_estimate": item.get("eps_estimate"),
            "rev_actual": item.get("rev_actual"),
            "rev_estimate": item.get("rev_estimate"),
        }
        # Derive a simple verdict
        if item.get("eps_actual") is not None and item.get("eps_estimate") is not None:
            entry["verdict"] = "Beat" if item["eps_actual"] >= item["eps_estimate"] else "Miss"
        else:
            entry["verdict"] = "Pending"

        if item.get("hour") == "bmo":
            bmo.append(entry)
        else:
            amc.append(entry)

    return {"bmo": bmo[:8], "amc": amc[:8]}


# ─── News ─────────────────────────────────────────────────────────────────────

def get_news() -> list:
    cached = cache.get("news")
    if cached:
        return cached

    try:
        import morning_wire_engine as eng
        raw = eng.fetch_finviz_news(count=20)
        # fetch_finviz_news returns: headline, source, url, datetime, category, summary
        # Rename "datetime" → "time" for consistency with our API
        news = []
        for item in raw:
            news.append({
                "headline": item.get("headline", ""),
                "source": item.get("source", ""),
                "url": item.get("url", ""),
                "time": item.get("datetime", ""),
                "category": item.get("category", ""),
            })
        result = news
    except Exception as e:
        result = [{"headline": "News unavailable", "source": "", "url": "", "time": "", "error": str(e)}]

    cache.set("news", result, ttl=300)
    return result


# ─── Screener ─────────────────────────────────────────────────────────────────

def get_screener() -> list:
    """
    No screener.py in morning-wire. Return leadership data re-shaped as screener rows,
    or return an empty list if leadership is also absent.
    """
    cached = cache.get("screener")
    if cached:
        return cached

    leadership = get_leadership()
    if leadership:
        result = [
            {
                "sym": item.get("sym", item.get("symbol", item.get("ticker", ""))),
                "rs_score": item.get("score", item.get("rs_score", 0)),
                "vol_ratio": item.get("vol_ratio", 1.0),
                "mom": item.get("mom", 0.0),
                "thesis": item.get("thesis", ""),
            }
            for item in leadership
        ]
    else:
        result = []

    cache.set("screener", result, ttl=900)
    return result
