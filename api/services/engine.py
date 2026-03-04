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

def _enrich_earnings_with_gap(data: dict) -> None:
    """Batch-fetch live change_pct from Massive and add it to each earnings entry."""
    all_entries = data.get("bmo", []) + data.get("amc", [])
    syms = [e["sym"] for e in all_entries if e.get("sym")]
    if not syms:
        return
    try:
        from api.services.massive import _get_client
        price_map = _get_client().get_batch_snapshots(syms)
        for entry in all_entries:
            entry["change_pct"] = price_map.get(entry["sym"])
    except Exception:
        pass


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
        _enrich_earnings_with_gap(data)
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

    _enrich_earnings_with_gap(data)
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

# ─── News helpers ─────────────────────────────────────────────────────────────

_AV_TOPIC_MAP = {
    "Earnings":                "EARN",
    "Mergers & Acquisitions":  "M&A",
    "IPO":                     "IPO",
    "Life Sciences":           "BIO",
    "Economy - Monetary":      "MACRO",
}

_UPGRADE_PATTERNS = (
    "upgrades to", "raises to", "initiates", "outperform",
    "overweight", "price target raised", "raises price target",
    "pt raised", "price target increase",
)
_DOWNGRADE_PATTERNS = (
    "downgrades to", "cuts to", "underperform", "underweight",
    "price target cut", "price target lowered", "pt cut", "pt lowered",
    "price target decrease",
)


def _classify_category(item: dict, headline: str) -> str:
    """Classify an AV article dict into a category badge string."""
    hl = headline.lower()
    if any(p in hl for p in _UPGRADE_PATTERNS):
        return "UPGRADE"
    if any(p in hl for p in _DOWNGRADE_PATTERNS):
        return "DOWNGRADE"
    topics = sorted(
        item.get("topics", []),
        key=lambda t: float(t.get("relevance_score", 0) or 0),
        reverse=True,
    )
    for t in topics:
        badge = _AV_TOPIC_MAP.get(t.get("topic", ""))
        if badge:
            return badge
    return "GENERAL"


def _map_sentiment(label: str | None) -> str:
    """Map AV overall_sentiment_label to 'bullish' | 'bearish' | 'neutral'."""
    if not label:
        return "neutral"
    lc = label.lower()
    if "bullish" in lc:
        return "bullish"
    if "bearish" in lc:
        return "bearish"
    return "neutral"


_SOURCE_TIER = {
    "reuters": 1, "associated press": 1, "ap": 1, "dow jones": 1, "bloomberg": 1,
    "benzinga": 2, "business wire": 2, "pr newswire": 2, "globenewswire": 2, "sec edgar": 2,
}

_CATEGORY_PRIORITY = {
    "EARN": 0, "M&A": 1, "UPGRADE": 2, "DOWNGRADE": 2,
    "BIO": 3, "IPO": 4, "MACRO": 5, "GENERAL": 6,
}
_PREMARKET_PINNED = {"EARN", "M&A", "BIO"}


def _deduplicate_news(items: list[dict]) -> list[dict]:
    """Collapse same-event articles (same ticker + category within 2h) into one item."""
    from datetime import datetime
    # Pre-pass: drop exact URL duplicates (AV sometimes returns the same article twice)
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for item in items:
        u = item.get("url", "")
        if u and u in seen_urls:
            continue
        if u:
            seen_urls.add(u)
        deduped.append(item)
    items = deduped

    buckets: dict[tuple, list[dict]] = {}
    for item in items:
        ticker = (item.get("tickers") or [""])[0]
        category = item.get("category", "GENERAL")
        try:
            ts = datetime.strptime(item["time"], "%Y-%m-%d %H:%M:%S").timestamp()
            bucket = int(ts) // 7200
        except Exception:
            bucket = 0
        key = (ticker, category, bucket)
        buckets.setdefault(key, []).append(item)

    def _tier(it):
        return _SOURCE_TIER.get(it.get("source", "").lower(), 3)

    result = []
    for group in buckets.values():
        best = min(group, key=lambda it: (_tier(it), it.get("time", "")))
        if len(group) > 1:
            other_sources = [g["source"] for g in group if g is not best]
            unique_others = list(dict.fromkeys(other_sources))
            if unique_others:
                extra = f" +{len(unique_others) - 1}" if len(unique_others) > 1 else ""
                best = dict(best)
                best["source"] = f"{best['source']} · {unique_others[0]}{extra}"
        result.append(best)
    return result


def _sort_news(items: list[dict], is_premarket: bool) -> list[dict]:
    """Sort by category priority (premarket-aware) then recency."""
    import datetime as _dt

    def _key(item):
        cat = item.get("category", "GENERAL")
        pri = _CATEGORY_PRIORITY.get(cat, 6)
        if is_premarket and cat in _PREMARKET_PINNED:
            pri = -1
        try:
            ts = _dt.datetime.strptime(item["time"], "%Y-%m-%d %H:%M:%S").timestamp()
            recency = -int(ts)
        except Exception:
            recency = 1  # sort to bottom — positive beats all negative recency values
        return (pri, recency)

    return sorted(items, key=_key)


