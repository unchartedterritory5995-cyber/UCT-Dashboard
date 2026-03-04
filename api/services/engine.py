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
        breadth["exposure"] = _normalize_exposure(state.get("exposure") or {})
    else:
        # Priority 2: wire_data pushed from engine (persisted in Railway volume)
        wire = _load_wire_data()
        if wire and wire.get("breadth"):
            breadth = _normalize_breadth(wire["breadth"], state)
            breadth["exposure"] = _normalize_exposure(wire.get("exposure") or {})
            breadth["ma_data"]  = wire.get("ma_data") or {}
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
        "pct_above_5ma":   raw.get("pct_above_5ma",  raw.get("pct_above_5"))  or None,
        "pct_above_50ma":  raw.get("pct_above_50ma", raw.get("pct_above_50")) or None,
        "pct_above_200ma": raw.get("pct_above_200ma", raw.get("pct_above_200")) or None,
        "advancing":       raw.get("advancing") or None,
        "declining":       raw.get("declining") or None,
        "new_highs":       raw.get("new_highs") or None,
        "new_lows":        raw.get("new_lows")  or None,
        "new_highs_list":  raw.get("new_highs_list", []),
        "new_lows_list":   raw.get("new_lows_list",  []),
        "breadth_score":   raw.get("breadth_score", 50.0),
        "distribution_days": state.get("distribution_days_qqq", 0),
        "market_phase":    state.get("market_phase", ""),
    }


def _normalize_exposure(raw: dict) -> dict:
    """Pass through UCT Intelligence Exposure Rating from wire_data."""
    if not raw:
        return {}
    return {
        "score":       raw.get("score"),
        "score_delta": raw.get("score_delta"),
        "breakdown":   raw.get("breakdown", {}),
        "note":        raw.get("note", ""),
        "gate_active": raw.get("gate_active", False),
        "gate_reason": raw.get("gate_reason"),
        "bonus":       raw.get("bonus", 0),
    }


# ─── Themes ───────────────────────────────────────────────────────────────────

def get_themes(period: str = "1W") -> dict:
    # ── Today: live intraday via Massive batch snapshot ───────────────────────
    if period == "Today":
        cache_key = "themes_Today"
        cached = cache.get(cache_key)
        if cached:
            return cached

        wire = _load_wire_data()
        wire_themes = wire.get("themes", {}) if wire else {}
        tickers = list(wire_themes.keys()) if wire_themes else []

        from api.services.massive import get_etf_snapshots
        snap = get_etf_snapshots(tickers) if tickers else {}

        synthetic = {}
        for ticker, data in wire_themes.items():
            if not isinstance(data, dict):
                continue
            synthetic[ticker] = {**data, "Today": snap.get(ticker, 0.0)}

        result = _normalize_themes(synthetic, "Today")
        cache.set(cache_key, result, ttl=30)
        return result

    # ── Historical periods (1W / 1M / 3M): unchanged ─────────────────────────
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

    av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not av_key:
        result = [{"headline": "News unavailable", "source": "", "url": "", "time": "", "category": "", "ticker": "", "error": "ALPHAVANTAGE_API_KEY not set"}]
        cache.set("news", result, ttl=120)
        return result

    try:
        import requests as _requests
        from datetime import datetime, timezone, timedelta

        # Only fetch articles from last 48h to ensure freshness
        time_from = (datetime.now(timezone.utc) - timedelta(hours=48)).strftime("%Y%m%dT%H%M")

        r = _requests.get(
            "https://www.alphavantage.co/query",
            params={
                "function":  "NEWS_SENTIMENT",
                "sort":      "LATEST",
                "limit":     "200",
                "time_from": time_from,
                "apikey":    av_key,
            },
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
        )
        r.raise_for_status()
        feed = r.json().get("feed", [])

        # Noise sources — aggregator pages, not real news
        _BAD_SOURCES = {"stock titan", "intellectia ai"}
        # Headline patterns that indicate a page listing, not an article
        _BAD_HEADLINE = ("sec filings", "10-k", "10-q", "8-k", "stock news today",
                         "stock price and chart", "latest stock news", "annual report")

        # ── Pass 1: extract all candidate (item, ticker) pairs ────────────────
        candidates = []  # list of (item_dict, ticker_str)
        for item in feed:
            src = item.get("source", "").lower()
            if src in _BAD_SOURCES:
                continue
            headline = item.get("title", "")
            if any(p in headline.lower() for p in _BAD_HEADLINE):
                continue
            for t in item.get("ticker_sentiment", []):
                try:
                    rel = float(t.get("relevance_score", 0))
                except (TypeError, ValueError):
                    rel = 0
                sym = (t.get("ticker") or "").strip().upper()
                if rel >= 0.5 and sym and 1 <= len(sym) <= 4 and sym.isalpha():
                    candidates.append((item, sym))
                    break  # one ticker per article

        # ── Pass 2: filter ETFs + low-volume tickers via yfinance fast_info ──
        unique_syms = list({sym for _, sym in candidates})

        def _check_sym(sym: str) -> tuple[str, bool]:
            """Return (sym, keep) — keep=True if equity with avg dvol >= $5M."""
            try:
                import yfinance as yf
                fi = yf.Ticker(sym).fast_info
                qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
                if qt.upper() not in ("EQUITY", ""):
                    return sym, False  # ETF / mutual fund / index
                price   = getattr(fi, "last_price", 0) or 0
                avg_vol = getattr(fi, "three_month_average_volume", 0) or 0
                return sym, (price * avg_vol) >= 5_000_000
            except Exception:
                return sym, True  # can't check → keep

        from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
        with ThreadPoolExecutor(max_workers=min(len(unique_syms), 12)) as ex:
            allowed = {sym for sym, ok in (f.result() for f in _as_completed(
                ex.submit(_check_sym, s) for s in unique_syms
            )) if ok}

        # ── Pass 3: build result from candidates that passed the filter ───────
        result = []
        seen_tickers = set()
        for item, sym in candidates:
            if len(result) >= 20:
                break
            if sym not in allowed or sym in seen_tickers:
                continue
            seen_tickers.add(sym)
            ts = item.get("time_published", "")
            try:
                dt_utc = datetime.strptime(ts[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                dt_et  = dt_utc.astimezone(timezone(timedelta(hours=-5)))
                time_str = dt_et.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                time_str = ""
            result.append({
                "headline": item.get("title", ""),
                "source":   item.get("source", ""),
                "url":      item.get("url", ""),
                "time":     time_str,
                "category": "",
                "ticker":   sym,
            })

    except Exception as e:
        result = [{"headline": "News unavailable", "source": "", "url": "", "time": "", "category": "", "ticker": "", "error": str(e)}]

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
