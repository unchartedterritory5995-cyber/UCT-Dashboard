"""
api/services/engine.py

Reads data for the engine endpoints. Primary source is data/wire_data.json
(written at the end of each morning_wire_engine.py run). Falls back to
morning_wire_state.json keys and finally live engine calls when the JSON
file is absent or stale.

wire_data.json schema (written by morning_wire_engine.run()):
  date          — ISO date string, e.g. "2026-02-22"
  rundown_html  — full assembled rundown HTML string
  leadership    — list of dicts (sym, thesis, score, …)
  themes        — dict keyed by ETF ticker (name, 1W, 1M, 3M, holdings, …)
  earnings      — {"bmo": [...], "amc": [...]} — raw EW/Finnhub entries

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
WIRE_DATA_FILE = os.path.join(MORNING_WIRE_PATH, "data", "wire_data.json")
PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"  # Railway volume mount

from api.services.cache import cache


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _load_wire_data() -> dict | None:
    """Load the pre-computed wire_data.json from the engine's last run.

    Priority: in-memory cache → Railway volume (/data/) → local dev path.
    """
    cached = cache.get("wire_data")
    if cached:
        return cached
    for path in [PERSISTENT_WIRE_DATA_FILE, WIRE_DATA_FILE]:
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                cache.set("wire_data", data, ttl=82800)
                return data
            except (json.JSONDecodeError, OSError):
                continue
    return None


# ─── Breadth ──────────────────────────────────────────────────────────────────

def get_breadth() -> dict:
    cached = cache.get("breadth")
    if cached:
        return cached

    state = _load_state()

    # Priority 1: state file breadth_data (local dev)
    breadth = state.get("breadth_data")
    if breadth:
        breadth = _normalize_breadth(breadth, state)
    else:
        # Priority 2: wire_data pushed from engine (persisted in Railway volume)
        wire = _load_wire_data()
        if wire and wire.get("breadth"):
            breadth = _normalize_breadth(wire["breadth"], state)
        else:
            # Priority 3: live fetch (local dev only — Finviz token not on Railway)
            try:
                import morning_wire_engine as eng
                raw = eng.fetch_breadth()
                breadth = _normalize_breadth(raw, state)
            except Exception as e:
                breadth = {
                    "pct_above_50ma": None,
                    "pct_above_200ma": None,
                    "advancing": None,
                    "declining": None,
                    "breadth_score": None,
                    "distribution_days": state.get("distribution_days_qqq", 0),
                    "market_phase": state.get("market_phase", ""),
                }

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

def get_themes(period: str = "1W") -> dict:
    wire = _load_wire_data()
    cache_key = f"themes_{period}"
    if wire and wire.get("themes"):
        cached = cache.get(cache_key)
        if cached:
            return cached
        data = _normalize_themes(wire["themes"], period)
        cache.set(cache_key, data, ttl=3600)
        return data

    cached = cache.get(cache_key)
    if cached:
        return cached

    state = _load_state()
    raw = state.get("themes_data")
    if not raw:
        try:
            import morning_wire_engine as eng
            raw = eng.fetch_theme_tracker()
        except Exception as e:
            result = {"leaders": [], "laggards": [], "period": period, "error": str(e)}
            cache.set(cache_key, result, ttl=3600)
            return result

    result = _normalize_themes(raw, period)
    cache.set(cache_key, result, ttl=3600)
    return result


def _normalize_themes(raw, period: str = "1W") -> dict:
    """
    fetch_theme_tracker() returns a dict keyed by ETF ticker.
    Each value has: name, ticker, etf_name, 1W, 1M, 3M, holdings, intl_holdings.

    Returns ALL themes sorted by selected period with holdings included.
    """
    if not isinstance(raw, dict) or not raw:
        return {"leaders": [], "laggards": [], "period": period}

    items = []
    for ticker, data in raw.items():
        if not isinstance(data, dict):
            continue
        pct_val = data.get(period, 0) or 0
        pct_str = f"{pct_val:+.2f}%" if isinstance(pct_val, (int, float)) else str(pct_val)
        bar = min(100, max(0, abs(pct_val) * 8)) if isinstance(pct_val, (int, float)) else 50

        raw_holdings = data.get("holdings", [])
        holdings = [
            h["sym"] for h in raw_holdings
            if isinstance(h, dict) and h.get("sym")
        ]

        raw_intl = data.get("intl_holdings", [])
        intl_count = len(raw_intl) if isinstance(raw_intl, list) else 0

        items.append({
            "name": data.get("name", ticker),
            "ticker": ticker,
            "etf_name": data.get("etf_name", ""),
            "pct": pct_str,
            "pct_val": pct_val,
            "bar": round(bar),
            "holdings": holdings,
            "intl_count": intl_count,
        })

    items.sort(key=lambda x: x["pct_val"], reverse=True)

    def clean(item):
        return {
            "name": item["name"],
            "ticker": item["ticker"],
            "etf_name": item["etf_name"],
            "pct": item["pct"],
            "bar": item["bar"],
            "holdings": item["holdings"],
            "intl_count": item["intl_count"],
        }

    leaders  = [clean(i) for i in items if i["pct_val"] >= 0]
    laggards = [clean(i) for i in reversed(items) if i["pct_val"] < 0]

    return {"leaders": leaders, "laggards": laggards, "period": period}


# ─── Leadership ───────────────────────────────────────────────────────────────

def get_leadership() -> list:
    wire = _load_wire_data()
    if wire and wire.get("leadership"):
        cached = cache.get("leadership")
        if cached:
            return cached
        data = wire["leadership"] if isinstance(wire["leadership"], list) else []
        cache.set("leadership", data, ttl=3600)
        return data

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
    wire = _load_wire_data()
    if wire and wire.get("rundown_html"):
        cached = cache.get("rundown")
        if cached:
            return cached
        data = {"html": wire["rundown_html"], "date": wire.get("date", "")}
        cache.set("rundown", data, ttl=3600)
        return data

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
    wire = _load_wire_data()
    if wire and wire.get("earnings"):
        cached = cache.get("earnings")
        if cached:
            return cached
        raw_earnings = wire["earnings"]
        # wire_data earnings are raw EW entries with "symbol" key; normalise them
        bmo_raw = raw_earnings.get("bmo", []) if isinstance(raw_earnings, dict) else []
        amc_raw = raw_earnings.get("amc", []) if isinstance(raw_earnings, dict) else []
        data = _normalize_earnings(
            [dict(e, hour="bmo") for e in bmo_raw] +
            [dict(e, hour="amc") for e in amc_raw]
        )
        cache.set("earnings", data, ttl=1800)
        return data

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


def _fmt_surprise(actual, estimate):
    if actual is None or estimate is None or estimate == 0:
        return None
    pct = (actual - estimate) / abs(estimate) * 100
    return f"{'+' if pct >= 0 else ''}{pct:.1f}%"


def _normalize_earnings(raw) -> dict:
    """
    fetch_earnings_whispers() returns a flat list with "hour": "bmo" | "amc".
    Split into bmo / amc buckets and expose clean fields.
    """
    bmo, amc = [], []
    for item in (raw or []):
        if not isinstance(item, dict):
            continue
        eps_actual   = item.get("eps_actual")
        eps_estimate = item.get("eps_estimate")
        rev_actual   = item.get("rev_actual")
        rev_estimate = item.get("rev_estimate")
        entry = {
            "sym":              item.get("symbol", item.get("sym", "")),
            "reported_eps":     eps_actual,
            "eps_estimate":     eps_estimate,
            "surprise_pct":     _fmt_surprise(eps_actual, eps_estimate),
            "rev_estimate":     rev_estimate,
            "rev_actual":       rev_actual,
            "rev_surprise_pct": _fmt_surprise(rev_actual, rev_estimate),
        }
        # Derive a simple verdict
        if eps_actual is not None and eps_estimate is not None:
            entry["verdict"] = "Beat" if eps_actual >= eps_estimate else "Miss"
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
                "ticker": item.get("ticker", item.get("sym", item.get("symbol", ""))),
                "rs_score": item.get("score", item.get("rs_score", 0)),
                "vol_ratio": item.get("vol_ratio", 1.0),
                "momentum": item.get("momentum", item.get("mom", 0.0)),
                "cap_tier": item.get("cap_tier", "—"),
                "thesis": item.get("thesis", ""),
            }
            for item in leadership
        ]
    else:
        result = []

    cache.set("screener", result, ttl=900)
    return result