def get_news() -> list:
    cached = cache.get("news")
    if cached:
        return cached

    av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not av_key:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None,
                   "error": "ALPHAVANTAGE_API_KEY not set"}]
        cache.set("news", result, ttl=120)
        return result

    try:
        import requests as _requests
        from datetime import datetime, timezone, timedelta
        from concurrent.futures import ThreadPoolExecutor, as_completed as _ac

        try:
            from zoneinfo import ZoneInfo
            _et_tz = ZoneInfo("America/New_York")
        except ImportError:
            _et_tz = timezone(timedelta(hours=-5))
        now_et = datetime.now(_et_tz)
        is_premarket = 4 <= now_et.hour < 9 or (now_et.hour == 9 and now_et.minute < 30)
        time_from = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y%m%dT%H%M")

        # ── Fetch AV + EDGAR in parallel ──────────────────────────────────────
        def _fetch_av():
            r = _requests.get(
                "https://www.alphavantage.co/query",
                params={"function": "NEWS_SENTIMENT", "sort": "LATEST",
                        "limit": "200", "time_from": time_from, "apikey": av_key},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15,
            )
            r.raise_for_status()
            return r.json().get("feed", [])

        def _fetch_edgar():
            try:
                from api.services.edgar import fetch_edgar_news
                return fetch_edgar_news(hours=24)
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=2) as ex:
            av_future = ex.submit(_fetch_av)
            edgar_future = ex.submit(_fetch_edgar)
            try:
                av_feed = av_future.result(timeout=20)
            except Exception:
                av_feed = []
            try:
                edgar_items = edgar_future.result(timeout=15)
            except Exception:
                edgar_items = []

        # ── Noise filters ──────────────────────────────────────────────────────
        _BAD_SOURCES = {"stock titan", "intellectia ai"}
        _BAD_HEADLINE = ("sec filings", "stock news today", "stock price and chart",
                         "latest stock news", "annual report")

        # ── Process AV feed → candidate items ─────────────────────────────────
        av_candidates = []
        for item in av_feed:
            if item.get("source", "").lower() in _BAD_SOURCES:
                continue
            headline = item.get("title", "")
            if any(p in headline.lower() for p in _BAD_HEADLINE):
                continue
            ticker_sentiment = sorted(
                item.get("ticker_sentiment", []),
                key=lambda t: float(t.get("relevance_score", 0) or 0),
                reverse=True,
            )
            tickers = []
            for t in ticker_sentiment:
                try:
                    rel = float(t.get("relevance_score", 0))
                except (TypeError, ValueError):
                    rel = 0
                sym = (t.get("ticker") or "").strip().upper()
                if rel >= 0.5 and sym and 1 <= len(sym) <= 4 and sym.isalpha():
                    tickers.append(sym)
                if len(tickers) == 3:
                    break
            if not tickers:
                continue

            ts = item.get("time_published", "")
            try:
                dt_utc = datetime.strptime(ts[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                time_str = dt_utc.astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                time_str = ""

            av_candidates.append({
                "headline":  headline,
                "source":    item.get("source", ""),
                "url":       item.get("url", ""),
                "time":      time_str,
                "category":  _classify_category(item, headline),
                "sentiment": _map_sentiment(item.get("overall_sentiment_label")),
                "tickers":   tickers,
            })

        # ── ETF + volume filter on AV candidates ──────────────────────────────
        unique_syms = list({sym for it in av_candidates for sym in it["tickers"]})

        def _check_sym(sym: str) -> tuple[str, bool]:
            try:
                import yfinance as yf
                fi = yf.Ticker(sym).fast_info
                qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
                if qt.upper() not in ("EQUITY", ""):
                    return sym, False
                price   = getattr(fi, "last_price", 0) or 0
                avg_vol = getattr(fi, "three_month_average_volume", 0) or 0
                return sym, (price * avg_vol) >= 5_000_000
            except Exception:
                return sym, True

        if unique_syms:
            with ThreadPoolExecutor(max_workers=min(len(unique_syms), 12)) as ex:
                allowed = {s for s, ok in (f.result() for f in _ac(
                    ex.submit(_check_sym, s) for s in unique_syms
                )) if ok}
        else:
            allowed = set()

        av_filtered = [
            it for it in av_candidates
            if any(t in allowed for t in it["tickers"])
        ]
        for it in av_filtered:
            it["tickers"] = [t for t in it["tickers"] if t in allowed]

        # ── Merge AV + EDGAR, dedup, sort, take top 40 ────────────────────────
        merged = av_filtered + edgar_items
        deduped = _deduplicate_news(merged)
        sorted_items = _sort_news(deduped, is_premarket=is_premarket)
        top40 = sorted_items[:40]

        # ── Batch Massive price fetch ──────────────────────────────────────────
        primary_tickers = [(it.get("tickers") or [""])[0] for it in top40 if it.get("tickers")]
        price_map: dict[str, float] = {}
        try:
            from api.services.massive import _get_client
            client = _get_client()
            price_map = client.get_batch_snapshots(list(set(primary_tickers)))
        except Exception:
            pass

        # ── Build final 20-item list ───────────────────────────────────────────
        result = []
        for it in top40:
            if len(result) >= 20:
                break
            primary = (it.get("tickers") or [""])[0]
            result.append({
                "headline":   it["headline"],
                "source":     it.get("source", ""),
                "url":        it.get("url", ""),
                "time":       it.get("time", ""),
                "category":   it.get("category", "GENERAL"),
                "sentiment":  it.get("sentiment", "neutral"),
                "tickers":    it.get("tickers", []),
                "change_pct": price_map.get(primary),
            })

    except Exception as e:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None, "error": str(e)}]

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
